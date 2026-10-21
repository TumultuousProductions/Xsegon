<?php
/**
 * Xsegon - the importer.
 *
 * Reads LaunchBox once and writes data\library.json, when asked (or at startup if the
 * timestamps moved and library.importOnStartup is on); requests read the JSON.
 *
 * Every game keeps its own row: two games sharing a name are still two games, and
 * grouping is for a view to do.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/launchbox.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/art.php';
require_once __DIR__ . '/overrides.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/local.php';
require_once __DIR__ . '/drives.php';    // a drive that has stopped answering is not looked at

function xs_library_path(): string
{
    return xs_data_path('library.json');
}

function xs_sessions_path(): string
{
    return xs_data_path('sessions.jsonl');
}

/** Newest mtime across the LaunchBox files we actually read. */
function xs_launchbox_stamp(string $root, array $platforms): int
{
    $files = [
        lb_data_dir($root) . DIRECTORY_SEPARATOR . 'Platforms.xml',
        lb_data_dir($root) . DIRECTORY_SEPARATOR . 'Emulators.xml',
    ];
    foreach ($platforms as $p) {
        $files[] = lb_data_dir($root) . DIRECTORY_SEPARATOR . 'Platforms'
                 . DIRECTORY_SEPARATOR . $p . '.xml';
    }
    $newest = 0;
    foreach ($files as $f) {
        if (is_file($f)) {
            $newest = max($newest, (int) filemtime($f));
        }
    }
    return $newest;
}

function xs_import(?array $settings = null): array
{
    $t0 = microtime(true);
    $s = $settings ?? xs_settings();
    $root = xs_norm_path($s['paths']['launchbox']);

    if (!is_dir($root)) {
        return ['ok' => false, 'error' => "LaunchBox not found at {$root}"];
    }

    $allPlatforms = lb_platforms($root);
    $wanted = $s['library']['platforms'];
    $platforms = $wanted ? array_values(array_intersect($allPlatforms, $wanted)) : $allPlatforms;

    /* Xsegon's own emulator table, seeded from LaunchBox on the first import that finds
       none; from then on it is what the import reads. Deleting it reads LaunchBox again. */
    if (!is_file(xs_emulators_path())) {
        xs_emulators_write(xs_emulators_seed($root));
        xs_log('EMU', 'seeded data\\emulators.json from LaunchBox');
    }
    $table     = xs_emulators($root);
    // Only the list of games comes in: nothing of LaunchBox's pictures, which Get Pictures fills instead.
    $noPictures = array_fill_keys(array_keys(art_types()), null);

    $games = [];
    $perPlatform = [];
    $noArt = 0;
    $noLaunch = [];

    foreach ($platforms as $platform) {
        $rows = lb_games($root, $platform);
        if (!$rows) {
            continue;                        // a category like "Consoles" has no game file
        }
        $kept = 0;

        foreach ($rows as $g) {
            if ($g['hidden'] && !$s['library']['includeHidden']) {
                continue;
            }
            if ($g['broken'] && !$s['library']['includeBroken']) {
                continue;
            }

            $launch = xs_emu_launch($table, $g, $root);
            if (isset($launch['error'])) {
                $noLaunch[] = $g['title'] . ' (' . $platform . '): ' . $launch['error'];
            }

            $noArt++;
            $g['art']    = $noPictures;
            $g['launch'] = isset($launch['error']) ? null : $launch;
            $g['launchError'] = $launch['error'] ?? null;
            $g['key']    = art_key($g['title']);      // for search, not for merging
            $games[] = $g;
            $kept++;
        }
        $perPlatform[$platform] = $kept;
    }

    $library = [
        'generatedAt' => date('c'),
        'stamp'       => xs_launchbox_stamp($root, $platforms),
        'launchbox'   => $root,
        'platforms'   => $perPlatform,
        'counts'      => [
            'games'     => count($games),
            'noArt'     => $noArt,
            'noLaunch'  => count($noLaunch),
        ],
        'unlaunchable'      => array_slice($noLaunch, 0, 50),
        'games'             => $games,
    ];

    /* A LaunchBox file that is there but unreadable must not read as "nothing there",
       or a console would quietly vanish: the import refuses and leaves the library. */
    $bad = lb_bad_xml('take');
    if ($bad) {
        $names = implode(', ', array_map('basename', $bad));
        xs_log('IMP', 'refused: ' . $names . ' cannot be read as XML; the library was left as it was');
        return ['ok' => false, 'error' => 'LaunchBox\'s ' . $names . ' cannot be read (a damaged file?). '
            . 'Nothing was imported, so your library is untouched. LaunchBox keeps .bak copies beside it.'];
    }

    // The whole import is lost if this fails, so the reason goes to the screen.
    if (!xs_write_json(xs_library_path(), $library, $why)) {
        return ['ok' => false, 'error' => (string) $why];
    }

    $seeded = 0;
    if ($s['library']['seedPlayHistory']) {
        $seeded = xs_seed_history($games);
    }

    // The startup import throws its report away, so the log carries the summary.
    xs_log('IMP', 'imported ' . count($games) . ' games across ' . count($perPlatform) . ' consoles in '
        . (int) round((microtime(true) - $t0) * 1000) . 'ms'
        . ($noArt ? ', ' . $noArt . ' without art' : '') . (count($noLaunch) ? ', ' . count($noLaunch) . ' unlaunchable' : ''));

    return [
        'ok'        => true,
        'games'     => count($games),
        'platforms' => count($perPlatform),
        'noArt'     => $noArt,
        'noLaunch'  => count($noLaunch),
        'seeded'    => $seeded,
        'ms'        => (int) round((microtime(true) - $t0) * 1000),
    ];
}

