<?php
/**
 * Xsegon - the games Steam has installed, read from Steam's own files.
 *
 *     <steam>\steamapps\libraryfolders.vdf       every folder Steam installs into
 *     <library>\steamapps\appmanifest_<id>.acf   one per installed app: its name, its folder
 *     <steam>\appcache\appinfo.vdf               what Steam knows about each app: what kind
 *                                                of app it is, the program it runs, the
 *                                                developer, publisher and release date
 *     <steam>\appcache\librarycache\<id>\        the pictures the Steam library shows: a
 *                                                cover, a logo, a wide background
 *
 * Every one of them is only ever read: nothing here writes into Steam's
 * folders. api\steam.php (Games > Add Steam games) turns what this finds into
 * games of your own (includes\local.php), filed under Steam, with the
 * pictures copied into data\art like any other replaced picture.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';    // paths.steam
require_once __DIR__ . '/overrides.php';
require_once __DIR__ . '/local.php';       // xs_local_read, for what is already here

const XS_STEAM_PLATFORM = 'Steam';

/**
 * Where Steam is: Settings > Paths > Steam folder when it is filled in, else
 * the folder Steam wrote into the registry, else the usual places. '' when
 * there is no Steam to be found.
 *
 * The registry spells it Steam's way ("d:/programs/steam"), so the spelling is
 * taken from Steam's library folder list where it can be: a game added by hand
 * keeps the path as Explorer spells it, and the two are compared.
 */
function xs_steam_root(): string
{
    static $root = null;
    if ($root !== null) {
        return $root;
    }
    $found = '';
    $set = trim((string) (xs_settings()['paths']['steam'] ?? ''));
    $tries = [];
    if ($set !== '') {
        $tries[] = $set;
    } else {
        $out = @shell_exec('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath 2>NUL');
        if (is_string($out) && preg_match('/SteamPath\s+REG_SZ\s+(.+)/i', $out, $m)) {
            $tries[] = trim($m[1]);
        }
        $tries[] = 'C:\\Program Files (x86)\\Steam';
        $tries[] = 'C:\\Program Files\\Steam';
    }
    foreach ($tries as $p) {
        $p = xs_norm_path(str_replace('/', '\\', $p));
        if ($p !== '' && is_dir($p . '\\steamapps')) {
            $found = $p;
            break;
        }
    }
    if ($found !== '') {
        foreach (xs_steam_library_paths($found) as $lib) {
            if (strcasecmp($lib, $found) === 0) {
                $found = $lib;
                break;
            }
        }
    }
    return $root = $found;
}

/**
 * Steam's text KeyValues ("key" "value", "key" { ... }) as nested arrays.
 * Enough for appmanifest and libraryfolders files: quoted strings with \" and
 * \\ inside, braces, and // comments.
 */
function xs_steam_kv(string $text): array
{
    $len = strlen($text);
    $stack = [[]];
    $names = [];
    $key = null;
    $i = 0;
    while ($i < $len) {
        $c = $text[$i];
        if ($c === '"') {
            $s = '';
            $j = $i + 1;
            while ($j < $len && $text[$j] !== '"') {
                if ($text[$j] === '\\' && $j + 1 < $len) {
                    $s .= $text[$j + 1];
                    $j += 2;
                    continue;
                }
                $s .= $text[$j];
                $j++;
            }
            $i = $j + 1;
            if ($key === null) {
                $key = $s;
            } else {
                $stack[count($stack) - 1][$key] = $s;
                $key = null;
            }
        } elseif ($c === '{') {
            $names[] = $key ?? '';
            $stack[] = [];
            $key = null;
            $i++;
        } elseif ($c === '}') {
            if (count($stack) > 1) {
                $obj = array_pop($stack);
                $stack[count($stack) - 1][array_pop($names)] = $obj;
            }
            $i++;
        } elseif ($c === '/' && ($text[$i + 1] ?? '') === '/') {
            $nl = strpos($text, "\n", $i);
            $i = $nl === false ? $len : $nl + 1;
        } else {
            $i++;
        }
    }
    return $stack[0];
}

