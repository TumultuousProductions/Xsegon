<?php
/**
 * Xsegon - hacks: the patches on this PC that fit a game's file, and playing
 * one with that file left as it is.
 *
 * BPS and UPS carry their base file's CRC32; IPS and xdelta are matched by a checksum
 * their readme states or by name. Patches are looked for in Hack folders and in library
 * files that hold a patch and no game.
 *
 * Playing: RetroArch patches as it loads where the core takes the game from memory;
 * else a patched copy is made once in data\hacks. Nothing is written beside the games.
 */
declare(strict_types=1);

require_once __DIR__ . '/filecheck.php';

const XS_HACK_KINDS = ['bps' => 'BPS', 'ups' => 'UPS', 'ips' => 'IPS', 'xdelta' => 'xdelta'];
/** Cores that take the game from memory, by their own code: only these are patched as the game loads. */
const XS_HACK_MEMORY_CORES = ['mupen64plus_next', 'mesen', 'nestopia', 'fceumm', 'snes9x', 'mgba', 'gambatte',
                              'melonds', 'melondsds', 'genesis_plus_gx', 'picodrive'];
/** A game or patch file larger than this is not read for matching. */
const XS_HACK_MAX_BYTES = 134217728;
/** What a file sums to when it ends in its own CRC32, as a BPS or UPS does. */
const XS_HACK_SOUND = '2144df1c';
// What the kept index was read with: a higher number reads every file again (2: a .7z is opened).
const XS_HACK_INDEX = 2;

function xs_hack_dir(): string
{
    return xs_data_path('hacks');
}

/** The switches a person set: ['copy' => [game id => true]], games whose hacks start from a copy. */
function xs_hack_choice(): array
{
    $raw = xs_read_json(xs_data_path('hack-choice.json'), []);
    $copy = [];
    foreach ((array) (is_array($raw) ? ($raw['copy'] ?? []) : []) as $id => $on) {
        if (is_string($id) && $on) {
            $copy[$id] = true;
        }
    }
    return ['copy' => $copy];
}

function xs_hack_copy_set(string $id, bool $on, ?string &$why = null): bool
{
    $c = xs_hack_choice();
    if ($on) {
        $c['copy'][$id] = true;
    } else {
        unset($c['copy'][$id]);
    }
    return xs_write_json(xs_data_path('hack-choice.json'), ['copy' => (object) $c['copy']], $why);
}

/** bin\7zr.exe run on a .7z: [process, its output], or null. A blocking pipe: PHP's other kind on Windows reads 2 MB a second. */
function xs_hack_7z_run(array $args): ?array
{
    $exe = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . '7zr.exe';
    if (!is_file($exe)) {
        return null;
    }
    $p = @proc_open(array_merge([$exe], $args), [1 => ['pipe', 'w'], 2 => ['file', 'NUL', 'w']], $pipes, null, null, ['bypass_shell' => true, 'blocking_pipes' => true]);
    return is_resource($p) ? [$p, $pipes[1]] : null;
}

/** A .7z's own list, in the shape of a .zip's directory: it keeps a CRC32 for each file inside too. */
function xs_hack_7z_dir(string $file): ?array
{
    $list = xs_hack_7z_run(['l', '-slt', '-sccUTF-8', '--', $file]);
    if ($list === null) {
        return null;
    }
    $text = (string) stream_get_contents($list[1]);
    fclose($list[1]);
    proc_close($list[0]);
    if (!str_contains($text, '----------')) {
        return null;
    }
    $out = [];
    foreach (preg_split('/\r?\n\r?\n/', (string) substr($text, (int) strpos($text, '----------'))) ?: [] as $block) {
        if (preg_match('/^Path = (.+)$/m', $block, $p) && preg_match('/^Size = (\d+)/m', $block, $s)
            && !preg_match('/^(?:Folder = \+|Attributes = D)/m', $block)) {
            $out[] = ['name' => trim($p[1]), 'size' => (int) $s[1], 'packed' => 0, 'method' => '7z', 'at' => 0,
                      'crc' => preg_match('/^CRC = ([0-9A-Fa-f]{8})/m', $block, $c) ? strtolower($c[1]) : ''];
        }
    }
    // Alone in there, it is asked for by no name at all: a name with an accent can get lost on the way.
    return array_map(static fn(array $e): array => $e + ['alone' => count($out) === 1], $out);
}

/** One file out of a .7z, whole, or null. */
function xs_hack_7z_bytes(string $file, array $e): ?string
{
    if ($e['size'] > XS_HACK_MAX_BYTES) {
        return null;
    }
    $run = xs_hack_7z_run(array_merge(['e', '-so', '-sccUTF-8', '--', $file], !empty($e['alone']) ? [] : [$e['name']]));
    if ($run === null) {
        return null;
    }
    $out = (string) stream_get_contents($run[1]);
    fclose($run[1]);
    proc_close($run[0]);
    return strlen($out) === $e['size'] ? $out : null;
}