/**
 * Take LaunchBox's PlayCount/PlayTime exactly once, so Recently Played is not empty on
 * day one. After this Xsegon's session log is the only record; nothing is merged.
 */
function xs_seed_history(array $games): int
{
    $marker = xs_data_path('history-seeded.json');
    if (is_file($marker)) {
        return 0;
    }
    $rows = 0;
    foreach ($games as $g) {
        if ($g['playCount'] <= 0 && $g['playTime'] <= 0) {
            continue;
        }
        xs_append_jsonl(xs_sessions_path(), [
            'at'       => null,             // LaunchBox does not record when
            'gameId'   => $g['id'],
            'title'    => $g['title'],
            'platform' => $g['platform'],
            'seconds'  => $g['playTime'],
            'count'    => $g['playCount'],
            'source'   => 'launchbox-seed',
        ]);
        $rows++;
    }
    xs_write_json($marker, ['seededAt' => date('c'), 'rows' => $rows]);
    return $rows;
}

/**
 * The library as every reader should see it: what was imported, with Xsegon's edits laid
 * over it. The importer never calls this, so an edit is never written into library.json.
 */
/**
 * Where a game's file really is. LaunchBox may store a path relative to its own folder,
 * and a check for the file must ask about the same path the launch would use.
 */
function xs_rom_real_path(string $rom, array $s): string
{
    if ($rom === '' || preg_match('/^(?:[A-Za-z]:[\\\\\\/]|\\\\\\\\)/', $rom)) {
        return $rom;                        // already absolute, or a UNC share
    }
    $lb = xs_norm_path((string) ($s['paths']['launchbox'] ?? ''));
    return $lb === '' ? $rom : $lb . DIRECTORY_SEPARATOR . $rom;
}

/* ---- a games folder that is not there right now ---------------------------
 * Asked per game: a file whose own games folder or drive is away is not missing, it is
 * away, so an unplugged second drive's games are not offered for deleting.
 */

/** The folder a game's file lives under: the longest games folder of yours that holds it, else its drive or share. */
function xs_rom_home(string $full, array $s): string
{
    $full = xs_norm_path($full);
    $best = '';
    $roots = array_merge([(string) ($s['paths']['romRoot'] ?? '')], (array) ($s['paths']['scanFolders'] ?? []));
    foreach ($roots as $r) {
        $r = is_string($r) ? xs_norm_path($r) : '';
        if ($r !== '' && strlen($r) > strlen($best) && xs_inside($full, $r)) {
            $best = $r;
        }
    }
    if ($best !== '') {
        return $best;
    }
    if (preg_match('#^[A-Za-z]:[\\\\/]#', $full)) {
        return strtoupper($full[0]) . ':' . DIRECTORY_SEPARATOR;
    }
    return preg_match('#^(\\\\\\\\[^\\\\/]+[\\\\/][^\\\\/]+)#', $full, $m) ? $m[1] : '';
}

/** The folder of this file that is not there right now, or null when it is (or the file has no such folder). */
function xs_rom_away(string $full, array $s): ?string
{
    static $there = [];
    $home = xs_rom_home($full, $s);
    if ($home === '') {
        return null;
    }
    $key = strtolower($home);
    // A drive that is not answering is away, for as long as it is not.
    $there[$key] ??= xs_drive_stuck($home) === null && xs_look('is_dir', $home);
    return $there[$key] ? null : $home;
}

