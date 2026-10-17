<?php
/**
 * Xsegon - Flashpoint Archive, as the Extensions page knows it (includes\extensions.php).
 *
 *     <flashpoint>\version.txt                  which Flashpoint it is ("Flashpoint 12.1 Infinity - ...")
 *     <flashpoint>\Data\flashpoint.sqlite        its game list, read by bin\flashpoint.php
 *     <flashpoint>\Data\Playlists\*.json         its playlists, Favorites among them
 *     <flashpoint>\Data\Images\<kind>\..\<id>.png  its pictures of a game, where it has fetched them
 *     <flashpoint>\CLIFp.exe                     the helper that starts a game without Flashpoint's window,
 *                                                put there by Set up (bin\extensions.php)
 *     data\extensions.json                       { "flashpoint": { "folder", "put": { "helper": tag } } }
 *
 * Its games become games of your own (includes\local.php), filed under Flashpoint, each
 * started as "CLIFp.exe play -i <its Flashpoint ID>", which downloads and mounts it the first
 * time, starts Flashpoint's game server and stays until the game is closed. Flashpoint's
 * folder is only ever read, bar CLIFp.exe beside it.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/drives.php';
require_once __DIR__ . '/gamesdb.php';      // xs_reader_run: the same way of starting a reader

const XS_FP_PLATFORM = 'Flashpoint';
const XS_FP_HELPER   = 'CLIFp.exe';

function xs_ext_state_path(): string
{
    return xs_data_path('extensions.json');
}

/** What Xsegon keeps of the extensions: a folder chosen for each, what it put there. */
function xs_ext_state(): array
{
    $s = xs_read_json(xs_ext_state_path(), []);
    return is_array($s) ? $s : [];
}

function xs_ext_state_set(string $id, array $patch, ?string &$why = null): bool
{
    $all = xs_ext_state();
    $all[$id] = array_merge(is_array($all[$id] ?? null) ? $all[$id] : [], $patch);
    return xs_write_json(xs_ext_state_path(), $all, $why);
}

/**
 * Whether a folder is a Flashpoint: its game list where Flashpoint keeps it, or, before its
 * first start has made one, its version.txt and its own window's program.
 */
function xs_fp_is(string $dir): bool
{
    $DS = DIRECTORY_SEPARATOR;
    return $dir !== '' && xs_drive_stuck($dir) === null && (is_file($dir . $DS . 'Data' . $DS . 'flashpoint.sqlite')
        || (is_file($dir . $DS . 'version.txt') && is_file($dir . $DS . 'Launcher' . $DS . 'Flashpoint.exe')));
}

/**
 * Where Flashpoint may be, in the order looked: the folder chosen on the Extensions page,
 * then a Flashpoint folder at the top of a drive or in your own folders. A test copy looks
 * only where it was told, so it never finds this PC's own.
 */
function xs_fp_places(): array
{
    $chosen = xs_norm_path((string) (xs_ext_state()['flashpoint']['folder'] ?? ''));
    $out = $chosen !== '' ? [$chosen] : [];
    if (xs_test_copy()) {
        return $out;
    }
    foreach (range('C', 'Z') as $d) {
        if (xs_drive_stuck($d . ':\\') === null && @is_dir($d . ':\\')) {
            array_push($out, $d . ':\\Flashpoint', $d . ':\\Games\\Flashpoint');
        }
    }
    $home = (string) getenv('USERPROFILE');
    if ($home !== '') {
        foreach (['', 'Desktop', 'Downloads', 'Documents', 'Games'] as $f) {
            $out[] = $home . ($f !== '' ? DIRECTORY_SEPARATOR . $f : '') . DIRECTORY_SEPARATOR . 'Flashpoint';
        }
    }
    return array_values(array_unique($out));
}

/** Flashpoint's folder on this PC, or '' when none is found. */
function xs_fp_root(): string
{
    foreach (xs_fp_places() as $p) {
        if (xs_fp_is($p)) {
            return $p;
        }
    }
    return '';
}