/** An archive's own directory (.zip, or .7z through 7zr): name, size, packed, method, at and crc per file inside, or null. */
function xs_hack_zip_dir(string $file): ?array
{
    if (strtolower((string) pathinfo($file, PATHINFO_EXTENSION)) === '7z') {
        return xs_hack_7z_dir($file);
    }
    $size = @filesize($file);
    $fh = @fopen($file, 'rb');
    if ($fh === false || $size === false || $size < 22) {
        if ($fh !== false) {
            fclose($fh);
        }
        return null;
    }
    $len = (int) min($size, 66000);
    fseek($fh, $size - $len);
    $tail = (string) fread($fh, $len);
    $at = strrpos($tail, "PK\x05\x06");
    if ($at === false || $at + 22 > strlen($tail)) {
        fclose($fh);
        return null;
    }
    $e = unpack('vcount/Vsize/Vat', substr($tail, $at + 10, 10));
    fseek($fh, $e['at']);
    $cd = $e['size'] > 0 ? (string) fread($fh, $e['size']) : '';
    fclose($fh);
    $out = [];
    for ($p = 0, $n = 0; $n < $e['count'] && $p + 46 <= strlen($cd); $n++) {
        if (substr($cd, $p, 4) !== "PK\x01\x02") {
            break;
        }
        $h = unpack('vmethod/vtime/vdate/Vcrc/Vpacked/Vsize/vname/vextra/vcomment', substr($cd, $p + 10, 24));
        $name = substr($cd, $p + 46, $h['name']);
        if (!str_ends_with($name, '/')) {
            $out[] = ['name' => $name, 'size' => (int) $h['size'], 'packed' => (int) $h['packed'], 'method' => (int) $h['method'],
                      'at' => (int) unpack('V', substr($cd, $p + 42, 4))[1], 'crc' => sprintf('%08x', $h['crc'])];
        }
        $p += 46 + $h['name'] + $h['extra'] + $h['comment'];
    }
    return $out;
}

/** One file out of an archive, whole, or null. */
function xs_hack_zip_bytes(string $file, array $e): ?string
{
    if ($e['method'] === '7z') {
        return xs_hack_7z_bytes($file, $e);
    }
    if ($e['size'] > XS_HACK_MAX_BYTES || !in_array($e['method'], [0, 8], true)) {
        return null;
    }
    $fh = @fopen($file, 'rb');
    if ($fh === false) {
        return null;
    }
    fseek($fh, $e['at']);
    $local = (string) fread($fh, 30);
    if (strlen($local) < 30 || substr($local, 0, 4) !== "PK\x03\x04") {
        fclose($fh);
        return null;
    }
    $l = unpack('vname/vextra', substr($local, 26, 4));
    fseek($fh, $e['at'] + 30 + $l['name'] + $l['extra']);
    $raw = '';
    while (strlen($raw) < $e['packed'] && !feof($fh)) {
        $raw .= (string) fread($fh, min(1048576, $e['packed'] - strlen($raw)));
    }
    fclose($fh);
    $out = $e['method'] === 8 ? @gzinflate($raw) : $raw;
    return is_string($out) && strlen($out) === $e['size'] ? $out : null;
}

/** A number as BPS and UPS write it. */
function xs_hack_num(string $s, int &$p): int
{
    $data = 0;
    $shift = 1;
    for ($n = strlen($s); $p < $n;) {
        $x = ord($s[$p++]);
        $data += ($x & 0x7f) * $shift;
        if ($x & 0x80) {
            break;
        }
        $shift <<= 7;
        $data += $shift;
    }
    return $data;
}

/** What a patch says of itself, from its start and its last twelve bytes: the file it was made from and the file it makes. */
function xs_hack_facts(string $kind, string $head, string $tail): ?array
{
    $none = ['base' => null, 'baseBytes' => null, 'result' => null, 'resultBytes' => null];
    if ($kind === 'ips') {
        return substr($head, 0, 5) === 'PATCH' ? $none : null;
    }
    if ($kind === 'xdelta') {
        return substr($head, 0, 3) === "\xD6\xC3\xC4" ? $none : null;
    }
    if (substr($head, 0, 4) !== ($kind === 'bps' ? 'BPS1' : 'UPS1') || strlen($tail) !== 12) {
        return null;
    }
    $p = 4;
    $from = xs_hack_num($head, $p);
    $to = xs_hack_num($head, $p);
    $c = unpack('Vbase/Vresult', $tail);
    return ['base' => sprintf('%08x', $c['base']), 'baseBytes' => $from, 'result' => sprintf('%08x', $c['result']), 'resultBytes' => $to];
}

/** The base checksum a readme states ("CRC32: 7290770d"), or null. */
function xs_hack_says(string $text): ?string
{
    return preg_match('/CRC[\s\-]?32\s*[:=]?\s*\$?(?:0x)?([0-9A-Fa-f]{8})\b/i', $text, $m) ? strtolower($m[1]) : null;
}

/** A patch's name as a person reads it: no ending, no site number, no underscores. */
function xs_hack_title(string $name): string
{
    $t = (string) preg_replace('/\.[A-Za-z0-9]{2,6}$/', '', basename(str_replace('\\', '/', $name)));
    $t = (string) preg_replace('/^(\[\d+\]|\(MOD\))\s*/i', '', $t);
    return trim((string) preg_replace('/\s+/', ' ', str_replace(['_', '+'], ' ', $t))) ?: $name;
}

/** A game's file as a patch sees it: the CRC32 and size of the game itself, or the patches when it holds only those. */
function xs_hack_sum(string $rom): array
{
    $ext = strtolower((string) pathinfo($rom, PATHINFO_EXTENSION));
    $out = ['crc' => null, 'bytes' => 0, 'inner' => null, 'ext' => $ext, 'patches' => [], 'lazy' => false];
    if ($ext === 'zip' || $ext === '7z') {
        $dir = xs_hack_zip_dir($rom);
        if ($dir === null) {
            return $out;
        }
        $isPatch = false;
        $e = xs_fc_pick($dir, $isPatch);
        if ($isPatch) {
            foreach ($dir as $d) {
                if (isset(XS_HACK_KINDS[strtolower((string) pathinfo($d['name'], PATHINFO_EXTENSION))])) {
                    $out['patches'][] = $d['name'];
                }
            }
        } elseif ($e !== null) {
            $out = ['crc' => $e['crc'], 'bytes' => $e['size'], 'inner' => $e['name'],
                    'ext' => strtolower((string) pathinfo($e['name'], PATHINFO_EXTENSION))] + $out;
        }
        return $out;
    }
    // A plain file is summed only when a patch asks about it: a console's worth is slow.
    $out['bytes'] = (int) @filesize($rom);
    $out['lazy'] = $out['bytes'] > 0 && $out['bytes'] <= XS_HACK_MAX_BYTES;
    return $out;
}

