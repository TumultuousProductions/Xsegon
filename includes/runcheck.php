<?php
/**
 * The runs check: which games boot, found by starting each one for a few
 * seconds. bin\runcheck.ps1 does the running;
 * this makes its list, the RetroArch settings it runs with, and reads back
 * what it wrote. Everything lives in data\runcheck:
 *
 *   plan.json              the list the runner was given
 *   status.json            where it is (the runner writes it)
 *   results.json           id => what happened, kept between runs
 *   shots\<id>.png         the screenshot a few seconds in
 *   check-<port>.cfg       RetroArch's settings for these runs only
 *   sessions.before.jsonl  the play history as it was at the start
 *   saves\, raw\, ralog\   where RetroArch is sent to write, never your folders
 *   emu\                   the other emulators' logs, settings copies and saves
 *
 * RetroArch is asked whether a game is playing. The other emulators cannot
 * be asked, so each is read from the line in its log, or its window title,
 * that appears once the game's code runs. When nothing can say, the game
 * comes back as "look at it", with a picture. Steam and your own programs
 * are left out.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/retroarch.php';
require_once __DIR__ . '/cores.php';
require_once __DIR__ . '/emulators.php';

// "look": the check could not tell, and took a picture for you to judge.
const XS_RUNCHECK_RESULTS = ['boots', 'crashed', 'nostart', 'noanswer', 'look'];

function xs_runcheck_dir(string $sub = ''): string
{
    $d = xs_data_path('runcheck');
    return $sub === '' ? $d : $d . DIRECTORY_SEPARATOR . $sub;
}

/** The file name a game's screenshot has (the runner's Get-SafeName). */
function xs_runcheck_safe(string $id): string
{
    return (string) preg_replace('/[^A-Za-z0-9_\-]/', '_', $id);
}

/** Where the runner is, with running true only while its process is alive. */
function xs_runcheck_status(): array
{
    $st = xs_read_json(xs_runcheck_dir('status.json'), []);
    if (!is_array($st)) {
        $st = [];
    }
    /* Alive when Windows says its process is, or when it wrote its status in
       the last two minutes (it rewrites it every few seconds): tasklist can
       answer "not there" for a live runner, which would let Play through mid-check. */
    $pid = (int) ($st['pid'] ?? 0);
    $fresh = time() - (int) @filemtime(xs_runcheck_dir('status.json')) < 120;
    $wasRunning = !empty($st['running']);
    $st['running'] = $wasRunning && $pid > 0 && ($fresh || xs_pid_alive($pid, (int) strtotime((string) ($st['startedAt'] ?? ''))));
    // A runner that died mid-run is logged once, and written back so asking again does not say it again.
    if ($wasRunning && !$st['running'] && empty($st['diedLogged'])) {
        $st['diedLogged'] = true;
        xs_write_json(xs_runcheck_dir('status.json'), $st);
        xs_log('RCHK', 'the check stopped answering at game ' . (int) ($st['index'] ?? 0) . ' of '
            . (int) ($st['total'] ?? 0) . ' (its runner, pid ' . $pid . ', is gone); Start begins where it left off');
    }
    return $st;
}

function xs_runcheck_active(): bool
{
    return xs_runcheck_status()['running'];
}

/** Play pressed during the check: a note asking it to make way (bin\runcheck.ps1 pauses while that game runs). */
function xs_runcheck_make_way(array $game, ?string &$why = null): bool
{
    return xs_write_json(xs_runcheck_dir('pause'), ['id' => (string) ($game['id'] ?? ''), 'title' => (string) ($game['title'] ?? ''), 'at' => date('c')], $why);
}

/** id => the last result for that game. */
function xs_runcheck_results(): array
{
    $r = xs_read_json(xs_runcheck_dir('results.json'), []);
    return is_array($r) ? $r : [];
}

/**
 * The command a game would be started with, exactly as Play builds it (the
 * emulator where it is today, the core you chose), or null for a game the
 * check leaves out: not launchable, Steam, your own program, an emulator it
 * does not know, or one it knows but cannot run unwatched
 * (xs_runcheck_emu_why_not, said on the panel). $retroOnly: RetroArch's
 * games alone, for the one yes (js\runsbar.js).
 */
