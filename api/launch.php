<?php
/**
 * POST /api/launch.php  {"id": "<game id>"}
 *
 *      also "dry", "forReal", "slot", "stateLoad", "hack", "direct"
 *
 * Hands off to bin\launch.ps1 DETACHED and returns at once: an exec() would
 * block this single-threaded server for the whole game. Whether the game
 * started is written down by the launcher and read through api\status.php.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/brand.php';

xs_post_only();

$s    = xs_settings();
$body = xs_body();
$id   = trim((string) ($body['id'] ?? ''));
// "dry": true answers with the command it would run and runs nothing. A test
// copy is always dry unless "forReal": true, named so no test launches by
// forgetting (only tests\t-e2e.js sends it).
$dry  = !empty($body['dry']) || (xs_test_copy() && empty($body['forReal']));

if ($id === '') {
    xs_fail('no game id');
}

// ---- the guardrail ------------------------------------------------------
// One check on the ROM root, not one per file: a missing drive is said once.

// One of your own games (includes\local.php) does not live on the ROM drive,
// so the guardrail does not apply to it.
if ($s['launch']['checkRomRoot'] && !$dry && !str_starts_with($id, 'xs-')) {
    $root = xs_norm_path($s['paths']['romRoot']);
    if ($root !== '' && !is_dir($root)) {
        xs_json([
            'ok'        => false,
            'guardrail' => true,
            'error'     => 'ROMs not plugged in',
            'detail'    => "{$root} is not there",
        ], 503);
    }
}

$lib  = xs_library();
$game = null;
foreach ($lib['games'] ?? [] as $g) {
    if ($g['id'] === $id) {
        $game = $g;
        break;
    }
}

if ($game === null) {
    xs_fail('unknown game id', 404);
}
// An entry whose file is a patch and no game plays the game it was made for,
// with the patch (includes\hacks.php). $shown is what the launcher, the log
// and the answer name, so the entry's own history and marks follow.
$shown = $game;
if (empty($game['local']) && trim((string) ($body['hack'] ?? '')) === '') {
    require_once __DIR__ . '/../includes/hacks.php';
    $turn = xs_hack_entry_turn($game, $lib['games'] ?? []);
    if ($turn !== null) {
        $plays = null;
        foreach ($turn['on'] === null ? [] : ($lib['games'] ?? []) as $g) {
            if ($g['id'] === $turn['on']['id']) {
                $plays = $g;
                break;
            }
        }
        if ($plays === null) {
            $said = $game['title'] . ' ' . ($turn['why'] ?? 'is a patch, and the game it plays on is not there');
            xs_log('FAIL', '409 ' . $said . ' (launch.php)');
            xs_fail($said, 409);
        }
        xs_log('LNCH', $game['title'] . ' is a patch and no game: starting ' . $plays['title'] . ' with it');
        $body['hack'] = $turn['key'];
        $game = $plays;
        $id = (string) $plays['id'];
    }
}
if (empty($game['launch'])) {
    xs_fail($game['launchError'] ?: 'this game has no launch command', 409);
}
// The same guardrail for a game in a second games folder: with its drive out,
// a start would fail and earn the game a NEEDS FIX mark it does not deserve.
if ($s['launch']['checkRomRoot'] && !$dry && empty($game['local']) && ($game['romPath'] ?? '') !== '') {
    $away = xs_rom_away(xs_rom_real_path((string) $game['romPath'], $s), $s);
    if ($away !== null) {
        xs_json(['ok' => false, 'guardrail' => true, 'error' => 'ROMs not plugged in',
                 'detail' => "{$away} is not there"], 503);
    }
}

$launch = $game['launch'];

/* ---- Play without Steam ---------------------------------------------------
 * A Steam game started by its own program, for when Steam cannot go online.
 * A game that insists on Steam will still ask for it.
 */
$direct = !empty($body['direct']);
if ($direct) {
    $st = $launch['steam'] ?? null;
    if (!is_array($st) || ($st['exe'] ?? '') === '') {
        xs_fail('this game has no program of its own to start without Steam', 409);
    }
    $launch = ['local' => 'run', 'exe' => $st['exe'], 'args' => (string) $st['args'], 'rom' => '',
               'via' => 'its own program, without Steam', 'steam' => $st];
}

/* A Steam game is followed by its folder, not by the program started:
 * steam.exe exits at once or stays long after the game, and a publisher's
 * launcher hands over the same way (bin\launch.ps1, -WatchDir).
 */
$follow = null;
if (!empty($launch['steam']['dir']) && is_dir((string) $launch['steam']['dir'])) {
    $follow = $launch['steam'];
}
$viaSteam = $follow !== null && ($launch['via'] ?? '') === 'Steam';

/* ---- the core you chose --------------------------------------------------
 * The launch command is built at IMPORT time and kept in library.json, so a
 * core chosen afterwards is applied here.
 */
