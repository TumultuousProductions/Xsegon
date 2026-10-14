<?php
/**
 * Unpack and add: a disc game that is still in its .zip or .7z. No emulator
 * reads a disc from inside an archive, so it is looked into, put in the right
 * console's folder when it stands in the wrong one, unpacked beside itself
 * and taken into the library.
 *
 * Looking reads the archive's list of files and the start of its disc image,
 * where each console writes its own mark. Unpacking is a job in the
 * background (bin\unpack.php), one archive at a time; each one asked for
 * waits as a file of its own in data\unpack-queue, so the page and the
 * worker never write the same file. An archive is never changed or deleted,
 * and is moved to another console's folder only when that was asked.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/scan.php';
require_once __DIR__ . '/romid.php';

/** The mark every Xbox disc carries, 0x10000 into its game partition. */
const XS_UNPACK_XBOX = 'MICROSOFT*XBOX*MEDIA';
/** Where that partition starts in a whole disc image, and whose disc that makes it. */
const XS_UNPACK_XBOX_AT = [0x2080000 => 'Microsoft Xbox 360', 0xFD90000 => 'Microsoft Xbox 360', 0x18300000 => 'Microsoft Xbox'];
/** A disc that is one of the two Xboxes, and does not say which. */
const XS_UNPACK_EITHER_XBOX = 'Microsoft Xbox or Xbox 360';
/** Endings Windows runs. A console's game has no use for one, and it is how a virus travels in a download. */
const XS_UNPACK_RUNS = ['exe', 'scr', 'com', 'bat', 'cmd', 'msi', 'msp', 'lnk', 'pif', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh',
                        'ps1', 'psm1', 'hta', 'jar', 'cpl', 'reg', 'inf', 'chm', 'dll', 'sys'];
/** What Windows Defender gets through in a second of a disc packed in an archive, as measured. */
const XS_UNPACK_DEFENDER_RATE = 30 * 1048576;
// Where an unpack writes until it is whole (bin\unpack.php): never a game, never a disc that stands unpacked.
const XS_UNPACK_WORK = '.xsegon-unpacking';

function xs_unpack_job_path(): string
{
    return xs_data_path('unpack-job.json');
}

function xs_unpack_stop_path(): string
{
    return xs_data_path('unpack-stop');
}

function xs_unpack_queue_dir(): string
{
    return xs_data_path('unpack-queue');
}

/** Archives unpacked before, by their path in lower case: where to, and when. */
function xs_unpack_done_path(): string
{
    return xs_data_path('unpacked.json');
}

function xs_unpack_7zr(): string
{
    $exe = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . '7zr.exe';
    return is_file($exe) ? $exe : '';
}

function xs_unpack_tar(): string
{
    $exe = (getenv('SystemRoot') ?: 'C:\\Windows') . '\\System32\\tar.exe';
    return is_file($exe) ? $exe : '';
}

/**
 * Starts a program with its words as they are, its output on a pipe; null
 * when it will not start. The pipe blocks: a non-blocking one on Windows reads
 * only about 2 MB a second. $says: a file for what it complains of.
 */
function xs_unpack_run(array $cmd, bool $pipe = true, ?string $says = null): ?array
{
    $out = $pipe ? ['pipe', 'w'] : ['file', 'NUL', 'w'];
    $p = @proc_open($cmd, [1 => $out, 2 => ['file', $says ?? 'NUL', 'w']], $pipes, null, null, ['bypass_shell' => true, 'blocking_pipes' => true]);
    if (!is_resource($p)) {
        return null;
    }
    if (isset($pipes[1])) {
        stream_set_chunk_size($pipes[1], 1048576);
    }
    return [$p, $pipes[1] ?? null];
}

/** The first line a program left in such a file, safe to keep and to show; '' when it said nothing. The file goes. */
function xs_unpack_said(string $file): string
{
    $text = trim((string) @file_get_contents($file, false, null, 0, 4096));
    @unlink($file);
    return mb_substr(mb_scrub(trim((string) strtok($text, "\r\n")), 'UTF-8'), 0, 200);
}

/**
 * Windows Defender's own command-line scanner, or '' when it is not here.
 * The test server never reaches the real one: it has a stand-in or none.
 */
function xs_unpack_defender(): string
{
    if (xs_test_copy()) {
        $test = (string) getenv('XSEGON_DEFENDER');
        return $test !== '' && is_file($test) ? $test : '';
    }
    $platform = (getenv('ProgramData') ?: 'C:\\ProgramData') . '\\Microsoft\\Windows Defender\\Platform';
    $newest = '';
    foreach (@scandir($platform) ?: [] as $n) {
        if ($n[0] !== '.' && is_file($platform . '\\' . $n . '\\MpCmdRun.exe') && strnatcmp($n, $newest) > 0) {
            $newest = $n;
        }
    }
    if ($newest !== '') {
        return $platform . '\\' . $newest . '\\MpCmdRun.exe';
    }
    $old = (getenv('ProgramFiles') ?: 'C:\\Program Files') . '\\Windows Defender\\MpCmdRun.exe';
    return is_file($old) ? $old : '';
}

/**
 * Asks Windows Defender about one file, an archive's insides included. It
 * only looks (-DisableRemediation): nothing is removed, quarantined or
 * changed. 'clean', 'found' ($what names what it found), 'stopped' when
 * $go() said to end, or 'unknown' when it is not here or would not say.
 */