function xs_runcheck_launch(array $g, array $s, bool $retroOnly = false): ?array
{
    $launch = $g['launch'] ?? null;
    if (!is_array($launch) || !empty($launch['local']) || !empty($g['steam']) || empty($launch['exe'])) {
        return null;
    }
    $kind = $launch['kind'] ?? '';
    if ($kind !== 'retroarch' && ($retroOnly || $kind !== 'emulator')) {
        return null;
    }
    $lb = xs_norm_path((string) ($s['paths']['launchbox'] ?? ''));
    $launch = xs_emu_repoint($launch, xs_emulators($lb), (string) $g['platform']);
    if ($kind === 'emulator') {
        $exe = (string) $launch['exe'];
        return xs_runcheck_emu_name($exe) !== null && xs_runcheck_emu_why_not($exe) === null ? $launch : null;
    }
    [$launch] = xs_core_apply($launch, (string) $g['id'], (string) $g['platform'], $lb);
    return ($launch['kind'] ?? '') === 'retroarch' ? $launch : null;
}

/**
 * RetroArch's settings for a check run, one file per port. Every line is
 * about keeping the run away from anything of yours, or letting it be
 * watched and quit:
 */
function xs_runcheck_config(int $port): string
{
    $q = static fn(string $p) => '"' . $p . '"';
    $lines = [
        'network_cmd_enable = "true"',                  // to be asked, screenshotted and quit
        'network_cmd_port = "' . $port . '"',
        'config_save_on_exit = "false"',                // none of this is written into retroarch.cfg
        /* A small window, so the PC stays usable while a check runs. The
           screenshot is the core's own frame, so the window's size never
           reaches the picture. */
        'video_fullscreen = "false"',
        'video_scale = "1"',
        'savestate_auto_save = "false"',                // closing never writes over your auto save
        'savestate_auto_load = "false"',                // and never starts from it either
        'savefile_directory = ' . $q(xs_runcheck_dir('saves')),      // in-game saves and memory cards
        'savestate_directory = ' . $q(xs_runcheck_dir('saves')),
        'savefiles_in_content_dir = "false"',
        'savestates_in_content_dir = "false"',
        'screenshot_directory = ' . $q(xs_runcheck_dir('raw')),
        /* The picture the core drew, not a read back from the graphics card:
           RetroArch 1.22.2's GPU screenshot under Direct3D 11, asked for over
           the network, crashes it. */
        'video_gpu_screenshot = "false"',
        'screenshots_in_content_dir = "false"',         // never beside your ROMs
        'notification_show_screenshot = "false"',
        'content_runtime_log = "false"',                // RetroArch's own play time
        'content_runtime_log_aggregate = "false"',
        'history_list_enable = "false"',                // and its history list
        'audio_mute_enable = "true"',
        'pause_nonactive = "false"',                    // keeps playing without the focus
        'quit_press_twice = "false"',
        'log_to_file = "true"',                         // for "why it did not start"
        'log_to_file_timestamp = "false"',
        'log_dir = ' . $q(xs_runcheck_dir('ralog')),
        'log_verbosity = "true"',
        /* Everything, not errors only: the line that says WHY a game does
           not start is often the core's own (a missing BIOS). The log is
           rewritten per game, so the verbosity costs nothing that lasts. */
        'frontend_log_level = "0"',
        'libretro_log_level = "0"',
    ];
    $file = xs_runcheck_dir('check-' . $port . '.cfg');
    if (!is_dir(xs_runcheck_dir())) {
        @mkdir(xs_runcheck_dir(), 0777, true);
    }
    // Without this file RetroArch would run every game on the person's own
    // settings: their saves, their auto-save state, and no way to quit it.
    $text = implode("\n", $lines) . "\n";
    if (@file_put_contents($file, $text) !== strlen($text)) {
        xs_fail('could not write the check\'s own RetroArch settings to ' . $file . ', so nothing was started', 500);
    }
    return $file;
}

/**
 * The games to check: every RetroArch game, or one console's, less the ones
 * already checked when $skipDone. Each with the command it runs with.
 */