/** Which Flashpoint it is, from its version.txt: ['text', 'number' (12.1, 14.0.3), 'edition' (Infinity, Ultimate)]. */
function xs_fp_version(string $root): array
{
    $text = trim((string) @file_get_contents($root . DIRECTORY_SEPARATOR . 'version.txt'));
    $text = mb_substr((string) preg_replace('/\s+/', ' ', $text), 0, 120);
    preg_match('/Flashpoint\s+(\d+(?:\.\d+)*)\s*(Infinity|Ultimate|Core)?/i', $text, $m);
    return ['text' => $text, 'number' => (string) ($m[1] ?? ''), 'edition' => ucfirst(strtolower((string) ($m[2] ?? '')))];
}

/**
 * The release of the helper made for this Flashpoint: the one whose version series it is in,
 * else one for the same major version. Null when none is (an older Flashpoint, or a newer one
 * than the list knows).
 */
function xs_fp_fit(array $helper, string $number): ?array
{
    $same = null;
    foreach ((array) ($helper['fits'] ?? []) as $f) {
        $series = (string) ($f['flashpoint'] ?? '');
        if ($series === '' || $number === '') {
            continue;
        }
        if ($number === $series || str_starts_with($number, $series . '.')) {
            return $f;
        }
        if (strtok($series, '.') === strtok($number, '.')) {
            $same = $f;
        }
    }
    return $same;
}

/**
 * The helper beside Flashpoint: whether it is there, which release it is (by its size, or by
 * what Xsegon put there) and whether Xsegon put it there.
 */
function xs_fp_helper_here(string $root, array $helper): array
{
    $exe = $root . DIRECTORY_SEPARATOR . XS_FP_HELPER;
    if (!is_file($exe)) {
        return ['there' => false, 'tag' => null, 'mine' => false, 'path' => $exe];
    }
    $put = (array) (xs_ext_state()['flashpoint']['put'] ?? []);
    $size = (int) @filesize($exe);
    $tag = null;
    foreach ((array) ($helper['fits'] ?? []) as $f) {
        if ((int) ($f['exeSize'] ?? 0) === $size) {
            $tag = (string) $f['tag'];
        }
    }
    $mine = isset($put['helper']) && strcasecmp((string) ($put['helperAt'] ?? ''), $exe) === 0;
    return ['there' => true, 'tag' => $tag ?? ($mine ? (string) $put['helper'] : null), 'mine' => $mine, 'path' => $exe];
}

/** A Flashpoint folder named in its preferences.json, else its usual place. */
function xs_fp_pref_dir(string $root, string $key, string $usual): string
{
    static $prefs = [];
    if (!isset($prefs[$root])) {
        $p = xs_read_json($root . DIRECTORY_SEPARATOR . 'preferences.json', []);
        $prefs[$root] = is_array($p) ? $p : [];
    }
    $rel = (string) ($prefs[$root][$key] ?? '');
    $rel = $rel !== '' && !preg_match('#^([A-Za-z]:|[\\\\/])#', $rel) && !str_contains($rel, '..') ? $rel : $usual;
    return $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
}

/** Where Flashpoint fetches a picture it has not got, or '' when it is set not to. */
function xs_fp_image_base(string $root): string
{
    $p = xs_read_json($root . DIRECTORY_SEPARATOR . 'preferences.json', []);
    $base = is_array($p) && ($p['onDemandImages'] ?? false) === true ? (string) ($p['onDemandBaseUrl'] ?? '') : '';
    return preg_match('#^https://[A-Za-z0-9.-]+/[A-Za-z0-9./_-]*$#', $base) ? rtrim($base, '/') . '/' : '';
}

/**
 * Flashpoint's playlists, its favourites first: [file, title, count, ids]. Each file is one
 * Flashpoint keeps and names; one that does not read as a playlist is left out.
 */
function xs_fp_playlists(string $root): array
{
    $dir = xs_fp_pref_dir($root, 'playlistFolderPath', 'Data/Playlists');
    $out = [];
    foreach (xs_glob($dir, '*.json') as $path) {
        $f = basename($path);
        $j = xs_read_json($path, null);
        if (!is_array($j) || !is_array($j['games'] ?? null)) {
            continue;
        }
        $ids = [];
        foreach ($j['games'] as $g) {
            $id = is_array($g) ? (string) ($g['gameId'] ?? '') : '';
            if (preg_match('/^[0-9a-f-]{36}$/i', $id)) {
                $ids[] = strtolower($id);
            }
        }
        $title = trim((string) ($j['title'] ?? '')) ?: pathinfo($f, PATHINFO_FILENAME);
        $out[] = ['file' => $f, 'title' => mb_substr($title, 0, 80), 'count' => count($ids), 'ids' => array_values(array_unique($ids)),
                  'favourites' => strcasecmp($f, 'Favorites.json') === 0];
    }
    usort($out, static fn($a, $b) => [!$a['favourites'], strtolower($a['title'])] <=> [!$b['favourites'], strtolower($b['title'])]);
    return $out;
}