/**
 * Mark games whose file is not on the disk as unplayable, with the reason, so Play does
 * not fail in the emulator. Skipped when the ROM drive is absent: that is one problem,
 * which the guardrail already says, not one per game.
 */
function xs_apply_missing(array $lib, array $s): array
{
    if (empty($lib['games']) || empty($s['launch']['sweepFiles'])) {
        return $lib;
    }
    $root = xs_norm_path((string) ($s['paths']['romRoot'] ?? ''));
    if ($root !== '' && (xs_drive_stuck($root) !== null || !is_dir($root))) {
        return $lib;
    }
    /* Answers are kept 10 seconds: a game's details asks several endpoints at once, and a
       sleeping drive is slow. A launch always checks the real file (bin\launch.ps1). */
    $cacheFile = xs_data_path('rom-check.json');
    $cache = xs_read_json($cacheFile, null);
    $known = (is_array($cache) && ($cache['root'] ?? null) === $root && time() - (int) ($cache['at'] ?? 0) < 10
              && is_array($cache['has'] ?? null)) ? $cache['has'] : [];
    $has = [];
    foreach ($lib['games'] as $i => $g) {
        // Not a game that already cannot launch, nor one of your own (maybe a web address).
        if (empty($g['launch']) || !empty($g['local'])) {
            continue;
        }
        // A scanned game's file was seen by this same read (xs_scanned_games).
        if (!empty($g['scanned'])) {
            continue;
        }
        $rom = (string) ($g['romPath'] ?? '');
        if ($rom === '') {
            continue;
        }
        // "Has" also when its own folder is away: an unplugged drive, not a file gone.
        $full = xs_rom_real_path($rom, $s);
        $has[$rom] = array_key_exists($rom, $known) ? (bool) $known[$rom]
                   : (xs_file_seen($full) || xs_rom_away($full, $s) !== null);
        if ($has[$rom]) {
            continue;
        }
        $lib['games'][$i]['launch'] = null;
        $lib['games'][$i]['launchError'] = 'the file is not there: ' . $rom;
    }
    // The fast lane never writes: its answer is as right, only not kept.
    if ($has && !$known && !xs_fast_lane()) {
        xs_write_json($cacheFile, ['at' => time(), 'root' => $root, 'has' => $has]);
    }
    return $lib;
}

function xs_library(): array
{
    return xs_library_build();
}

/**
 * One game as xs_library() has it, or null. The same row, but the disk is
 * asked about this game's file and pictures alone, not every game's.
 */
function xs_game(string $id): ?array
{
    foreach (xs_library_build($id)['games'] ?? [] as $g) {
        if ((string) ($g['id'] ?? '') === $id) {
            return $g;
        }
    }
    return null;
}

/** The same, or a 404 in the endpoint's own words. */
function xs_game_or_404(string $id, string $why = 'unknown game'): array
{
    $game = xs_game($id);
    if ($game === null) {
        xs_fail($why, 404);
    }
    return $game;
}

/**
 * The library, built. With $only, every row but that game's skips the disk
 * and is right only in the names it shares: xs_game() is the way in.
 */