/** One patch as the index keeps it, read once and again only when its file changes. */
function xs_hack_patch(string $file, ?array $entry, array $dir, string $stamp, array $old, array $extra): ?array
{
    $inner = $entry === null ? null : $entry['name'];
    $key = substr(sha1(strtolower($file) . '|' . (string) $inner), 0, 16);
    if (isset($old[$key]) && ($old[$key]['stamp'] ?? '') === $stamp) {
        return $extra + $old[$key];
    }
    $kind = strtolower((string) pathinfo($inner ?? $file, PATHINFO_EXTENSION));
    $says = null;
    if ($entry !== null) {
        $bytes = xs_hack_zip_bytes($file, $entry);
        if ($bytes === null) {
            return null;
        }
        $head = substr($bytes, 0, 64);
        $tail = substr($bytes, -12);
        $whole = $entry['crc'];
        $size = $entry['size'];
        // A readme in the same archive is this hack's own.
        foreach ($dir as $d) {
            if ($says === null && preg_match('/\.(txt|nfo|md)$/i', $d['name']) && $d['size'] <= 262144) {
                $says = xs_hack_says((string) xs_hack_zip_bytes($file, $d));
            }
        }
    } else {
        $size = (int) @filesize($file);
        if ($size < 5 || $size > XS_HACK_MAX_BYTES) {
            return null;
        }
        $head = (string) @file_get_contents($file, false, null, 0, 64);
        $tail = (string) @file_get_contents($file, false, null, $size - 12, 12);
        $whole = in_array($kind, ['bps', 'ups'], true) ? (string) @hash_file('crc32b', $file) : '';
        $txt = (string) preg_replace('/\.[A-Za-z0-9]+$/', '.txt', $file);
        if (is_file($txt) && filesize($txt) <= 262144) {
            $says = xs_hack_says((string) @file_get_contents($txt));
        }
    }
    $facts = xs_hack_facts($kind, $head, $tail);
    if ($facts === null) {
        return null;                                   // named like a patch and not one
    }
    return $extra + ['key' => $key, 'file' => $file, 'inner' => $inner, 'kind' => $kind, 'bytes' => $size, 'stamp' => $stamp,
                     'sound' => !in_array($kind, ['bps', 'ups'], true) || $whole === XS_HACK_SOUND, 'says' => $says] + $facts;
}

/** The Hack folders of a console: the ones its games stand in, and the ones beside its games. */
function xs_hack_folders(array $gameDirs): array
{
    $is = static fn(string $n): bool => (bool) preg_match('/^(rom[ _-]?)?hacks?(?![a-z])|^mods?$/i', $n);
    $found = [];
    foreach ($gameDirs as $d) {
        $top = $d;
        while ($is(basename($top)) && dirname($top) !== $top) {
            $found[strtolower($top)] = $top;
            $top = dirname($top);
        }
        foreach ((array) @scandir($top) as $n) {
            if ($n !== '.' && $n !== '..' && $is((string) $n) && is_dir($top . DIRECTORY_SEPARATOR . $n)) {
                $found[strtolower($top . DIRECTORY_SEPARATOR . $n)] = $top . DIRECTORY_SEPARATOR . $n;
            }
        }
    }
    // One inside another is walked with it.
    ksort($found);
    $out = [];
    foreach ($found as $low => $dir) {
        $inside = false;
        foreach ($out as $have) {
            $inside = $inside || str_starts_with($low, strtolower($have) . DIRECTORY_SEPARATOR);
        }
        if (!$inside) {
            $out[] = $dir;
        }
    }
    return $out;
}

/** The files under a Hack folder that could be or hold a patch, three folders deep at most. */
function xs_hack_files(string $dir, int $depth = 0, int &$seen = 0): array
{
    $out = [];
    foreach ((array) @scandir($dir) as $n) {
        if ($n === '.' || $n === '..' || ++$seen > 3000) {
            continue;
        }
        $path = $dir . DIRECTORY_SEPARATOR . $n;
        if (is_dir($path)) {
            if ($depth < 3) {
                $out = array_merge($out, xs_hack_files($path, $depth + 1, $seen));
            }
        } elseif (isset(XS_HACK_KINDS[$ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION))]) || $ext === 'zip' || $ext === '7z') {
            $out[] = $path;
        }
    }
    return $out;
}

/**
 * Every game file of one console as a patch sees it, and every patch for it, kept in
 * data\hacks\index.json and re-read only for a changed file. $want: games to sum now.
 */