/** Every folder Steam installs games into, the main one included, each once. */
function xs_steam_library_paths(string $root): array
{
    $paths = [];
    $kv = xs_steam_kv((string) @file_get_contents($root . '\\steamapps\\libraryfolders.vdf'));
    foreach (($kv['libraryfolders'] ?? []) as $lib) {
        if (is_array($lib) && !empty($lib['path'])) {
            $paths[] = xs_norm_path(str_replace('/', '\\', (string) $lib['path']));
        }
    }
    $paths[] = $root;
    $out = [];
    foreach ($paths as $p) {
        $out[strtolower($p)] ??= $p;
    }
    return array_values($out);
}

/**
 * Every app Steam has installed, from each library's appmanifest files:
 * [appid => [id, name, installdir, dir, folder (is it there), state, lastPlayed]].
 */
function xs_steam_installed(string $root): array
{
    $apps = [];
    foreach (xs_steam_library_paths($root) as $lib) {
        $sa = $lib . '\\steamapps';
        foreach (@scandir($sa) ?: [] as $f) {
            if (!preg_match('/^appmanifest_\d+\.acf$/i', $f)) {
                continue;
            }
            $st = xs_steam_kv((string) @file_get_contents($sa . '\\' . $f))['AppState'] ?? null;
            if (!is_array($st) || empty($st['appid'])) {
                continue;
            }
            $id = (string) $st['appid'];
            $name = (string) ($st['installdir'] ?? '');
            $dir = $sa . '\\common\\' . $name;
            $apps[$id] = [
                'id'         => $id,
                'name'       => (string) ($st['name'] ?? $id),
                'installdir' => $name,
                'dir'        => $dir,
                'folder'     => $name !== '' && is_dir($dir),
                'state'      => (int) ($st['StateFlags'] ?? 0),
                'lastPlayed' => (int) ($st['LastPlayed'] ?? 0),
            ];
        }
    }
    return $apps;
}

/**
 * What Steam knows about these apps, from appcache\appinfo.vdf:
 * [appid => [type, name, developer, publisher, released, launch, installdir]].
 * type is Steam's word: Game, Demo, Beta (a playtest), Tool, Application...
 * launch is the program Steam runs for it on Windows, relative to its folder,
 * or null. An app Steam holds no record of is simply not in the answer.
 *
 * The file is binary: format 28, or 29, which keeps the key names in one
 * table at the end. Only the wanted apps are decoded; the rest are stepped
 * over by their length.
 */
function xs_steam_appinfo(string $root, array $ids): array
{
    $b = @file_get_contents($root . '\\appcache\\appinfo.vdf');
    if (!is_string($b) || strlen($b) < 16) {
        return [];
    }
    $magic = unpack('V', $b, 0)[1];
    $v29 = $magic === 0x07564429;
    if (!$v29 && $magic !== 0x07564428) {
        return [];                              // a format this does not know
    }
    $strings = null;
    $p = 8;
    if ($v29) {
        $off = (int) unpack('P', $b, 8)[1];
        $p = 16;
        if ($off <= 16 || $off + 4 > strlen($b)) {
            return [];
        }
        $strings = [];
        $n = unpack('V', $b, $off)[1];
        $q = $off + 4;
        for ($k = 0; $k < $n; $k++) {
            $e = strpos($b, "\0", $q);
            if ($e === false) {
                break;
            }
            $strings[] = substr($b, $q, $e - $q);
            $q = $e + 1;
        }
    }
    $want = array_flip(array_map('strval', $ids));
    $out = [];
    $len = strlen($b);
    while ($p + 8 <= $len) {
        $appid = unpack('V', $b, $p)[1];
        if ($appid === 0) {
            break;
        }
        $size = unpack('V', $b, $p + 4)[1];
        if (isset($want[(string) $appid])) {
            // past the app's header: state, last update, token, two hashes, change number
            $q = $p + 8 + 60;
            $kv = xs_steam_bkv($b, $q, $strings);
            $out[(string) $appid] = xs_steam_facts(is_array($kv['appinfo'] ?? null) ? $kv['appinfo'] : $kv);
        }
        $p += 8 + $size;
    }
    return $out;
}