require_once __DIR__ . '/../includes/cores.php';
require_once __DIR__ . '/../includes/emulators.php';
$chosenCore = null;
if (empty($launch['local'])) {
    /* Where is that emulator today? The command carries its path at import,
       so a moved emulator is looked up in Xsegon's own table. */
    $launch = xs_emu_repoint($launch, xs_emulators(xs_norm_path($s['paths']['launchbox'])),
                             (string) $game['platform']);
    [$launch, $chosenCore] = xs_core_apply(
        $launch, $id, (string) $game['platform'], xs_norm_path($s['paths']['launchbox'])
    );
}

/* ---- the core file has to exist ------------
 * RetroArch with a -L core not on disk exits with code 1 and no words, which
 * reads as a broken game: said here, before anything is spawned. A dry run
 * only reports it (coreMissing). Under xs_setup_auto the missing cores are
 * fetched here, so the second press plays.
 */
$coreMissing = false;
if (($launch['kind'] ?? '') === 'retroarch') {
    require_once __DIR__ . '/../includes/setup.php';
    $load     = lb_core_load((string) ($launch['args'] ?? ''));
    $coreFile = $load === null ? null : xs_setup_core_file((string) $launch['exe'], ['load' => $load]);
    $coreMissing = $coreFile !== null && !is_file($coreFile);
    if ($coreMissing && !$dry) {
        $sj       = xs_setup_job();
        $fetching = xs_setup_busy($sj);
        $started  = null;
        if (!$fetching && xs_setup_auto() && !xs_in_launchbox($coreFile)) {
            $err     = null;
            $started = xs_setup_chain_cores($err);
        }
        $msg = $fetching
            ? (($sj['kind'] ?? '') === 'retroarch'
                ? 'waiting on the RetroArch download: the cores come right after it. Press Play again when the message says the cores are fetched'
                : 'waiting on the cores download: the ' . $game['platform'] . ' core is on its way. Press Play again when the message says the cores are fetched')
            : ($started !== null
                ? 'waiting on the cores download: fetching the ' . $game['platform'] . ' core now. Press Play again when the message says the cores are fetched'
                : 'the ' . $game['platform'] . ' core (' . lb_core_name((string) $load) . ') is not downloaded yet: Settings > Emulators > Get them, or Help > Getting started');
        xs_log('FAIL', '409 ' . $game['title'] . ' was not started: its core ' . lb_core_name((string) $load) . ' is not on disk (launch.php)');
        xs_json(['ok' => false, 'error' => $msg, 'waiting' => $fetching || $started !== null], 409);
    }
}

// A web game: the page opens the address itself (it knows whether it is the
// kiosk window or a tab), and this only says so. Play time for it is counted
// by the page, from opening it to coming back (api\session.php).
if (($launch['local'] ?? '') === 'url') {
    xs_log('LNCH', $game['title'] . ' url=' . $launch['url']);
    if ($s['launch']['logLaunches']) {
        xs_append_jsonl(xs_data_path('launch-log.jsonl'), [
            'at' => date('c'), 'id' => $id, 'title' => $game['title'], 'command' => 'open ' . $launch['url'],
        ]);
    }
    xs_json(['ok' => true, 'launched' => $game['title'], 'platform' => $game['platform'],
             'via' => 'browser', 'url' => $launch['url'], 'detached' => false]);
}

/* One game at a time: launches share ra-append.cfg, last-launch.bat and
   running.json, so a second could hand the first its save slot or cheats.
   Windows is asked whether the launcher is alive, so a dead one never blocks. */
$busy = xs_game_running(true);
if ($busy !== null) {
    // Both refusals are logged with their reason and the game asked for.
    xs_log('FAIL', '409 ' . $game['title'] . ' was not started: ' . ($busy['title'] ?? 'a game') . ' is still running (launch.php)');
    xs_json(['ok' => false, 'error' => ($busy['title'] ?? 'a game') . ' is still running: quit it first',
             'running' => $busy['title'] ?? null], 409);
}
// The runs check starts games of its own, one after another. Play asks it to
// make way, and the page presses Play again once it has paused for this game.
// A dry run asks too, so the tests can see this without a real launch.
require_once __DIR__ . '/../includes/runcheck.php';
$rc = xs_runcheck_status();
if ($rc['running'] && empty($rc['paused'])) {
    if (!xs_runcheck_make_way($game, $why)) {
        xs_log('FAIL', '409 ' . $game['title'] . ' was not started: the runs check could not be asked to make way (' . $why . ')');
        xs_json(['ok' => false, 'error' => 'the games check could not be asked to make way (' . $why . '): Stop in the corner stops it'], 409);
    }
    xs_log('RCHK', 'Play on ' . $game['title'] . ' at game ' . (int) ($rc['index'] ?? 0) . ' of ' . (int) ($rc['total'] ?? 0) . ': the check is asked to make way');
    xs_json(['ok' => false, 'makingWay' => true, 'error' => 'the games check is making way for ' . $game['title']], 409);
}

