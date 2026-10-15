<?php
/**
 * Xsegon - the worker for a video package's long steps (includes\videopack.php),
 * run in the background.
 *
 *   php bin\videopack.php
 *
 * The plan is in data\videopack-job.json. "import" puts a package's videos
 * onto the games here that have none; "make" lives in private\, where present.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';
require_once __DIR__ . '/../includes/videopack.php';

set_time_limit(0);
ini_set('memory_limit', '1024M');

$job = xs_read_json(xs_vp_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\videopack-job.json\n");
    exit(1);
}
$job['pid'] = getmypid();
$last = 0.0;
$save = static function (bool $now = true) use (&$job, &$last): void {
    if (!$now && microtime(true) - $last < 0.4) {
        return;
    }
    $last = microtime(true);
    $job['beat'] = time();
    xs_write_json(xs_vp_job_path(), $job);
};
$save();
register_shutdown_function(static function () use (&$job, $save): void {
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $save();
    }
});
$stopped = static fn (): bool => is_file(xs_vp_stop_path());
$end = static function (string $state, string $words) use (&$job, $save): void {
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    @unlink(xs_vp_stop_path());
    xs_log('VPK', ($job['kind'] ?? '') . ' ' . $state . ': ' . $words);
    exit(0);
};
$n = static fn (int $count, string $one, string $many): string => $count . ' ' . ($count === 1 ? $one : $many);
$t0 = microtime(true);

// ---- a list in, a package out (private\bin\videopack-make.php, where present) ----
if (($job['kind'] ?? '') === 'make') {
    $make = XS_ROOT . DIRECTORY_SEPARATOR . 'private' . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'videopack-make.php';
    if (!is_file($make)) {
        $end('failed', 'this copy does not make video packages');
    }
    require $make;
}

// ---- a package in, its videos onto the games ---------------------------------
if (($job['kind'] ?? '') === 'import') {
    $job['phase'] = 'reading';
    $save();
    $package = (string) $job['package'];
    $pkg = xs_vp_package_read($package, $why);
    if ($pkg === null) {
        $end('failed', (string) $why);
    }
    $s      = xs_settings();
    $byId   = [];
    $byName = [];
    $consoles = [];     // each console's games, for the look before a video is named (xs_vp_dest_now)
    $shelf  = [];       // each console's videos by name as the plan was made
    foreach (xs_library()['games'] ?? [] as $g) {
        $byId[(string) $g['id']] = $g;
        $byName[art_key((string) $g['platform']) . '|' . art_key((string) $g['title'])] ??= $g;
        $consoles[art_key((string) $g['platform'])][] = $g;
    }
    $types = video_types();
    $plan  = [];
    $tally = ['had' => 0, 'absent' => 0, 'bad' => 0];
    foreach ($pkg['doc']['games'] as $row) {
        $entry = is_array($row) ? ($pkg['dir'][(string) ($row['video'] ?? '')] ?? null) : null;
        $ext   = strtolower(pathinfo((string) ($row['video'] ?? ''), PATHINFO_EXTENSION));
        if ($entry === null || !isset($types[$ext])) {
            $tally['bad']++;
            continue;
        }
        // The game the list named, by its id when this is the library it came from, else by console and title.
        $g = $byId[(string) ($row['id'] ?? '')] ?? null;
        if ($g === null || art_key((string) $g['platform']) !== art_key((string) ($row['platform'] ?? ''))) {
            $g = $byName[art_key((string) ($row['platform'] ?? '')) . '|' . art_key((string) ($row['title'] ?? ''))] ?? null;
        }
        if ($g === null) {
            $tally['absent']++;
            continue;
        }
        if (video_for_game($s, $g) !== null) {
            $tally['had']++;
            continue;
        }
        $pk   = art_key((string) $g['platform']);
        $dest = xs_vp_dest_now($s, $g, $consoles[$pk] ?? [], $ext, $said, $has, $shelf[$pk] ??= video_console_now($s, (string) $g['platform']));
        if ($has) {
            $tally['had']++;
            continue;
        }
        if ($dest === null) {
            $tally['bad']++;
            xs_log('VPK', $g['title'] . ' (' . $g['platform'] . '): ' . $said . ': left out');
            continue;
        }
        $plan[] = ['entry' => $entry, 'dest' => $dest, 'title' => (string) $g['title'], 'game' => $g, 'ext' => $ext];
        $job['total'] += $entry['size'];
    }
    $job['games'] = count($plan);
    $job['phase'] = 'copying';
    $save();
    foreach ($plan as $i => $p) {
        if ($stopped()) {
            $end('stopped', 'stopped: ' . $n($job['added'], 'game', 'games') . ' got a video before that');
        }
        $job['at'] = $i + 1;
        // Looked at again just before: two versions of one game share a name, and so a video: the second
        // finds the first's already there. A name another game's video took meanwhile is not used.
        $now = xs_vp_dest_now($s, $p['game'], $consoles[art_key((string) $p['game']['platform'])] ?? [], $p['ext'], $said, $has);
        if ($has) {
            $job['bytes'] += $p['entry']['size'];
            $job['added']++;
            continue;
        }
        if ($now === null) {
            $tally['bad']++;
            xs_log('VPK', $p['title'] . ': ' . $said . ': left out');
            continue;
        }
        $p['dest'] = $now;
        if (!is_dir(dirname($p['dest'])) && !@mkdir(dirname($p['dest']), 0777, true)) {
            $end('failed', 'the folder ' . dirname($p['dest']) . ' could not be made: ' . $n($job['added'], 'game', 'games') . ' got a video before that');
        }
        $ok = xs_zs_take($package, $p['entry'], $p['dest'], static function (int $len) use (&$job, $save, $stopped): bool {
            $job['bytes'] += $len;
            $save(false);
            return !$stopped();
        }, $why);
        if (!$ok && $why === 'stopped') {
            $end('stopped', 'stopped: ' . $n($job['added'], 'game', 'games') . ' got a video before that');
        }
        if (!$ok && str_contains((string) $why, 'written')) {
            $end('failed', $p['title'] . '\'s video ' . $why . ': ' . $n($job['added'], 'game', 'games') . ' got a video before that');
        }
        if ($ok && !xs_vp_is_video($p['dest'])) {
            @unlink($p['dest']);
            [$ok, $why] = [false, 'is not a video a browser can play'];
        }
        if (!$ok) {
            $tally['bad']++;
            xs_log('VPK', $p['title'] . '\'s video ' . $why . ': left out');
            continue;
        }
        $job['added']++;
        $save(false);
    }
    $job += $tally;
    $job['seconds'] = (int) round(microtime(true) - $t0);
    $more = array_filter([
        $tally['had'] ? $n($tally['had'], 'game', 'games') . ' already had a video and kept it' : '',
        $tally['absent'] ? $n($tally['absent'], 'video is', 'videos are') . ' for a game not in this library' : '',
        $tally['bad'] ? $n($tally['bad'], 'video', 'videos') . ' could not be used' : '',
    ]);
    $end('done', ($job['added'] ? $n($job['added'], 'game now has', 'games now have') . ' a video from the package' : 'No game got a video from the package')
        . ($more ? ': ' . implode(', ', $more) : ''));
}

$end('failed', 'the job in data\\videopack-job.json is of no kind this worker knows');
