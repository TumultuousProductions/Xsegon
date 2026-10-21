<?php
/**
 * /api/setup.php - getting a new person up and going.
 *
 *   GET                              is there a RetroArch, what Get RetroArch
 *                                    would fetch, which cores are missing,
 *                                    and the background job if one is running
 *   POST {"get": "retroarch"}        fetch RetroArch into data\emulators
 *   POST {"use": true}               put the RetroArch that was found into
 *                                    the emulator table
 *   POST {"cores": ["Sega Genesis"]} fetch the missing cores for these consoles
 *   POST {"auto": true|false}        the one yes: set everything up by itself,
 *                                    now and as games are scanned in later,
 *                                    the Runs check last (api\running.php);
 *                                    with "runs": false without that check,
 *                                    with "runs": "ask" not until it is answered
 *   POST {"runs": true|false}        the answer: the Runs check last, or not
 *                                    (also Skip on the list). With "videos"
 *                                    and "cheats" beside it, the two other
 *                                    things the same window offers: videos
 *                                    owed until the names are in, the cheat
 *                                    lists fetched at once
 *   POST {"videos": false}           Skip on the videos line before they begin
 *   GET  ?run=1                      the Setting up list: each part of the
 *                                    run and how far it is, null when none is on
 *   GET  ?job=1                      only the background job, for the corner watch
 *   POST {"asked": true}           the first-run question was answered
 *   POST {"asked": "guide"}          the first-run guide was shown
 *   POST {"asked": "fill"}           Fill in has filled every game it was sure
 *                                    of: the ones still bare were left on purpose
 *   POST {"asked": "hint"}           the pictures hint under Get Media was shown
 *   GET  ?guide=1                    only the guide's counts, for that hint
 *
 * Every POST is refused when the rules say no, whatever the page showed:
 * Get RetroArch while one is here, a core into a folder Xsegon only reads, a second
 * job while one runs. `dry: true` answers with the plan and starts nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/setup.php';
require_once __DIR__ . '/../includes/runcheck.php';

/* The Setting up list's own read (js\setuplist.js), every second and a half
   while a run is on: answered before the library is read, which the full
   state below needs and this does not. */
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && isset($_GET['run'])) {
    xs_json(['ok' => true, 'run' => xs_setup_run_view()]);
}
/* The corner watch's read (js\setupbar.js), every second while a fetch runs:
   only the job, for the same reason. */
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET' && isset($_GET['job'])) {
    xs_json(['ok' => true, 'light' => true, 'job' => xs_setup_job()]);
}

$s     = xs_settings();
$root  = xs_norm_path($s['paths']['launchbox']);
$table = xs_emulators($root);
$lib   = xs_library();

function xs_setup_view(array $table, array $lib): array
{
    $job   = xs_setup_job();
    $table = xs_emulators(xs_norm_path(xs_settings()['paths']['launchbox']));   // the job may have just changed it
    $ra    = xs_ra_find($table, $lib);
    $src   = xs_setup_source();
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    return [
        'ok'        => true,
        'retroarch' => $ra,
        'canGet'    => !$ra['have'] && !xs_setup_busy($job),
        'canUse'    => $ra['have'] && !$ra['inTable'],
        'get'       => [
            'version' => $src['version'],
            'bytes'   => $src['bytes'],
            'url'     => $src['url'],
            'carried' => $src['local'] !== '',     // in the package already: unpacked, not downloaded
            'dest'    => xs_own_ra_dir(),
            'sets'    => array_map(static fn ($k, $v) => ['key' => $k, 'value' => $v[0], 'why' => $v[1]],
                                   array_keys(xs_setup_preset()), array_values(xs_setup_preset())),
        ],
        'cores'     => xs_setup_cores($table, $lib),
        'job'       => $job,
        'asked'     => !empty($asked['askedRetroArch']),
        'auto'      => is_array($asked) && !empty($asked['auto']),
        'guide'     => xs_setup_guide($lib, is_array($asked) ? $asked : []),
    ];
}

/** The scanned games nobody has looked up: no Games Database number and no
    libretro name. Their ids, so a pass can say which ones it left behind. */