function xs_hack_index(string $platform, array $games, array $want = []): array
{
    $s = xs_settings();
    $file = xs_hack_dir() . DIRECTORY_SEPARATOR . 'index.json';
    $all = is_file($file) ? xs_read_json($file, []) : [];
    $all = is_array($all) && ($all['_v'] ?? 0) === XS_HACK_INDEX ? $all : ['_v' => XS_HACK_INDEX];
    $old = (array) ($all[$platform] ?? []);
    $oldGames = (array) ($old['games'] ?? []);
    $oldPatches = [];
    foreach ((array) ($old['patches'] ?? []) as $p) {
        if (is_array($p) && isset($p['key'])) {
            $oldPatches[$p['key']] = $p;
        }
    }
    $now = ['games' => [], 'patches' => [], 'folders' => []];
    $dirs = [];
    foreach ($games as $g) {
        if (($g['platform'] ?? '') !== $platform || !empty($g['local'])) {
            continue;
        }
        $rom = xs_rom_real_path((string) ($g['romPath'] ?? ''), $s);
        if ($rom === '' || !is_file($rom)) {
            continue;
        }
        $stamp = filesize($rom) . ':' . filemtime($rom);
        $was = $oldGames[$g['id']] ?? null;
        $sum = is_array($was) && ($was['rom'] ?? '') === $rom && ($was['stamp'] ?? '') === $stamp
            ? $was : xs_hack_sum($rom) + ['rom' => $rom, 'stamp' => $stamp];
        if (!empty($sum['lazy']) && in_array($g['id'], $want, true)) {
            $sum['crc'] = (string) @hash_file('crc32b', $rom);
            $sum['lazy'] = false;
        }
        $sum['title'] = (string) $g['title'];
        $now['games'][$g['id']] = $sum;
        $dirs[strtolower(dirname($rom))] = dirname($rom);
        if ($sum['patches']) {
            $zd = (array) xs_hack_zip_dir($rom);
            foreach ($zd as $e) {
                if (in_array($e['name'], $sum['patches'], true)) {
                    // Named for its file, which carries the version: three entries of one card share a title.
                    $p = xs_hack_patch($rom, $e, $zd, $stamp, $oldPatches,
                        ['from' => $g['id'], 'name' => xs_hack_title(count($sum['patches']) === 1 ? $rom : $e['name'])]);
                    if ($p !== null) {
                        $now['patches'][$p['key']] = $p;
                    }
                }
            }
        }
    }
    $now['folders'] = xs_hack_folders(array_values($dirs));
    foreach ($now['folders'] as $hd) {
        foreach (xs_hack_files($hd) as $f) {
            $stamp = @filesize($f) . ':' . @filemtime($f);
            if (!in_array(strtolower((string) pathinfo($f, PATHINFO_EXTENSION)), ['zip', '7z'], true)) {
                $p = xs_hack_patch($f, null, [], $stamp, $oldPatches, ['from' => null, 'name' => xs_hack_title($f)]);
                if ($p !== null && !isset($now['patches'][$p['key']])) {
                    $now['patches'][$p['key']] = $p;
                }
                continue;
            }
            $zd = xs_hack_zip_dir($f);
            $isPatch = false;
            if ($zd === null || xs_fc_pick($zd, $isPatch) !== null || !$isPatch) {
                continue;                              // a game, or nothing of ours
            }
            $inside = array_values(array_filter($zd, static fn(array $e): bool
                => isset(XS_HACK_KINDS[strtolower((string) pathinfo($e['name'], PATHINFO_EXTENSION))])));
            foreach ($inside as $e) {
                $p = xs_hack_patch($f, $e, $zd, $stamp, $oldPatches,
                    ['from' => null, 'name' => xs_hack_title(count($inside) === 1 ? $f : $e['name'])]);
                if ($p !== null && !isset($now['patches'][$p['key']])) {
                    $now['patches'][$p['key']] = $p;
                }
            }
        }
    }
    $now['patches'] = array_values($now['patches']);
    if ($now != $old) {
        $all[$platform] = $now;
        if (!is_dir(xs_hack_dir())) {
            @mkdir(xs_hack_dir(), 0777, true);
        }
        xs_write_json($file, $all, $ww);
    }
    return $now;
}

/** The official name of every known release of a console by CRC32, from the list the file check reads. */
function xs_hack_crc_names(string $platform): array
{
    static $mem = [];
    $sys = xs_lr_system($platform);
    if ($sys === null) {
        return [];
    }
    if (!isset($mem[$sys])) {
        $got = xs_lr_cached(xs_lr_cache_name($sys, 'crcs'), static function (?string &$why) use ($sys): ?array {
            $dat = xs_lr_get(xs_lr_base('meta') . '/no-intro/' . rawurlencode($sys) . '.dat', $why, 15);
            if ($dat === null) {
                return null;
            }
            preg_match_all('/rom \( name "((?:[^"\\\\]|\\\\.)*)"[^\n]*?\bcrc ([0-9A-Fa-f]{8})\b/', $dat, $m, PREG_SET_ORDER);
            $names = [];
            foreach ($m as $row) {
                $names[strtolower($row[2])] = (string) preg_replace('/\.[A-Za-z0-9]{2,4}$/', '', $row[1]);
            }
            return $names ? ['names' => $names] : null;
        }, $why);
        $mem[$sys] = (array) ($got['names'] ?? []);
    }
    return $mem[$sys];
}

/** The library entries said to be hacks, each with the game it was said to come from (includes\hackof.php). */
function xs_hack_said_of(): array
{
    require_once __DIR__ . '/hackof.php';
    $out = [];
    foreach (xs_hackof_all() as $id => $rec) {
        if (is_array($rec) && ($rec['is'] ?? '') === 'hack' && (string) ($rec['of'] ?? '') !== '') {
            $out[(string) $id] = (string) $rec['of'];
        }
    }
    return $out;
}

/**
 * Play on an entry whose file is a patch and no game: the game it plays on and the
 * patch's key, or 'on' null with why. Null for an entry that is a game.
 */