/** Ask bin\flashpoint.php; its answer, or ['ok' => false, 'error']. */
function xs_fp_read(array $args, int $seconds = 20): array
{
    if (!xs_gamesdb_readable()) {
        return ['ok' => false, 'error' => 'this PHP has not got its sqlite3 file, which reading Flashpoint\'s game list needs'];
    }
    return xs_reader_run('flashpoint.php', $args, $seconds, 'FLPT', 'the reader of Flashpoint\'s game list');
}

/** How many games and animations this Flashpoint lists, or null when its list cannot be read. */
function xs_fp_count(string $root): ?int
{
    $r = xs_fp_read(['count', $root], 15);
    return !empty($r['ok']) ? (int) ($r['total'] ?? 0) : null;
}

/** These games' facts from Flashpoint's list, by its ID; null with $why. */
function xs_fp_facts(string $root, array $ids, ?string &$why = null): ?array
{
    $why = null;
    $ask = xs_data_path('.flashpoint-ask.json');
    if (@file_put_contents($ask, json_encode(array_values($ids))) === false) {
        $why = 'the question for Flashpoint\'s game list could not be written';
        return null;
    }
    $r = xs_fp_read(['facts', $root, $ask], max(20, (int) ceil(count($ids) / 50)));
    @unlink($ask);
    if (empty($r['ok'])) {
        $why = (string) ($r['error'] ?? 'Flashpoint\'s game list did not answer');
        return null;
    }
    return is_array($r['games'] ?? null) ? $r['games'] : [];
}

/** Your games brought in from Flashpoint, by their Flashpoint ID: [fp id => index in the entries]. */
function xs_fp_here(array $entries): array
{
    $out = [];
    foreach ($entries as $i => $e) {
        $id = strtolower((string) ($e['fpId'] ?? ''));
        if ($id !== '') {
            $out[$id] = $i;
        }
    }
    return $out;
}

/**
 * A playlist's games brought in as games of your own under Flashpoint, each started through
 * the helper beside it. One already here is brought up to date where it is empty and keeps
 * what you changed; none is ever taken away. What came: ['added', 'kept', 'unknown',
 * 'online', 'ids' (Xsegon's ids, for their pictures)], or null with $why.
 */
function xs_fp_bring(string $root, array $list, bool $dry, ?string &$why = null): ?array
{
    require_once __DIR__ . '/local.php';
    $facts = xs_fp_facts($root, $list['ids'], $why);
    if ($facts === null) {
        return null;
    }
    $entries = xs_local_read();
    $here = xs_fp_here($entries);
    $run = $root . DIRECTORY_SEPARATOR . XS_FP_HELPER;
    $date = static fn(string $v): string => preg_match('/^\d{4}(-\d{2}(-\d{2})?)?$/', substr(trim($v), 0, 10)) ? substr(trim($v), 0, 10) : '';
    $got = ['added' => 0, 'kept' => 0, 'unknown' => 0, 'online' => 0, 'ids' => []];
    foreach ($list['ids'] as $fid) {
        $f = $facts[$fid] ?? null;
        if (!is_array($f) || trim((string) ($f['title'] ?? '')) === '') {
            $got['unknown']++;              // a game Flashpoint's list no longer has
            continue;
        }
        $at = $here[$fid] ?? null;
        $e = $at === null ? ['title' => trim((string) $f['title']), 'platform' => XS_FP_PLATFORM] : $entries[$at];
        // How it starts follows where Flashpoint is now; everything else only fills what is empty.
        $e['run'] = $run;
        $e['args'] = 'play -i ' . $fid;
        unset($e['url']);
        $e['fpId'] = $fid;
        foreach (['developer' => 'developer', 'publisher' => 'publisher', 'notes' => 'description'] as $mine => $theirs) {
            $v = trim((string) ($f[$theirs] ?? ''));
            if (($e[$mine] ?? '') === '' && $v !== '') {
                $e[$mine] = mb_substr($v, 0, $mine === 'notes' ? 20000 : 500);
            }
        }
        if (($e['released'] ?? '') === '' && $date((string) ($f['released'] ?? '')) !== '') {
            $e['released'] = $date((string) $f['released']);
        }
        $clean = xs_local_clean($e, $at === null ? null : (string) $entries[$at]['id']);
        if (is_string($clean)) {
            xs_log('FLPT', 'not brought in: ' . $f['title'] . ' (' . $fid . '): ' . $clean);
            $got['unknown']++;
            continue;
        }
        $clean['fpId'] = $fid;
        $clean['added'] = $at === null ? date('Y-m-d') : (string) ($entries[$at]['added'] ?? date('Y-m-d'));
        if ($at === null) {
            $entries[] = $clean;
            $here[$fid] = count($entries) - 1;
            $got['added']++;
        } else {
            $entries[$at] = $clean;
            $got['kept']++;
        }
        // A zipped game not downloaded yet is fetched by the helper at its first play; a game with no zip fetches as it plays.
        if (!is_array($f['data'] ?? null) || empty($f['data']['present'])) {
            $got['online']++;
        }
        $got['ids'][] = (string) $clean['id'];
    }
    if (!$dry && ($got['added'] || $got['kept']) && !xs_local_write($entries, $why)) {
        return null;
    }
    return $got;
}

