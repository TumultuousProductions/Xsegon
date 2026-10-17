<?php
/**
 * The file check: what a game's file really is, by checksum against the
 * No-Intro lists libretro publishes (metadat/no-intro/<system>.dat). A name
 * proves nothing: a file named like the USA release can be a translation.
 *
 * Reads a file and never changes it. One answer per game is kept in
 * data\filecheck.json with the file's size and date, so a changed file shows.
 * Cartridge consoles only: a disc is hours of reading and another set of lists.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/libretro.php';
require_once __DIR__ . '/romid.php';

/** Consoles with a No-Intro list, by Xsegon's name for them. */
const XS_FC_CONSOLES = [
    'Nintendo Entertainment System', 'Nintendo Famicom Disk System', 'Super Nintendo Entertainment System',
    'Nintendo 64', 'Nintendo Game Boy', 'Nintendo Game Boy Color', 'Nintendo Game Boy Advance', 'Nintendo DS',
    'Nintendo Virtual Boy', 'Sega Genesis', 'Sega Mega Drive', 'Sega 32X', 'Sega Master System', 'Sega Game Gear',
    'Sega SG-1000', 'Atari 2600', 'Atari 5200', 'Atari 7800', 'Atari Lynx', 'Atari Jaguar', 'NEC TurboGrafx-16',
    'ColecoVision', 'Mattel Intellivision', 'GCE Vectrex', 'Fairchild Channel F', 'WonderSwan', 'WonderSwan Color',
    'Bandai WonderSwan', 'Bandai WonderSwan Color', 'SNK Neo Geo Pocket', 'SNK Neo Geo Pocket Color',
];
/** The words No-Intro writes for where a release was sold. */
const XS_FC_REGIONS = [
    'USA', 'World', 'Europe', 'Japan', 'Asia', 'Australia', 'Brazil', 'Canada', 'China', 'France', 'Germany',
    'Hong Kong', 'Italy', 'Korea', 'Netherlands', 'Spain', 'Sweden', 'Russia', 'Taiwan', 'UK', 'United Kingdom',
    'Mexico', 'Latin America', 'Scandinavia', 'Denmark', 'Finland', 'Norway', 'Portugal', 'Greece', 'Argentina',
    'India', 'Poland', 'Belgium', 'Austria', 'Switzerland', 'Ireland', 'New Zealand', 'South Africa', 'Israel',
    'Turkey', 'Export', 'Unknown',
];
/** And for the languages on the cartridge. */
const XS_FC_LANGS = ['En', 'Ja', 'Fr', 'De', 'Es', 'It', 'Nl', 'Pt', 'Sv', 'No', 'Da', 'Fi', 'Zh', 'Ko', 'Pl', 'Ru',
                     'El', 'Tr', 'Cs', 'Hu', 'Ca', 'Ar', 'He', 'Hr', 'Ro', 'Sk', 'Sl', 'Uk', 'Th', 'Hi', 'Gd', 'Eu'];
/** Enough of a game's start to hold every console's own header. */
const XS_FC_HEAD = 0x10200;
/** One request checks files for about this long, then answers. */
const XS_FC_SECONDS = 1.5;

function xs_fc_path(): string
{
    return xs_data_path('filecheck.json');
}

function xs_fc_can(string $platform): bool
{
    return in_array($platform, XS_FC_CONSOLES, true) && xs_lr_system($platform) !== null;
}

/** Every answer kept, by game id. */
function xs_fc_all(): array
{
    $all = xs_read_json(xs_fc_path(), []);
    return is_array($all) ? $all : [];
}

/**
 * One console's list: 'names' (sha1 => official name) and 'serials' (the game
 * code a cartridge carries => the plainest release with it). null with $why
 * when the list cannot be had.
 */