function xs_runcheck_plan(array $games, array $s, string $platform, bool $skipDone, string $only = '', bool $retroOnly = false): array
{
    $results = xs_runcheck_results();
    $done = $skipDone ? $results : [];
    $cfgs = [];
    $out = [];
    foreach ($games as $g) {
        if ($platform !== '' && $g['platform'] !== $platform) {
            continue;
        }
        // "failed": just the games whose last check went wrong, for running again after a fix.
        if ($only === 'failed') {
            if (!in_array($results[$g['id']]['result'] ?? '', ['crashed', 'nostart', 'noanswer'], true)) {
                continue;
            }
        } elseif (isset($done[$g['id']]) && in_array($done[$g['id']]['result'] ?? '', XS_RUNCHECK_RESULTS, true)) {
            continue;
        }
        $launch = xs_runcheck_launch($g, $s, $retroOnly);
        if ($launch === null) {
            continue;
        }
        /* A game whose folder is away is left out, and the runner is told
           where each file and its folder are so it can stop if the drive is
           pulled part way, rather than mark every game NEEDS FIX. */
        $rom = xs_rom_real_path((string) ($g['romPath'] ?? ''), $s);
        if ($rom !== '' && xs_rom_away($rom, $s) !== null) {
            continue;
        }
        if (($launch['kind'] ?? '') !== 'retroarch') {
            $out[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'],
                      'rom' => $rom, 'home' => $rom !== '' ? xs_rom_home($rom, $s) : '', 'mode' => 'emu',
                      'exe' => (string) $launch['exe']] + xs_runcheck_emu($launch);
            continue;
        }
        $flags = ra_flags(ra_config_path((string) $launch['exe']));
        $port = (int) ($flags['network_cmd_port'] ?: 55355);
        $cfgs[$port] ??= xs_runcheck_config($port);
        $out[] = [
            'id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'], 'port' => $port,
            'rom' => $rom, 'home' => $rom !== '' ? xs_rom_home($rom, $s) : '',
            'exe' => xs_runcheck_exe((string) $launch['exe']),
            'args' => '--appendconfig="' . $cfgs[$port] . '" ' . xs_runcheck_windowed((string) $launch['args']),
            /* A console whose BIOS shows a menu of its own when the disc does
               not start, while RetroArch still says PLAYING: the runner looks
               for it in the picture (Test-Ps1Menu). */
            'menu' => in_array(strtolower((string) $g['platform']), ['sony playstation', 'sony psx'], true) ? 'ps1' : '',
        ];
    }
    return $out;
}

/**
 * A launch command without RetroArch's force-fullscreen flag, for the
 * check's small window: a flag on the command line beats any config. Split
 * with quotes kept whole, so a ROM path with " -f " in it is never touched.
 */
function xs_runcheck_windowed(string $args): string
{
    preg_match_all('/"[^"]*"|\S+/', $args, $m);
    $keep = array_filter($m[0], static fn(string $t): bool => $t !== '-f' && $t !== '--fullscreen');
    return implode(' ', $keep);
}

/**
 * retroarch.exe itself where the command starts a script beside it: a
 * wrapper script may wait for an answer on an error, which nobody gives in an
 * unwatched run, and may hide RetroArch's exit code.
 */
function xs_runcheck_exe(string $exe): string
{
    if (!preg_match('/\.(bat|cmd)$/i', $exe)) {
        return $exe;
    }
    $ra = dirname($exe) . DIRECTORY_SEPARATOR . 'retroarch.exe';
    return is_file($ra) ? $ra : $exe;
}

/* ---- the other emulators ---------------------------------------------------
   None answers "is a game playing?" the way RetroArch does, so each is read
   from what it leaves behind, as each one's source has it:

     PCSX2    its log says "ELF ... is executing" once the game's own code
              runs, past the BIOS
     Dolphin  its window title gains the game's name between " | " parts
     Cemu     its log says "------- Loaded title -------", its title "FPS:"
     RPCS3    its game window's title shows "FPS:" above 0
     Xenia    its log says "Launching module", its title "[TITLEID v..."
     xemu     no log of the game and a title that never changes, so it is
              asked through its QEMU monitor which program the Xbox runs: a
              title ID of the game's own (a publisher's two letters first), or
              a dashboard's or menu's (FFFE0000, FFFF0002, XMenu's 00000005).
              When the monitor says nothing, "look at it", with a picture

   Every one is told to stay in a window, by a flag or by a copy of its
   settings made for the check, never by writing to yours. One that would
   stop the run with a question when closed, or cannot be kept out of full
   screen, is left out and the panel says why. */