$script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'launch.ps1';

/* ---- what this run tells RetroArch ---------------------------------------
 * Two features add config for one run only, through --appendconfig, and they
 * have to share one file because RetroArch takes one. Collected here and
 * written once below.
 */
$appendLines = [];

/* ---- RetroArch's own settings, put right first ---------------
 * A command port Windows has set aside, or a temp folder RetroArch cannot
 * find: written into retroarch.cfg for a RetroArch of your own that is not
 * open (includes\retroarch.php), else given for this run alone. A dry run
 * only looks, and can say what Windows has set aside.
 */
$raFix   = null;
$raPort  = 0;       // the port RetroArch is on, where this changed it
$raAside = $dry && is_array($body['assumeAside'] ?? null) ? $body['assumeAside'] : null;
if (($launch['kind'] ?? '') === 'retroarch') {
    require_once __DIR__ . '/../includes/retroarch.php';
    try {
        $raFix = ra_cfg_repair((string) $launch['exe'], $dry, $raAside, $dry && !empty($body['assumeNoHome']) ? '' : null);
    } catch (\Throwable $e) {
        xs_log('RA', 'RetroArch\'s settings were not looked at: ' . $e->getMessage());   // never a reason not to launch
    }
    foreach (($raFix['faults'] ?? []) as $f) {
        if ($f['key'] !== 'network_cmd_port') {
            continue;                       // the temp folder is this run's only for an archive: see below
        }
        $raPort = (int) $f['now'];
        if ($raFix['how'] === 'run') {
            $appendLines[] = 'network_cmd_port = "' . $raPort . '"';
            if (ra_flags(ra_config_path((string) $launch['exe']))['config_save_on_exit'] !== false) {
                $appendLines[] = 'config_save_on_exit = "false"';
            }
        }
    }
}

// ---- a save state to start on -------------------------------------------
// RetroArch rewrites state_slot in retroarch.cfg on every exit anyway, so it
// does no lasting harm. includes\states.php says why not --entryslot.
$slot    = -1;
$netPort = 0;
if (isset($body['slot']) && $body['slot'] !== '' && $body['slot'] !== null) {
    if (!is_int($body['slot']) || $body['slot'] < 0 || $body['slot'] > 999) {
        xs_fail('slot must be a number from 0 to 999');
    }
    if (($launch['kind'] ?? '') !== 'retroarch') {
        xs_fail('only a RetroArch game has save state slots', 409);
    }
    $slot = $body['slot'];
    $appendLines[] = 'state_slot = "' . $slot . '"';
    /* The launcher loads the state itself, over RetroArch's network commands.
       Where they are off they are switched on for this run alone, with
       config_save_on_exit off so the switch is never written back. */
    require_once __DIR__ . '/../includes/states.php';
    $flags = ra_flags(ra_config_path($launch['exe']));
    // A dry run can say "as if they were off", so the tests reach every road.
    if ($dry && !empty($body['assumeNetOff'])) {
        $flags['network_cmd_enable'] = false;
    }
    /* How the state is loaded (xs_state_load_mode) is asked once by the page,
       the first time with network commands off. $body['stateLoad'] is that
       answer for this launch, sent before the setting is saved. */
    $choice = in_array($body['stateLoad'] ?? null, ['session', 'key'], true) ? $body['stateLoad'] : null;
    $mode = xs_state_load_mode($flags, $choice);
    if ($mode === 'ask') {
        xs_json(['ok' => true, 'ask' => 'stateLoad', 'launched' => null, 'slot' => $slot,
                 'hotkey' => strtoupper((string) ($flags['input_load_state'] ?: 'F4'))]);
    }
    if ($mode === 'network' || $mode === 'session') {
        $netPort = $raPort > 0 ? $raPort : (int) ($flags['network_cmd_port'] ?: 55355);
    }
    if ($mode === 'session') {
        // Switched on for this run, so the port is this run's too: one Windows has set aside would answer nothing.
        if (ra_port_state($netPort, $raAside) === 'aside') {
            $netPort = ra_free_port($netPort, $raAside) ?? $netPort;
        }
        $appendLines[] = 'network_cmd_enable = "true"';
        $appendLines[] = 'network_cmd_port = "' . $netPort . '"';
        // Only where saving on exit is on: someone who has it off loses nothing.
        if ($flags['config_save_on_exit'] !== false) {
            $appendLines[] = 'config_save_on_exit = "false"';
        }
    }
}

/* ---- one of its hacks ---------------------------------------
 * A patch that fits this game's file, picked in its details (includes\hacks.php):
 * put on by RetroArch as the game loads, with saves in a folder of the hack's
 * own, or played from a patched copy Xsegon makes once. The game's own file
 * is never written, and a save picked for the game is not loaded into a hack.
 */