function xs_fc_list(string $sys, ?string &$why = null): ?array
{
    static $mem = [];
    if (isset($mem[$sys])) {
        return $mem[$sys];
    }
    $got = xs_lr_cached(xs_lr_cache_name($sys, 'releases'), static function (?string &$why) use ($sys): ?array {
        $dat = xs_lr_get(xs_lr_base('meta') . '/no-intro/' . rawurlencode($sys) . '.dat', $why, 60);
        if ($dat === null) {
            return null;
        }
        preg_match_all('/rom \( name "((?:[^"\\\\]|\\\\.)*)"[^\n]*?\bsha1 ([0-9A-Fa-f]{40})(?: serial "([^"]*)")?/', $dat, $m, PREG_SET_ORDER);
        $names = [];
        $serials = [];
        foreach ($m as $row) {
            $name = (string) preg_replace('/\.[A-Za-z0-9]{2,4}$/', '', $row[1]);
            $names[strtolower($row[2])] = $name;
            // Revisions and betas share a code: the name with the fewest marks is the release itself.
            $code = strtoupper((string) preg_replace('/\s+/', '', $row[3] ?? ''));
            if ($code !== '' && (!isset($serials[$code]) || substr_count($name, '(') < substr_count($serials[$code], '('))) {
                $serials[$code] = $name;
            }
        }
        if (!$names) {
            $why = 'the list for ' . $sys . ' came back empty';
            return null;
        }
        return ['names' => $names, 'serials' => $serials];
    }, $why);
    if ($got === null || empty($got['names'])) {
        xs_log('FCHK', $sys . ': the list of known releases could not be had' . ($why !== null ? ' (' . $why . ')' : ''));
        return null;
    }
    return $mem[$sys] = ['names' => $got['names'], 'serials' => (array) ($got['serials'] ?? [])];
}

/** What only wraps the game in this file: [what it is, bytes to skip, byte order to undo]. */
function xs_fc_wrap(string $platform, string $start): array
{
    switch ($platform) {
        case 'Nintendo Entertainment System':
            return str_starts_with($start, "NES\x1a") ? ['header', 16, ''] : [null, 0, ''];
        case 'Nintendo Famicom Disk System':
            return str_starts_with($start, "FDS\x1a") ? ['wrap', 16, ''] : [null, 0, ''];
        case 'Atari Lynx':
            return str_starts_with($start, 'LYNX') ? ['wrap', 64, ''] : [null, 0, ''];
        case 'Atari 7800':
            return substr($start, 1, 9) === 'ATARI7800' ? ['wrap', 128, ''] : [null, 0, ''];
        case 'Super Nintendo Entertainment System':
            return ['copier', 512, ''];          // kept only when the size says one is there
        case 'Nintendo 64':
            $h = substr($start, 0, 4);
            return $h === "\x37\x80\x40\x12" ? ['v64', 0, 'v'] : ($h === "\x40\x12\x37\x80" ? ['n64', 0, 'V'] : [null, 0, '']);
    }
    return [null, 0, ''];
}

/** Bytes in the N64's own order, from a file kept in another. */
function xs_fc_swap(string $bytes, string $order): string
{
    $out = '';
    for ($at = 0, $n = strlen($bytes); $at < $n; $at += 262144) {
        $piece = substr($bytes, $at, 262144);
        $out .= $order === 'v' ? pack('n*', ...unpack('v*', $piece)) : pack('N*', ...unpack('V*', $piece));
    }
    return $out;
}

/**
 * The file to read inside an archive: the biggest game, else the biggest of
 * anything. A patch with no game beside it (its tool and a note may be) is
 * $patch, and nothing is picked.
 */
function xs_fc_pick(array $entries, bool &$patch): ?array
{
    $patch = false;
    $ends = xs_romid_endings() + ['smd' => 1, 'unh' => 1, 'jag' => 1, 'sgb' => 1];
    $best = null;
    $bestGame = false;
    $patches = 0;
    foreach ($entries as $e) {
        $ext = strtolower((string) pathinfo($e['name'], PATHINFO_EXTENSION));
        if (in_array($ext, XS_ROMID_BESIDE, true)) {
            $patches += in_array($ext, ['ips', 'bps', 'ups', 'xdelta'], true) ? 1 : 0;
            continue;
        }
        // A plain .bin is a game when it is the size of one: a tool's settings file is not.
        $game = isset($ends[$ext]) || (($ext === 'bin' || $ext === 'rom') && $e['size'] >= 32768);
        if ($best === null || ($game && !$bestGame) || ($game === $bestGame && $e['size'] > $best['size'])) {
            $best = $e;
            $bestGame = $game;
        }
    }
    $patch = !$bestGame && $patches > 0;
    return $patch ? null : $best;
}