function xs_hack_entry_turn(array $game, array $games): ?array
{
    if (!empty($game['local']) || !xs_fc_can((string) ($game['platform'] ?? ''))) {
        return null;
    }
    $rom = xs_rom_real_path((string) ($game['romPath'] ?? ''), xs_settings());
    if (!in_array(strtolower((string) pathinfo($rom, PATHINFO_EXTENSION)), ['zip', '7z'], true) || !is_file($rom)) {
        return null;
    }
    // The file check's word spares the look, while the file is as it was then.
    $rec = xs_fc_all()[(string) $game['id']] ?? null;
    if (is_array($rec) && in_array($rec['kind'] ?? '', ['known', 'unknown'], true)
        && (int) ($rec['size'] ?? -1) === (int) filesize($rom) && (int) ($rec['mtime'] ?? -1) === (int) filemtime($rom)) {
        return null;
    }
    $own = xs_hacks_for($game, $games)['own'];
    if (!$own) {
        return null;
    }
    foreach ($own as $o) {
        if ($o['on'] !== null) {
            return ['on' => $o['on'], 'key' => $o['key'], 'name' => $o['name'], 'why' => null];
        }
    }
    $o = $own[0];
    return ['on' => null, 'key' => $o['key'], 'name' => $o['name'],
            'why' => $o['needs'] !== null ? 'is a patch for ' . $o['needs'] . ', and that release is not in your library'
                   : ($o['names'] ? 'is a patch for a game that is not in your library'
                                  : 'is a patch, not a game. Say in its Hacks tab which game it is a hack of, and Play starts that game with it')];
}

/** The start command a game has today: its emulator where it is now, and the core chosen for it. */
function xs_hack_launch_of(array $game): ?array
{
    if (empty($game['launch']) || !empty($game['launch']['local'])) {
        return null;
    }
    require_once __DIR__ . '/cores.php';
    require_once __DIR__ . '/emulators.php';
    $lb = xs_norm_path(xs_settings()['paths']['launchbox']);
    $launch = xs_emu_repoint($game['launch'], xs_emulators($lb), (string) $game['platform']);
    return xs_core_apply($launch, (string) $game['id'], (string) $game['platform'], $lb)[0];
}

/** Whether RetroArch can patch this game as it loads: its core's short name when it can, else null. */
function xs_hack_memory_core(?array $launch): ?string
{
    if ($launch === null || ($launch['kind'] ?? '') !== 'retroarch') {
        return null;
    }
    $load = lb_core_load((string) ($launch['args'] ?? ''));
    $core = $load === null ? '' : strtolower(lb_core_name($load));
    return in_array($core, XS_HACK_MEMORY_CORES, true) ? $core : null;
}

function xs_hack_stem(string $name): string
{
    return strtolower(trim((string) preg_replace('/\s*\(.*$/', '', $name)));
}

/**
 * Games of your own whose arguments name this game's file (a PC version of a console
 * game). With $sum, a program handed its own copy is found too, by checksum.
 */
function xs_hack_programs(array $game, ?array $sum = null): array
{
    require_once __DIR__ . '/local.php';
    $rom = xs_rom_real_path((string) ($game['romPath'] ?? ''), xs_settings());
    if ($rom === '') {
        return [];
    }
    // The whole name: not the start of a longer one, nor the end of another.
    $whole = '/(^|["\'\s=])' . preg_quote(strtolower(str_replace('/', '\\', $rom)), '/') . '($|["\'\s])/';
    $bytes = (int) ($sum['bytes'] ?? 0);
    $crc = !empty($sum['crc']) && $bytes > 0 && $bytes <= XS_HACK_MAX_BYTES ? (string) $sum['crc'] : null;
    $out = [];
    foreach (xs_local_read() as $e) {
        $run = (string) ($e['run'] ?? '');
        $args = (string) ($e['args'] ?? '');
        if ($run === '' || $args === '' || empty($e['id']) || empty($e['title'])) {
            continue;
        }
        $how = preg_match($whole, strtolower(str_replace('/', '\\', $args))) ? 'file' : null;
        if ($how === null && $crc !== null) {
            // Each file the arguments name: only one of this game's size is read.
            preg_match_all('/"([^"]+)"|([^\s"=]+)/', $args, $named, PREG_SET_ORDER);
            foreach ($named as $t) {
                $f = $t[1] !== '' ? $t[1] : ($t[2] ?? '');
                if (strpbrk($f, '\\/') !== false && @is_file($f) && @filesize($f) === $bytes && @hash_file('crc32b', $f) === $crc) {
                    $how = 'copy';
                    break;
                }
            }
        }
        if ($how === null) {
            continue;
        }
        $out[] = ['id' => (string) $e['id'], 'title' => (string) $e['title'], 'platform' => xs_local_platform($e),
                  'ready' => is_file($run), 'how' => $how];
    }
    usort($out, static fn(array $a, array $b): int => strcasecmp($a['title'], $b['title']));
    return $out;
}

/**
 * What a game's Hacks tab shows: patches that fit its file or another release of it, how
 * each starts, and your own games that play from it. $launch when the caller has it.
 */