$hack = null;
if (trim((string) ($body['hack'] ?? '')) !== '') {
    if (!empty($launch['local']) || $slot >= 0) {
        xs_fail('a hack starts a cartridge game from its own beginning', 409);
    }
    require_once __DIR__ . '/../includes/hacks.php';
    $why  = null;
    $hack = xs_hack_launch($game, $lib['games'] ?? [], $launch, trim((string) $body['hack']), $why);
    if ($hack === null) {
        xs_log('FAIL', '409 ' . $game['title'] . ' was not started with a hack: ' . (string) $why . ' (launch.php)');
        xs_fail((string) $why, 409);
    }
    $launch        = $hack['launch'];
    $launch['via'] = (string) $launch['via'] . ', with ' . $hack['name'];
    $appendLines   = array_merge($appendLines, $hack['append']);
    unset($hack['launch']);
}

/* ---- RetroAchievements' hardcore ------------------------------------------
 * Signed in with hardcore on, RetroArch refuses a save loaded and cheats inside
 * the game. So the person is asked before the start (includes\achievements.php):
 * "soft" plays this once in softcore, "nocheats" plays without the cheats. A hack
 * is left alone: what RetroArch does with a patched game is not proven yet.
 */
require_once __DIR__ . '/../includes/cheats.php';
require_once __DIR__ . '/../includes/achievements.php';
require_once __DIR__ . '/../includes/versions.php';
// The game's cheats are its own whichever version starts: its versions are one game (includes\versions.php).
$versionIds = xs_versions_of($game, $lib['games'] ?? []);
$hc = in_array($body['hardcore'] ?? null, ['soft', 'nocheats'], true) ? $body['hardcore'] : null;
if (($launch['kind'] ?? '') === 'retroarch' && $hack === null && xs_ach_ra_state(ra_config_path((string) $launch['exe']))['hardcoreOn']) {
    $cheatPick = $hc === 'nocheats' ? null : xs_cheats_for_game($versionIds);
    $askWhy = $slot >= 0 ? 'state' : ($cheatPick !== null && count($cheatPick['on'] ?? []) > 0 ? 'cheats' : null);
    if ($askWhy !== null && $hc === null) {
        xs_log('ACH', 'asked before starting ' . $game['title'] . ': hardcore and ' . ($askWhy === 'state' ? 'a save state' : 'cheats'));
        xs_json(['ok' => true, 'ask' => 'hardcore', 'why' => $askWhy, 'launched' => null, 'slot' => $slot >= 0 ? $slot : null]);
    }
    if ($hc === 'soft') {
        // Never written back as the person's own setting.
        array_push($appendLines, 'cheevos_hardcore_mode_enable = "false"', 'config_save_on_exit = "false"');
        xs_log('ACH', $game['title'] . ' plays in softcore this once');
    }
}

/* ---- the cheats you chose -----------------------------------------------
 * RetroArch picks up <cheat_database_path>\<core>\<rom>.cht by itself. Xsegon
 * writes that file in ITS OWN folder and points RetroArch there for this run,
 * since RetroArch's own may be read only. With config_save_on_exit on, an
 * appended value IS written back into retroarch.cfg, so it is off for the run.
 */
$cheats = null;
if (($launch['kind'] ?? '') === 'retroarch') {
    // Cheats found for the game would land on a changed one; "nocheats" is the hardcore answer above.
    // The game's own (see $versionIds above): another version's choice counts.
    $pick = $hack !== null || $hc === 'nocheats' ? null : xs_cheats_for_game($versionIds, $cheatFrom);
    if ($pick !== null && $cheatFrom !== $id) {
        xs_log('CHEAT', xs_versions_said($game, $versionIds, $id) . ': this version has no choice of its own, so the game\'s cheats from version '
            . $cheatFrom . ' go with it');
    }
    if ($pick !== null) {
        $why   = null;
        $staged = xs_cheat_stage($game, $pick, $why);
        if ($staged === null) {
            // Never refuse to launch over this: it would read as a broken game.
            xs_log('CHEAT', 'not applied to ' . $game['title'] . ': ' . (string) $why);
        } else {
            $appendLines = array_merge($appendLines, xs_cheat_config_lines());
            $cheats = ['file' => $pick['file'], 'on' => count($pick['on']), 'staged' => $staged];
        }
    }
}

/* ---- your buttons for this console, and this game ------------
 * Written as RetroArch remaps in Xsegon's own folder and pointed at for this
 * run, like the cheats (includes\padmap.php). Never a reason not to launch.
 */
