<?php
/**
 * Xsegon - which console a game file is for, read from the file itself.
 *
 * Used for the files that stand OUTSIDE a console folder. Inside one, the
 * folder's name decides unless the file names, for sure, a console the
 * folder's cannot play (xs_scan_file_says, includes\scan.php): a folder called
 * gbc holding .gb games is still Game Boy Color, and a PlayStation disc in the
 * gc folder is a PlayStation game.
 *
 * Three answers, kept apart on purpose:
 *
 *   a console's name   the file says so itself
 *   false              it is not a game (a markdown file called notes.md, a
 *                      Windows .iso, a zip of photographs): never mentioned
 *   null               it may well be a game, and nothing in it can be read
 *                      to say which console (.chd and .7z are packed too
 *                      tightly to look inside): the scan names these and says
 *                      which folder names it understands
 *
 * How it tells, cheapest first:
 *
 *   1. The ending, when one console owns it (.nes, .sfc, .gba, .z64 ...).
 *      Three endings are shared with ordinary files (.md is also a text
 *      note, .gen and .vb also source code), so those are looked into.
 *   2. A .zip is opened as far as its list of names, read by hand from the
 *      end of the file (Xsegon does not rely on PHP's zip extension):
 *      one game file inside with an ending a console owns says the console.
 *   3. A disc image is asked at the places every console writes its name:
 *      "SEGA SEGASATURN" at the start, the PlayStation's and the PSP's name
 *      in the disc's own label, the GameCube's and the Wii's magic numbers
 *      (in a .ciso too, which the GameCube and the PSP both use).
 *      A PlayStation disc is 1 or 2 by the BOOT or BOOT2 line of its
 *      SYSTEM.CNF. A .cue is asked through the file it names, a .m3u through
 *      its first disc.
 *
 * Reads at most a few thousand bytes of any file, and never writes.
 */
declare(strict_types=1);

/** ending => console, for endings one console owns. */
function xs_romid_endings(): array
{
    return [
        'nes' => 'Nintendo Entertainment System', 'unf' => 'Nintendo Entertainment System',
        'fds' => 'Nintendo Famicom Disk System',
        'sfc' => 'Super Nintendo Entertainment System', 'smc' => 'Super Nintendo Entertainment System',
        'gb'  => 'Nintendo Game Boy', 'gbc' => 'Nintendo Game Boy Color', 'gba' => 'Nintendo Game Boy Advance',
        'nds' => 'Nintendo DS',
        'z64' => 'Nintendo 64', 'n64' => 'Nintendo 64', 'v64' => 'Nintendo 64',
        'vb'  => 'Nintendo Virtual Boy', 'min' => 'Nintendo Pokemon Mini',
        'md'  => 'Sega Genesis', 'gen' => 'Sega Genesis', '32x' => 'Sega 32X',
        'sms' => 'Sega Master System', 'gg' => 'Sega Game Gear',
        'a26' => 'Atari 2600', 'a52' => 'Atari 5200', 'a78' => 'Atari 7800', 'lnx' => 'Atari Lynx', 'j64' => 'Atari Jaguar',
        'pce' => 'NEC TurboGrafx-16', 'col' => 'ColecoVision', 'vec' => 'GCE Vectrex', 'int' => 'Mattel Intellivision',
        'ws'  => 'WonderSwan', 'wsc' => 'WonderSwan Color',
        'ngp' => 'SNK Neo Geo Pocket', 'ngc' => 'SNK Neo Geo Pocket Color',
        // discs whose ending is the console's own
        'gdi' => 'Sega Dreamcast', 'cdi' => 'Sega Dreamcast',
        'gcm' => 'Nintendo GameCube', 'wbfs' => 'Nintendo Wii', 'wux' => 'Wii U',
        'cso' => 'Sony PSP',
        'nsp' => 'Nintendo Switch', 'xci' => 'Nintendo Switch', 'nsz' => 'Nintendo Switch',
        '3ds' => 'Nintendo 3DS', 'cia' => 'Nintendo 3DS', 'cci' => 'Nintendo 3DS',
    ];
}

/** Endings that are a game for some console, and for which nobody can say here. */
function xs_romid_sealed(): array
{
    return ['chd', '7z'];
}

/**
 * The console this file is for: its name, false (not a game), or null
 * (cannot be told from the file). See the top of this file. $guess false:
 * a PlayStation disc with no boot line to read is null, not guessed by its
 * size (a guess never overrules a console's folder, includes\scan.php).
 */
