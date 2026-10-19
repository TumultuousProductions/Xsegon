<?php
/**
 * Xsegon - the diagnostics report.
 *
 * Gathers the log, settings, emulator table and receipts into one zip.
 * `report.txt` leads with whatever check failed, so most reports are
 * answerable without unzipping anything.
 *
 * It carries no games, art or video, and a summary in place of the library,
 * so it attaches to a message. It DOES carry the person's paths and game
 * names (a report without paths cannot answer a path question); the screen
 * says so before the button, and the report lists its own contents.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/import.php';
require_once __DIR__ . '/version.php';
require_once __DIR__ . '/backup.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/padplugged.php';
require_once __DIR__ . '/sittings.php';

/** How many days of log go in. Enough for "it worked on Tuesday". */
const XS_REPORT_DAYS = 3;

/** Anything bigger than this is named in the report but left out of it. */
const XS_REPORT_MAX_FILE = 4194304;

function xs_report_dir(): string
{
    $d = xs_data_path('reports');
    if (!is_dir($d)) {
        @mkdir($d, 0777, true);
    }
    return $d;
}

/** Is this a name this code wrote? Nothing else in the folder is touched. */
function xs_report_is_name(string $name): bool
{
    return (bool) preg_match('/^xsegon-report-\d{4}-\d\d-\d\d-\d{4}\.zip$/', $name);
}

/**
 * Can Xsegon save anything at all? Done for real through xs_write_json, so a
 * failure reads as the person saw it when their setting did not stick.
 */
function xs_report_write_test(?string &$why = null): bool
{
    $probe = xs_data_path('write-check.json');
    $ok    = xs_write_json($probe, ['at' => date('c')], $why);
    @unlink($probe);
    @unlink($probe . '.tmp');
    return $ok;
}

/** The day logs a report reads, day => file, today's and the days before it. */
function xs_report_log_days(): array
{
    $out = [];
    for ($i = 0; $i < XS_REPORT_DAYS; $i++) {
        $day = date('Y-m-d', strtotime('-' . $i . ' days'));
        $p   = xs_data_path('log') . DIRECTORY_SEPARATOR . $day . '.log';
        if (is_file($p)) {
            $out[$day] = $p;
        }
    }
    return $out;
}

/** Count the lines of today's log that mean something went wrong. */
function xs_report_today_trouble(): array
{
    $path = xs_data_path('log') . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log';
    $out  = ['PHPE' => 0, 'FAIL' => 0, 'WRIT' => 0, 'ERR' => 0, 'BUG' => 0, 'WARN' => 0, 'last' => []];
    if (!is_file($path)) {
        return $out;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        if (!preg_match('/^\S+ [SP] (PHPE|FAIL|WRIT|ERR|BUG|WARN)\s/', $line, $m)) {
            continue;
        }
        $out[$m[1]]++;
        $out['last'][] = $line;
    }
    $out['last'] = array_slice($out['last'], -12);
    return $out;
}

/**
 * Everything a person would check by hand, checked.
 *
 * Each row is [key, label, state, says]. State is one of bad, warn, ok, info:
 * bad is "this is almost certainly your problem", warn is "this would explain
 * some things", info is "worth knowing, nothing wrong".
 */