require_once __DIR__ . '/../includes/padmap.php';
$pads = null;
if (($launch['kind'] ?? '') === 'retroarch') {
    $padKey = mb_strtolower((string) $game['platform']);
    $padMap = xs_pad_maps()[$padKey] ?? [];
    $why = null;
    // Checked again here, not only when it was saved: a file edited by hand
    // must cost the buttons, said in the log, and never the launch.
    if (!is_array($padMap) || !xs_pad_valid($padMap, $why)) {
        xs_log('PADS', 'the buttons kept for ' . $game['platform'] . ' are not a set of swaps (' . (string) $why . '), so they are left out of ' . $game['title']);
        $padMap = [];
    }
    // Players 2 to 4 with buttons of their own; the rest have player 1's, the console's.
    $padBad = [];
    $padPlayers = xs_pad_players($padKey, $padBad);
    if ($padBad) {
        xs_log('PADS', 'the buttons kept for player ' . implode(' and ', $padBad) . ' on ' . $game['platform'] . ' are not a set of swaps, so player 1\'s are used in ' . $game['title']);
    }
    $gameMap = xs_game_map($id);            // null: none of its own; []: standard on purpose
    if ($padMap || $gameMap !== null || array_filter($padPlayers)) {
        $why = null;
        $padDir = xs_pad_stage($launch, $padMap, $gameMap, $why, $padPlayers);
        if ($padDir === null) {
            xs_log('PADS', 'buttons not applied to ' . $game['title'] . ': ' . (string) $why);
        } else {
            if ($why !== null) {            // staged, but without the game's own
                xs_log('PADS', 'only the console\'s buttons for ' . $game['title'] . ': ' . (string) $why);
                $gameMap = null;
            }
            $appendLines = array_merge($appendLines, xs_pad_config_lines($padDir));
            // A game's own buttons are every player's: RetroArch reads its file in place of the console's.
            $pads = ['moved' => count($padMap), 'game' => $gameMap === null ? 0 : count($gameMap),
                     'gameOwn' => $gameMap !== null, 'folder' => $padDir,
                     'players' => (object) ($gameMap === null ? array_map('count', $padPlayers) : [])];
        }
    }
}

/* ---- your keys for this console ------------------------------
 * Appended for this run like the buttons above. Each key goes on the RetroPad
 * button that sends its console button under the remap this run really has.
 * Never a reason not to launch.
 */
$keysUsed = null;
$keysEvery = null;
if (($launch['kind'] ?? '') === 'retroarch') {
    $keyMap = xs_pad_keys()[mb_strtolower((string) $game['platform'])] ?? [];
    $keyMap = is_array($keyMap) ? $keyMap : [];
    $layout = xs_pad_layouts()[mb_strtolower((string) $game['platform'])] ?? null;
    // Every console's keys (includes\padmap.php): under this console's own, and only for a console the picker lists.
    $every  = $layout !== null ? xs_pad_every_keys() : [];
    if (($keyMap || $every) && $layout !== null) {
        require_once __DIR__ . '/../includes/rahotkeys.php';
        $raKeys = xs_ra_read_keys((string) ra_config_path($launch['exe']));
        $binds  = xs_ra_key_binds($raKeys);
        $hotNow = xs_ra_hotkey_keys($raKeys);
        $remap  = $pads === null ? [] : ($gameMap ?? $padMap);
        $why = null;
        // Both checked again here: RetroArch's own keys may have moved since they were kept.
        if ($every && !xs_pad_keys_valid($every, xs_pad_every_layout(), [], $binds, $hotNow, $why)) {
            xs_log('PADS', 'Every console\'s keys not applied to ' . $game['title'] . ': ' . (string) $why);
            $every = [];
        }
        $base = xs_pad_every_binds($binds, $every);
        if ($keyMap && !xs_pad_keys_valid($keyMap, $layout, $remap, $base, $hotNow, $why)) {
            xs_log('PADS', 'keys not applied to ' . $game['title'] . ': ' . (string) $why);
            $keyMap = [];
        }
        $keyLines = xs_pad_key_lines($keyMap, $remap, $binds, $base);
        if ($keyLines) {
            $appendLines = array_merge($appendLines, $keyLines);
            $keysUsed  = $keyMap ? count($keyMap) : null;
            $keysEvery = $every ? count($every) : null;
        }
    }
}

/* ---- leaving and pausing, your choice ------------------------
 * Appended for this run only; unset leaves RetroArch's own settings
 * (includes\rahotkeys.php). A choice that cannot apply is left out and logged.
 */
require_once __DIR__ . '/../includes/rahotkeys.php';
$hot = null;
if (($launch['kind'] ?? '') === 'retroarch') {
    $hotChoices = xs_ra_choices();
    if ($hotChoices) {
        $hotLines = xs_ra_choice_lines($hotChoices, (string) ra_config_path($launch['exe']));
        if ($hotLines['lines']) {
            $appendLines = array_merge($appendLines, $hotLines['lines']);
            $hot = $hotLines['said'];
        }
        if ($hotLines['skipped'] !== null) {
            xs_log('HOTK', 'left out of ' . $game['title'] . ': ' . $hotLines['skipped']);
        }
    }
    /* Turbo fire, the game's own choice over the global one, RetroPad words
       so any driver. The same per-run save-off guard as the rest. */
    $turboOwn = false;
    $turboChoice = xs_ra_turbo_for($id, $turboOwn);
    if ($turboChoice !== null) {
        $appendLines = array_merge($appendLines, xs_ra_turbo_lines($turboChoice), ['config_save_on_exit = "false"']);
        $hot = ($hot !== null ? $hot . ' ' : '') . 'turbo=' . xs_ra_turbo_choice_words($turboChoice)
             . ($turboOwn ? ' (this game\'s own)' : '');
    }
}