function xs_hacks_for(array $game, array $games, ?array $launch = null): array
{
    $platform = (string) ($game['platform'] ?? '');
    $out = ['can' => false, 'why' => null, 'rows' => [], 'own' => [], 'more' => 0, 'folders' => [], 'memory' => null, 'copy' => false, 'programs' => []];
    if (!empty($game['local'])) {
        $out['why'] = 'A game of your own has no patches here: hacks are looked for by a cartridge game\'s checksum.';
        return $out;
    }
    $out['programs'] = xs_hack_programs($game);
    if (!xs_fc_can($platform)) {
        $out['why'] = 'Hacks are found for cartridge consoles only for now, and ' . ($platform ?: 'this') . ' is not one of them.';
        return $out;
    }
    $idx = xs_hack_index($platform, $games, [$game['id']]);
    $sum = $idx['games'][$game['id']] ?? null;
    if ($sum === null) {
        $out['why'] = 'This game\'s file is not there to be read.';
        return $out;
    }
    $out['can'] = true;
    $out['programs'] = xs_hack_programs($game, $sum);
    $out['folders'] = $idx['folders'];
    $launch = $launch ?? xs_hack_launch_of($game);
    $core = xs_hack_memory_core($launch);
    $out['memory'] = $core;
    $out['copy'] = isset(xs_hack_choice()['copy'][$game['id']]);
    $via = preg_replace('/\s*\(.*$/', '', (string) ($launch['via'] ?? '')) ?: 'its emulator';

    // This game's own file is a patch: it plays on the game it was made for.
    if ($sum['patches']) {
        // That game may be a plain file not summed yet: only the ones of the size the patch names are.
        $maybe = [];
        foreach ($idx['patches'] as $p) {
            foreach ($idx['games'] as $gid => $gs) {
                if (($p['from'] ?? null) === $game['id'] && !empty($gs['lazy']) && $gs['bytes'] === $p['baseBytes']) {
                    $maybe[] = $gid;
                }
            }
        }
        $idx = $maybe ? xs_hack_index($platform, $games, $maybe) : $idx;
        $saidOf = xs_hack_said_of();
        foreach ($idx['patches'] as $p) {
            if (($p['from'] ?? null) !== $game['id']) {
                continue;
            }
            $on = null;
            $how = null;
            foreach ($idx['games'] as $gid => $gs) {
                if ($p['base'] !== null && $gs['crc'] === $p['base']) {
                    $on = ['id' => $gid, 'title' => $gs['title']];
                    $how = 'checksum';
                    break;
                }
            }
            // A patch that names no game plays on the game you said it is a hack of.
            $said = $saidOf[(string) $game['id']] ?? '';
            if ($on === null && $p['base'] === null && $said !== '' && isset($idx['games'][$said]) && !$idx['games'][$said]['patches']) {
                $on = ['id' => $said, 'title' => $idx['games'][$said]['title']];
                $how = 'said';
            }
            $out['own'][] = ['key' => $p['key'], 'name' => $p['name'], 'kind' => XS_HACK_KINDS[$p['kind']], 'on' => $on, 'how' => $how,
                             'names' => $p['base'] !== null,
                             'needs' => $on === null && $p['base'] !== null ? (xs_hack_crc_names($platform)[$p['base']] ?? null) : null];
        }
        return $out;
    }

    $mine = strtolower((string) pathinfo($sum['inner'] ?? $sum['rom'], PATHINFO_FILENAME));
    $file = strtolower((string) pathinfo($sum['rom'], PATHINFO_FILENAME));
    $names = null;
    $seen = [];
    $saidOf = xs_hack_said_of();
    foreach ($idx['patches'] as $p) {
        // The same patch kept in two files is one hack.
        $same = $p['base'] === null ? null : $p['kind'] . $p['base'] . $p['result'] . $p['bytes'] . ($p['sound'] ? '' : '!');
        if ($same !== null && isset($seen[$same])) {
            continue;
        }
        $seen[(string) $same] = true;
        $like = strtolower((string) pathinfo($p['inner'] ?? $p['file'], PATHINFO_FILENAME));
        $how = null;
        if ($p['base'] !== null) {
            $how = $sum['crc'] !== null && $p['base'] === $sum['crc'] ? 'checksum' : null;
        } elseif ($p['says'] !== null) {
            $how = $sum['crc'] !== null && $p['says'] === $sum['crc'] ? 'readme' : null;
        } elseif ($like === $mine || $like === $file) {
            $how = 'name';
        } elseif (($saidOf[(string) ($p['from'] ?? '')] ?? null) === (string) $game['id']) {
            $how = 'said';                             // the library entry it is kept in was said to be a hack of this game
        }
        $row = ['key' => $p['key'], 'name' => $p['name'], 'kind' => XS_HACK_KINDS[$p['kind']], 'fits' => $how !== null, 'how' => $how,
                'note' => null, 'route' => null, 'why' => null, 'made' => false, 'sound' => (bool) $p['sound'],
                'from' => $p['from'] ?? null,          // the library entry it is kept in, when it is one
                'where' => basename(dirname($p['file'])) . DIRECTORY_SEPARATOR . basename($p['file'])];
        if ($how === null) {
            $base = $p['base'] ?? $p['says'];
            if ($base === null) {
                $out['more']++;                        // says nothing of its game, and is not named like this one
                continue;
            }
            // Made for another release of this same game: listed, and said.
            $names = $names ?? xs_hack_crc_names($platform);
            $for = $names[$base] ?? null;
            $me = $sum['crc'] === null ? null : ($names[$sum['crc']] ?? null);
            if ($for === null || $me === null || xs_hack_stem($for) !== xs_hack_stem($me)) {
                continue;
            }
            $row['note'] = 'made for ' . $for . '; this file is ' . $me;
            $out['rows'][] = $row;
            continue;
        }
        if (!$p['sound']) {
            $row['why'] = 'the patch file is damaged: it does not sum to its own checksum';
        } elseif ($core !== null && !$out['copy']) {
            $row['route'] = 'memory';
        } elseif ($p['kind'] === 'xdelta') {
            $row['why'] = 'an xdelta patch can only be put on as the game loads in RetroArch, and '
                        . ($core !== null ? 'this game is set to start from a copy' : $via . ' does not take it that way');
        } else {
            $row['route'] = 'copy';
            $row['made'] = is_file(xs_hack_made_path($game, $sum, $p));
        }
        $out['rows'][] = $row;
    }
    usort($out['rows'], static fn(array $a, array $b): int => [$b['fits'], strtolower($a['name'])] <=> [$a['fits'], strtolower($b['name'])]);
    return $out;
}