/**
 * Hands the game's own bytes to $sink in pieces: the file as it is, or the
 * one game inside a .zip or a .7z. $about says which file inside, and whether
 * the archive holds only a patch. False with $why when it cannot be read.
 */
function xs_fc_feed(string $file, callable $sink, array &$about, ?string &$why = null): bool
{
    $about = ['inner' => null, 'patch' => false];
    $why = null;
    $ext = strtolower((string) pathinfo($file, PATHINFO_EXTENSION));
    if ($ext === '7z') {
        return xs_fc_feed_7z($file, $sink, $about, $why);
    }
    $fh = @fopen($file, 'rb');
    if ($fh === false) {
        $why = 'the file would not open';
        return false;
    }
    if ($ext !== 'zip') {
        while (!feof($fh)) {
            $sink((string) fread($fh, 1048576));
        }
        fclose($fh);
        return true;
    }
    $names = xs_romid_zip_names($file);
    $e = $names === null ? null : xs_fc_pick($names, $about['patch']);
    if ($e === null) {
        fclose($fh);
        $why = $names === null ? 'the zip could not be read' : 'the zip holds no game';
        return $about['patch'];
    }
    $about['inner'] = $e['name'];
    $local = xs_romid_read($file, $e['at'], 30);
    if (substr($local, 0, 4) !== "PK\x03\x04" || !in_array($e['method'], [0, 8], true)) {
        fclose($fh);
        $why = 'the zip is packed in a way Xsegon cannot open';
        return false;
    }
    $l = unpack('vname/vextra', substr($local, 26, 4));
    fseek($fh, $e['at'] + 30 + $l['name'] + $l['extra']);
    $ctx = $e['method'] === 8 ? @inflate_init(ZLIB_ENCODING_RAW) : null;
    $got = 0;
    // Small pieces in: a game packs well, and one piece unpacked has to fit in memory.
    for ($left = $e['packed']; $left > 0;) {
        $in = (string) fread($fh, min($left, $ctx === null ? 1048576 : 32768));
        if ($in === '') {
            break;
        }
        $left -= strlen($in);
        $out = $ctx === null ? $in : @inflate_add($ctx, $in, ZLIB_SYNC_FLUSH);
        if (!is_string($out)) {
            break;
        }
        $got += strlen($out);
        $sink($out);
    }
    fclose($fh);
    if ($got !== $e['size']) {
        $why = 'the zip is damaged: ' . $e['name'] . ' did not unpack whole';
        return false;
    }
    return true;
}

