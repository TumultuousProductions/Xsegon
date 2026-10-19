<?php
/**
 * Xsegon - the discs of one game, played as one.
 *
 * Which emulators read a playlist, the playlist written beside a set's
 * discs, and the games whose file is swapped for it. Loaded by scan.php,
 * which every caller already loads.
 */
declare(strict_types=1);

require_once __DIR__ . '/scan.php';

/**
 * Whether the emulator behind a launch reads a playlist itself: RetroArch's
 * disc cores do, and a few programs. The others (Xenia, PCSX2, xemu) take one
 * disc, and a set's other discs are chosen in the emulator or at Play.
 */
function xs_scan_reads_playlists(array $launch): bool
{
    return ($launch['kind'] ?? '') === 'retroarch'
        || (bool) preg_match('/dolphin|duckstation|mednafen|flycast|redream|ares|bizhawk/i', basename((string) ($launch['exe'] ?? '')));
}

/** The discs a playlist names, in its order, as whole paths. A line may lead into a folder beside the playlist. */
function xs_scan_m3u_discs(string $m3u): array
{
    $out = [];
    foreach (@file($m3u, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        $line = str_replace('/', DIRECTORY_SEPARATOR, $line);
        $out[] = preg_match('/^(?:[A-Za-z]:|\\\\\\\\)/', $line) ? $line : dirname($m3u) . DIRECTORY_SEPARATOR . $line;
    }
    return $out;
}

/* ---- disc sets as one game: the m3u builder ---------------------------- */
/*
 * A set with no playlist plays Disc 1 only. A .m3u beside the discs, one file name a line,
 * makes it one game: RetroArch reads entries relative to it. Named like the disc with the
 * disc tag out ("Final Fantasy VII (USA).m3u"), so media named after the ROM still matches.
 */

/** "Final Fantasy VII (USA) (Disc 1).cue" -> "Final Fantasy VII (USA).m3u" */
function xs_scan_m3u_name(string $discFile): string
{
    $base = (string) pathinfo($discFile, PATHINFO_FILENAME);
    $stem = preg_replace('/\s*\((?:Disc|Disk|CD)\s*\d+[^)]*\)|\s*\b(?:Disc|Disk|CD)\s*\d+\b/i', '', $base) ?? $base;
    $stem = trim(preg_replace('/\s+/', ' ', $stem) ?? $stem);
    return ($stem !== '' ? $stem : $base) . '.m3u';
}

/** The playlist beside this disc, if one has been built; else null. */
function xs_scan_m3u_for(string $rom): ?string
{
    if ($rom === '' || xs_scan_disc(basename($rom)) === null) {
        return null;
    }
    if (strtolower((string) pathinfo($rom, PATHINFO_EXTENSION)) === 'm3u') {
        return null;
    }
    $m3u = dirname($rom) . DIRECTORY_SEPARATOR . xs_scan_m3u_name(basename($rom));
    return is_file($m3u) ? $m3u : null;
}

/** The other discs of this one's set in the same folder, itself included,
    Disc 1 first. One file when it has no set. */
function xs_scan_disc_siblings(string $rom): array
{
    if (xs_scan_disc(basename($rom)) === null) {
        return [$rom];
    }
    $dir = dirname($rom);
    $want = xs_scan_m3u_name(basename($rom));
    $ext = strtolower((string) pathinfo($rom, PATHINFO_EXTENSION));
    $found = [];
    foreach (@scandir($dir) ?: [] as $n) {
        if ($n === '.' || $n === '..' || strtolower((string) pathinfo($n, PATHINFO_EXTENSION)) !== $ext) {
            continue;
        }
        $no = xs_scan_disc($n);
        if ($no === null || xs_scan_m3u_name($n) !== $want || isset($found[$no])) {
            continue;
        }
        $found[$no] = $dir . DIRECTORY_SEPARATOR . $n;
    }
    ksort($found);
    return $found ? array_values($found) : [$rom];
}

/**
 * Whether a game is known to be one of several discs, and how it plays, from its own
 * files on every read, nothing kept:
 *
 *   ['set' => true, 'n' => 3]   plays through an m3u naming two or more discs
 *   ['set' => false, 'disc' => 1, 'onDisk' => 2]
 *                               a file named "(Disc 1)" with no playlist;
 *                               onDisk is how many of its set are in its folder
 *   null                        everything else
 *
 * Only what the files prove: an m3u of one disc and "(Disc 1 of 1)" are null, and a
 * name with no disc number is not guessed at.
 */
function xs_disc_info(array $g, array $s): ?array
{
    $rom = (string) ($g['romPath'] ?? '');
    if ($rom === '' || !empty($g['steam'])) {
        return null;
    }
    $name = basename($rom);
    if (strtolower((string) pathinfo($name, PATHINFO_EXTENSION)) === 'm3u') {
        $lines = @file(xs_rom_real_path($rom, $s), FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return null;                        // unreadable (the drive unplugged): say nothing
        }
        $n = count(array_filter($lines, static fn($l) => trim($l) !== '' && trim($l)[0] !== '#'));
        return $n >= 2 ? ['set' => true, 'n' => $n] : null;
    }
    $disc = xs_scan_disc($name);
    if ($disc === null) {
        return null;
    }
    if (preg_match('/\b(?:Disc|Disk|CD)\s*\d+\s*of\s*(\d+)/i', $name, $m) && (int) $m[1] < 2) {
        return null;                            // "(Disc 1 of 1)": one disc after all
    }
    return ['set' => false, 'disc' => $disc, 'onDisk' => count(xs_scan_disc_siblings(xs_rom_real_path($rom, $s)))];
}

/**
 * The m3u these discs would get, or null: fewer than two, several folders, a gap or no
 * Disc 1, an archive or PBP among them. One already there comes back with 'exists'.
 */
function xs_scan_m3u_offer(string $platform, array $discRoms): ?array
{
    if (count($discRoms) < 2) {
        return null;
    }
    $dir = null;
    $byNo = [];
    foreach ($discRoms as $rom) {
        $d = dirname((string) $rom);
        if ($dir === null) {
            $dir = $d;
        } elseif (strcasecmp($dir, $d) !== 0) {
            return null;
        }
        $ext = strtolower((string) pathinfo((string) $rom, PATHINFO_EXTENSION));
        if (in_array($ext, ['m3u', 'pbp', 'zip', '7z'], true)) {
            return null;
        }
        $no = xs_scan_disc(basename((string) $rom));
        if ($no === null || isset($byNo[$no])) {
            return null;
        }
        $byNo[$no] = basename((string) $rom);
    }
    ksort($byNo);
    if (array_keys($byNo) !== range(1, count($byNo))) {
        return null;
    }
    $file = xs_scan_m3u_name($byNo[1]);
    return ['platform' => $platform, 'title' => xs_scan_set_title($byNo[1]), 'dir' => $dir, 'file' => $file,
            'discs' => array_values($byNo), 'exists' => is_file($dir . DIRECTORY_SEPARATOR . $file)];
}

/** Every set in one folder, from the folder itself: the write checks a request against it. */
function xs_scan_m3u_offers_in(string $dir): array
{
    $bySet = [];
    foreach (@scandir($dir) ?: [] as $n) {
        if ($n === '.' || $n === '..' || !is_file($dir . DIRECTORY_SEPARATOR . $n) || xs_scan_disc($n) === null) {
            continue;
        }
        $ext = strtolower((string) pathinfo($n, PATHINFO_EXTENSION));
        if (!in_array($ext, xs_scan_extensions(true), true)) {
            continue;
        }
        // A bare .bin beside its .cue is the cue's data, not a disc, and a
        // "(Disc 2) (Track 1).bin" is a track of one.
        if ($ext === 'bin' && (xs_scan_track_bin($n) || is_file($dir . DIRECTORY_SEPARATOR . (string) preg_replace('/\.bin$/i', '.cue', $n)))) {
            continue;
        }
        // Likewise a .img or .ccd that belongs to the sheet of its name (xs_scan_dump_part).
        if (xs_scan_dump_part($dir . DIRECTORY_SEPARATOR . $n, $ext)) {
            continue;
        }
        $bySet[xs_scan_m3u_name($n) . '|' . $ext][] = $dir . DIRECTORY_SEPARATOR . $n;
    }
    $offers = [];
    foreach ($bySet as $roms) {
        $o = xs_scan_m3u_offer('', $roms);
        if ($o !== null) {
            $offers[] = $o;
        }
    }
    return $offers;
}

/**
 * Write one playlist: under a scanned folder, one that folder is offered now, not there
 * yet. Its contents come from the disk; the request names only which one.
 */
function xs_scan_m3u_write(string $dir, string $file, ?string &$why = null): ?array
{
    $why = null;
    $dir = xs_norm_path($dir);
    $inside = false;
    foreach (xs_scan_roots() as $root) {
        if (str_starts_with(strtolower($dir) . '\\', strtolower(rtrim($root, '\\/')) . '\\')) {
            $inside = true;
        }
    }
    if (!$inside || !is_dir($dir)) {
        $why = 'that folder is not under a folder Xsegon looks in';
        return null;
    }
    $offer = null;
    foreach (xs_scan_m3u_offers_in($dir) as $o) {
        if ($o['file'] === $file) {
            $offer = $o;
        }
    }
    if ($offer === null) {
        $why = 'there is no disc set in that folder to build ' . $file . ' from';
        return null;
    }
    $path = $dir . DIRECTORY_SEPARATOR . $file;
    if ($offer['exists']) {
        $why = 'there is already a playlist at ' . $path;
        return null;
    }
    $body = implode("\n", $offer['discs']) . "\n";
    if (@file_put_contents($path, $body) === false) {
        $why = 'could not write ' . $path . '. ' . xs_file_error_reason();
        return null;
    }
    return ['path' => $path, 'discs' => $offer['discs']];
}

/**
 * Joins a later disc the walk passed over to its game in the library, through a playlist
 * beside the game's file (written or added to). The request names only which file.
 */
function xs_scan_join(string $rom, ?string &$why = null): ?array
{
    $why = null;
    $rom = xs_norm_path($rom);
    $row = null;
    foreach (xs_scan_walk()['passed'] ?? [] as $p) {
        if (strcasecmp(xs_norm_path((string) $p['rom']), $rom) === 0) {
            $row = $p;
        }
    }
    if ($row === null || empty($row['join'])) {
        $why = 'that file is not a later disc of a game in the library that plays through a playlist';
        return null;
    }
    $has = xs_norm_path((string) $row['has']);
    $isList = strtolower((string) pathinfo($has, PATHINFO_EXTENSION)) === 'm3u';
    $m3u = $isList ? $has : dirname($has) . DIRECTORY_SEPARATOR . xs_scan_m3u_name(basename($has));
    $discs = [];                                       // disc number => whole path
    if ($isList) {
        foreach (xs_scan_m3u_discs($m3u) as $i => $d) {
            $discs[xs_scan_disc(basename($d)) ?? ($i + 1)] = $d;
        }
    } elseif (is_file($m3u)) {
        $why = 'there is already a playlist at ' . $m3u;
        return null;
    } else {
        $discs[xs_scan_disc(basename($has)) ?? 1] = $has;
    }
    $no = (int) $row['disc'];
    if (isset($discs[$no])) {
        $why = 'the game already has a disc ' . $no;
        return null;
    }
    $discs[$no] = $rom;
    ksort($discs);
    if (array_keys($discs) !== range(1, count($discs))) {
        $why = 'with it the game would have discs ' . implode(', ', array_keys($discs)) . ': a disc in between is not here';
        return null;
    }
    $base = strtolower(dirname($m3u)) . DIRECTORY_SEPARATOR;
    $lines = [];
    foreach ($discs as $d) {
        if (!str_starts_with(strtolower($d), $base)) {
            $why = 'its discs are not under one folder, so one playlist cannot name them';
            return null;
        }
        $lines[] = substr($d, strlen($base));
    }
    if (@file_put_contents($m3u, implode("\n", $lines) . "\n") === false) {
        $why = 'could not write ' . $m3u . '. ' . xs_file_error_reason();
        return null;
    }
    return ['path' => $m3u, 'discs' => $lines, 'title' => (string) $row['title'], 'disc' => $no];
}

/**
 * An imported game whose file is Disc 1 launches the playlist beside it. Only the path is
 * swapped in the command. Runs before the missing sweep, so what is swept would launch.
 */
function xs_apply_m3u(array $lib, array $s): array
{
    foreach ($lib['games'] ?? [] as $i => $g) {
        if (empty($g['launch']) || !empty($g['local']) || !empty($g['scanned'])) {
            continue;                           // scanned ones did this at their merge
        }
        $rom = (string) ($g['romPath'] ?? '');
        if ($rom === '' || xs_scan_disc(basename($rom)) === null) {
            continue;
        }
        $m3u = xs_scan_m3u_for(xs_rom_real_path($rom, $s));
        if ($m3u === null) {
            continue;
        }
        $lib['games'][$i]['romPath'] = $m3u;
        $lib['games'][$i]['discSet'] = true;
        $lib['games'][$i]['launch']['rom']  = $m3u;
        $lib['games'][$i]['launch']['args'] = str_replace($rom, $m3u, (string) ($g['launch']['args'] ?? ''));
    }
    return $lib;
}