function xs_report_checks(): array
{
    $s    = xs_settings();
    $out  = [];
    $add  = static function (string $key, string $label, string $state, string $says) use (&$out): void {
        $out[] = ['key' => $key, 'label' => $label, 'state' => $state, 'says' => $says];
    };

    $add('build', 'This build', 'info', xs_version_line());

    // What the person changed: Xsegon's own files not as the release made them, and a look of their own (includes\custom.php).
    require_once __DIR__ . '/custom.php';
    $rc = xs_release_changes();
    $own = xs_custom_state();
    $names = static fn (array $l): string => implode(', ', array_slice($l, 0, 20)) . (count($l) > 20 ? ' and ' . (count($l) - 20) . ' more' : '');
    $add('changed', 'Changed from the release', 'info',
        ($rc === null ? 'not a release (a checkout or a tester\'s copy): there is no list to compare its files with.'
            : (!$rc['changed'] && !$rc['missing'] ? 'every one of the ' . $rc['files'] . ' files of release ' . $rc['version'] . ' is as it came.'
                : ($rc['changed'] ? count($rc['changed']) . ' of the ' . $rc['files'] . ' files of release ' . $rc['version'] . ' differ: ' . $names($rc['changed']) . '. ' : '')
                  . ($rc['missing'] ? count($rc['missing']) . ' are not there: ' . $names($rc['missing']) . '.' : '')))
        . ($own['css'] ? ' A stylesheet of their own is read after Xsegon\'s (custom\\style.css, ' . $own['lines'] . ' lines'
            . (!empty($own['starter']) ? ', as Xsegon made it' : '') . (!empty($s['feel']['highContrast']) ? ', left out with High contrast' : '') . ').' : ''));

    // Can it write at all. Everything else is downstream of this one.
    $why = null;
    if (xs_report_write_test($why)) {
        $add('write', 'Saving', 'ok', 'Xsegon can write to its own data folder.');
    } else {
        $add('write', 'Saving', 'bad', 'Xsegon CANNOT write to its own data folder. ' . (string) $why);
    }

    $free = @disk_free_space(xs_data_dir());
    if ($free === false) {
        $add('space', 'Free space', 'warn', 'the free space on that drive could not be read.');
    } else {
        $gb = $free / 1073741824;
        $add('space', 'Free space', $gb < 1 ? 'bad' : ($gb < 5 ? 'warn' : 'ok'),
            number_format($gb, 1) . ' GB free where data\\ lives'
            . ($gb < 1 ? ', which is not enough to save reliably.' : '.'));
    }

    // The guardrail that stops most launches.
    $rom = xs_norm_path((string) ($s['paths']['romRoot'] ?? ''));
    /* Getting started keeps the folder you choose as a scan folder, not as
       the ROM drive, so with no ROM drive the games folders are what count. */
    $scanDirs = array_values(array_filter(array_map(static fn($p) => xs_norm_path((string) $p),
        (array) ($s['paths']['scanFolders'] ?? [])), static fn($p) => $p !== ''));
    if ($rom === '' && $scanDirs) {
        $gone = array_values(array_filter($scanDirs, static fn($p) => !is_dir($p)));
        $add('roms', 'Games folders', $gone ? 'warn' : 'ok', $gone
            ? implode(', ', $gone) . (count($gone) === 1 ? ' is' : ' are') . ' not there. Is a drive unplugged?'
            : implode(', ', $scanDirs));
    } elseif ($rom === '') {
        $add('roms', 'Games folders', 'warn', 'none chosen yet. Help > Getting started asks for one.');
    } elseif (is_dir($rom)) {
        $add('roms', 'ROM folder', 'ok', $rom);
    } else {
        $add('roms', 'ROM folder', 'bad', $rom . ' is NOT THERE. If that is a removable drive, plug it in. '
            . 'Xsegon refuses to launch while it is missing, on purpose, because an emulator handed a path on a '
            . 'drive that is gone fails in a way that looks like the emulator being broken.');
    }

    /* LaunchBox is checked only where it is set. Without it no import builds
       a library, so the library is the games Xsegon has (scanned, your own). */
    $lb = xs_norm_path((string) ($s['paths']['launchbox'] ?? ''));
    if ($lb !== '') {
        $add('launchbox', 'LaunchBox', is_dir($lb) ? 'ok' : 'info',
            is_dir($lb) ? $lb : $lb . ' is not there. Everything still works except importing your library again.');
    }

    $lib = xs_read_json(xs_library_path(), null);
    if ($lib === null && !is_dir($lb)) {
        require_once __DIR__ . '/import.php';
        $n = count(xs_library()['games'] ?? []);
        $add('library', 'Library', $n ? 'ok' : 'info', $n
            ? $n . ($n === 1 ? ' game' : ' games') . ', found by Scan for Games or added by you.'
            : 'no games yet. Help > Getting started finds them.');
    } elseif ($lib === null) {
        $add('library', 'Library', 'bad', 'no library has been built. Settings > Library > Re-read LaunchBox.');
    } else {
        $age  = time() - strtotime((string) ($lib['generatedAt'] ?? 'now'));
        $days = (int) floor($age / 86400);
        $add('library', 'Library', 'ok', (int) ($lib['counts']['games'] ?? 0) . ' games across '
            . count($lib['platforms'] ?? []) . ' consoles, built '
            . ($days > 0 ? $days . ' days ago' : 'today') . '.');
        $bad = count($lib['unlaunchable'] ?? []);
        if ($bad > 0) {
            $add('unlaunchable', 'Games that cannot launch', 'warn', $bad
                . ' of them had no launch command when the library was built. They are listed in library-summary.txt.');
        }
    }

    // Every emulator path, because one wrong path takes a whole console out.
    $table   = xs_read_json(xs_emulators_path(), null);
    $progs   = is_array($table) ? ($table['programs'] ?? []) : [];
    $missing = [];
    foreach ($progs as $key => $p) {
        if (!is_file((string) ($p['exe'] ?? ''))) {
            $missing[] = $key . ' (' . (string) ($p['exe'] ?? '') . ')';
        }
    }
    if (!$progs) {
        $add('emulators', 'Emulators', 'warn', is_dir($lb)
            ? 'Xsegon has no emulator table yet. It is written on the first import.'
            : 'none set up yet. Help > Getting started gets RetroArch and sets it up.');
    } elseif ($missing) {
        $add('emulators', 'Emulators', 'bad', count($missing) . ' of ' . count($progs)
            . ' are not where Xsegon thinks: ' . implode('; ', $missing)
            . '. Settings > Emulators fixes a path without re-importing anything.');
    } else {
        $add('emulators', 'Emulators', 'ok', 'all ' . count($progs) . ' are on disk.');
    }

    // The launcher's own last word.
    $err = xs_read_json(xs_data_path('last-error.json'), null);
    if (is_array($err)) {
        $add('lastError', 'Last launch failure', 'warn',
            (string) ($err['title'] ?? 'a game') . ': ' . (string) ($err['error'] ?? $err['message'] ?? 'no reason recorded')
            . (isset($err['at']) ? ' (' . (string) $err['at'] . ')' : ''));
    }
    $run = xs_read_json(xs_data_path('running.json'), null);
    if (is_array($run)) {
        $since = isset($run['startedAt']) ? (time() - (int) strtotime((string) $run['startedAt'])) : 0;
        $add('running', 'A game is marked running', $since > 21600 ? 'warn' : 'info',
            (string) ($run['title'] ?? 'a game') . ($since > 21600
                ? ', and has been for over six hours, so this is probably a leftover from a window that was killed.'
                : '.'));
    }

    $t = xs_report_today_trouble();
    $n = $t['PHPE'] + $t['FAIL'] + $t['WRIT'] + $t['ERR'] + $t['BUG'] + $t['WARN'];
    // A BUG is a fault in Xsegon itself (log.js, bug()): always worth a look.
    $add('trouble', 'Trouble in today\'s log', $t['PHPE'] || $t['WRIT'] || $t['BUG'] ? 'warn' : ($n ? 'info' : 'ok'),
        $n === 0 ? 'nothing logged as an error today.'
            : $n . ' lines: ' . $t['BUG'] . ' faults in Xsegon, ' . $t['PHPE'] . ' PHP errors, ' . $t['WRIT'] . ' failed saves, '
              . $t['FAIL'] . ' refused requests, ' . $t['ERR'] . ' page errors, ' . $t['WARN'] . ' warnings.');

    // Saved settings of the wrong kind (settings.php, xs_settings_drift).
    $drift = xs_settings_drift();
    $add('drift', 'Settings of the wrong kind', $drift ? 'warn' : 'ok',
        $drift ? implode('; ', array_slice($drift, 0, 6)) . '. Setting each one again from its menu, or Reset to defaults, puts it right.'
               : 'every saved setting is the kind it should be.');

    if (!xs_log_enabled()) {
        $add('logging', 'Logging', 'warn', 'logging is OFF (Settings > Debug), so this report carries very little. '
            . 'Turn it on, make the problem happen again, then make the report.');
    }

    // A page only hears a controller that presses a button, so Windows is asked what is plugged in as well.
    $padWhy = null;
    $seen   = xs_sittings_pads(xs_report_log_days());
    $add('pads', 'Controllers', 'info', xs_pads_plugged_words(xs_pads_plugged_ask($padWhy), $padWhy) . '. '
        . (!xs_log_enabled() ? 'With logging off, whether one pressed a button in Xsegon is not known.'
            : ($seen ? 'In the log of these days, pressed a button in Xsegon: ' . implode('; ', $seen) . '.'
                     : 'In the log of these days none pressed a button in Xsegon.')));

    // Why Xsegon is built the way it is, which saves a round of questions.
    $off = array_values(array_filter(['sqlite3', 'zip', 'gd'], static fn($e) => !extension_loaded($e)));
    if ($off) {
        $add('php', 'PHP extensions off', 'info', implode(', ', $off)
            . ' are not loaded, which is expected: Xsegon is written to work without them.');
    }

    return $out;
}