/** The one game inside a .7z, through the 7zr that ships in bin\. */
function xs_fc_feed_7z(string $file, callable $sink, array &$about, ?string &$why): bool
{
    $exe = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . '7zr.exe';
    if (!is_file($exe)) {
        $why = 'a .7z needs bin\\7zr.exe, and it is not there';
        return false;
    }
    $run = static function (array $args) use ($exe) {
        // A blocking pipe: PHP's other kind on Windows reads 2 MB a second.
        $p = @proc_open(array_merge([$exe], $args), [1 => ['pipe', 'w'], 2 => ['file', 'NUL', 'w']], $pipes, null, null, ['bypass_shell' => true, 'blocking_pipes' => true]);
        return is_resource($p) ? [$p, $pipes[1]] : null;
    };
    $list = $run(['l', '-slt', '-sccUTF-8', '--', $file]);
    if ($list === null) {
        $why = '7zr would not start';
        return false;
    }
    $text = (string) stream_get_contents($list[1]);
    fclose($list[1]);
    proc_close($list[0]);
    $entries = [];
    foreach (preg_split('/\r?\n\r?\n/', (string) substr($text, (int) strpos($text, '----------'))) ?: [] as $block) {
        if (preg_match('/^Path = (.+)$/m', $block, $p) && preg_match('/^Size = (\d+)/m', $block, $s)
            && !preg_match('/^(?:Folder = \+|Attributes = D)/m', $block)) {
            $entries[] = ['name' => trim($p[1]), 'size' => (int) $s[1]];
        }
    }
    $e = xs_fc_pick($entries, $about['patch']);
    if ($e === null) {
        $why = $entries ? 'the .7z holds no game' : 'the .7z could not be read';
        return $about['patch'];
    }
    $about['inner'] = $e['name'];
    // Alone in there, it is asked for by no name at all: a name with an accent can get lost on the way.
    $out = $run(array_merge(['e', '-so', '-sccUTF-8', '--', $file], count($entries) === 1 ? [] : [$e['name']]));
    if ($out === null) {
        $why = '7zr would not start';
        return false;
    }
    $got = 0;
    while (!feof($out[1])) {
        $piece = (string) stream_get_contents($out[1], 1048576);
        $got += strlen($piece);
        $sink($piece);
    }
    fclose($out[1]);
    proc_close($out[0]);
    if ($got !== $e['size']) {
        $why = 'the .7z did not unpack whole: ' . $e['name'];
        return false;
    }
    return true;
}

/**
 * Reads the game once and sums it as it stands and, where something only
 * wraps it (a header, a copier's header, another byte order), without that.
 * With $algo 'md5' (RetroAchievements' sum), 'sha1' and 'alt' hold MD5s.
 */
function xs_fc_read(string $platform, string $file, ?string &$why = null, string $algo = 'sha1'): ?array
{
    $st = ['n' => 0, 'head' => '', 'sha' => hash_init($algo), 'crc' => hash_init('crc32b'),
           'alt' => null, 'fix' => null, 'skip' => 0, 'order' => '', 'carry' => '', 'first' => true];
    $sink = static function (string $chunk) use (&$st, $platform, $algo): void {
        if ($chunk === '') {
            return;
        }
        if ($st['first']) {
            $st['first'] = false;
            [$st['fix'], $st['skip'], $st['order']] = xs_fc_wrap($platform, $chunk);
            $st['alt'] = $st['fix'] === null ? null : hash_init($algo);
        }
        hash_update($st['sha'], $chunk);
        hash_update($st['crc'], $chunk);
        if (strlen($st['head']) < XS_FC_HEAD) {
            $st['head'] .= substr($chunk, 0, XS_FC_HEAD - strlen($st['head']));
        }
        if ($st['alt'] !== null && $st['order'] !== '') {
            $buf = $st['carry'] . $chunk;
            $use = strlen($buf) - strlen($buf) % 4;
            $st['carry'] = substr($buf, $use);
            hash_update($st['alt'], xs_fc_swap(substr($buf, 0, $use), $st['order']));
        } elseif ($st['alt'] !== null) {
            $from = max(0, $st['skip'] - $st['n']);
            if ($from < strlen($chunk)) {
                hash_update($st['alt'], $from > 0 ? substr($chunk, $from) : $chunk);
            }
        }
        $st['n'] += strlen($chunk);
    };
    $about = [];
    if (!xs_fc_feed($file, $sink, $about, $why)) {
        return null;
    }
    if ($about['patch']) {
        return ['patch' => true, 'inner' => null];
    }
    if ($st['n'] === 0) {
        $why = 'the file is empty';
        return null;
    }
    // A copier's header shows in the size: 512 bytes over a whole number of kilobytes.
    if ($st['fix'] === 'copier' && $st['n'] % 1024 !== 512) {
        $st['fix'] = null;
    }
    $head = $st['head'];
    if ($st['fix'] === 'copier') {
        $head = substr($head, 512);
    } elseif ($st['order'] !== '') {
        $head = xs_fc_swap(substr($head, 0, strlen($head) - strlen($head) % 4), $st['order']);
    }
    return ['patch' => false, 'inner' => $about['inner'], 'bytes' => $st['n'],
            'sha1' => hash_final($st['sha']), 'crc' => hash_final($st['crc']),
            'fix' => $st['fix'], 'alt' => $st['fix'] === null ? null : hash_final($st['alt']), 'head' => $head];
}