function xs_romid(string $file, int $depth = 0, bool $guess = true): string|false|null
{
    $ext  = strtolower((string) pathinfo($file, PATHINFO_EXTENSION));
    $ends = xs_romid_endings();
    if (isset($ends[$ext])) {
        // The three endings ordinary files share: a real game is not text.
        if (in_array($ext, ['md', 'gen', 'vb'], true) && !xs_romid_binary($file, 16384)) {
            return false;
        }
        return $ends[$ext];
    }
    if ($ext === 'chd') {
        return xs_romid_chd($file);
    }
    if (in_array($ext, xs_romid_sealed(), true)) {
        return null;
    }
    if ($ext === 'zip') {
        return xs_romid_zip($file);
    }
    if ($ext === 'rvz' || $ext === 'wia') {
        // Dolphin's packed discs say which of its two consoles in the header.
        $h = xs_romid_read($file, 0x48, 4);
        return $h === "\x00\x00\x00\x01" ? 'Nintendo GameCube' : ($h === "\x00\x00\x00\x02" ? 'Nintendo Wii' : null);
    }
    if ($ext === 'pbp') {
        return xs_romid_pbp($file);
    }
    if ($ext === 'ciso') {
        return xs_romid_ciso($file);
    }
    if ($ext === 'cue' || $ext === 'm3u') {
        if ($depth > 2) {
            return null;
        }
        $inner = $ext === 'cue' ? xs_romid_cue_file($file) : xs_romid_m3u_first($file);
        return $inner === null ? null : xs_romid($inner, $depth + 1, $guess);
    }
    if (in_array($ext, ['iso', 'bin', 'img'], true)) {
        $disc = xs_romid_disc($file, $guess);
        // An .iso with no ordinary disc label is a console's own format this
        // does not read (an Xbox's, a 3DO's): a game, of a console unknown.
        return $disc === false && $ext === 'iso' && substr(xs_romid_read($file, 0x8000, 6), 0, 6) !== "\x01CD001" ? null : $disc;
    }
    return false;
}

/** $len bytes at $at, or '' when the file is shorter or will not open. */
function xs_romid_read(string $file, int $at, int $len): string
{
    $fh = @fopen($file, 'rb');
    if ($fh === false) {
        return '';
    }
    $got = '';
    if (@fseek($fh, $at) === 0) {
        $got = (string) @fread($fh, $len);
    }
    fclose($fh);
    return $got;
}

/** Big enough to be a game, and not text: a zero byte in its first 512. */
function xs_romid_binary(string $file, int $atLeast): bool
{
    if ((int) @filesize($file) < $atLeast) {
        return false;
    }
    return str_contains(xs_romid_read($file, 0, 512), "\0");
}

/**
 * The names and sizes inside a .zip, from its central directory, or null
 * when it is not a zip this can read (damaged, or over 4 GB).
 */
function xs_romid_zip_names(string $file): ?array
{
    $size = (int) @filesize($file);
    if ($size < 22) {
        return null;
    }
    $tailLen = min($size, 66000);
    $tail = xs_romid_read($file, $size - $tailLen, $tailLen);
    $at = strrpos($tail, "PK\x05\x06");
    if ($at === false || strlen($tail) < $at + 22) {
        return null;
    }
    $end = unpack('vdisk/vcdDisk/vhere/vtotal/VcdSize/VcdAt', substr($tail, $at + 4, 16));
    if ($end === false || $end['cdAt'] === 0xFFFFFFFF || $end['cdSize'] > 4 * 1048576 || $end['cdAt'] + $end['cdSize'] > $size) {
        return null;
    }
    $cd = xs_romid_read($file, (int) $end['cdAt'], (int) $end['cdSize']);
    $out = [];
    $p = 0;
    while ($p + 46 <= strlen($cd) && substr($cd, $p, 4) === "PK\x01\x02") {
        $h = unpack('Vsize/vname/vextra/vcomment', substr($cd, $p + 24, 10));
        $m = unpack('vmethod', substr($cd, $p + 10, 2)) + unpack('Vpacked', substr($cd, $p + 20, 4)) + unpack('Vat', substr($cd, $p + 42, 4));
        $name = substr($cd, $p + 46, $h['name']);
        if ($name !== '' && !str_ends_with($name, '/')) {
            $out[] = ['name' => $name, 'size' => (int) $h['size'],
                      'method' => (int) $m['method'], 'packed' => (int) $m['packed'], 'at' => (int) $m['at']];
        }
        $p += 46 + $h['name'] + $h['extra'] + $h['comment'];
        if (count($out) > 400) {
            break;                           // an arcade set or a backup: not one game
        }
    }
    return $out;
}