function xs_hack_made_path(array $game, array $sum, array $p): string
{
    $name = trim((string) preg_replace('/[<>:"\/\\\\|?*\x00-\x1F]+/', ' ', (string) $p['name'])) ?: $p['key'];
    return xs_hack_dir() . DIRECTORY_SEPARATOR . 'made' . DIRECTORY_SEPARATOR . preg_replace('/[^A-Za-z0-9\-]/', '', (string) $game['id'])
         . DIRECTORY_SEPARATOR . $name . '.' . ($sum['ext'] ?: 'bin');
}

/** The patch's own bytes, from its file or out of its archive. */
function xs_hack_patch_bytes(array $p): ?string
{
    if ($p['inner'] === null) {
        $b = @file_get_contents($p['file']);
        return $b === false ? null : $b;
    }
    foreach ((array) xs_hack_zip_dir($p['file']) as $e) {
        if ($e['name'] === $p['inner']) {
            return xs_hack_zip_bytes($p['file'], $e);
        }
    }
    return null;
}

/** A BPS put on $src: the patched bytes, or null with $why. */
function xs_hack_apply_bps(string $src, string $patch, ?string &$why): ?string
{
    $end = strlen($patch) - 12;
    $p = 4;
    $from = xs_hack_num($patch, $p);
    $to = xs_hack_num($patch, $p);
    $p += xs_hack_num($patch, $p);                     // its own notes, passed over
    if ($from !== strlen($src)) {
        $why = 'the patch was made for a file of ' . number_format($from) . ' bytes, and this one is ' . number_format(strlen($src));
        return null;
    }
    $out = '';
    $n = 0;
    $srcAt = 0;
    $outAt = 0;
    while ($p < $end) {
        $d = xs_hack_num($patch, $p);
        $len = ($d >> 2) + 1;
        switch ($d & 3) {
            case 0:
                $out .= substr($src, $n, $len);
                break;
            case 1:
                $out .= substr($patch, $p, $len);
                $p += $len;
                break;
            case 2:
                $d2 = xs_hack_num($patch, $p);
                $srcAt += ($d2 & 1 ? -1 : 1) * ($d2 >> 1);
                $out .= substr($src, $srcAt, $len);
                $srcAt += $len;
                break;
            default:
                $d2 = xs_hack_num($patch, $p);
                $outAt += ($d2 & 1 ? -1 : 1) * ($d2 >> 1);
                $gap = $n - $outAt;
                if ($outAt < 0 || $gap <= 0) {
                    $why = 'the patch does not read as a BPS';
                    return null;
                }
                // It may reach into what it is writing: a run repeats itself.
                $out .= $gap >= $len ? substr($out, $outAt, $len)
                                     : substr(str_repeat(substr($out, $outAt, $gap), intdiv($len, $gap) + 1), 0, $len);
                $outAt += $len;
        }
        $n += $len;
        if (strlen($out) !== $n) {
            $why = 'the patch reaches past the end of the file it was made for';
            return null;
        }
    }
    if ($n !== $to) {
        $why = 'the patched file came out ' . number_format($n) . ' bytes, and the patch says ' . number_format($to);
        return null;
    }
    return $out;
}

/** A UPS put on $src. */
function xs_hack_apply_ups(string $src, string $patch, ?string &$why): ?string
{
    $end = strlen($patch) - 12;
    $p = 4;
    $from = xs_hack_num($patch, $p);
    $to = xs_hack_num($patch, $p);
    if ($from !== strlen($src)) {
        $why = 'the patch was made for a file of ' . number_format($from) . ' bytes, and this one is ' . number_format(strlen($src));
        return null;
    }
    $out = str_pad(substr($src, 0, $to), $to, "\0");
    $at = 0;
    while ($p < $end) {
        $at += xs_hack_num($patch, $p);
        $z = strpos($patch, "\0", $p);
        if ($z === false || $z > $end) {
            $z = $end;
        }
        for (; $p < $z; $p++, $at++) {
            if ($at < $to) {
                $out[$at] = $out[$at] ^ $patch[$p];
            }
        }
        $p++;
        $at++;
    }
    return $out;
}

/** An IPS put on $src. It names no base, so it goes on whatever it is given. */
function xs_hack_apply_ips(string $src, string $patch, ?string &$why): ?string
{
    $out = $src;
    $n = strlen($patch);
    for ($p = 5; $p + 3 <= $n;) {
        if (substr($patch, $p, 3) === 'EOF') {
            // Three more bytes after the end cut the file to that length.
            if ($p + 6 === $n) {
                $out = substr($out, 0, (ord($patch[$p + 3]) << 16) | (ord($patch[$p + 4]) << 8) | ord($patch[$p + 5]));
            }
            return $out;
        }
        if ($p + 5 > $n) {
            break;
        }
        $at = (ord($patch[$p]) << 16) | (ord($patch[$p + 1]) << 8) | ord($patch[$p + 2]);
        $len = (ord($patch[$p + 3]) << 8) | ord($patch[$p + 4]);
        $p += 5;
        $fill = null;
        if ($len === 0) {
            if ($p + 3 > $n) {
                break;
            }
            $len = (ord($patch[$p]) << 8) | ord($patch[$p + 1]);
            $fill = $patch[$p + 2];
            $p += 3;
        } elseif ($p + $len > $n) {
            break;
        }
        if (strlen($out) < $at + $len) {
            $out = str_pad($out, $at + $len, "\0");
        }
        for ($i = 0; $i < $len; $i++) {
            $out[$at + $i] = $fill ?? $patch[$p + $i];
        }
        $p += $fill === null ? $len : 0;
    }
    $why = 'the patch does not read as an IPS to its end';
    return null;
}

/**
 * The patched copy of a game, made once in data\hacks\made and kept until the game or
 * patch changes. A BPS or UPS result must match the checksum the patch names.
 */