function xs_unpack_defender_scan(string $file, ?string &$what = null, ?callable $go = null): string
{
    $what = null;
    $exe = xs_unpack_defender();
    if ($exe === '') {
        return 'unknown';
    }
    $said = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xs-defender-' . getmypid() . '.txt';
    $cmd = array_merge(preg_match('/\.php$/i', $exe) ? [xs_php_exe(), $exe] : [$exe],
        ['-Scan', '-ScanType', '3', '-File', $file, '-DisableRemediation']);
    $p = @proc_open($cmd, [1 => ['file', $said, 'w'], 2 => ['file', 'NUL', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($p)) {
        return 'unknown';
    }
    while (proc_get_status($p)['running']) {
        if ($go !== null && !$go()) {
            @proc_terminate($p);
            proc_close($p);
            @unlink($said);
            return 'stopped';
        }
        usleep(250000);
    }
    proc_close($p);
    $text = (string) @file_get_contents($said);
    @unlink($said);
    if (preg_match('/found no threats/i', $text)) {
        return 'clean';
    }
    if (preg_match('/found \d+ threats?/i', $text)) {
        preg_match_all('/^\s*Threat\s*:\s*(.+?)\s*$/mi', $text, $m);
        $what = implode(', ', array_unique($m[1])) ?: 'a threat it did not name';
        return 'found';
    }
    xs_log('UNPK', 'Windows Defender would not say about ' . basename($file) . ': ' . trim((string) preg_replace('/\s+/', ' ', mb_substr($text, 0, 300))));
    return 'unknown';
}

/**
 * The files in an archive that do not belong in a game:
 *
 *   outside    a path that would be written outside the folder it unpacks into
 *   disguised  a name with hidden characters in it, the kind that make
 *              "game.exe" read as "game.iso"
 *   runs       a Windows program or script
 */
function xs_unpack_odd(array $entries): array
{
    $odd = ['outside' => [], 'disguised' => [], 'runs' => []];
    foreach ($entries as $e) {
        $name = (string) $e['name'];
        if (preg_match('#(?:^|/)\.\.(?:/|$)|^/|^[A-Za-z]:#', $name)) {
            $odd['outside'][] = $name;
        } elseif (preg_match('/[\x00-\x1F]|\xE2\x80[\xAA-\xAE]|\xE2\x81[\xA6-\xA9]/', $name)) {
            $odd['disguised'][] = $name;
        } elseif (in_array(strtolower((string) pathinfo($name, PATHINFO_EXTENSION)), XS_UNPACK_RUNS, true)) {
            $odd['runs'][] = $name;
        }
    }
    return $odd;
}

/**
 * Why nothing is unpacked from this archive, or null when it may be. A disc
 * image is taken alone, so a program beside it simply stays behind; a game
 * kept as a folder is taken whole, so a program in it is a reason to stop.
 */
function xs_unpack_unsafe(array $look): ?string
{
    $odd = $look['odd'];
    $some = static fn (array $n): string => implode(', ', array_slice($n, 0, 3)) . (count($n) > 3 ? ' and ' . (count($n) - 3) . ' more' : '');
    if ($odd['outside']) {
        return 'it holds files that would be written outside its own folder (' . $some($odd['outside']) . '), which no honest archive does';
    }
    if ($odd['disguised']) {
        return 'it holds a file whose name carries hidden characters, the kind that make a program read as something else';
    }
    if ($look['shape'] === 'folder' && $odd['runs']) {
        return 'the game in it is a folder with Windows programs inside (' . $some($odd['runs']) . '), and a console\'s game has no use for one';
    }
    return null;
}

/** May this archive be touched at all: a .zip or .7z that is there, under one of the games folders. */
function xs_unpack_allowed(string $archive, ?string &$why = null): bool
{
    $why = null;
    if (!preg_match('/\.(zip|7z)$/i', $archive) || !is_file($archive)) {
        $why = 'there is no .zip or .7z at ' . $archive;
        return false;
    }
    $real = (string) realpath($archive);
    foreach (xs_scan_roots() as $root) {
        if ($root !== '' && is_dir($root) && xs_inside($real, (string) realpath($root))) {
            return true;
        }
    }
    $why = 'that file is not under one of your games folders';
    return false;
}

/** The files in an archive, each with its name and size unpacked; null with $why. */
function xs_unpack_entries(string $archive, ?string &$why = null): ?array
{
    $why = null;
    $is7z = (bool) preg_match('/\.7z$/i', $archive);
    $out = [];
    if ($is7z && xs_unpack_7zr() !== '') {
        $run = xs_unpack_run([xs_unpack_7zr(), 'l', '-slt', '-sccUTF-8', '--', $archive]);
        $text = $run === null ? '' : (string) stream_get_contents($run[1]);
        if ($run !== null) {
            fclose($run[1]);
            proc_close($run[0]);
        }
        foreach (preg_split('/\r?\n\r?\n/', (string) substr($text, (int) strpos($text, '----------'))) ?: [] as $block) {
            if (preg_match('/^Path = (.+)$/m', $block, $p) && preg_match('/^Size = (\d+)/m', $block, $s)
                && !preg_match('/^(?:Folder = \+|Attributes = D)/m', $block)) {
                $out[] = ['name' => str_replace('\\', '/', trim($p[1])), 'size' => (int) $s[1]];
            }
        }
    } elseif (xs_unpack_tar() !== '') {
        $run = xs_unpack_run([xs_unpack_tar(), '-tvf', $archive]);
        $text = $run === null ? '' : (string) stream_get_contents($run[1]);
        if ($run !== null) {
            fclose($run[1]);
            proc_close($run[0]);
        }
        // -rw-r--r--  0 0  0  7838695424 Oct 01  2011 Game (USA).iso
        foreach (preg_split('/\r?\n/', $text) ?: [] as $line) {
            if (preg_match('/^-\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\w{3}\s+\d+\s+[\d:]+\s+(.+)$/', $line, $m)) {
                $out[] = ['name' => str_replace('\\', '/', $m[2]), 'size' => (int) $m[1]];
            }
        }
    } else {
        $why = $is7z ? 'a .7z needs bin\\7zr.exe or Windows\' tar, and neither is here' : 'Windows\' tar.exe is not here to open a .zip';
        return null;
    }
    if (!$out) {
        $why = 'the archive could not be read, or it is empty';
        return null;
    }
    return $out;
}

/** What a disc says about itself in its first 2 MB: [console, how it says so], or null. */
function xs_unpack_marks(string $head, int $discBytes): ?array
{
    if (substr($head, 0x800, 12) === 'PlayStation3') {
        return ['Sony Playstation 3', 'its disc is signed PlayStation3'];
    }
    // A game partition alone (an "xiso"): either Xbox, told apart by the program in its first folder.
    if (substr($head, 0x10000, 20) === XS_UNPACK_XBOX) {
        $root = unpack('Vsector/Vsize', substr($head, 0x10014, 8));
        $table = substr($head, (int) $root['sector'] * 2048, min((int) $root['size'], 0x10000));
        if (stripos($table, 'default.xex') !== false) {
            return ['Microsoft Xbox 360', 'an Xbox disc whose program is a default.xex'];
        }
        return stripos($table, 'default.xbe') !== false
            ? ['Microsoft Xbox', 'an Xbox disc whose program is a default.xbe']
            : [XS_UNPACK_EITHER_XBOX, 'an Xbox disc, and it does not say which Xbox'];
    }
    // Every other console: the reader the scan uses, on these first bytes as a file.
    $tmp = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xs-unpack-' . getmypid() . '.iso';
    $console = @file_put_contents($tmp, $head) === false ? null : xs_romid_disc($tmp);
    @unlink($tmp);
    if (!is_string($console)) {
        return null;
    }
    // With no boot line in reach that reader goes by size, and it was shown 2 MB: a disc this big is no CD.
    if ($console === 'Sony Playstation' && $discBytes > 900 * 1048576) {
        $console = 'Sony Playstation 2';
    }
    return [$console, 'its disc is signed as one'];
}

/**
 * Which console's disc this is, read from the image inside the archive
 * without unpacking it: the packed stream is read from its start only as far
 * as the marks stand (2 MB for most, a few hundred for an Xbox disc).
 */
function xs_unpack_probe(string $archive, array $entry, int $entries): ?array
{
    $is7z = (bool) preg_match('/\.7z$/i', $archive);
    // Alone in there it is asked for by no name: a name with an accent or a bracket can miss.
    $name = $entries === 1 ? [] : [$entry['name']];
    $run = $is7z && xs_unpack_7zr() !== ''
        ? xs_unpack_run(array_merge([xs_unpack_7zr(), 'e', '-so', '-sccUTF-8', '--', $archive], $name))
        : (xs_unpack_tar() !== '' ? xs_unpack_run(array_merge([xs_unpack_tar(), '-xOf', $archive], $name)) : null);
    if ($run === null) {
        return null;
    }
    [$proc, $pipe] = $run;
    $found = null;
    $head = '';
    $pos = 0;
    $marks = [];                                      // where an Xbox mark would stand => whose disc
    foreach (XS_UNPACK_XBOX_AT as $at => $console) {
        if ($entry['size'] > $at + 0x10000 + 20) {
            $marks[$at + 0x10000] = $console;
        }
    }
    ksort($marks);
    $got = '';
    while ($found === null && !feof($pipe)) {
        $chunk = (string) fread($pipe, 1048576);
        if ($chunk === '') {
            continue;
        }
        if (strlen($head) < 0x200000) {
            $head .= substr($chunk, 0, 0x200000 - strlen($head));
            if (strlen($head) >= 0x200000) {
                $found = xs_unpack_marks($head, $entry['size']);
            }
        }
        // The next mark's 20 bytes, wherever they fall across the pieces read.
        $at = array_key_first($marks);
        while ($found === null && $at !== null && $at < $pos + strlen($chunk)) {
            $from = max($at + strlen($got), $pos);
            $got .= substr($chunk, $from - $pos, 20 - strlen($got));
            if (strlen($got) < 20) {
                break;
            }
            if ($got === XS_UNPACK_XBOX) {
                $found = [$marks[$at], 'its disc carries the Xbox mark where ' . ($marks[$at] === 'Microsoft Xbox' ? 'an Xbox' : 'an Xbox 360') . ' disc keeps it'];
            }
            unset($marks[$at]);
            $got = '';
            $at = array_key_first($marks);
        }
        $pos += strlen($chunk);
        if (!$marks && strlen($head) >= 0x200000) {
            break;
        }
    }
    if ($found === null && $head !== '' && strlen($head) < 0x200000) {
        $found = xs_unpack_marks($head, $entry['size']);         // a disc smaller than 2 MB
    }
    @proc_terminate($proc);
    fclose($pipe);
    proc_close($proc);
    return $found;
}

/**
 * What an archive holds: how many files and how big unpacked, the game in it
 * (a disc image, or a game kept as a folder), and which console's it is.
 * 'top' is the one folder everything stands in, if any. Of a disc image only
 * the disc is taken ('take'); the rest stays ('left'). 'odd': xs_unpack_odd.
 * Without $probe only the quick list of files is read.
 */
function xs_unpack_look(string $archive, ?string &$why = null, bool $probe = true): ?array
{
    $entries = xs_unpack_entries($archive, $why);
    if ($entries === null) {
        return null;
    }
    $look = ['entries' => count($entries), 'bytes' => array_sum(array_column($entries, 'size')),
             'main' => null, 'mainBytes' => 0, 'shape' => 'none', 'console' => null, 'how' => '', 'top' => null, 'names' => [],
             'take' => null, 'left' => [], 'odd' => xs_unpack_odd($entries)];
    $tops = [];
    foreach ($entries as $e) {
        $tops[explode('/', $e['name'])[0]] = true;
    }
    $look['names'] = array_keys($tops);
    $first = (string) array_key_first($tops);
    $look['top'] = count($tops) === 1 && str_contains($entries[0]['name'], '/') ? $first : null;

    // A game kept as a folder says its console by the program in it.
    $folders = ['#(?:^|/)PS3_GAME/USRDIR/EBOOT\.BIN$#i' => ['Sony Playstation 3', 'it holds a PS3_GAME folder'],
                '#(?:^|/)default\.xex$#i' => ['Microsoft Xbox 360', 'it holds a default.xex'],
                '#(?:^|/)default\.xbe$#i' => ['Microsoft Xbox', 'it holds a default.xbe']];
    foreach ($folders as $re => [$console, $how]) {
        foreach ($entries as $e) {
            if (preg_match($re, $e['name'])) {
                return ['main' => $e['name'], 'mainBytes' => $e['size'], 'shape' => 'folder', 'console' => $console, 'how' => $how] + $look;
            }
        }
    }
    // Else a disc image: the biggest .iso, or the biggest of the other kinds.
    $kinds = array_flip(xs_scan_extensions(true) + [99 => 'img']);
    $best = null;
    $take = [];
    $left = [];
    $tops = [];
    $bytes = 0;
    foreach ($entries as $e) {
        $ext = strtolower((string) pathinfo($e['name'], PATHINFO_EXTENSION));
        if (!isset($kinds[$ext])) {
            $left[] = $e['name'];
            continue;
        }
        $take[] = $e['name'];
        $tops[explode('/', $e['name'])[0]] = true;
        $bytes += $e['size'];
        if ($ext === 'm3u') {
            continue;
        }
        $rank = [$ext === 'iso' ? 1 : 0, $e['size']];
        if ($best === null || $rank > $best[0]) {
            $best = [$rank, $e, $ext];
        }
    }
    if ($best === null) {
        return $look;
    }
    $look = ['main' => $best[1]['name'], 'mainBytes' => $best[1]['size'], 'shape' => 'image', 'take' => $take, 'left' => $left,
             'bytes' => $bytes, 'names' => array_keys($tops),
             'top' => count($tops) === 1 && str_contains($take[0], '/') ? (string) array_key_first($tops) : null] + $look;
    if ($probe && in_array($best[2], ['iso', 'bin', 'img'], true)) {
        $says = xs_unpack_probe($archive, $best[1], count($entries));
        if ($says !== null) {
            $look = ['console' => $says[0], 'how' => $says[1]] + $look;
        }
    }
    return $look;
}

/** The console folder an archive stands in: ['platform', 'dir'], looking up to three folders above it. */
function xs_unpack_home(string $archive): array
{
    $dir = dirname($archive);
    for ($i = 0; $i < 3 && $dir !== dirname($dir); $i++) {
        $platform = xs_scan_platform_for(basename($dir));
        if ($platform !== null) {
            return ['platform' => $platform, 'dir' => $dir];
        }
        $dir = dirname($dir);
    }
    return ['platform' => null, 'dir' => dirname($archive)];
}

/** The folder that console's games are kept in, beside $near first: ['dir', 'there']. */
function xs_unpack_folder_for(string $platform, string $near): array
{
    $places = [dirname($near)];
    foreach (xs_scan_roots() as $root) {
        $places[] = $root;
        if (xs_scan_platform_for(basename($root)) === $platform && is_dir($root)) {
            return ['dir' => $root, 'there' => true];
        }
    }
    foreach (array_unique($places) as $place) {
        foreach (@scandir($place) ?: [] as $n) {
            if ($n !== '.' && $n !== '..' && is_dir($place . DIRECTORY_SEPARATOR . $n) && xs_scan_platform_for($n) === $platform) {
                return ['dir' => $place . DIRECTORY_SEPARATOR . $n, 'there' => true];
            }
        }
    }
    $short = array_search($platform, xs_scan_platforms(), true);
    return ['dir' => dirname($near) . DIRECTORY_SEPARATOR . ($short !== false ? $short : $platform), 'there' => false];
}

/**
 * The folder an archive unpacks into. One that brings a folder of its own
 * needs none made; one lying loose in the console's folder gets a folder
 * named for the game, without its disc number, so a set's discs meet in it.
 */
function xs_unpack_dest(string $archive, array $look, string $consoleDir): string
{
    $dir = dirname($archive);
    if ($look['top'] !== null || strcasecmp(xs_norm_path($dir), xs_norm_path($consoleDir)) !== 0) {
        return $dir;
    }
    $name = (string) pathinfo($archive, PATHINFO_FILENAME);
    $name = trim((string) preg_replace('/\s*\((?:Disc|Disk|CD)\s*\d+[^)]*\)/i', '', $name));
    return $dir . DIRECTORY_SEPARATOR . ($name !== '' ? $name : 'game');
}

/** A file of that name and size under a folder, two folders deep at most; else null. */
function xs_unpack_find(string $dir, string $name, int $size, int $depth = 0): ?string
{
    foreach (@scandir($dir) ?: [] as $n) {
        if ($n === '.' || $n === '..') {
            continue;
        }
        $full = $dir . DIRECTORY_SEPARATOR . $n;
        if (is_dir($full)) {
            $deeper = $depth < 2 ? xs_unpack_find($full, $name, $size, $depth + 1) : null;
            if ($deeper !== null) {
                return $deeper;
            }
        } elseif (strcasecmp($n, $name) === 0 && (int) filesize($full) === $size) {
            return $full;
        }
    }
    return null;
}

/**
 * What to do with an archive, from what was seen in it:
 *
 *   right    its console's folder: unpack here
 *   unsure   the disc does not say whose it is: unpack here on the folder's word
 *   wrong    another console's game: 'move' says where it belongs, and whether
 *            a file of its name is there already ('same' size, or 'other')
 *   nogame   no disc and no game folder in it
 *   done     its game is already unpacked ('already' is where)
 */
function xs_unpack_plan(string $archive, array $look): array
{
    $home = xs_unpack_home($archive);
    $plan = ['verdict' => 'right', 'here' => $home['platform'], 'hereDir' => $home['dir'], 'belongs' => $look['console'],
             'move' => null, 'already' => null, 'need' => $look['bytes'], 'unsafe' => xs_unpack_unsafe($look),
             // Whether Windows Defender is here to be asked first, and about how long it takes for this much.
             'defender' => xs_unpack_defender() !== '', 'defenderSeconds' => (int) ceil($look['bytes'] / XS_UNPACK_DEFENDER_RATE)];
    if ($look['shape'] === 'none') {
        return ['verdict' => 'nogame'] + $plan;
    }
    if ($plan['unsafe'] !== null) {
        return ['verdict' => 'unsafe'] + $plan;
    }
    $console = $look['console'];
    $games = $home['dir'];                             // the folder its console's games are kept in
    if ($console === null || $home['platform'] === null) {
        $plan['verdict'] = 'unsure';
    } elseif ($console === XS_UNPACK_EITHER_XBOX) {
        $plan['verdict'] = in_array($home['platform'], ['Microsoft Xbox', 'Microsoft Xbox 360'], true) ? 'right' : 'unsure';
    } elseif ($console !== $home['platform']) {
        $to = xs_unpack_folder_for($console, $home['dir']);
        $twin = $to['dir'] . DIRECTORY_SEPARATOR . basename($archive);
        $plan['verdict'] = 'wrong';
        $plan['move'] = $to + ['twin' => !is_file($twin) ? null : ((int) filesize($twin) === (int) filesize($archive) ? 'same' : 'other'),
                               'dest' => xs_unpack_dest($twin, $look, $to['dir'])];
        $games = $to['there'] ? $to['dir'] : $games;
    }
    $plan['dest'] = xs_unpack_dest($archive, $look, $home['dir']);
    $plan['already'] = $look['shape'] === 'folder'
        ? (is_file($plan['dest'] . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $look['main'])) ? $plan['dest'] : null)
        : xs_unpack_find($games, basename((string) $look['main']), (int) $look['mainBytes']);
    if ($plan['already'] !== null && $plan['verdict'] !== 'wrong') {
        $plan['verdict'] = 'done';
    }
    $free = @disk_free_space(is_dir($plan['dest']) ? $plan['dest'] : dirname($plan['dest']));
    $plan['free'] = $free === false ? null : (int) $free;
    // A gigabyte over, so the drive is not left full to the last byte.
    $plan['room'] = $plan['free'] === null || $plan['free'] > $look['bytes'] + 1073741824;
    return $plan;
}

// ---- the job ----------------------------------------------------------------

/** The job as the worker left it, or null; a worker that is gone is said. */
function xs_unpack_job(): ?array
{
    $job = xs_read_json(xs_unpack_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_unpack_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'Unpacking stopped before it finished: ' . $dead . '. Nothing was added for the archive in hand; ask for it again.';
    }
    return $job;
}

function xs_unpack_running(): bool
{
    return (xs_unpack_job()['state'] ?? '') === 'running';
}

/** Where an archive waits that the worker at work must not take: it started on older code (xs_unpack_code). */
function xs_unpack_held_dir(): string
{
    return xs_unpack_queue_dir() . DIRECTORY_SEPARATOR . 'held';
}

/**
 * The archives asked for and not begun, oldest first: each ['file' (its own in
 * the queue), 'archive', 'move']. $held: with the ones kept for a fresh worker,
 * which a worker itself never takes.
 */
function xs_unpack_waiting(bool $held = false): array
{
    $out = [];
    $files = xs_glob(xs_unpack_queue_dir(), '*.json');
    sort($files);
    $kept = $held ? xs_glob(xs_unpack_held_dir(), '*.json') : [];
    sort($kept);
    foreach (array_merge($files, $kept) as $f) {
        $item = xs_read_json($f, null);
        if (is_array($item) && !empty($item['archive'])) {
            $out[] = ['file' => $f] + $item;
        }
    }
    return $out;
}

/** A mark of the unpacking code as it stands now: the job carries the one its worker started with. */
function xs_unpack_code(): string
{
    return @filemtime(__FILE__) . '-' . @filemtime(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'unpack.php');
}

/**
 * Puts one archive in the queue and starts the worker when none is at work.
 * $scan: ask Windows Defender about it first. $all: asked for with the rest,
 * so nobody looked into it first (the worker does, bin\unpack.php).
 */
function xs_unpack_ask(string $archive, ?string $moveTo, bool $scan, ?string &$why = null, bool $all = false): bool
{
    $why = null;
    foreach (xs_unpack_waiting(true) as $w) {
        if (strcasecmp((string) $w['archive'], $archive) === 0) {
            $why = 'that archive is already waiting its turn';
            return false;
        }
    }
    $job = xs_unpack_job();
    if (($job['state'] ?? '') === 'running' && strcasecmp((string) ($job['now']['archive'] ?? ''), $archive) === 0) {
        $why = 'that archive is being unpacked now';
        return false;
    }
    // A worker keeps the code it started with: one from before a change would do this archive the old way,
    // so the archive is kept for a fresh worker, which starts when that one has ended (xs_unpack_advance).
    $older = ($job['state'] ?? '') === 'running' && ($job['code'] ?? '') !== xs_unpack_code();
    $dir = $older ? xs_unpack_held_dir() : xs_unpack_queue_dir();
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    $file = $dir . DIRECTORY_SEPARATOR . sprintf('%.4f', microtime(true)) . '-' . substr(sha1($archive), 0, 8) . '.json';
    if (!xs_write_json($file, ['archive' => $archive, 'moveTo' => $moveTo, 'scan' => $scan, 'all' => $all, 'asked' => time()], $why)) {
        return false;
    }
    xs_log('UNPK', 'asked for: ' . $archive . ($moveTo !== null ? ', moved to ' . $moveTo . ' first' : '') . ($scan ? '' : ', without the virus check')
        . ($all ? ', with the rest (Unpack all)' : '')
        . ($older ? ', kept for a fresh worker: the one at work started on older code' : ''));
    return ($job['state'] ?? '') === 'running' || xs_unpack_start($why);
}

/**
 * Unpack all: each archive named is asked for, to be unpacked where it
 * stands. ['asked' => how many, 'not' => [['archive', 'why'], ...]].
 */
function xs_unpack_ask_all(array $archives, bool $scan): array
{
    $out = ['asked' => 0, 'not' => []];
    foreach ($archives as $a) {
        $archive = xs_norm_path(trim((string) $a));
        $why = null;
        if (!xs_unpack_allowed($archive, $why) || !xs_unpack_ask($archive, null, $scan, $why, true)) {
            $out['not'][] = ['archive' => $archive, 'why' => (string) $why];
            continue;
        }
        $out['asked']++;
    }
    return $out;
}

/**
 * What the archives still to unpack take as they are, and the room free on
 * the drive each stands on: ['bytes', 'drives' => [['drive', 'bytes', 'free']]].
 * Each archive is given its own 'bytes', and 'spare' when an archive of its
 * name and size was unpacked from another folder and that game still stands:
 * a spare copy is no game waiting, so it is left out of the sums.
 */
function xs_unpack_room(array &$archives): array
{
    $unpacked = [];
    $done = xs_read_json(xs_unpack_done_path(), []);
    foreach (is_array($done) ? $done : [] as $path => $d) {
        if (is_array($d) && (!empty($d['main']) ? is_file((string) $d['main']) : is_dir((string) ($d['dest'] ?? '')))) {
            $unpacked[strtolower(basename((string) $path)) . '|' . (int) ($d['size'] ?? -1)] = true;
        }
    }
    $drives = [];
    $total = 0;
    foreach ($archives as &$a) {
        $file = (string) ($a['file'] ?? '');
        $a['bytes'] = (int) @filesize($file);
        $a['spare'] = isset($unpacked[strtolower(basename($file)) . '|' . $a['bytes']]);
        if ($a['spare']) {
            continue;
        }
        $total += $a['bytes'];
        $drive = preg_match('/^[A-Za-z]:/', $file) ? strtoupper(substr($file, 0, 2)) : dirname($file);
        if (!isset($drives[$drive])) {
            $free = @disk_free_space(dirname($file));
            $drives[$drive] = ['drive' => $drive, 'bytes' => 0, 'free' => $free === false ? null : (int) $free];
        }
        $drives[$drive]['bytes'] += $a['bytes'];
    }
    unset($a);
    return ['bytes' => $total, 'drives' => array_values($drives)];
}

/**
 * What waits with no worker at work goes to a fresh one: the archives kept
 * while a worker on older code ran, and the ones a worker left behind when
 * it ended part way (the PC shut down) or was asked as it was leaving.
 */
function xs_unpack_advance(): void
{
    $job = xs_unpack_job();
    if (($job['state'] ?? '') === 'running') {
        return;
    }
    $kept = xs_glob(xs_unpack_held_dir(), '*.json');
    if ($kept) {
        foreach ($kept as $f) {
            @rename($f, xs_unpack_queue_dir() . DIRECTORY_SEPARATOR . basename($f));
        }
        @rmdir(xs_unpack_held_dir());
        xs_log('UNPK', count($kept) . ' kept for a fresh worker: it starts now, the older one has ended');
        xs_unpack_start();
        return;
    }
    $left = xs_unpack_waiting();
    // Not in the seconds a worker takes to end or to start: its last word may be on its way.
    if (!$left || time() - (int) @filemtime(xs_unpack_job_path()) < 5) {
        return;
    }
    // Stop was pressed and no worker was left to carry it out: what waited is let go, as Stop says.
    if (is_file(xs_unpack_stop_path())) {
        xs_unpack_drop($left);
        xs_log('UNPK', count($left) . ' waiting let go: stopped, with no worker left to do it');
        return;
    }
    // Three starts in a row with nothing done and no more: a worker that cannot run is not started for ever.
    $results = (array) ($job['results'] ?? []);
    $again = count($results) > (int) ($job['carried'] ?? 0) ? 1 : (int) ($job['again'] ?? 0) + 1;
    if ($again > 3) {
        return;
    }
    $hand = (string) ($job['now']['archive'] ?? '');
    if ($hand !== '') {
        $results[] = ['archive' => $hand, 'at' => time(), 'ok' => false,
                      'why' => 'unpacking ended before it was whole, as when Xsegon or the PC is shut down. Nothing of it was kept: ask for it again'];
    }
    xs_log('UNPK', count($left) . ' still waiting with no worker at work' . ($hand !== '' ? ' (it ended on ' . basename($hand) . ')' : '')
        . ': one starts for them' . ($again > 1 ? ', try ' . $again . ' of 3' : ''));
    xs_unpack_start($why, ['results' => $results, 'carried' => count($results), 'again' => $again]);
}

/** Lets go of archives that wait, and of the word to stop: [each from xs_unpack_waiting()]. */
function xs_unpack_drop(array $waiting): void
{
    foreach ($waiting as $w) {
        @unlink((string) $w['file']);
    }
    @unlink(xs_unpack_stop_path());
}

/** Stop lets go of what waits for a fresh worker too. */
function xs_unpack_let_go(): void
{
    foreach (xs_glob(xs_unpack_held_dir(), '*.json') as $f) {
        @unlink($f);
    }
    @rmdir(xs_unpack_held_dir());
}

/** Start the worker: the job written, the worker started and left. $carry: what the run before it had done. */
function xs_unpack_start(?string &$why = null, array $carry = []): bool
{
    $why = null;
    @unlink(xs_unpack_stop_path());
    $job = $carry + ['state' => 'running', 'started' => time(), 'code' => xs_unpack_code(), 'now' => null, 'results' => []];
    if (!xs_write_json(xs_unpack_job_path(), $job, $why)) {
        return false;
    }
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'display_startup_errors=0',
            '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'unpack.php',
            '--server=http://127.0.0.1:' . (int) ($_SERVER['SERVER_PORT'] ?? 0)];
    $handle = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($handle === false) {
        $why = 'the unpacking worker could not be started';
        xs_write_json(xs_unpack_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        xs_log('UNPK', $why . ' (popen failed)');
        return false;
    }
    pclose($handle);
    return true;
}

/** The discs under a folder, two folders deep: name without its ending, lower case => the file. */
function xs_unpack_stems(string $dir, int $depth = 0): array
{
    static $kinds = null;
    $kinds ??= array_flip(array_diff(xs_scan_extensions(true), ['zip', '7z']));
    $out = [];
    foreach (@scandir($dir) ?: [] as $n) {
        if ($n === '.' || $n === '..' || $n === XS_UNPACK_WORK) {
            continue;
        }
        $full = $dir . DIRECTORY_SEPARATOR . $n;
        if (isset($kinds[strtolower((string) pathinfo($n, PATHINFO_EXTENSION))]) && is_file($full)) {
            $out[strtolower((string) pathinfo($n, PATHINFO_FILENAME))] ??= $full;
        } elseif ($depth < 2 && is_dir($full)) {
            $out += xs_unpack_stems($full, $depth + 1);
        }
    }
    return $out;
}

/**
 * Whether an archive's game stands unpacked: the file its record names is
 * there (and the archive is the one recorded), or a disc of the archive's
 * own name is beside it or up to two folders in. $stems keeps each folder's
 * discs for the next archive asked about.
 */
function xs_unpack_stands(string $file, mixed $rec, array &$stems): bool
{
    if (is_array($rec) && !empty($rec['main']) && is_file((string) $rec['main'])
        && (int) ($rec['size'] ?? -1) === (int) @filesize($file)) {
        return true;
    }
    $dir = dirname($file);
    $stems[$dir] ??= xs_unpack_stems($dir);
    return isset($stems[$dir][strtolower((string) pathinfo($file, PATHINFO_FILENAME))]);
}

/**
 * The archives a scan met, without the ones whose game stands unpacked
 * already: [the ones still to unpack, ['count', 'bytes'] of the ones left
 * out]. One in hand or waiting its turn is never left out.
 */
function xs_unpack_sort(array $archives): array
{
    $done = xs_read_json(xs_unpack_done_path(), []);
    $done = is_array($done) ? $done : [];
    $busy = array_map(static fn ($w) => strtolower((string) $w['archive']), xs_unpack_waiting(true));
    $now = (string) (xs_unpack_job()['now']['archive'] ?? '');
    if ($now !== '') {
        $busy[] = strtolower($now);
    }
    $still = [];
    $left = ['count' => 0, 'bytes' => 0];
    $stems = [];
    foreach ($archives as $a) {
        $file = (string) ($a['file'] ?? '');
        $key = strtolower($file);
        if ($file === '' || in_array($key, $busy, true) || !xs_unpack_stands($file, $done[$key] ?? null, $stems)) {
            $still[] = $a;
            continue;
        }
        $left['count']++;
        $left['bytes'] += (int) @filesize($file);
    }
    return [$still, $left];
}

/** Keeps that an archive's game was found unpacked already (a look said so), by the game's own file. */
function xs_unpack_remember(string $archive, array $look, array $plan): void
{
    $main = $look['shape'] === 'folder'
        ? $plan['dest'] . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $look['main'])
        : (string) $plan['already'];
    $done = xs_read_json(xs_unpack_done_path(), []);
    $done = is_array($done) ? $done : [];
    $key = strtolower($archive);
    $old = is_array($done[$key] ?? null) ? $done[$key] : [];
    $size = (int) @filesize($archive);
    if (!is_file($main) || (($old['main'] ?? '') === $main && (int) ($old['size'] ?? -1) === $size)) {
        return;
    }
    $done[$key] = ['main' => $main, 'size' => $size] + $old + ['dest' => dirname($main), 'at' => time(), 'added' => [], 'found' => true];
    xs_write_json(xs_unpack_done_path(), $done);
}