const XS_RUNCHECK_EMUS = [
    'pcsx2-qt' => 'PCSX2', 'pcsx2' => 'PCSX2', 'dolphin' => 'Dolphin', 'cemu' => 'Cemu',
    'rpcs3' => 'RPCS3', 'xenia' => 'Xenia', 'xenia_canary' => 'Xenia', 'xemu' => 'xemu',
];

// The spare RPCS3 user the check runs as, so trophies and saves land there.
const XS_RUNCHECK_RPCS3_USER = '00000099';

/** Which emulator a program is, by its file name; null for one the check does not know. */
function xs_runcheck_emu_name(string $exe): ?string
{
    $base = strtolower((string) preg_replace('/\.exe$/i', '', basename(str_replace('\\', '/', $exe))));
    return XS_RUNCHECK_EMUS[$base] ?? null;
}

/** A command line in pieces, quoted parts kept whole. */
function xs_runcheck_tokens(string $args): array
{
    preg_match_all('/"[^"]*"|\S+/', $args, $m);
    return $m[0];
}

/**
 * The pieces less each flag named in $drop (name => takes a value), and the
 * value after one that takes it. "--name=value" goes whole. Without case.
 */
function xs_runcheck_strip(array $tokens, array $drop): array
{
    $out = [];
    for ($i = 0, $n = count($tokens); $i < $n; $i++) {
        $t = strtolower($tokens[$i]);
        $name = explode('=', $t, 2)[0];
        if (array_key_exists($name, $drop)) {
            if ($drop[$name] && !str_contains($t, '=')) {
                $i++;
            }
            continue;
        }
        $out[] = $tokens[$i];
    }
    return $out;
}

/** A folder under Documents, wherever Windows keeps Documents. */
function xs_runcheck_docs(string $sub): string
{
    $home = (string) getenv('USERPROFILE');
    foreach ([$home . '\\OneDrive\\Documents', $home . '\\Documents'] as $d) {
        if (is_dir($d . DIRECTORY_SEPARATOR . $sub)) {
            return $d . DIRECTORY_SEPARATOR . $sub;
        }
    }
    return $home . '\\Documents\\' . $sub;
}

/** Where an emulator keeps its settings and log, decided the way it decides. */
function xs_runcheck_emu_home(string $name, string $exe): string
{
    $dir = dirname($exe);
    switch ($name) {
        case 'PCSX2':
            return is_file($dir . '\\portable.ini') || is_file($dir . '\\portable.txt') ? $dir : xs_runcheck_docs('PCSX2');
        case 'Dolphin':
            if (is_file($dir . '\\portable.txt')) {
                return $dir . '\\User';
            }
            $docs = xs_runcheck_docs('Dolphin Emulator');
            return is_dir($docs) ? $docs : getenv('APPDATA') . '\\Dolphin Emulator';
        case 'Cemu':
            if (is_dir($dir . '\\portable')) {
                return $dir . '\\portable';
            }
            return is_file($dir . '\\settings.xml') ? $dir : getenv('APPDATA') . '\\Cemu';
        case 'xemu':
            return is_file($dir . '\\xemu.toml') ? $dir : getenv('APPDATA') . '\\xemu\\xemu';
    }
    return $dir;                                    // RPCS3 and Xenia: beside the program
}

/** RPCS3's settings file: config\config.yml, or config.yml beside it in older builds. */
function xs_runcheck_rpcs3_config(string $exe): string
{
    $new = dirname($exe) . '\\config\\config.yml';
    return is_file($new) ? $new : dirname($exe) . '\\config.yml';
}

/** One value from an INI file's text; null when the section or key is not there. */
function xs_runcheck_ini(string $text, string $section, string $key): ?string
{
    $in = false;
    foreach (preg_split('/\R/', $text) ?: [] as $line) {
        $line = trim($line);
        if ($line !== '' && $line[0] === '[') {
            $in = strcasecmp($line, '[' . $section . ']') === 0;
        } elseif ($in && preg_match('/^' . preg_quote($key, '/') . '\s*=\s*(.*)$/i', $line, $m)) {
            return trim($m[1], " \t\"");
        }
    }
    return null;
}