/* ---- the saves kept beside the game -------------------------
 * A save left next to the game's file is copied where RetroArch loads it:
 * only where RetroArch has none of its own, and never into a folder Xsegon only reads.
 */
if (($launch['kind'] ?? '') === 'retroarch') {
    try {
        require_once __DIR__ . '/../includes/saves.php';
        // A dry run asks the same question and writes nothing, so the tests load these files too
        // and a fault in loading them shows there, not only in a real launch.
        $dry ? xs_saves_can_write($game) : xs_saves_pickup($game);
    } catch (\Throwable $e) {
        xs_log('SAVE', 'the saves beside ' . $game['title'] . ' were not looked at: ' . $e->getMessage());
    }
}

/* ---- RetroArch's own words, after a start that failed ----------------------
 * A game that closed at once leaves only an exit code. The next start of that
 * same game asks RetroArch for its own log (data\log\retroarch-last.log), so
 * the reason is on record. Every other start is untouched.
 */
if (($launch['kind'] ?? '') === 'retroarch') {
    require_once __DIR__ . '/../includes/retroarch.php';
    $raLog = ra_retry_log_args($id);
    if ($raLog !== '') {
        $launch['args'] = $raLog . ' ' . $launch['args'];
        if (!$dry) {
            xs_log('LNCH', $game['title'] . ' failed to start last time: started with RetroArch\'s own log on, ' . ra_retry_log_path());
        }
    }
}

/* ---- an archive, in a core that wants a plain file ------------
 * RetroArch unpacks the game into its temp folder first, and where it cannot
 * find that folder the start ends at once with exit code 1 and no words. The
 * folder is named for this run alone: RetroArch's own settings stay as they are.
 */
$romEnding = strtolower(pathinfo((string) ($launch['rom'] ?? ''), PATHINFO_EXTENSION));
if (($launch['kind'] ?? '') === 'retroarch' && in_array($romEnding, ['zip', '7z'], true)) {
    require_once __DIR__ . '/../includes/retroarch.php';
    $raCfg   = ra_config_path((string) $launch['exe']);
    $raFlags = ra_flags($raCfg);
    // Put right in RetroArch's settings above (a dry run only looked, and says so): then there is nothing to give this run.
    $raSettled = ($raFix['how'] ?? null) === 'settings' && in_array('cache_directory', array_column($raFix['faults'], 'key'), true);
    if (!$raSettled && !in_array($romEnding, ra_core_endings((string) $launch['exe'], (string) $launch['args'], $raFlags), true)) {
        // A dry run can say "as if HOME were not set", which is how Windows starts it and not how a test shell does.
        $raTemp = ra_temp_dir_fix($raCfg, (string) $launch['exe'], $dry && !empty($body['assumeNoHome']) ? '' : null);
        if ($raTemp !== null) {
            $appendLines[] = 'cache_directory = "' . $raTemp['use'] . '"';
            if ($raFlags['config_save_on_exit'] !== false) {
                $appendLines[] = 'config_save_on_exit = "false"';
            }
            if (!$dry) {
                xs_log('LNCH', $game['title'] . ' is an archive and RetroArch cannot find its temp folder (' . $raTemp['set']
                             . '): unpacked into ' . $raTemp['use'] . ' for this run');
            }
        }
    }
}

/* ---- a real start from the test copy is a small window ---------------------
 * A test's real start (forReal) never takes the screen: full screen comes off
 * the command, outside its quoted paths, and off in the settings for that run,
 * with the sound; none of it is saved. Off a test copy this is never reached.
 */
if (!$dry && xs_test_copy() && ($launch['kind'] ?? '') === 'retroarch') {
    $argParts = explode('"', (string) $launch['args']);
    foreach ($argParts as $i => $part) {
        if ($i % 2 === 0) {
            $argParts[$i] = (string) preg_replace('/(^|\s)(-f|--fullscreen)(?=\s|$)/', '$1', $part);
        }
    }
    $launch['args'] = implode('"', $argParts);
    array_push($appendLines, 'video_fullscreen = "false"', 'video_scale = "1"', 'audio_mute_enable = "true"', 'config_save_on_exit = "false"');
}