/**
 * One game's empty picture slots filled from Flashpoint: its logo as the box (the picture
 * Flashpoint shows for it), its screenshot as the screenshot. From Flashpoint's folder where
 * it has them, else from where Flashpoint fetches them. A slot set to "use no picture", or
 * one already filled, is left. [kind => 'flashpoint' | 'online' | 'already' | 'kept empty' | 'none' | 'failed: why'].
 */
function xs_fp_pictures(string $root, string $id, string $fid): array
{
    require_once __DIR__ . '/overrides.php';
    require_once __DIR__ . '/fanmake.php';       // xs_fm_fetch: one small download, a test copy's from its stand-in
    $have = xs_own_art_index()[$id] ?? [];
    $hidden = (array) (xs_art_hidden()[$id] ?? []);
    $images = xs_fp_pref_dir($root, 'imageFolderPath', 'Data/Images');
    $base = xs_fp_image_base($root);
    $sub = substr($fid, 0, 2) . DIRECTORY_SEPARATOR . substr($fid, 2, 2) . DIRECTORY_SEPARATOR . $fid . '.png';
    $out = [];
    foreach (['box' => 'Logos', 'shot' => 'Screenshots'] as $kind => $folder) {
        if (isset($have[$kind])) {
            $out[$kind] = 'already';
            continue;
        }
        if (in_array($kind, $hidden, true)) {
            $out[$kind] = 'kept empty';
            continue;
        }
        $file = $images . DIRECTORY_SEPARATOR . $folder . DIRECTORY_SEPARATOR . $sub;
        $bytes = is_file($file) ? @file_get_contents($file) : false;
        $from = 'flashpoint';
        if (!is_string($bytes) || $bytes === '') {
            $bytes = null;
            $from = 'online';
            if ($base !== '') {
                $bytes = xs_fm_fetch($base . $folder . '/' . str_replace(DIRECTORY_SEPARATOR, '/', $sub), $w);
                // Not there (a 404, or a test copy's stand-in with no such file) is no picture; anything else is a fault.
                if ($bytes === null && !preg_match('/\b404\b|Could(n\'t| not) open file/', (string) $w)) {
                    $out[$kind] = 'failed: ' . $w;
                    continue;
                }
            }
        }
        if ($bytes === null || $bytes === '') {
            $out[$kind] = 'none';
            continue;
        }
        $out[$kind] = xs_own_art_store($id, $kind, $bytes, false, $w) !== null ? $from : 'failed: ' . $w;
    }
    return $out;
}

/** How a game of yours from Flashpoint cannot start, or null when it can: said where Play is pressed. */
function xs_fp_launch_why(array $e): ?string
{
    $run = (string) ($e['run'] ?? '');
    if ($run === '' || xs_file_seen($run)) {
        return null;
    }
    $root = dirname($run);
    return xs_fp_is($root)
        ? 'Flashpoint is not set up for Xsegon yet: open Games > Extensions, select Flashpoint, then press Set up'
        : 'Flashpoint is not at ' . $root . ' any more: open Games > Extensions and select Flashpoint to find it again';
}