/** A per-console count, plus the games that could not be launched. */
function xs_report_library_summary(): string
{
    $lib = xs_read_json(xs_library_path(), null);
    if ($lib === null) {
        // With no library.json the games are the scanner's and your own, merged at read.
        require_once __DIR__ . '/import.php';
        $merged = xs_library();
        if (empty($merged['games'])) {
            return "No games yet. Help > Getting started finds them.\n";
        }
        $lib = ['generatedAt'  => 'read live from Scan for Games and your own games',
                'launchbox'    => '(no LaunchBox: this library is Xsegon\'s own)',
                'games'        => $merged['games'],
                'unlaunchable' => array_slice(array_values(array_filter(array_map(
                    static fn($g) => empty($g['launch'])
                        ? ['title' => (string) ($g['title'] ?? '?'), 'platform' => (string) ($g['platform'] ?? '?')]
                        : null,
                    $merged['games']))), 0, 50)];
    }
    $out = "Library built " . (string) ($lib['generatedAt'] ?? '?') . "\n";
    $out .= "From " . (string) ($lib['launchbox'] ?? '?') . "\n\n";

    $rows = [];
    foreach ($lib['games'] ?? [] as $g) {
        $p = (string) ($g['platform'] ?? '?');
        $rows[$p] = $rows[$p] ?? ['games' => 0, 'noArt' => 0, 'noLaunch' => 0];
        $rows[$p]['games']++;
        if (empty($g['art']['box'])) { $rows[$p]['noArt']++; }
        if (empty($g['launch'])) { $rows[$p]['noLaunch']++; }
    }
    ksort($rows);
    $out .= str_pad('Console', 40) . str_pad('Games', 8) . str_pad('No cover', 10) . "No launch\n";
    $out .= str_repeat('-', 68) . "\n";
    foreach ($rows as $p => $r) {
        $out .= str_pad(mb_substr($p, 0, 38), 40) . str_pad((string) $r['games'], 8)
              . str_pad((string) $r['noArt'], 10) . $r['noLaunch'] . "\n";
    }

    $bad = $lib['unlaunchable'] ?? [];
    $out .= "\nGames with no launch command (" . count($bad) . " shown):\n";
    foreach ($bad as $b) {
        $out .= '  ' . (is_array($b) ? (string) ($b['title'] ?? '?') . ' [' . (string) ($b['platform'] ?? '?') . ']'
                                     : (string) $b) . "\n";
    }

    // Each game's file by name, never its folder: which release a game is shows here ("... (USA).sfc").
    $out .= "\nEvery game and its file, by console:\n";
    $by = [];
    foreach ($lib['games'] ?? [] as $g) {
        $file = basename(str_replace('\\', '/', (string) ($g['romPath'] ?? $g['run'] ?? '')));
        $by[(string) ($g['platform'] ?? '?')][] = '  ' . (string) ($g['title'] ?? '?') . '  =  ' . ($file !== '' ? $file : '(no file)');
    }
    ksort($by);
    foreach ($by as $p => $lines) {
        natcasesort($lines);
        $out .= "\n" . $p . "\n" . implode("\n", $lines) . "\n";
    }
    return $out;
}