if ($appendLines) {
    $appendLines = array_values(array_unique($appendLines));   // the state, the cheats, your buttons and your menu choice all turn off config_save_on_exit
    $cfg = xs_data_path('ra-append.cfg');
    if (file_put_contents($cfg, implode("\n", $appendLines) . "\n") === false) {
        xs_fail('could not write the extra settings for RetroArch', 500);
    }
    $launch['args'] = '--appendconfig="' . $cfg . '" ' . $launch['args'];
}

/* A BIOS file this game wants and does not have never stops the launch (a
   table can be wrong): the launcher says so only if the game fails to start. */
$failHint = null;
if (($launch['kind'] ?? '') === 'retroarch') {
    require_once __DIR__ . '/../includes/bioshelp.php';
    $biosLack = xs_bios_lack_for(['platform' => $game['platform'], 'title' => $game['title'], 'rom' => $launch['rom']],
        (string) $launch['exe'], (string) $launch['args']);
    $failHint = $biosLack === null ? null : xs_bios_hint($biosLack);
}

// What bin\launch.ps1 is told. Handed over by xs_spawn_ps(), which is what
// keeps a title or a ROM path with & or quotes in it from reaching cmd.exe.
$params = [
    'Exe'          => $launch['exe'],
    'Arguments'    => $launch['args'],
    'GameId'       => $shown['id'],
    'Title'        => $shown['title'],
    'Platform'     => $game['platform'],
    // What kind of thing is started: only RetroArch can be asked to quit from here.
    'Kind'         => (string) ($launch['kind'] ?? '') === 'retroarch' ? 'retroarch' : 'other',
    'RomPath'      => $launch['rom'],
    'DataDir'      => xs_data_dir(),
    // Xsegon's window wears your name when one is set: the one to come back to is found by it.
    'FocusTitle'   => (string) $s['launch']['focusTitle'] === 'Xsegon' ? xs_brand($s)['title'] : (string) $s['launch']['focusTitle'],
    'RestoreFocus' => (bool) $s['launch']['restoreFocus'],
    'StepAside'    => (bool) ($s['launch']['stepAside'] ?? true),
];
/* Without a save to load, the port still goes along wherever RetroArch's
   network commands are already on, so the launcher can ask whether the game
   got going and tell a close from a crash (bin\launch.ps1, A CLOSE IS NOT A
   CRASH). Not switched on for this: that is only done for a picked save. */
if ($slot < 0 && ($launch['kind'] ?? '') === 'retroarch') {
    require_once __DIR__ . '/../includes/states.php';
    $flags = ra_flags(ra_config_path($launch['exe']));
    if ($flags['network_cmd_enable'] === true) {
        $netPort = $raPort > 0 ? $raPort : (int) ($flags['network_cmd_port'] ?: 55355);
    }
}
if ($slot >= 0) {
    $params['StateSlot'] = $slot;
}
if ($slot >= 0 || $netPort > 0) {
    $params['NetPort'] = $netPort;
}
if ($failHint !== null) {
    $params['FailHint'] = $failHint;
}
$params['Log'] = xs_log_enabled();       // the launcher writes its own LNCH lines
/* An optional display guard (private\bin\display-guard.ps1) puts the display
   back after a game; never on a test copy, whose display is not its own. */
if (!xs_test_copy() && is_file(XS_ROOT . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'display-guard.ps1')) {
    $params['DisplayGuard'] = 'on';
}
if ($follow !== null) {
    $params['WatchDir'] = (string) $follow['dir'];
    // and by its program's name, for a game the folder check cannot see (a
    // protected process hides its path). Not a name as common as "Game" or
    // "Launcher", which some other program could be wearing.
    $name = pathinfo((string) ($follow['exe'] ?? ''), PATHINFO_FILENAME);
    if ($name !== '' && !in_array(strtolower($name), ['game', 'launcher', 'start', 'play', 'main', 'client', 'app', 'run', 'setup'], true)) {
        $params['WatchNames'] = $name;
    }
    $params['ViaSteam'] = $viaSteam;
}

// An N64 game whose texture packs the core has not read yet: this start reads them all, RetroArch's window still meanwhile.
$texRead = 0;
if (($launch['kind'] ?? '') === 'retroarch' && strtolower((string) ($game['platform'] ?? '')) === 'nintendo 64') {
    require_once __DIR__ . '/../includes/texpacks.php';
    $texRead = xs_tp_reads_first_for((string) $game['id']);
}

// The call as PowerShell text: readable in a dry run and the launch log.
$command = xs_ps_call($script, $params);

/* A Flashpoint game: its player reads no controller, so a helper beside the launcher turns
   the pad into the game's keys while its window is in front (bin\padtokeys.ps1). */