/** A .zip: the console of the one game inside, false for no game, null if unreadable. */
function xs_romid_zip(string $file): string|false|null
{
    $names = xs_romid_zip_names($file);
    if ($names === null) {
        return null;
    }
    $ends = xs_romid_endings() + ['smd' => 'Sega Genesis'];
    $found = [];
    $games = 0;
    $maybe = 0;
    $others = 0;
    $plain = null;                           // the one .bin or .rom, if there is one
    foreach ($names as $n) {
        $ext = strtolower((string) pathinfo($n['name'], PATHINFO_EXTENSION));
        if (in_array($ext, XS_ROMID_BESIDE, true)) {
            continue;                        // what comes along with a game
        }
        // A README.md is a note, a Genesis game is a hundred times its size.
        if (isset($ends[$ext]) && !(in_array($ext, ['md', 'gen', 'vb'], true) && $n['size'] < 65536)) {
            $found[$ends[$ext]] = true;
            $games++;
        } elseif (in_array($ext, XS_ROMID_ANYONES, true)) {
            $maybe++;
            $plain = $ext === 'bin' || $ext === 'rom' ? $n : $plain;
        } else {
            $others++;
        }
    }
    /* One plain .bin and nothing else that could be a game: the Genesis's
       habit, and the Genesis signs its cartridges 256 bytes in. The start
       of the file is unpacked (zlib is always loaded) and looked at. */
    if (!$found && $maybe === 1 && $plain !== null && $others <= 2) {
        $sign = substr(xs_romid_zip_start($file, $plain, 0x120), 0x100, 16);
        if (str_starts_with($sign, 'SEGA 32X')) {
            return 'Sega 32X';
        }
        if (str_starts_with($sign, 'SEGA') || str_starts_with($sign, ' SEGA')) {
            return 'Sega Genesis';
        }
    }
    // One game of one console, with at most a couple of files nobody can
    // name beside it.
    if (count($found) === 1 && $games <= 2 && $maybe === 0 && $others <= 2) {
        return (string) array_key_first($found);
    }
    /* A game, perhaps, or a bundle of many: not ONE game of ONE console, so
       it is named for the person to unpack or put in a console's folder. */
    if ($found || $maybe > 0) {
        return null;
    }
    return false;
}

/** The first $len bytes of one file inside a zip, unpacked; '' when it cannot be done. */
function xs_romid_zip_start(string $file, array $entry, int $len): string
{
    $local = xs_romid_read($file, $entry['at'], 30);
    if (substr($local, 0, 4) !== "PK\x03\x04") {
        return '';
    }
    $l = unpack('vname/vextra', substr($local, 26, 4));
    $at = $entry['at'] + 30 + $l['name'] + $l['extra'];
    if ($entry['method'] === 0) {
        return xs_romid_read($file, $at, $len);                      // stored as it is
    }
    if ($entry['method'] !== 8 || !function_exists('inflate_init')) {
        return '';
    }
    $ctx = @inflate_init(ZLIB_ENCODING_RAW);
    if ($ctx === false) {
        return '';
    }
    // Deflate rarely shrinks a game below a quarter: four times what is wanted, and a little.
    $out = @inflate_add($ctx, xs_romid_read($file, $at, min($entry['packed'], $len * 4 + 4096)), ZLIB_SYNC_FLUSH);
    return is_string($out) ? substr($out, 0, $len) : '';
}

/**
 * A .chd is packed too tightly to read the disc in it, but its own notes
 * (plain, after the header) say when the disc is a GD-ROM, and only the
 * Dreamcast has those. Any other .chd: null, it cannot be told.
 */
function xs_romid_chd(string $file): ?string
{
    $head = xs_romid_read($file, 0, 64);
    if (substr($head, 0, 8) !== 'MComprHD' || unpack('N', substr($head, 12, 4))[1] !== 5) {
        return null;
    }
    $at = unpack('J', substr($head, 48, 8))[1];
    for ($i = 0; $i < 40 && $at > 0; $i++) {
        $entry = xs_romid_read($file, (int) $at, 16);
        if (strlen($entry) < 16) {
            break;
        }
        if (substr($entry, 0, 4) === 'CHGD') {
            return 'Sega Dreamcast';
        }
        $at = unpack('J', substr($entry, 8, 8))[1];
    }
    return null;
}