/** What is actually in data\, folder by folder, so "is the copy there" is answerable. */
function xs_report_data_summary(): string
{
    $out = "data\\ as it stands\n" . str_repeat('-', 60) . "\n";
    foreach (scandir(xs_data_dir()) ?: [] as $name) {
        if ($name === '.' || $name === '..') {
            continue;
        }
        $full = xs_data_path($name);
        if (is_dir($full)) {
            $files = 0;
            $bytes = 0;
            foreach (xs_backup_walk($name) as $rel) {
                $files++;
                $bytes += (int) @filesize(xs_data_path(str_replace('/', DIRECTORY_SEPARATOR, $rel)));
            }
            $out .= str_pad($name . '\\', 26) . str_pad($files . ' files', 14)
                  . number_format($bytes / 1048576, 1) . " MB\n";
        } else {
            $out .= str_pad($name, 26) . str_pad('', 14) . number_format(((int) @filesize($full)) / 1024, 1) . " KB\n";
        }
    }
    return $out;
}

/** The PHP this is running on, and the settings that shaped the design. */
function xs_report_php_summary(): string
{
    $keys = ['date.timezone', 'memory_limit', 'upload_max_filesize', 'post_max_size',
             'max_execution_time', 'display_errors', 'error_reporting'];
    $out  = 'PHP ' . PHP_VERSION . ' (' . xs_php_exe() . ")\n";
    $out .= 'ini file: ' . (xs_utf8_path((string) php_ini_loaded_file()) ?: 'none') . "\n\n";
    foreach ($keys as $k) {
        $out .= str_pad($k, 24) . (string) ini_get($k) . "\n";
    }
    $out .= "\nExtensions loaded:\n  " . implode(', ', get_loaded_extensions()) . "\n";
    return $out;
}