/** One map of Steam's binary KeyValues, read from $p up to its end marker. */
function xs_steam_bkv(string $b, int &$p, ?array $strings, int $depth = 0): array
{
    $out = [];
    $len = strlen($b);
    while ($p < $len) {
        $t = ord($b[$p++]);
        if ($t === 0x08) {
            return $out;
        }
        if ($strings !== null) {
            $key = $strings[unpack('V', $b, $p)[1]] ?? '';
            $p += 4;
        } else {
            $e = strpos($b, "\0", $p);
            if ($e === false) {
                return $out;
            }
            $key = substr($b, $p, $e - $p);
            $p = $e + 1;
        }
        if ($t === 0x00) {
            $out[$key] = $depth < 32 ? xs_steam_bkv($b, $p, $strings, $depth + 1) : [];
        } elseif ($t === 0x01) {
            $e = strpos($b, "\0", $p);
            if ($e === false) {
                return $out;
            }
            $out[$key] = substr($b, $p, $e - $p);
            $p = $e + 1;
        } elseif ($t === 0x02) {
            $out[$key] = unpack('l', $b, $p)[1];
            $p += 4;
        } elseif ($t === 0x03) {
            $out[$key] = unpack('g', $b, $p)[1];
            $p += 4;
        } elseif ($t === 0x07 || $t === 0x0A) {
            $out[$key] = (string) unpack('P', $b, $p)[1];
            $p += 8;
        } else {
            return $out;                        // a type this does not know: keep what was read
        }
    }
    return $out;
}

/** The few facts Xsegon wants out of one app's record. */
function xs_steam_facts(array $a): array
{
    $c   = is_array($a['common'] ?? null) ? $a['common'] : [];
    $x   = is_array($a['extended'] ?? null) ? $a['extended'] : [];
    $cfg = is_array($a['config'] ?? null) ? $a['config'] : [];
    $dev = (string) ($x['developer'] ?? '');
    $pub = (string) ($x['publisher'] ?? '');
    foreach ((array) ($c['associations'] ?? []) as $as) {
        if (!is_array($as)) {
            continue;
        }
        if ($dev === '' && ($as['type'] ?? '') === 'developer') {
            $dev = (string) ($as['name'] ?? '');
        }
        if ($pub === '' && ($as['type'] ?? '') === 'publisher') {
            $pub = (string) ($as['name'] ?? '');
        }
    }
    $when = (int) ($c['original_release_date'] ?? 0) ?: (int) ($c['steam_release_date'] ?? 0);

    // The program Steam runs on Windows: the default launch entry for Windows,
    // else the first one there is. An entry switched off ("none") or pointing
    // at a steam:// address (the redistributables) is not a program to run.
    $launch = null;
    foreach ((array) ($cfg['launch'] ?? []) as $l) {
        if (!is_array($l) || empty($l['executable']) || ($l['type'] ?? '') === 'none') {
            continue;
        }
        $os = (string) ($l['config']['oslist'] ?? '');
        if ($os !== '' && stripos($os, 'windows') === false) {
            continue;
        }
        if (preg_match('#^[a-z]+://#i', (string) $l['executable'])) {
            continue;
        }
        $isDefault = ($l['type'] ?? 'default') === 'default';
        if ($launch === null || $isDefault) {
            $launch = ['exe' => (string) $l['executable'], 'args' => (string) ($l['arguments'] ?? ''),
                       'workdir' => (string) ($l['workingdir'] ?? '')];
        }
        if ($isDefault) {
            break;
        }
    }
    return [
        'type'       => (string) ($c['type'] ?? ''),
        'name'       => (string) ($c['name'] ?? ''),
        'developer'  => $dev,
        'publisher'  => $pub,
        'released'   => $when > 0 ? date('Y-m-d', $when) : '',
        'launch'     => $launch,
        'installdir' => (string) ($cfg['installdir'] ?? ''),
    ];
}

/**
 * What an app is, for the checklist: 'game'; 'demo' (a demo or a playtest);
 * 'tool' (Steam's word for it is Tool or Application: the redistributables, a
 * game maker); 'none' when its folder is not there to play from.
 */
function xs_steam_kind(array $app, ?array $facts): string
{
    if (empty($app['folder'])) {
        return 'none';
    }
    $type = strtolower((string) ($facts['type'] ?? ''));
    if (in_array($type, ['tool', 'application', 'config', 'video', 'music', 'dlc', 'media'], true)) {
        return 'tool';
    }
    if ($type === 'demo' || $type === 'beta' || preg_match('/\b(demo|playtest)\b/i', (string) $app['name'])) {
        return 'demo';
    }
    return 'game';
}