/** What comes along with a game in its zip: notes, pictures, patches. */
const XS_ROMID_BESIDE = ['txt', 'nfo', 'diz', 'url', 'jpg', 'jpeg', 'png', 'gif', 'pdf', 'htm', 'html',
                         'ips', 'bps', 'ups', 'xdelta', 'nsf', 'ico'];
/** Endings a game can have that no one console owns. */
const XS_ROMID_ANYONES = ['bin', 'rom', 'zip', '7z', 'iso', 'chd', 'cue', 'img'];

/**
 * Inside a console's folder the folder says which console, so the only
 * question left for a .zip is whether there is a game in it at all: a patch
 * in a zip and a tool's source code are not. True when it cannot be read
 * (the folder's word stands).
 */
function xs_romid_zip_game(string $file): bool
{
    $names = xs_romid_zip_names($file);
    if ($names === null) {
        return true;
    }
    $ends = xs_romid_endings() + ['smd' => 'Sega Genesis'];
    foreach ($names as $n) {
        $ext = strtolower((string) pathinfo($n['name'], PATHINFO_EXTENSION));
        if ((isset($ends[$ext]) && !(in_array($ext, ['md', 'gen', 'vb'], true) && $n['size'] < 65536))
            || in_array($ext, XS_ROMID_ANYONES, true)) {
            return true;
        }
    }
    return false;
}

/** The file a .cue names first, when it is there; else null. */
function xs_romid_cue_file(string $cue): ?string
{
    $text = xs_romid_read($cue, 0, 4096);
    if (!preg_match('/^\s*FILE\s+"([^"]+)"/mi', $text, $m) && !preg_match('/^\s*FILE\s+(\S+)/mi', $text, $m)) {
        return null;
    }
    $f = dirname($cue) . DIRECTORY_SEPARATOR . basename(str_replace('\\', '/', $m[1]));
    return is_file($f) ? $f : null;
}

/** The first disc a .m3u lists, when it is there; else null. */
function xs_romid_m3u_first(string $m3u): ?string
{
    foreach (preg_split('/\r?\n/', xs_romid_read($m3u, 0, 4096)) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        // Beside the playlist, or in a folder beside it that the line names.
        $f = dirname($m3u) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $line);
        if (!is_file($f)) {
            $f = dirname($m3u) . DIRECTORY_SEPARATOR . basename(str_replace('\\', '/', $line));
        }
        return is_file($f) ? $f : null;
    }
    return null;
}

/**
 * A .ciso is two consoles' packed disc. The GameCube's and the Wii's keep the
 * disc's first block whole after a 32 KB map, magic number and all; the PSP's
 * is compressed from its 24 byte header on.
 */
function xs_romid_ciso(string $file): string|false|null
{
    $head = xs_romid_read($file, 0, 4);
    if ($head === '') {
        return null;
    }
    if ($head !== 'CISO') {
        return false;
    }
    $disc = xs_romid_read($file, 0x8018, 8);
    if (substr($disc, 4, 4) === "\xC2\x33\x9F\x3D") {
        return 'Nintendo GameCube';
    }
    if (substr($disc, 0, 4) === "\x5D\x1C\x9E\xA3") {
        return 'Nintendo Wii';
    }
    return 'Sony PSP';
}

/** A PSP .pbp: a PlayStation classic or a PSP game, by its own category. */
function xs_romid_pbp(string $file): string|false|null
{
    $head = xs_romid_read($file, 0, 40);
    if (substr($head, 0, 4) !== "\0PBP") {
        return false;
    }
    $o = unpack('Vsfo/Vicon', substr($head, 8, 8));
    $sfo = xs_romid_read($file, (int) $o['sfo'], max(0, min(4096, (int) $o['icon'] - (int) $o['sfo'])));
    if (substr($sfo, 0, 4) !== "\0PSF") {
        return null;
    }
    // The values are plain text in the block; a PlayStation classic says
    // CATEGORY ME, a PSP game UG or MG (and friends).
    $h = unpack('Vkeys/Vdata/Vcount', substr($sfo, 8, 12));
    for ($i = 0; $i < min(64, (int) $h['count']); $i++) {
        $e = unpack('vkey/vfmt/Vlen/Vmax/Vat', substr($sfo, 20 + $i * 16, 16));
        if ($e === false) {
            break;
        }
        $key = strtok(substr($sfo, (int) $h['keys'] + $e['key'], 16), "\0");
        if ($key === 'CATEGORY') {
            $cat = strtok(substr($sfo, (int) $h['data'] + $e['at'], 4), "\0");
            return $cat === 'ME' ? 'Sony Playstation' : 'Sony PSP';
        }
    }
    return null;
}