/**
 * Why the check leaves an emulator out, or null when it can run its games
 * with nobody there. Read from the emulator's own settings, never written:
 * the person changes them, in the emulator, if they want its games checked.
 */
function xs_runcheck_emu_why_not(string $exe): ?string
{
    static $memo = [];
    if (array_key_exists($exe, $memo)) {
        return $memo[$exe];
    }
    $name = xs_runcheck_emu_name($exe);
    $home = $name !== null ? xs_runcheck_emu_home($name, $exe) : '';
    $why = null;
    // A question left unset is on: both ask by default.
    if ($name === 'PCSX2') {
        $ini = (string) @file_get_contents($home . '\\inis\\PCSX2.ini');
        if (strtolower((string) xs_runcheck_ini($ini, 'UI', 'ConfirmShutdown')) !== 'false') {
            $why = 'asks "are you sure" when closing. Turn off Confirm Shutdown in PCSX2 (Settings > Interface) to include it.';
        }
    } elseif ($name === 'RPCS3') {
        $ini = (string) @file_get_contents(dirname($exe) . '\\GuiConfigs\\CurrentSettings.ini');
        if (strtolower((string) xs_runcheck_ini($ini, 'main_window', 'confirmationBoxExitGame')) !== 'false') {
            $why = 'asks "do you really want to exit the game" when closing. Turn that off in RPCS3 (Configuration > GUI) to include it.';
        } elseif (!preg_match('/^[ \t]*Start games in fullscreen mode:[ \t]*(true|false)[ \t]*\r?$/mi',
                              (string) @file_get_contents(xs_runcheck_rpcs3_config($exe)))) {
            $why = 'has no full screen line in its settings for the check to turn off.';
        }
    } elseif ($name === 'Cemu') {
        if (preg_match('~<fullscreen>\s*true\s*</fullscreen>~i', (string) @file_get_contents($home . '\\settings.xml'))) {
            $why = 'starts full screen, which cannot be changed for one launch. Turn off full screen in Cemu\'s general settings to include it.';
        }
    } elseif ($name === 'xemu' && !is_file($home . '\\xemu.toml')) {
        $why = 'has no settings file (xemu.toml) the check could find to keep it in a window.';
    }
    return $memo[$exe] = $why;
}

/** A copy of an emulator's settings for the check's runs, or the request fails. */
function xs_runcheck_emu_copy(string $file, string $text): string
{
    if (@file_put_contents($file, $text) !== strlen($text)) {
        xs_fail('could not write the check\'s own copy of the emulator settings to ' . $file . ', so nothing was started', 500);
    }
    return $file;
}

/**
 * How the check runs one game on one of these emulators: the command (in a
 * window, saves elsewhere where it can be told so), the program to watch,
 * where its words go, and what in them proves the game started (boot, or
 * title on its window) or says why not (fail). Patterns are .NET's, read by
 * bin\runcheck.ps1. logMode: fresh (a file of the check's own), append (the
 * emulator adds to its log) or rewrite (it starts its log again each time).
 * Only for an emulator xs_runcheck_emu_why_not lets through.
 */