function xs_setup_bare_ids(array $lib): array
{
    $ids = [];
    foreach ($lib['games'] ?? [] as $g) {
        if (empty($g['local']) && !empty($g['scanned'])
            && (int) ($g['dbId'] ?? 0) === 0 && (string) ($g['lrName'] ?? '') === '') {
            $ids[] = (string) ($g['id'] ?? '');
        }
    }
    return $ids;
}

/* The first-run guide's other steps: where games are looked for, how many
   there are, and how many scanned ones have only a file name for a title.
   "left" is how many of those a finished Fill in pass left on purpose: they
   no longer keep the step open, until a game scanned later opens it again. */
function xs_setup_filling(): bool
{
    require_once __DIR__ . '/../includes/fill.php';
    $job = xs_fill_job();
    // A look fills nothing: it is Fill in custom reading its list.
    return ($job['state'] ?? '') === 'running' && ($job['mode'] ?? '') !== 'look';
}

function xs_setup_guide(array $lib, array $asked): array
{
    require_once __DIR__ . '/../includes/scan.php';
    $folders = [];
    // "made": the Games folder Xsegon made on a new copy's first start
    // (includes\scan.php), which step 2 says in words and offers to open.
    $own = strtolower(xs_scan_first_folder_made());
    foreach (xs_scan_roots() as $p) {
        $folders[] = ['path' => $p, 'there' => is_dir($p), 'made' => $own !== '' && strtolower($p) === $own];
    }
    $games = $scanned = 0;
    foreach ($lib['games'] ?? [] as $g) {
        if (!empty($g['local'])) {
            continue;
        }
        $games++;
        if (!empty($g['scanned'])) {
            $scanned++;
        }
    }
    // Looked up in the Games Database, or matched on libretro's lists: not bare.
    $bare = xs_setup_bare_ids($lib);
    $left = is_array($asked['fillLeft'] ?? null) ? $asked['fillLeft'] : [];
    return [
        'folders'  => $folders,
        'games'    => $games,
        'scanned'  => $scanned,
        'bare'     => count($bare),
        'left'     => count(array_intersect($bare, $left)),
        // How often the pictures hint has been shown since the last Fill in
        // pass: it stops by itself after three (js/hint.js).
        'hinted'   => (int) ($asked['hintShown'] ?? 0),
        'shown'    => !empty($asked['shownGuide']),
        // A Fill in pass at work in the background (includes\fill.php): the
        // step says so in place of its buttons.
        'filling'  => xs_setup_filling(),
    ];
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    // The pictures hint asks only this: nothing about RetroArch or its
    // cores is looked up for a note that shows for three seconds.
    if (isset($_GET['guide'])) {
        $asked = xs_read_json(xs_data_path('setup.json'), []);
        xs_json(['ok' => true, 'guide' => xs_setup_guide($lib, is_array($asked) ? $asked : [])]);
    }
    xs_json(xs_setup_view($table, $lib));
}

xs_local_origin_only();
$body = xs_body();
$dry  = !empty($body['dry']);
$job  = xs_setup_job();

function xs_setup_refuse(string $why, int $code = 409): void
{
    xs_log('SETUP', 'refused: ' . $why);
    xs_fail($why, $code);
}

if (!empty($body['asked'])) {
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    // "asked" is the Get RetroArch question; "guide" is the first-run guide
    // having been shown once. Both are only ever set, never unset. "fill" is
    // written again by every finished pass: the games it left bare, by id.
    if (($body['asked'] ?? '') === 'guide') {
        $asked['shownGuide'] = true;
    } elseif (($body['asked'] ?? '') === 'fill') {
        $asked['fillLeft'] = xs_setup_bare_ids($lib);
        $asked['hintShown'] = 0;          // games scanned later may be hinted about afresh
        xs_log('SETUP', 'fill in finished, ' . count($asked['fillLeft']) . ' left for a person to decide');
    } elseif (($body['asked'] ?? '') === 'hint') {
        $asked['hintShown'] = (int) ($asked['hintShown'] ?? 0) + 1;
    } else {
        $asked['askedRetroArch'] = true;
    }
    xs_write_json(xs_data_path('setup.json'), $asked);
    xs_json(['ok' => true]);
}