/**
 * A raw disc image (.iso, .bin, .img): which console's disc, false for no
 * console's, null when it cannot be opened.
 */
function xs_romid_disc(string $file, bool $guess = true): string|false|null
{
    $start = xs_romid_read($file, 0, 64);
    if ($start === '') {
        return null;
    }
    /* A CD is stored either as its 2048 byte sectors alone (.iso) or with
       each one wrapped in 2352 (.bin): the same words then stand 16 bytes
       in (mode 1) or 24 (mode 2, the PlayStation's). Sega's consoles sign
       the first sector; the others are found by the disc's own label in
       sector 16. Sega's discs first: a Sega CD's also says SEGA MEGA DRIVE
       at 0x100, where a cartridge signs. */
    $layouts = [[2048, 0], [2352, 16], [2352, 24]];
    foreach ($layouts as [$sector, $skip]) {
        $first = $skip === 0 ? $start : xs_romid_read($file, $skip, 32);
        if (str_starts_with($first, 'SEGA SEGASATURN')) {
            return 'Sega Saturn';
        }
        if (str_starts_with($first, 'SEGADISCSYSTEM') || str_starts_with($first, 'SEGABOOTDISC') || str_starts_with($first, 'SEGADISC')) {
            return 'Sega CD';
        }
        if (str_starts_with($first, 'SEGA SEGAKATANA')) {
            return 'Sega Dreamcast';
        }
    }
    // A cartridge dumped as .bin: the Genesis and the 32X sign at 0x100.
    $sega = xs_romid_read($file, 0x100, 16);
    if (str_starts_with($sega, 'SEGA 32X')) {
        return 'Sega 32X';
    }
    if (str_starts_with($sega, 'SEGA GENESIS') || str_starts_with($sega, 'SEGA MEGA DRIVE') || str_starts_with($sega, ' SEGA')) {
        return 'Sega Genesis';
    }
    // Nintendo's two disc consoles carry a magic number near the start.
    if (substr($start, 0x1C, 4) === "\xC2\x33\x9F\x3D") {
        return 'Nintendo GameCube';
    }
    if (substr($start, 0x18, 4) === "\x5D\x1C\x9E\xA3") {
        return 'Nintendo Wii';
    }
    foreach ($layouts as [$sector, $skip]) {
        $pvd = xs_romid_read($file, 16 * $sector + $skip, 190);
        if (substr($pvd, 0, 6) !== "\x01CD001") {
            continue;
        }
        $system = trim(substr($pvd, 8, 32));
        if (str_starts_with($system, 'PSP GAME')) {
            return 'Sony PSP';
        }
        if (str_starts_with($system, 'PLAYSTATION')) {
            // 1 or 2: the boot line of SYSTEM.CNF, found through the root folder.
            $root = unpack('Vlba', substr($pvd, 156 + 2, 4));
            $dir  = xs_romid_read($file, (int) $root['lba'] * $sector + $skip, 2048);
            $at   = stripos($dir, 'SYSTEM.CNF');
            if ($at !== false && $at >= 33) {
                $rec = unpack('Vlba', substr($dir, $at - 33 + 2, 4));
                $cnf = xs_romid_read($file, (int) $rec['lba'] * $sector + $skip, 256);
                if (stripos($cnf, 'BOOT2') !== false) {
                    return 'Sony Playstation 2';
                }
                if (stripos($cnf, 'BOOT') !== false) {
                    return 'Sony Playstation';
                }
            }
            // No readable boot line: a CD is a PlayStation, a DVD its successor (a guess, when asked for one).
            if (!$guess) {
                return null;
            }
            return (int) @filesize($file) > 900 * 1048576 ? 'Sony Playstation 2' : 'Sony Playstation';
        }
        return false;                        // a disc, of no console known here
    }
    return false;
}