function xs_library_build(?string $only = null): array
{
    $was = xs_doing('reading the library');
    $lib = xs_read_json(xs_library_path(), ['games' => [], 'counts' => ['games' => 0]]);
    // Your own games join before the overlays, so marks and edits work on them too.
    // They are never in library.json.
    xs_doing('reading your own games');
    $lib = xs_apply_local($lib);
    // Scanned games likewise: merged at read, so a re-import cannot take them away.
    require_once __DIR__ . '/scan.php';
    xs_doing('reading the games Scan for Games added');
    $lib = xs_apply_scanned($lib, $only);
    xs_doing('reading the library');
    $lib = xs_apply_hidden($lib);        // games told not to show (data\hidden.json)
    // Deleted games go next, before any overlay is spent on them.
    require_once __DIR__ . '/deleted.php';
    $lib = xs_apply_deleted($lib);
    // A game given an emulator of its own starts in it (includes\emuset.php).
    require_once __DIR__ . '/emuset.php';
    $lib = xs_apply_emu_choice($lib);
    // A disc set with a playlist plays through it; before the sweep, so the sweep
    // looks for the file that would launch.
    xs_doing('checking disc sets and missing files');
    $lib = xs_apply_m3u($lib, xs_settings());
    $lib = xs_apply_missing($lib, xs_settings());
    xs_doing('putting on pictures and your changes');
    if (isset($lib['games']) && is_array($lib['games'])) {
        $lib['games'] = xs_apply_overrides($lib['games']);
        // Order is rank, lowest first: the copy in data\media (includes\media.php),
        // then an image replaced in Xsegon.
        $lib['games'] = xs_apply_media_copy($lib['games']);
        $lib['games'] = xs_apply_art_hidden($lib['games']);   // before own art: a replacement still shows
        $lib['games'] = xs_apply_own_art($lib['games'], $only);
        // A scanned "(Track N).bin" is one track of a disc, not a game: dropped here,
        // while its row in scanned-games.json stays.
        $lib['games'] = array_values(array_filter($lib['games'], static function (array $g): bool {
            return !xs_scan_track_bin(basename(str_replace(chr(92), '/', (string) ($g['romPath'] ?? ''))));
        }));
        // A file said to go with a game leaves the lists for that game's tab (includes\accompanied.php).
        require_once __DIR__ . '/accompanied.php';
        $lib = xs_apply_accompanied($lib);
        // After the overrides, so a title you gave a game is the one compared.
        $lib['games'] = xs_apply_variants($lib['games']);
    }
    xs_doing($was);
    return $lib;
}

/**
 * Games sharing a console and title, told apart: $g['variant'] holds the bracket words of
 * its file name the others lack; the title itself is left as it is.
 *
 * Words every member shares are dropped. Two left alike add the file type ("USA, Z64"
 * beside "USA, ZIP"). Cut at 48 characters.
 */
function xs_file_tags(string $file): array
{
    $name = pathinfo(str_replace(chr(92), '/', $file), PATHINFO_FILENAME);
    $tags = [];
    $depth = 0;
    $buf = '';
    foreach (mb_str_split($name) as $c) {
        if ($c === '(' || $c === '[') {
            if ($depth++ === 0) {
                $buf = '';
                continue;
            }
        } elseif (($c === ')' || $c === ']') && $depth > 0) {
            if (--$depth === 0) {
                if (trim($buf) !== '') {
                    $tags[] = trim($buf);
                }
                continue;
            }
        }
        if ($depth > 0) {
            $buf .= $c;
        }
    }
    return $tags;
}

function xs_apply_variants(array $games): array
{
    $groups = [];
    foreach ($games as $i => $g) {
        $key = mb_strtolower((string) ($g['platform'] ?? '')) . '|' . mb_strtolower(trim((string) ($g['title'] ?? '')));
        $groups[$key][] = $i;
    }
    foreach ($groups as $idx) {
        if (count($idx) < 2) {
            continue;
        }
        $tags = [];
        foreach ($idx as $i) {
            $tags[$i] = xs_file_tags((string) ($games[$i]['romPath'] ?? ''));
        }
        $lower = array_map(static fn($t) => array_map('mb_strtolower', $t), $tags);
        $common = array_intersect(...array_values($lower));
        $words = [];
        foreach ($idx as $i) {
            $own = array_filter($tags[$i], static fn($t) => !in_array(mb_strtolower($t), $common, true));
            $words[$i] = implode(', ', $own);
        }
        $seen = array_count_values($words);
        foreach ($idx as $i) {
            $ext = strtoupper((string) pathinfo((string) ($games[$i]['romPath'] ?? ''), PATHINFO_EXTENSION));
            if ($seen[$words[$i]] > 1 && $ext !== '') {
                $words[$i] = $words[$i] === '' ? $ext : $words[$i] . ', ' . $ext;
            }
            if ($words[$i] !== '') {
                $games[$i]['variant'] = mb_strlen($words[$i]) > 48 ? rtrim(mb_substr($words[$i], 0, 45)) . '...' : $words[$i];
            }
        }
    }
    return $games;
}

/** True when LaunchBox has changed since the library was built. */
function xs_library_stale(array $s): bool
{
    $lib = xs_read_json(xs_library_path());
    if (!is_array($lib) || !isset($lib['stamp'])) {
        return true;
    }
    $root = xs_norm_path($s['paths']['launchbox']);
    if (xs_drive_stuck($root) !== null) {
        return false;                    // LaunchBox's drive is not answering: nothing can be said to have moved
    }
    $platforms = $s['library']['platforms'] ?: lb_platforms($root);
    return xs_launchbox_stamp($root, $platforms) > (int) $lib['stamp'];
}