function xs_runcheck_emu(array $launch): array
{
    $exe = (string) $launch['exe'];
    $name = (string) xs_runcheck_emu_name($exe);
    $home = xs_runcheck_emu_home($name, $exe);
    $emu = xs_runcheck_dir('emu');
    if (!is_dir($emu)) {
        @mkdir($emu, 0777, true);
    }
    $in = static fn(string $f): string => $emu . DIRECTORY_SEPARATOR . $f;
    $q = static fn(string $p): string => '"' . $p . '"';
    $t = xs_runcheck_tokens((string) $launch['args']);
    $p = ['emu' => $name, 'proc' => (string) preg_replace('/\.exe$/i', '', basename($exe)), 'out' => $in('out.txt'),
          'log' => '', 'logMode' => 'fresh', 'boot' => '', 'fail' => '', 'title' => '', 'look' => false, 'qmp' => false,
          'start' => 45, 'extra' => 0, 'saves' => false];
    switch ($name) {
        case 'PCSX2':
            $t = xs_runcheck_strip($t, ['-fullscreen' => false, '-nofullscreen' => false, '-logfile' => true]);
            $lower = array_map('strtolower', $t);
            // -nogui ends the program with the game; without it, -batch does.
            $batch = in_array('-nogui', $lower, true) || in_array('-batch', $lower, true) ? [] : ['-batch'];
            $t = array_merge(['-nofullscreen', '-logfile', $q($in('pcsx2.log'))], $batch, $t);
            $p = array_replace($p, ['log' => $in('pcsx2.log'), 'boot' => 'ELF (?!rom0:).* is executing',
                'fail' => 'Startup Error|requires a PlayStation 2 BIOS|Failed to open CDVD']);
            break;
        case 'Dolphin':
            // Its own -C lines for full screen and the stop question go, so the check's are the only ones.
            $keep = [];
            for ($i = 0, $n = count($t); $i < $n; $i++) {
                $next = strtolower(trim($t[$i + 1] ?? '', '"'));
                if (in_array(strtolower($t[$i]), ['-c', '--config'], true) && preg_match('/^dolphin\.(display\.fullscreen|interface\.confirmstop)=/', $next)) {
                    $i++;
                    continue;
                }
                if (preg_match('/^--config=dolphin\.(display\.fullscreen|interface\.confirmstop)=/i', trim($t[$i], '"'))) {
                    continue;
                }
                $keep[] = $t[$i];
            }
            $lower = array_map('strtolower', $keep);
            $batch = in_array('-b', $lower, true) || in_array('--batch', $lower, true) ? [] : ['-b'];
            $set = [];
            foreach ([
                'Dolphin.Display.Fullscreen=False', 'Dolphin.Interface.ConfirmStop=False',
                'Dolphin.Interface.UsePanicHandlers=False',         // a warning box would wait for a press; logged instead
                'Dolphin.DSP.Volume=0',
                'Dolphin.General.NANDRootPath=' . $in('dolphin-nand'),           // Wii saves
                'Dolphin.Core.GCIFolderAPath=' . $in('dolphin-card-a'), 'Dolphin.Core.GCIFolderBPath=' . $in('dolphin-card-b'),
                'Dolphin.Core.MemcardAPath=' . $in('dolphin-card-a.raw'), 'Dolphin.Core.MemcardBPath=' . $in('dolphin-card-b.raw'),
            ] as $kv) {
                array_push($set, '-C', $q($kv));
            }
            $t = array_merge($set, $batch, $keep);
            /* Its window title alone: "<rev> | JIT64 DC | <backend> | HLE | <game>"
               once the game runs. Its log, switched on by -C Logger.* lines, is not written. */
            $p = array_replace($p, ['title' => '\|[^|]*\|[^|]*\|', 'saves' => true]);
            break;
        case 'Cemu':
            $t = xs_runcheck_strip($t, ['-f' => false, '--fullscreen' => false]);
            $p = array_replace($p, ['log' => $home . '\\log.txt', 'logMode' => 'rewrite',
                'boot' => '------- Loaded title -------|------- Run title -------', 'title' => 'FPS:\s*[1-9]',
                'fail' => 'Unable to find RPX|Mounting failed|Could not decrypt|title\.tik is missing|Unable to launch', 'start' => 60]);
            break;
        case 'RPCS3':
            $cfg = (string) @file_get_contents(xs_runcheck_rpcs3_config($exe));
            $cfg = (string) preg_replace('/^([ \t]*Start games in fullscreen mode:[ \t]*)true(?=[ \t]*\r?$)/mi', '${1}false', $cfg);
            $cfg = (string) preg_replace('/^([ \t]*Master Volume:[ \t]*)\d+(?=[ \t]*\r?$)/mi', '${1}0', $cfg);
            $copy = xs_runcheck_emu_copy($in('rpcs3-config.yml'), $cfg);
            $t = xs_runcheck_strip($t, ['--fullscreen' => false, '--config' => true, '--user-id' => true]);
            $t = array_merge(['--config', $q($copy), '--user-id', XS_RUNCHECK_RPCS3_USER], $t);
            $logDir = dirname($exe) . '\\log';
            // A first boot compiles the game before it draws anything: minutes, not seconds.
            $p = array_replace($p, ['log' => is_dir($logDir) ? $logDir . '\\RPCS3.log' : dirname($exe) . '\\RPCS3.log', 'logMode' => 'rewrite',
                'title' => 'FPS:\s*[1-9]', 'start' => 180, 'saves' => true,
                'fail' => 'Booting .* failed|Failed to decrypt|Firmware is missing|No config file found|Another instance of RPCS3']);
            break;
        case 'Xenia':
            $t = xs_runcheck_strip($t, ['--fullscreen' => false, '--log_file' => true, '--content_root' => true]);
            $t = array_merge(['--fullscreen=false', '--log_file=' . $q($in('xenia.log')), '--content_root=' . $q($in('xenia-content'))], $t);
            $p = array_replace($p, ['log' => $in('xenia.log'), 'boot' => 'Launching module', 'title' => '\[[0-9A-F]{8} v',
                'fail' => 'Unable to mount disc image|Failed to launch target|Failed to load user module|CRASH DUMP', 'start' => 60, 'saves' => true]);
            break;
        case 'xemu':
            $toml = (string) @file_get_contents($home . '\\xemu.toml');
            $toml = (string) preg_replace('/^([ \t]*fullscreen_on_startup[ \t]*=[ \t]*)true/mi', '${1}false', $toml);
            $copy = xs_runcheck_emu_copy($in('xemu.toml'), $toml);
            /* Its QEMU monitor, opened for the runner (which puts a free port in
               for {QMP}): the program the Xbox runs is the game's own title or
               the dashboard's. wait=off, or QEMU would wait for the runner. */
            $t = xs_runcheck_strip($t, ['-full-screen' => false, '-config_path' => true, '-qmp' => true]);
            $t = array_merge(['-config_path', $q($copy), '-qmp', 'tcp:127.0.0.1:{QMP},server=on,wait=off'], $t);
            // Its words go to the output the runner keeps (out.txt). "look" is the way out
            // when the monitor says nothing; the start-up animation is a few seconds more.
            $p = array_replace($p, ['fail' => 'Failed to open', 'look' => true, 'qmp' => true, 'start' => 45, 'extra' => 10]);
            break;
    }
    return ['args' => implode(' ', $t)] + $p;
}