/**
 * How a run ended, in words: what was unpacked first, then what was left
 * packed on purpose ('kept') and what failed. With nothing unpacked it says
 * so, and gives the reason itself when one archive is all there was.
 */
function xs_unpack_ending(array $results): string
{
    $ok = $kept = $bad = 0;
    $why = '';
    foreach ($results as $r) {
        if (!empty($r['ok'])) {
            $ok++;
            continue;
        }
        empty($r['kept']) ? $bad++ : $kept++;
        $why = !empty($r['stopped']) ? 'it was stopped, and what it had written was taken away' : (string) ($r['why'] ?? '');
    }
    $rest = ($kept ? ', ' . $kept . ' left packed' : '') . ($bad ? ', ' . $bad . ' not' : '') . ($kept || $bad ? ' (Scan for Games says why)' : '');
    if ($ok > 0) {
        return $ok . ($ok === 1 ? ' archive' : ' archives') . ' unpacked' . $rest;
    }
    if ($kept + $bad === 1) {
        return 'nothing was unpacked: ' . $why;
    }
    $parts = array_filter([$kept ? $kept . ' left packed' : '', $bad ? $bad . ' could not be unpacked' : '']);
    return 'nothing was unpacked' . ($parts ? ': ' . implode(' and ', $parts) . ' (Scan for Games says why)' : '');
}