/** The letters and digits a header holds, as a person reads them. */
function xs_fc_text(string $raw): string
{
    return trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/[^\x20-\x7E]+/', ' ', $raw)));
}

/**
 * What the game says about itself in its own header: its name and where it
 * was made for. A hack or a translation usually keeps the header of the game
 * it was built on. null when the console writes none, or it does not read as one.
 */
function xs_fc_header(string $platform, string $head): ?array
{
    $letter = ['E' => 'USA', 'J' => 'Japan', 'P' => 'Europe', 'U' => 'Australia', 'D' => 'Germany', 'F' => 'France',
               'I' => 'Italy', 'S' => 'Spain', 'X' => 'Europe', 'Y' => 'Europe', 'K' => 'Korea', 'B' => 'Brazil', 'C' => 'China'];
    $title = '';
    $region = '';
    $code = '';
    switch ($platform) {
        case 'Nintendo 64':
            if (strlen($head) < 0x40 || substr($head, 0, 4) !== "\x80\x37\x12\x40") {
                return null;
            }
            $title = xs_fc_text(substr($head, 0x20, 20));
            $code = xs_fc_text(substr($head, 0x3B, 4));
            $region = $letter[$head[0x3E]] ?? '';
            break;
        case 'Nintendo Game Boy Advance':
            if (strlen($head) < 0xC0 || $head[0xB2] !== "\x96") {
                return null;
            }
            $title = xs_fc_text(substr($head, 0xA0, 12));
            $code = xs_fc_text(substr($head, 0xAC, 4));
            $region = $letter[$head[0xAF]] ?? '';
            break;
        case 'Nintendo DS':
            if (strlen($head) < 0x10) {
                return null;
            }
            $title = xs_fc_text(substr($head, 0, 12));
            $code = xs_fc_text(substr($head, 0x0C, 4));
            $region = strlen($code) === 4 ? ($letter[$code[3]] ?? '') : '';
            break;
        case 'Nintendo Game Boy':
        case 'Nintendo Game Boy Color':
            if (strlen($head) < 0x150) {
                return null;
            }
            $sum = 0;
            for ($i = 0x134; $i <= 0x14C; $i++) {
                $sum = ($sum - ord($head[$i]) - 1) & 0xFF;
            }
            if ($sum !== ord($head[0x14D])) {
                return null;
            }
            $title = xs_fc_text(substr($head, 0x134, 16));
            $region = $head[0x14A] === "\x00" ? 'Japan' : 'outside Japan';
            break;
        case 'Super Nintendo Entertainment System':
            // Two places it can stand; the one whose own sum adds up, else the one that reads as a name.
            $best = -1;
            foreach ([0x7FC0, 0xFFC0] as $at) {
                $h = substr($head, $at, 0x20);
                if (strlen($h) < 0x20 || !preg_match('/^[\x20-\x7E]{21}$/', substr($h, 0, 21)) || trim(substr($h, 0, 21)) === '') {
                    continue;
                }
                $u = unpack('vinv/vsum', substr($h, 0x1C, 4));
                $score = ($u['inv'] ^ $u['sum']) === 0xFFFF ? 2 : 1;
                if ($score > $best) {
                    $best = $score;
                    $title = xs_fc_text(substr($h, 0, 21));
                    $region = [0 => 'Japan', 1 => 'USA', 2 => 'Europe', 3 => 'Sweden', 4 => 'Finland', 5 => 'Denmark',
                               6 => 'France', 7 => 'Netherlands', 8 => 'Spain', 9 => 'Germany', 10 => 'Italy', 11 => 'China',
                               13 => 'Korea', 15 => 'Canada', 16 => 'Brazil', 17 => 'Australia'][ord($h[0x19])] ?? '';
                }
            }
            break;
        case 'Sega Genesis':
        case 'Sega Mega Drive':
        case 'Sega 32X':
            if (strlen($head) < 0x200 || !str_contains(substr($head, 0x100, 5), 'SEGA')) {
                return null;
            }
            $title = xs_fc_text(substr($head, 0x150, 48)) ?: xs_fc_text(substr($head, 0x120, 48));
            $code = (string) preg_replace('/\s+/', '', substr($head, 0x183, 11));      // "GM T-48073 -00" without its GM
            $r = trim(substr($head, 0x1F0, 3));
            $where = [];
            if (preg_match('/^[JUE]+$/', $r)) {
                foreach (['J' => 'Japan', 'U' => 'USA', 'E' => 'Europe'] as $l => $w) {
                    if (str_contains($r, $l)) {
                        $where[] = $w;
                    }
                }
            } elseif (preg_match('/^[0-9A-F]$/', $r)) {
                foreach ([1 => 'Japan', 4 => 'USA', 8 => 'Europe'] as $bit => $w) {
                    if (hexdec($r) & $bit) {
                        $where[] = $w;
                    }
                }
            }
            $region = implode(', ', $where);
            break;
        default:
            return null;
    }
    if ($title === '' && $region === '') {
        return null;
    }
    return ['title' => $title, 'region' => $region, 'code' => preg_match('/^[A-Z0-9\-]{4,14}$/', $code) ? $code : ''];
}