/**
 * The emulators the check knows but leaves out, each with how many of your
 * games it holds and why, for the panel to say.
 */
function xs_runcheck_left(array $games, array $s): array
{
    $table = xs_emulators(xs_norm_path((string) ($s['paths']['launchbox'] ?? '')));
    $by = [];
    foreach ($games as $g) {
        $l = $g['launch'] ?? null;
        if (!is_array($l) || !empty($l['local']) || !empty($g['steam']) || ($l['kind'] ?? '') !== 'emulator' || empty($l['exe'])) {
            continue;
        }
        $exe = (string) xs_emu_repoint($l, $table, (string) $g['platform'])['exe'];
        $name = xs_runcheck_emu_name($exe);
        $why = $name !== null ? xs_runcheck_emu_why_not($exe) : null;
        if ($why === null) {
            continue;
        }
        $by[$name] ??= ['emulator' => $name, 'games' => 0, 'why' => $why];
        $by[$name]['games']++;
    }
    ksort($by, SORT_NATURAL | SORT_FLAG_CASE);
    return array_values($by);
}

/** How many games each console has that the check can run, and how many are done. */
function xs_runcheck_consoles(array $games, array $s): array
{
    $res = xs_runcheck_results();
    $by = [];
    foreach ($games as $g) {
        $launch = xs_runcheck_launch($g, $s);
        if ($launch === null) {
            continue;
        }
        $p = (string) $g['platform'];
        $by[$p] ??= ['platform' => $p, 'games' => 0, 'checked' => 0, 'via' => []];
        $by[$p]['games']++;
        // Which emulators run them: RetroArch, or the others by name.
        $via = ($launch['kind'] ?? '') === 'retroarch' ? 'RetroArch' : (string) xs_runcheck_emu_name((string) $launch['exe']);
        if (!in_array($via, $by[$p]['via'], true)) {
            $by[$p]['via'][] = $via;
        }
        if (isset($res[$g['id']])) {
            $by[$p]['checked']++;
        }
    }
    ksort($by, SORT_NATURAL | SORT_FLAG_CASE);
    return array_values($by);
}