function xs_hack_make(array $game, array $sum, array $p, ?string &$why = null): ?string
{
    $why = null;
    $out = xs_hack_made_path($game, $sum, $p);
    $want = ['patch' => $p['key'] . ':' . $p['stamp'], 'game' => $sum['stamp']];
    $have = is_file($out . '.json') ? xs_read_json($out . '.json', null) : null;
    if (is_file($out) && is_array($have) && ($have['patch'] ?? '') === $want['patch'] && ($have['game'] ?? '') === $want['game']) {
        return $out;
    }
    @ini_set('memory_limit', '1536M');
    @set_time_limit(300);
    $t0 = microtime(true);
    $src = '';
    $about = [];
    if (!xs_fc_feed($sum['rom'], static function (string $b) use (&$src): void { $src .= $b; }, $about, $rw) || $src === '') {
        $why = 'the game\'s file could not be read' . ($rw !== null ? ': ' . $rw : '');
        return null;
    }
    $patch = xs_hack_patch_bytes($p);
    if ($patch === null) {
        $why = 'the patch could not be read';
        return null;
    }
    $made = match ($p['kind']) {
        'bps' => xs_hack_apply_bps($src, $patch, $why),
        'ups' => xs_hack_apply_ups($src, $patch, $why),
        'ips' => xs_hack_apply_ips($src, $patch, $why),
        default => null,
    };
    if ($made === null) {
        $why = $why ?? 'a patch of this kind cannot be made into a copy yet';
        return null;
    }
    if ($p['result'] !== null && hash('crc32b', $made) !== $p['result']) {
        $why = 'the patched copy did not come out as the patch says it should, so it was not kept';
        return null;
    }
    if (!is_dir(dirname($out)) && !@mkdir(dirname($out), 0777, true) && !is_dir(dirname($out))) {
        $why = 'the folder for the copy could not be made';
        return null;
    }
    if (@file_put_contents($out . '.part', $made) !== strlen($made) || !@rename($out . '.part', $out)) {
        @unlink($out . '.part');
        $why = 'the copy could not be written (is the disk full?)';
        return null;
    }
    xs_write_json($out . '.json', $want, $ww);
    xs_log('HACK', 'made a copy of ' . $game['title'] . ' with ' . $p['name'] . ': ' . number_format(strlen($made)) . ' bytes in '
        . round((microtime(true) - $t0) * 1000) . 'ms' . ($p['result'] !== null ? ', checksum as the patch says' : ', unchecked (the patch names none)'));
    return $out;
}

/**
 * A game started with one of its hacks: the changed command and RetroArch's lines for
 * that run, or null with $why. $launch is already pointed at today's emulator and core.
 */
function xs_hack_launch(array $game, array $games, array $launch, string $key, ?string &$why = null): ?array
{
    $why = null;
    $list = xs_hacks_for($game, $games, $launch);
    $row = null;
    foreach ($list['rows'] as $r) {
        if ($r['key'] === $key && $r['fits']) {
            $row = $r;
        }
    }
    if ($row === null) {
        $why = 'that patch is not one that fits ' . $game['title'];
        return null;
    }
    if ($row['route'] === null) {
        $why = (string) $row['why'];
        return null;
    }
    $idx = xs_hack_index((string) $game['platform'], $games, [$game['id']]);
    $sum = $idx['games'][$game['id']];
    $p = array_values(array_filter($idx['patches'], static fn(array $x): bool => $x['key'] === $key))[0];
    $append = [];
    if ($row['route'] === 'memory') {
        $file = $p['file'];
        if ($p['inner'] !== null) {
            // RetroArch is handed a file: a patch kept in an archive is put out beside Xsegon's other hack files.
            $file = xs_hack_dir() . DIRECTORY_SEPARATOR . 'patches' . DIRECTORY_SEPARATOR . $p['key'] . '.' . $p['kind'];
            if (!is_file($file) || filesize($file) !== $p['bytes']) {
                $bytes = xs_hack_patch_bytes($p);
                if ($bytes === null || (!is_dir(dirname($file)) && !@mkdir(dirname($file), 0777, true) && !is_dir(dirname($file)))
                    || @file_put_contents($file, $bytes) !== strlen($bytes)) {
                    $why = 'the patch could not be taken out of its archive';
                    return null;
                }
            }
        }
        // Saves follow the game's name, not the patch's: this hack gets a folder of its own, or it would write over the game's.
        $saves = xs_hack_dir() . DIRECTORY_SEPARATOR . 'saves' . DIRECTORY_SEPARATOR . $p['key'];
        if (!is_dir($saves) && !@mkdir($saves, 0777, true) && !is_dir($saves)) {
            $why = 'the folder for this hack\'s saves could not be made';
            return null;
        }
        $launch['args'] = '--' . $p['kind'] . '="' . $file . '" ' . $launch['args'];
        $append = ['savefile_directory = "' . $saves . '"', 'savestate_directory = "' . $saves . '"',
                   'savefiles_in_content_dir = "false"', 'savestates_in_content_dir = "false"', 'config_save_on_exit = "false"'];
    } else {
        $file = xs_hack_make($game, $sum, $p, $why);
        if ($file === null) {
            return null;
        }
        $rom = (string) ($launch['rom'] ?? '');
        if ($rom === '' || !str_contains((string) $launch['args'], $rom)) {
            $why = 'the start command for ' . $game['title'] . ' does not name its file, so the copy cannot stand in for it';
            return null;
        }
        $launch['args'] = str_replace($rom, $file, (string) $launch['args']);
        $launch['rom'] = $file;
    }
    return ['launch' => $launch, 'append' => $append, 'route' => $row['route'], 'name' => $p['name'], 'kind' => $p['kind'], 'file' => $file];
}