/** An official name taken apart: "Name (USA, Europe) (En,Fr) (Rev 1) (Beta)". */
function xs_fc_name_facts(string $name): array
{
    $facts = ['regions' => [], 'languages' => [], 'revision' => '', 'also' => []];
    preg_match_all('/\(([^()]*)\)/', $name, $m);
    foreach ($m[1] as $tag) {
        $parts = array_map('trim', explode(',', $tag));
        $langs = preg_split('/[,+]/', $tag) ?: [];
        if (!$facts['regions'] && !array_diff($parts, XS_FC_REGIONS)) {
            $facts['regions'] = $parts;
        } elseif (!$facts['languages'] && !array_diff(array_map(static fn($l) => explode('-', trim($l))[0], $langs), XS_FC_LANGS)) {
            $facts['languages'] = array_map('trim', $langs);
        } elseif ($facts['revision'] === '' && preg_match('/^(?:Rev [0-9A-Za-z.]+|v[0-9][0-9A-Za-z.]*)$/', $tag)) {
            $facts['revision'] = $tag;
        } else {
            $facts['also'][] = $tag;
        }
    }
    return $facts;
}

/** What a file on no list calls itself, by its name and its folder: a guess, and said as one. */
function xs_fc_guess(string $rom, ?string $inner): ?string
{
    $name = basename($rom) . ' ' . (string) $inner;
    $folder = strtolower(basename(dirname($rom)));
    if (preg_match('/[\[(]T[+\-]|translat/i', $name)) {
        return 'translation';
    }
    if (in_array($folder, ['hack', 'hacks', 'romhacks', 'rom hacks', 'mods'], true)
        || preg_match('/(?<![a-z])(?:hack|mod)(?![a-z])|\[h[0-9a-z]{0,3}\]|\[H\.[^\]]*\]/i', $name)) {
        return 'hack';
    }
    if (in_array($folder, ['homebrew', 'home brew'], true) || preg_match('/homebrew|\(PD\)|\(Aftermarket\)/i', $name)) {
        return 'homebrew';
    }
    return null;
}

/**
 * Checks one game's file now and keeps the answer. null with $why when
 * there is nothing to keep: no list for it, no file, or no list to be had.
 */