/** The report a person reads first. Whatever is wrong is at the top. */
function xs_report_text(array $checks, array $contents): string
{
    $rank = ['bad' => 0, 'warn' => 1, 'ok' => 2, 'info' => 3];
    $sorted = $checks;
    usort($sorted, static fn($a, $b) => ($rank[$a['state']] ?? 9) <=> ($rank[$b['state']] ?? 9));

    $bad  = array_filter($checks, static fn($c) => $c['state'] === 'bad');
    $warn = array_filter($checks, static fn($c) => $c['state'] === 'warn');

    $out  = "XSEGON DIAGNOSTICS REPORT\n";
    $out .= str_repeat('=', 68) . "\n";
    $out .= 'Made ' . date('Y-m-d H:i:s') . "\n";
    $out .= xs_version_line() . "\n\n";

    if ($bad) {
        $out .= "START HERE. " . count($bad) . " thing" . (count($bad) === 1 ? '' : 's')
              . " look" . (count($bad) === 1 ? 's' : '') . " genuinely wrong:\n\n";
        foreach ($bad as $c) {
            $out .= '  * ' . $c['label'] . ': ' . $c['says'] . "\n";
        }
        $out .= "\n";
    } elseif ($warn) {
        $out .= "Nothing is outright broken. " . count($warn) . " thing"
              . (count($warn) === 1 ? '' : 's') . " worth a look:\n\n";
        foreach ($warn as $c) {
            $out .= '  * ' . $c['label'] . ': ' . $c['says'] . "\n";
        }
        $out .= "\n";
    } else {
        $out .= "Every check passed. Whatever went wrong is not one of the usual\n"
              . "causes, so the log is the place to look.\n\n";
    }

    $out .= "EVERY CHECK\n" . str_repeat('-', 68) . "\n";
    foreach ($sorted as $c) {
        $out .= str_pad(strtoupper($c['state']), 6) . str_pad($c['label'], 28) . $c['says'] . "\n";
    }

    $t = xs_report_today_trouble();
    if ($t['last']) {
        $out .= "\nTHE LAST FEW TROUBLE LINES FROM TODAY\n" . str_repeat('-', 68) . "\n";
        foreach ($t['last'] as $line) {
            $out .= $line . "\n";
        }
    }

    // Each time Xsegon was open and what was done in it, so that is not dug out of the log by hand.
    $out .= "\n" . xs_sittings_text(xs_sittings(xs_report_log_days()));

    $out .= "\nWHAT IS IN THIS ZIP\n" . str_repeat('-', 68) . "\n";
    foreach ($contents as $name => $why) {
        $out .= str_pad($name, 30) . $why . "\n";
    }
    $out .= "\nWHAT IS NOT\n" . str_repeat('-', 68) . "\n";
    $out .= "Your ROMs, your pictures and your videos. None of them help and all\n";
    $out .= "of them are enormous. The full library.json is left out too, and\n";
    $out .= "library-summary.txt is in its place.\n";
    $out .= "\nWhat IS here: the folders you chose, the names of your games and of\n";
    $out .= "their files (library-summary.txt; it says which copy a game is). A\n";
    $out .= "report with the paths taken out cannot answer a path question. Where\n";
    $out .= "Xsegon was slow, the log also names the three programs that were using\n";
    $out .= "this PC the most at that moment (its BUSY lines).\n";

    return $out;
}