/**
 * The game's own program, for Play without Steam: the one Steam runs when it
 * has a record of it, else the only program at the top of the folder that
 * is not an installer or a crash reporter. ['exe' => absolute path or '', 'args' => ...].
 */
function xs_steam_exe(array $app, ?array $facts): array
{
    $l = $facts['launch'] ?? null;
    if (is_array($l)) {
        $exe = $app['dir'] . '\\' . ltrim(str_replace('/', '\\', $l['exe']), '\\');
        if (is_file($exe)) {
            return ['exe' => $exe, 'args' => $l['args']];
        }
    }
    $found = [];
    foreach (@scandir($app['dir']) ?: [] as $f) {
        if (preg_match('/\.exe$/i', $f) && !preg_match('/crash|unins|setup|redist|vcredist|dxsetup|launcherhelper|report/i', $f)
            && is_file($app['dir'] . '\\' . $f)) {
            $found[] = $app['dir'] . '\\' . $f;
        }
    }
    return count($found) === 1 ? ['exe' => $found[0], 'args' => ''] : ['exe' => '', 'args' => ''];
}

/**
 * The pictures Steam keeps for an app, by Xsegon's slots: [kind => file].
 * The cover Steam shows in its library is the box, its logo the clear logo,
 * its wide hero picture the background; your own screenshots of the game
 * (F12 in Steam) the screenshot. Only files that are there and not empty.
 * Today's cache has a folder per app; the older one kept them all in one
 * folder with the app's number in front, and both are looked in.
 */
function xs_steam_pictures(string $root, string $appid): array
{
    $cache = $root . '\\appcache\\librarycache';
    $tries = [
        'box'    => ['library_600x900_2x.jpg', 'library_600x900.jpg'],
        'logo'   => ['logo.png'],
        'fanart' => ['library_hero.jpg'],
    ];
    $out = [];
    foreach ($tries as $kind => $names) {
        foreach ($names as $n) {
            foreach ([$cache . '\\' . $appid . '\\' . $n, $cache . '\\' . $appid . '_' . $n] as $f) {
                if (is_file($f) && filesize($f) > 0) {
                    $out[$kind] = $f;
                    continue 3;
                }
            }
        }
    }
    $newest = null;
    $at = 0;
    foreach (@scandir($root . '\\userdata') ?: [] as $u) {
        if (!preg_match('/^\d+$/', $u)) {
            continue;
        }
        $dir = $root . '\\userdata\\' . $u . '\\760\\remote\\' . $appid . '\\screenshots';
        foreach (@scandir($dir) ?: [] as $f) {
            if (preg_match('/\.jpe?g$/i', $f) && ($t = (int) @filemtime($dir . '\\' . $f)) > $at) {
                $at = $t;
                $newest = $dir . '\\' . $f;
            }
        }
    }
    if ($newest !== null) {
        $out['shot'] = $newest;
    }
    return $out;
}

/** Steam's name for a game, without the trade mark signs it likes to wear. */
function xs_steam_title(string $name): string
{
    $t = (string) preg_replace('/[\x{2122}\x{00AE}\x{00A9}]/u', '', $name);
    return trim((string) preg_replace('/\s+/u', ' ', $t));
}

/**
 * Which of your own games is this Steam app already, as an index into the
 * entries: the one linked to it by number, else one whose program lives in
 * its folder (a game added by hand). null when it is not here yet.
 */
function xs_steam_existing(array $entries, array $app): ?int
{
    foreach ($entries as $i => $e) {
        if ((string) ($e['steamId'] ?? '') === (string) $app['id']) {
            return $i;
        }
    }
    $prefix = strtolower(rtrim((string) $app['dir'], '\\')) . '\\';
    foreach ($entries as $i => $e) {
        $run = strtolower(xs_norm_path((string) ($e['run'] ?? '')));
        if (empty($e['steamId']) && $run !== '' && str_starts_with($run, $prefix)) {
            return $i;
        }
    }
    return null;
}