function xs_fc_check(array $g, ?string &$why = null): ?array
{
    $why = null;
    $platform = (string) ($g['platform'] ?? '');
    if (!xs_fc_can($platform)) {
        $why = 'the file check knows cartridge consoles only, and ' . ($platform ?: 'this') . ' is not one';
        return null;
    }
    $rom = xs_rom_real_path((string) ($g['romPath'] ?? ''), xs_settings());
    if ($rom === '' || !is_file($rom)) {
        $why = 'the file is not there: ' . ($rom ?: '(none)');
        return null;
    }
    $list = xs_fc_list((string) xs_lr_system($platform), $lw);
    if ($list === null) {
        $why = 'the list of known ' . $platform . ' games could not be fetched' . ($lw !== null ? ' (' . $lw . ')' : '');
        return null;
    }
    $names = $list['names'];
    $rec = ['at' => time(), 'rom' => $rom, 'size' => (int) filesize($rom), 'mtime' => (int) filemtime($rom)];
    $read = xs_fc_read($platform, $rom, $rw);
    if ($read === null) {
        $rec += ['kind' => 'unread', 'why' => (string) $rw];
    } elseif ($read['patch']) {
        $rec += ['kind' => 'patch'];
    } else {
        $rec += ['inner' => $read['inner'], 'bytes' => $read['bytes'], 'sha1' => $read['sha1'], 'crc' => $read['crc']];
        $name = $names[$read['sha1']] ?? null;
        $fix = null;
        if ($name === null && $read['alt'] !== null && isset($names[$read['alt']])) {
            $name = $names[$read['alt']];
            $fix = $read['fix'] === 'wrap' ? null : $read['fix'];
        }
        $header = xs_fc_header($platform, $read['head']);
        if ($header !== null) {
            $rec['header'] = $header;
        }
        if ($name !== null) {
            $rec += ['kind' => 'known', 'name' => $name, 'fix' => $fix] + xs_fc_name_facts($name);
        } else {
            // A hack or a translation keeps its game's code, and the list says which release that is.
            // Only Nintendo's four-character codes: a Genesis serial is shared between regions, or junk.
            $code = (string) ($header['code'] ?? '');
            $rec += ['kind' => 'unknown', 'guess' => xs_fc_guess($rom, $read['inner']),
                     'base' => preg_match('/^(?=.*[A-Z])[A-Z0-9]{4}$/', $code) ? ($list['serials'][$code] ?? null) : null];
        }
    }
    $all = xs_fc_all();
    $all[(string) $g['id']] = $rec;
    if (!xs_write_json(xs_fc_path(), $all, $ww)) {
        $why = 'the answer could not be kept: ' . (string) $ww;
        return null;
    }
    xs_log('FCHK', (string) ($g['title'] ?? $g['id']) . ' (' . $platform . '): ' . $rec['kind']
        . (isset($rec['name']) ? ' ' . $rec['name'] : '') . (!empty($rec['fix']) ? ', ' . $rec['fix'] : '')
        . (isset($rec['why']) ? ', ' . $rec['why'] : ''));
    return $rec;
}

/** A kept answer as the page shows it: with whether the file has changed since. */
function xs_fc_view(array $g, ?array $rec): ?array
{
    if ($rec === null) {
        return null;
    }
    $rom = xs_rom_real_path((string) ($g['romPath'] ?? ''), xs_settings());
    $rec['file'] = basename(str_replace('\\', '/', (string) $rec['rom']));
    // A file that is away (its drive unplugged) has not changed; one that is there and differs has.
    $rec['stale'] = strcasecmp($rom, (string) $rec['rom']) !== 0
        || (is_file($rom) && ((int) filesize($rom) !== (int) $rec['size'] || (int) filemtime($rom) !== (int) $rec['mtime']));
    unset($rec['rom'], $rec['mtime']);
    return $rec;
}

/** What a game's details screen is told: whether its console can be checked (why not, when not), and the answer kept. */
function xs_fc_for(array $g): array
{
    $platform = (string) ($g['platform'] ?? '');
    $can = empty($g['local']) && xs_fc_can($platform);
    $why = null;
    if (!empty($g['local'])) {
        $why = 'A game of your own is not checked: there is no list of known releases to look it up in.';
    } elseif (!$can) {
        $why = 'The file check knows cartridge consoles only for now, and ' . ($platform ?: 'this') . ' is not one of them.';
    }
    return ['can' => $can, 'why' => $why, 'check' => $can ? xs_fc_view($g, xs_fc_all()[(string) $g['id']] ?? null) : null];
}