/* Skip on the videos line while it waits its turn: not owed any more. */
if (array_key_exists('videos', $body) && empty($body['videos']) && !array_key_exists('runs', $body) && !array_key_exists('auto', $body)) {
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    unset($asked['videosWanted']);
    if (!xs_write_json(xs_data_path('setup.json'), $asked, $why)) {
        xs_setup_refuse((string) $why, 500);
    }
    xs_log('SETUP', 'videos are left for later: Get Media > Videos from online archives fetches them any time');
    xs_json(['ok' => true, 'run' => xs_setup_run_view()]);
}

/* The answer to "Run the games check?", asked once the games are in, and
   Skip on the Setting up list. No: none is owed, for this run and for games
   scanned later (one already at work is stopped by the page through
   api\runcheck.php, as its Stop does). Yes: owed, last, as soon as there
   are games to check. */
if (array_key_exists('runs', $body) && !array_key_exists('auto', $body)) {
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    unset($asked['runsAsk']);
    if (empty($body['runs'])) {
        $asked['runsSkip'] = true;
        unset($asked['runsWanted']);
    } else {
        require_once __DIR__ . '/../includes/scan.php';
        unset($asked['runsSkip']);
        if (xs_scan_read()) {
            $asked['runsWanted'] = true;
        }
    }
    /* The two things asked in the same window. Videos are owed
       until the names are in (xs_setup_run_view starts them); Skip on the
       Runs check's line sends neither word and changes neither. */
    if (array_key_exists('videos', $body)) {
        if (empty($body['videos'])) {
            unset($asked['videosWanted']);
        } else {
            $asked['videosWanted'] = true;
        }
    }
    if (!xs_write_json(xs_data_path('setup.json'), $asked, $why)) {
        xs_setup_refuse((string) $why, 500);
    }
    xs_log('SETUP', empty($body['runs']) ? 'the runs check is left for later: Emulators > Runs check does it any time'
        : 'the runs check is wanted: it starts when the downloads and pictures are done');
    if (array_key_exists('videos', $body)) {
        xs_log('SETUP', empty($body['videos']) ? 'videos were not selected: Get Media > Videos from online archives fetches them any time'
            : 'videos are wanted: fetched from the online archives once the names are in');
    }
    // The cheat lists wait for nothing: fetched at once, into Xsegon's own folder.
    $cheatsSaid = null;
    if (!empty($body['cheats'])) {
        require_once __DIR__ . '/../includes/cheats.php';
        require_once __DIR__ . '/../includes/cheatlists.php';
        $cwhy = null;
        $cheatsSaid = xs_cheat_lists_here($lib) ? 'here already' : (xs_cl_start($cwhy) ? 'started' : 'not started: ' . $cwhy);
        xs_log('SETUP', 'the cheat lists were selected: ' . $cheatsSaid);
    }
    xs_json(['ok' => true, 'run' => xs_setup_run_view(), 'cheats' => $cheatsSaid]);
}

/* The one yes: everything set up by itself. Stores the choice, then does what
   is already possible (RetroArch, its cores, names and pictures). The rest
   follows by itself: the RetroArch fetch chains the cores (includes\setup.php)
   and a scan that adds games starts their cores and pictures (api\scan.php). */
