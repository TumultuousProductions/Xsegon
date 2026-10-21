<?php
/**
 * Xsegon - the worker behind the Media tab's compare (includes\mediachoice.php), run in the background.
 *
 *   php bin\mediachoice.php <ticket> look            ask each place in data\mediachoice\<ticket>\job.json
 *   php bin\mediachoice.php <ticket> fetch <key>     bring down the file in prep-<key>.json
 *
 * ScreenScraper is not asked here: its logins stay with bin\screenscraper.ps1, which writes ss.json.
 * Each place's answer is written as it comes, so the page fills place by place.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/mediachoice.php';

set_time_limit(0);
ini_set('memory_limit', '1024M');

$ticket = (string) ($argv[1] ?? '');
$mode   = (string) ($argv[2] ?? '');
if (!xs_mc_ticket_ok($ticket)) {
    fwrite(STDERR, "no such ticket\n");
    exit(1);
}

if ($mode === 'fetch') {
    $key  = (string) ($argv[3] ?? '');
    $path = xs_mc_path($ticket, 'prep-' . $key . '.json');
    $p    = preg_match('/^[a-f0-9]{12}$/D', $key) ? xs_read_json($path, null) : null;
    if (!is_array($p) || ($p['state'] ?? '') !== 'running' || !empty($p['pid']) || !xs_mc_file_ok((string) ($p['to'] ?? ''))) {
        fwrite(STDERR, "nothing waiting in that prep file\n");
        exit(1);
    }
    $p['pid'] = getmypid();
    xs_write_json($path, $p);
    $to = xs_mc_path($ticket, (string) $p['to']);
    $t0 = microtime(true);
    $last = 0.0;
    $why  = '';
    $done = false;
    // The compare closed (its prep file gone): nothing more is written, so its folder is not made again.
    $open = static fn (): bool => is_file($path);
    register_shutdown_function(static function () use (&$p, &$done, $path, $open): void {
        if (!$done && ($p['state'] ?? '') === 'running' && $open()) {
            $p['state'] = 'failed';
            $p['why']   = 'it stopped on a fault: the log has it';
            xs_write_json($path, $p);
        }
    });
    $max = (int) ($p['max'] ?? 0);
    if (xs_curl_exe() === '') {
        $ok  = false;
        $why = "Windows' own curl.exe is not on this PC, and that is what fetches it";
    } else {
        $ok = false;
        xs_curl_many(['one' => ['url' => (string) $p['url'], 'to' => $to, 'lane' => 'one']], 1, 1,
            static function ($k, bool $good, string $said) use (&$ok, &$why): void {
                $ok  = $good;
                $why = $said;
            },
            static function () use (&$p, &$last, &$why, $to, $path, $open, $max): bool {
                if (!$open()) {
                    $why = 'the compare closed';
                    return false;
                }
                // A place that sends more than it said, or more than Xsegon takes, is stopped.
                if ($max > 0 && (int) @filesize($to) > $max) {
                    $why = 'it is larger than ' . round($max / 1048576) . ' MB, more than Xsegon takes';
                    return false;
                }
                if (microtime(true) - $last >= 0.4) {
                    $last = microtime(true);
                    $p['got'] = (int) @filesize($to);
                    xs_write_json($path, $p);
                }
                return true;
            });
    }
    if (!$open()) {
        @unlink($to);
        $done = true;
        xs_log('CMPR', 'stopped bringing down ' . $p['ref'] . ': the compare closed');
        exit(0);
    }
    if ($ok && !xs_mc_is((string) $p['type'], $to)) {
        $ok  = false;
        $why = 'what came is not ' . (['video' => 'a video', 'pdf' => 'a PDF', 'image' => 'a picture'][$p['type']] ?? 'what was asked');
    }
    if ($ok && ($p['md5'] ?? '') !== '' && strtolower((string) md5_file($to)) !== strtolower((string) $p['md5'])) {
        $ok  = false;
        $why = 'it came damaged: its checksum is not the one the place gives';
    }
    if (!$ok) {
        @unlink($to);
    }
    $p['state'] = $ok ? 'done' : 'failed';
    $p['why']   = $ok ? '' : $why;
    $p['got']   = $p['size'] = $ok ? (int) filesize($to) : 0;
    $p['ended'] = time();
    $done = true;
    // The page may be reading the file just then: tried for a few seconds, or a whole file would read as stopped part way.
    for ($try = 0; $try < 20 && $open() && !xs_write_json($path, $p); $try++) {
        usleep(250000);
    }
    xs_log('CMPR', 'brought down ' . $p['ref'] . ': ' . ($ok ? round($p['size'] / 1048576, 1) . ' MB in ' . round(microtime(true) - $t0, 1) . 's' : 'failed, ' . $why));
    exit(0);
}

if ($mode !== 'look') {
    fwrite(STDERR, "look or fetch\n");
    exit(1);
}

$path = xs_mc_path($ticket, 'job.json');
$job  = xs_read_json($path, null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in that ticket\n");
    exit(1);
}
$job['pid'] = getmypid();
$save = static function () use (&$job, $path): void {
    // The compare closed: its folder is not made again for answers nobody will read.
    if (!is_file($path)) {
        return;
    }
    $job['beat'] = time();
    xs_write_json($path, $job);
};
$save();
register_shutdown_function(static function () use (&$job, $save): void {
    if (($job['state'] ?? '') !== 'running') {
        return;
    }
    foreach ($job['places'] as $k => $pl) {
        if ($k !== 'ss' && in_array($pl['state'], ['waiting', 'asking'], true)) {
            $job['places'][$k] = ['state' => 'failed', 'why' => 'the asking stopped on a fault: the log has it', 'items' => []] + $pl;
        }
    }
    $job['state'] = 'done';
    $save();
});

$g = xs_game((string) $job['id']);
foreach ($job['places'] as $key => $pl) {
    if ($key === 'ss' || $pl['state'] !== 'waiting') {
        continue;
    }
    if (!is_file($path)) {
        xs_log('CMPR', 'the compare closed before ' . XS_MC_PLACES[$key] . ' was asked (ticket ' . $ticket . ')');
        break;
    }
    $job['places'][$key]['state'] = 'asking';
    $save();
    $t0 = microtime(true);
    if ($g === null) {
        $r = ['state' => 'failed', 'why' => 'the game is not in the library any more', 'items' => []];
    } else {
        try {
            $r = xs_mc_ask($ticket, $g, (string) $key, (array) $pl['kinds']);
        } catch (\Throwable $e) {
            $r = ['state' => 'failed', 'why' => 'it stopped on a fault: ' . $e->getMessage(), 'items' => []];
            xs_log('CMPR', XS_MC_PLACES[$key] . ' fault at ' . basename($e->getFile()) . ':' . $e->getLine() . ': ' . $e->getMessage());
        }
    }
    $job['places'][$key] = $r + ['kinds' => $pl['kinds']];
    $save();
    xs_log('CMPR', ($g['title'] ?? $job['id']) . ': ' . XS_MC_PLACES[$key] . ' ' . ($r['state'] === 'done' ? 'has ' . count($r['items']) : $r['state'] . ', ' . $r['why'])
        . ' (' . round(microtime(true) - $t0, 1) . 's)');
}
$job['state'] = 'done';
$save();