/**
 * Write one. Returns what was made. A log day over the cap is named rather
 * than carried, so the report still attaches to a message.
 */
function xs_report_make(): array
{
    // Four things, said as each begins (xs_step): the window waiting on this draws its bar from them.
    xs_step('Running the checks', 0, 4);
    $checks = xs_report_checks();

    // name => what it is, which is also the contents list inside report.txt
    $why = [
        'report.txt'          => 'this file: the checks, worst first',
        'library-summary.txt' => 'games per console, any that cannot launch, each game\'s file',
        'data-summary.txt'    => "what is in Xsegon's data folder",
        'php.txt'             => 'the PHP running it, and its settings',
    ];

    $files = [];
    $small = ['settings.json' => 'your settings, paths included',
              'emulators.json' => 'where each emulator is',
              'cores.json'     => 'cores you chose per game',
              'emu-choice.json' => 'emulators you chose per game',
              'hack-choice.json' => 'games whose hacks start from a patched copy',
              'cheats.json'    => 'cheats you chose per game',
              'pad-remaps.json' => 'the buttons you set per console',
              'player-remaps.json' => 'the buttons players 2 to 4 have of their own',
              'game-remaps.json' => 'the buttons you set for one game',
              'pad-keys.json'   => 'the keyboard keys you set per console',
              'ra-hotkeys.json'  => 'your menu, quit and turbo choices for RetroArch',
              'game-hotkeys.json' => 'the turbo you set for one game',
              'hidden.json'    => 'games you took off the screen',
              'art-hidden.json' => 'pictures you told it not to use',
              'favourites.json' => 'your stars',
              'my-ratings.json' => 'your own ratings',
              'notes.json' => 'the notes you wrote on games',
              'hack-of.json' => 'which games you said are hacks, and of which game',
              'accompanied.json' => 'which files you said go with a game, and with which',
              'tags.json'       => 'your tags',
              'local-games.json' => 'games of your own',
              'overrides.json'  => 'your text edits',
              'last-error.json' => 'the launcher\'s last failure',
              'running.json'    => 'a game it thinks is running'];
    foreach ($small as $name => $note) {
        $p = xs_data_path($name);
        if (is_file($p)) {
            $files[$name] = $p;
            $why[$name]   = $note;
        }
    }

    $skipped = [];
    $dir = xs_data_path('log');
    for ($i = 0; $i < XS_REPORT_DAYS; $i++) {
        $day = date('Y-m-d', strtotime('-' . $i . ' days'));
        $p   = $dir . DIRECTORY_SEPARATOR . $day . '.log';
        if (!is_file($p)) {
            continue;
        }
        if (filesize($p) > XS_REPORT_MAX_FILE) {
            $skipped[] = $day . '.log (' . number_format(filesize($p) / 1048576, 1) . ' MB, too big to send)';
            continue;
        }
        $files['log/' . $day . '.log'] = $p;
        $why['log/' . $day . '.log']   = $i === 0 ? 'today' : $i . ' day' . ($i === 1 ? '' : 's') . ' ago';
    }
    if ($skipped) {
        $why['(left out)'] = implode('; ', $skipped);
    }

    // The play history can be long; the recent end is the diagnostic part.
    $sess = xs_read_jsonl(xs_sessions_path());
    $extra = [];
    xs_step('Counting the games on each console', 1, 4);
    $extra['library-summary.txt'] = xs_report_library_summary();
    xs_step('Measuring the data folder', 2, 4);
    $extra['data-summary.txt'] = xs_report_data_summary();
    $extra['php.txt'] = xs_report_php_summary();
    if ($sess) {
        $lines = array_map(static fn($r) => json_encode($r, JSON_UNESCAPED_SLASHES), array_slice($sess, -100));
        $extra['sessions-recent.jsonl'] = implode("\n", $lines) . "\n";
        // Fewer than 100 is not "the last 100 of".
        $why['sessions-recent.jsonl'] = count($sess) > 100
            ? 'the last 100 of ' . count($sess) . ' play sessions'
            : (count($sess) === 1 ? 'your one play session' : 'all ' . count($sess) . ' play sessions');
    }
    ksort($why);
    $extra['report.txt'] = xs_report_text($checks, $why);

    $name = 'xsegon-report-' . date('Y-m-d-Hi') . '.zip';
    $path = xs_report_dir() . DIRECTORY_SEPARATOR . $name;
    xs_step('Writing the report', 3, 4);
    $res  = xs_zip_write($path, $files, $extra);

    $worst = 'ok';
    foreach ($checks as $c) {
        if ($c['state'] === 'bad') { $worst = 'bad'; break; }
        if ($c['state'] === 'warn') { $worst = 'warn'; }
    }
    xs_log('RPT', 'made ' . $name . ' ' . $res['files'] . ' files ' . $res['bytes'] . ' bytes, worst check ' . $worst);

    return ['name' => $name, 'path' => $path, 'files' => $res['files'], 'bytes' => $res['bytes'], 'worst' => $worst];
}

/** The reports on hand, newest first. */
function xs_report_list(): array
{
    $out = [];
    foreach (@scandir(xs_report_dir()) ?: [] as $f) {
        if (!xs_report_is_name($f)) {
            continue;
        }
        $p = xs_report_dir() . DIRECTORY_SEPARATOR . $f;
        // A person reads this: the backup list's stamp, not an ISO string.
        $out[] = ['name' => $f, 'bytes' => (int) @filesize($p), 'at' => date('Y-m-d H:i', (int) @filemtime($p))];
    }
    usort($out, static fn($a, $b) => strcmp($b['name'], $a['name']));
    return $out;
}

/** Throw one away. Only ever a file this code wrote, in the reports folder. */
function xs_report_remove(string $name): void
{
    if (!xs_report_is_name($name)) {
        throw new RuntimeException('that is not a report this made: ' . $name);
    }
    $p = xs_report_dir() . DIRECTORY_SEPARATOR . $name;
    if (!is_file($p)) {
        throw new RuntimeException('there is no report called ' . $name);
    }
    @unlink($p);
    xs_log('RPT', 'deleted ' . $name);
}