if (array_key_exists('auto', $body)) {
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    $asked['auto'] = !empty($body['auto']);
    $asked['askedRetroArch'] = true;
    // The Runs check comes last (api\running.php says when): owed now for
    // the games already in, else by the scan that brings them (api\scan.php).
    $hasGames = false;
    foreach ($lib['games'] ?? [] as $g) {
        if (empty($g['local'])) {
            $hasGames = true;
            break;
        }
    }
    // "runs": false is without the check; "ask" is none until the person
    // has answered the question the page asks once the games are in.
    unset($asked['runsSkip'], $asked['runsAsk'], $asked['videosWanted']);   // videos are owed to one answer, never carried to the next yes
    /* The setup window (js\setupwin.js) answers everything with the yes: videos
       owed until the names are in, names and pictures left out when switched off. */
    if ($asked['auto'] && !empty($body['videos'])) {
        $asked['videosWanted'] = true;
    }
    if ($asked['auto'] && array_key_exists('pictures', $body)) {
        if (empty($body['pictures'])) {
            $asked['noPictures'] = true;
        } else {
            unset($asked['noPictures']);
        }
    }
    if ($asked['auto'] && array_key_exists('runs', $body) && ($body['runs'] === 'ask' || empty($body['runs']))) {
        $asked['runsSkip'] = true;
        if ($body['runs'] === 'ask') {
            $asked['runsAsk'] = true;
        }
    }
    if ($asked['auto'] && $hasGames && empty($asked['runsSkip'])) {
        $asked['runsWanted'] = true;
    } else {
        unset($asked['runsWanted']);
    }
    if (!$asked['auto']) {
        unset($asked['run']);           // the list goes with the yes
    }
    if (!xs_write_json(xs_data_path('setup.json'), $asked, $why)) {
        xs_setup_refuse((string) $why, 500);
    }
    xs_log('SETUP', 'set it all up by itself: ' . ($asked['auto'] ? 'yes' . (!empty($asked['runsWanted']) ? ', the runs check last'
        : (!empty($asked['runsAsk']) ? ', the runs check to be asked about' : (!empty($asked['runsSkip']) ? ', the runs check skipped' : ''))) : 'turned off'));
    if ($asked['auto']) {
        xs_setup_run_begin('the yes', xs_ra_find($table, $lib)['have']);
        if (array_key_exists('videos', $body) || array_key_exists('pictures', $body)) {
            xs_log('SETUP', 'chosen with the yes: names and pictures ' . (empty($asked['noPictures']) ? 'yes' : 'no')
                . ', videos ' . (!empty($asked['videosWanted']) ? 'yes' : 'no') . ', cheat lists ' . (!empty($body['cheats']) ? 'yes' : 'no'));
        }
    }
    $out = ['ok' => true, 'auto' => $asked['auto'], 'started' => null, 'used' => null, 'fill' => false, 'error' => null,
            'runs' => !empty($asked['runsWanted']), 'cheats' => null];
    // The cheat lists wait for nothing: fetched at once, into Xsegon's own folder, after the run begins so its list shows them.
    if ($asked['auto'] && !empty($body['cheats'])) {
        require_once __DIR__ . '/../includes/cheats.php';
        require_once __DIR__ . '/../includes/cheatlists.php';
        $cwhy = null;
        $out['cheats'] = xs_cheat_lists_here($lib) ? 'here already' : (xs_cl_start($cwhy) ? 'started' : 'not started: ' . $cwhy);
        xs_log('SETUP', 'the cheat lists were selected: ' . $out['cheats']);
    }
    if (!$asked['auto']) {
        xs_json($out);
    }
    if (xs_runcheck_active()) {
        $out['error'] = 'the Runs check is still going: the fetches wait until it is done';
    } elseif (!xs_setup_busy($job)) {
        $err = null;
        $ra  = xs_ra_find($table, $lib);
        if (!$ra['have']) {
            $out['started'] = xs_setup_retroarch_job(true, $err) !== null ? 'retroarch' : null;
        } else {
            if (!$ra['inTable']) {
                $reg = xs_setup_register($ra['exe'], $ra['own'], $err);
                if ($reg['ok']) {
                    if ($ra['own']) {
                        xs_setup_write_preset(dirname($ra['exe']));
                    }
                    $out['used'] = $ra['exe'];
                    xs_log('SETUP', 'using the RetroArch at ' . $ra['exe'] . ' by itself, ' . count($reg['filled']) . ' consoles given a core');
                }
            }
            if ($err === null && xs_setup_chain_cores($err) !== null) {
                $out['started'] = 'cores';
            }
        }
        $out['error'] = $err;
        if ($err !== null) {
            xs_log('SETUP', 'set it all up could not start: ' . $err);
        }
    }
    require_once __DIR__ . '/../includes/fill.php';
    if (empty($asked['noPictures']) && !xs_fill_running() && xs_setup_bare_ids($lib)) {
        $fillWhy = null;
        $out['fill'] = xs_fill_start(['mode' => 'all', 'picks' => [], 'pictures_wanted' => true,
                                      'complete' => false, 'dry' => false], $fillWhy);
        if ($out['fill']) {
            xs_log('FILL', 'started by itself: every game it is sure of (set it all up)');
        }
    }
    xs_json($out);
}