$padKeys = null;
$padCall = null;
if (($game['fpId'] ?? '') !== '' && ($launch['via'] ?? '') === 'Flashpoint') {
    require_once __DIR__ . '/../includes/flashpoint.php';
    $padKeys = xs_fp_padkeys((string) $game['fpId']);
    if ($padKeys !== null) {
        $padCall = xs_ps_call(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'padtokeys.ps1', [
            'Map' => $padKeys['map'], 'Windows' => $padKeys['windows'], 'FullScreen' => $padKeys['fullScreen'] !== '' ? $padKeys['fullScreen'] : null,
            'FullScreenIn' => $padKeys['fullScreen'] !== '' && $padKeys['fullScreenIn'] !== '' ? $padKeys['fullScreenIn'] : null,
            'GameId' => (string) $shown['id'], 'DataDir' => xs_data_dir(), 'Log' => xs_log_enabled()]);
    }
}

if ($dry) {
    xs_json(['ok' => true, 'dry' => true, 'launched' => $shown['title'], 'plays' => $game['title'], 'via' => $launch['via'],
             'exe' => $launch['exe'], 'args' => $launch['args'], 'command' => $command,
             'coreMissing' => $coreMissing, 'failHint' => $failHint,
             'core' => $chosenCore, 'cheats' => $cheats, 'hack' => $hack, 'pads' => $pads, 'keys' => $keysUsed, 'keysEvery' => $keysEvery, 'hot' => $hot, 'append' => $appendLines,
             'slot' => $slot >= 0 ? $slot : null, 'loads' => $slot < 0 ? null : ($netPort > 0 ? 'sent' : 'hotkey'),
             'follow' => $follow['dir'] ?? null, 'viaSteam' => $viaSteam, 'direct' => $direct,
             'asks' => $netPort > 0 ? $netPort : null,     // the port the launcher asks RetroArch on
             'texRead' => $texRead ?: null,                 // bytes of texture packs this start reads first
             'padKeys' => $padKeys,                         // a Flashpoint game's controller as its keys
             'padCall' => $padCall,
             'raFix' => $raFix]);                           // what was found wrong in RetroArch's settings, and where it would be put right
}

if ($s['launch']['logLaunches']) {
    xs_append_jsonl(xs_data_path('launch-log.jsonl'), [
        'at' => date('c'), 'id' => $shown['id'], 'title' => $shown['title'], 'command' => $command,
    ]);
}

xs_log('LNCH', $shown['title'] . ' via ' . $launch['via'] . ' exe=' . basename($launch['exe'])
       . ($chosenCore !== null ? ' core=' . $chosenCore : '')
       . ($cheats !== null ? ' cheats=' . $cheats['on'] : '')
       . ($hack !== null ? ' hack=' . $hack['route'] . ':' . basename((string) $hack['file']) : '')
       . ($pads !== null ? ' pads=' . $pads['moved'] . ($pads['gameOwn'] ? ' gamepads=' . $pads['game'] : '')
                           . ((array) $pads['players'] ? ' ownplayers=' . implode(',', array_keys((array) $pads['players'])) : '') : '')
       . ($keysUsed !== null ? ' keys=' . $keysUsed : '')
       . ($keysEvery !== null ? ' keysEvery=' . $keysEvery : '')
       . ($hot !== null ? ' hot=' . $hot : '')
       . ($slot >= 0 ? ' slot=' . $slot . ($netPort > 0 ? ' load=sent' : ' load=hotkey') : '')
       . ($texRead > 0 ? ' texread=' . round($texRead / 1048576) . 'MB' : '')
       . ($follow !== null ? ' follow=' . basename((string) $follow['dir']) : '')
       . ($padKeys !== null ? ' padkeys=' . $padKeys['map'] . ($padKeys['fullScreen'] !== '' ? ' full=' . $padKeys['fullScreen'] : '') : ''));
// Detached: this returns now, the game runs on.
if (!xs_spawn_ps($command)) {
    xs_fail('could not start the launcher', 500);
}
// Started as the launcher is, beside it.
if ($padCall !== null && !xs_spawn_ps($padCall)) {
    xs_log('LNCH', 'the controller helper for ' . $shown['title'] . ' could not be started: the game plays on the keyboard alone');
}
// Marked running at once, not in a second when PowerShell is up, so a second
// press meanwhile is refused (xs_game_running); the launcher replaces it.
xs_write_json(xs_data_path('running.json'), ['gameId' => $shown['id'], 'title' => $shown['title'],
    'platform' => $game['platform'], 'startedAt' => date('c'), 'pending' => true]);

xs_json([
    'ok'       => true,
    'launched' => $shown['title'],
    'platform' => $game['platform'],
    'via'      => $launch['via'],
    'detached' => true,
    'slot'     => $slot >= 0 ? $slot : null,
    'loads'    => $slot < 0 ? null : ($netPort > 0 ? 'sent' : 'hotkey'),
    'texRead'  => $texRead ?: null,
    // the key the page tells the person to press, as RetroArch has it set
    'hotkey'   => $slot >= 0 && isset($flags) ? strtoupper((string) (($flags['input_load_state'] ?? '') ?: 'F4')) : null,
]);