/** Everything the page shows: the archive in hand, the ones waiting, how the last ones ended, and what was unpacked before. */
function xs_unpack_status(): array
{
    xs_unpack_advance();
    $job = xs_unpack_job();
    $done = xs_read_json(xs_unpack_done_path(), []);
    // Only what still stands: a game deleted since is one to unpack again.
    $done = array_filter(is_array($done) ? $done : [], static fn ($d) => is_array($d) && !empty($d['main']) && is_file((string) $d['main']));
    return ['running' => ($job['state'] ?? '') === 'running', 'state' => $job['state'] ?? null, 'error' => $job['error'] ?? null,
            // Whether Windows Defender is here to be asked, and this server's clock, for how long a check has run.
            'defender' => xs_unpack_defender() !== '', 'time' => time(),
            'now' => $job['now'] ?? null, 'results' => $job['results'] ?? [], 'started' => (int) ($job['started'] ?? 0),
            'waiting' => array_map(static fn ($w) => (string) $w['archive'], xs_unpack_waiting(true)),
            'unpacked' => is_array($done) ? (object) $done : (object) []];
}

/** Bytes standing under these names in a folder: how far an unpack has come. */
function xs_unpack_size(string $dir, array $names): int
{
    $sum = 0;
    foreach ($names as $n) {
        $full = $dir . DIRECTORY_SEPARATOR . $n;
        if (is_file($full)) {
            $sum += (int) filesize($full);
        } elseif (is_dir($full) && !is_link($full)) {
            $sum += xs_unpack_size($full, array_values(array_diff(@scandir($full) ?: [], ['.', '..'])));
        }
    }
    return $sum;
}

/** Takes away what one unpack wrote: only the names it made, never through a link. */
function xs_unpack_remove(string $path): void
{
    if (is_link($path) || is_file($path)) {
        @unlink($path);
        return;
    }
    foreach (array_diff(@scandir($path) ?: [], ['.', '..']) as $n) {
        xs_unpack_remove($path . DIRECTORY_SEPARATOR . $n);
    }
    @rmdir($path);
}