if (xs_setup_busy($job) && !$dry) {
    xs_setup_refuse('a download is already under way; it has to finish first');
}
// The other half of api\runcheck.php's refusal: a core arriving half way
// through a check marks the games before it wrong.
if (!$dry && (($body['get'] ?? '') === 'retroarch' || isset($body['cores'])) && xs_runcheck_active()) {
    xs_setup_refuse('the Runs check is still going: let it finish or stop it, then fetch these. A core arriving half way through would mark the games checked before it as not starting');
}

if (($body['get'] ?? '') === 'retroarch') {
    $ra = xs_ra_find($table, $lib);
    if ($ra['have']) {
        xs_setup_refuse('RetroArch is already here (' . $ra['exe'] . '), so a second copy was not fetched');
    }
    // The checks, the plan and the start are xs_setup_retroarch_job's, shared with the one yes above.
    $err  = null;
    $plan = xs_setup_retroarch_job(false, $err);
    if ($plan === null) {
        xs_setup_refuse((string) $err);
    }
    if ($dry) {
        xs_json(['ok' => true, 'dry' => true, 'plan' => $plan]);
    }
    $plan = xs_setup_retroarch_job(true, $err);
    if ($plan === null) {
        xs_setup_refuse((string) $err, str_starts_with((string) $err, 'there is not enough room') ? 409 : 500);
    }
    xs_json(['ok' => true, 'started' => true, 'job' => $plan]);
}

if (!empty($body['use'])) {
    $ra = xs_ra_find($table, $lib);
    if (!$ra['have']) {
        xs_setup_refuse('there is no RetroArch to use');
    }
    if ($ra['inTable']) {
        xs_setup_refuse('the emulator table already runs ' . $ra['exe']);
    }
    if ($dry) {
        xs_json(['ok' => true, 'dry' => true, 'exe' => $ra['exe']]);
    }
    $reg = xs_setup_register($ra['exe'], $ra['own'], $why);
    if (!$reg['ok']) {
        xs_setup_refuse((string) $why, 500);
    }
    if ($ra['own']) {
        xs_setup_write_preset(dirname($ra['exe']));
    }
    xs_log('SETUP', 'using the RetroArch at ' . $ra['exe'] . ', ' . count($reg['filled']) . ' consoles given a core');
    // The one yes covers this road too: the cores follow without a window.
    if (xs_setup_auto()) {
        $cerr = null;
        xs_setup_chain_cores($cerr);
        if ($cerr !== null) {
            xs_log('SETUP', 'cores did not follow by themselves: ' . $cerr);
        }
    }
    xs_json(['ok' => true, 'exe' => $ra['exe'], 'key' => $reg['key'], 'filled' => $reg['filled']]);
}

if (isset($body['cores'])) {
    $want = array_map('strtolower', array_map('strval', (array) $body['cores']));
    $rows = array_values(array_filter(xs_setup_cores($table, $lib),
        static fn ($r) => in_array(strtolower($r['platform']), $want, true)));
    if (!$rows) {
        xs_setup_refuse('none of those consoles is missing a core');
    }
    foreach ($rows as $r) {
        if (!$r['may']) {
            xs_setup_refuse($r['platform'] . "'s core would go into a folder Xsegon never writes to. "
                . "RetroArch's own Online Updater can fetch it");
        }
        if (xs_test_keep_out($r['dir'])) {
            xs_setup_refuse('a test copy never writes into a real emulator\'s folder: ' . $r['dir']);
        }
    }
    // One job fetches into one folder; the page asks per RetroArch.
    $dirs = array_unique(array_map(static fn ($r) => strtolower($r['dir']), $rows));
    if (count($dirs) > 1) {
        xs_setup_refuse('those cores belong to different RetroArch folders; fetch them one RetroArch at a time');
    }
    $plan = xs_setup_cores_plan($rows);
    if ($dry) {
        xs_json(['ok' => true, 'dry' => true, 'plan' => $plan]);
    }
    if (!xs_write_json(xs_setup_job_path(), $plan, $why)) {
        xs_setup_refuse((string) $why, 500);
    }
    xs_log('SETUP', 'get cores asked: ' . implode(', ', array_column($plan['cores'], 'core')) . ' into ' . $plan['dest']);
    if (!xs_setup_start()) {
        xs_setup_refuse('the downloader could not be started', 500);
    }
    xs_json(['ok' => true, 'started' => true, 'job' => $plan]);
}

xs_fail('say what to do: get, use, cores or asked');
