<?php
/**
 * Xsegon - the worker that fetches the cheat lists (includes\cheatlists.php),
 * run in the background.
 *
 *   php bin\cheatlists.php
 *
 * The plan is in data\cheatlists-job.json. The .zip is unpacked beside the
 * lists folder and replaces it only when all of it is in. Only
 * <console>\<game>.cht is taken from it.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/cheatlists.php';
require_once __DIR__ . '/../includes/zipstore.php';

set_time_limit(0);
ini_set('memory_limit', '512M');

$job = xs_read_json(xs_cl_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\cheatlists-job.json\n");
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
    xs_write_json(xs_cl_job_path(), $job);
};
$save();

$dest  = xs_cl_dir();
$stage = $dest . '.new';
$old   = $dest . '.old';
$part  = $dest . '.download';
register_shutdown_function(static function () use (&$job, $save, $part): void {
    @unlink($part);
    @unlink($part . '.err');
    @unlink($part . '.head');
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $save();
    }
});
$stopped = static fn (): bool => is_file(xs_cl_stop_path());
$end = static function (string $state, string $words) use (&$job, $save): void {
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    @unlink(xs_cl_stop_path());
    xs_log('CHTL', $state === 'stopped' ? $words : $state . ': ' . $words);
    exit(0);
};
$curl = xs_curl_exe();
if ($curl === '') {
    $end('failed', 'Windows\' own curl.exe is not on this PC, and that is what fetches the cheat lists');
}
if (!is_dir(dirname($dest)) && !@mkdir(dirname($dest), 0777, true)) {
    $end('failed', 'the folder ' . dirname($dest) . ' could not be made');
}
$url = (string) ($job['url'] ?? xs_cl_source());
$t0  = microtime(true);

// ---- how big it is, so the bar has an end: the server's own word, asked first ----
$quiet = [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', 'NUL', 'w']];
$proc = @proc_open([$curl, '-L', '--silent', '--head', '--max-time', '20', '-A', 'Xsegon', '-o', $part . '.head', $url], $quiet, $pipes, null, null, ['bypass_shell' => true]);
if (is_resource($proc)) {
    proc_close($proc);
    if (preg_match_all('/^content-length:\s*(\d+)/mi', (string) @file_get_contents($part . '.head'), $m)) {
        $job['total'] = (int) end($m[1]);
    }
    @unlink($part . '.head');
}

// ---- the .zip itself -----------------------------------------------------------
$job['phase'] = 'fetching';
$save();
@unlink($part);
// Given up only when nothing comes for a minute: no limit on the whole of it.
$proc = @proc_open([$curl, '-L', '--fail', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20',
                    '--speed-limit', '1024', '--speed-time', '60', '-A', 'Xsegon', '-o', $part, $url],
    [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $part . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
if (!is_resource($proc)) {
    $end('failed', 'curl.exe could not be started');
}
while (true) {
    $st = proc_get_status($proc);
    clearstatcache(true, $part);
    $job['bytes'] = (int) @filesize($part);
    $save(false);
    if (!$st['running']) {
        break;
    }
    if ($stopped()) {
        proc_terminate($proc);
        proc_close($proc);
        $end('stopped', 'stopped: the cheat lists were not fetched');
    }
    usleep(100000);
}
proc_close($proc);
$lines = preg_split('/\R/', trim((string) @file_get_contents($part . '.err'))) ?: [''];
@unlink($part . '.err');
clearstatcache(true, $part);
if ((int) $st['exitcode'] !== 0 || !is_file($part) || (int) filesize($part) === 0) {
    $said = trim((string) end($lines));
    $end('failed', 'the cheat lists could not be fetched (is the internet there?): ' . ($said !== '' ? mb_substr($said, 0, 200) : 'curl ended with ' . (int) $st['exitcode']));
}
$job['bytes'] = (int) filesize($part);
$tFetch = microtime(true);

// ---- what is in it: a console's folder, and a game's .cht in that -----------------
$list = xs_zs_list($part);
$take = [];
$left = 0;                          // what the .zip holds that is no cheat list
foreach ($list ?? [] as $name => $e) {
    $bits = explode('/', (string) $name);
    $ok = count($bits) === 2 && strtolower((string) pathinfo($bits[1], PATHINFO_EXTENSION)) === 'cht';
    foreach ($bits as $b) {
        // A name Windows cannot keep, or one that would leave the folder, is not taken.
        $ok = $ok && $b !== '' && $b !== '.' && $b !== '..' && !preg_match('/[<>:"|?*\\\\\x00-\x1f]|[ .]$/', $b);
    }
    if ($ok) {
        $take[$name] = $e;
    } else {
        $left++;
    }
}
if (!$take) {
    $end('failed', $list === null ? 'what came is not a .zip: the lists were not changed' : 'the .zip holds no cheat list: the lists were not changed');
}
$job['files'] = count($take);
$job['phase'] = 'unpacking';
$save();
if (!xs_cl_wipe($stage) || !@mkdir($stage, 0777, true)) {
    $end('failed', 'the folder ' . $stage . ' could not be made ready');
}
$made = [];
$bad  = 0;
foreach ($take as $name => $e) {
    if ($stopped()) {
        xs_cl_wipe($stage);
        $end('stopped', 'stopped: the cheat lists were not put in place');
    }
    [$folder, $file] = explode('/', (string) $name);
    $dir = $stage . DIRECTORY_SEPARATOR . $folder;
    if (!isset($made[$folder])) {
        if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
            xs_cl_wipe($stage);
            $end('failed', 'the folder ' . $dir . ' could not be made (' . xs_file_error_reason() . ')');
        }
        $made[$folder] = true;
    }
    $bytes = xs_zs_bytes($part, $e);
    if ($bytes === null || @file_put_contents($dir . DIRECTORY_SEPARATOR . $file, $bytes) === false) {
        $bad++;
        // One or two that will not unpack are left out; a disk that takes nothing ends it.
        if ($bad > 50) {
            xs_cl_wipe($stage);
            $end('failed', 'the cheat lists could not be written to ' . $stage . ' (is the drive full?)');
        }
    }
    $job['at']++;
    $save(false);
}
@unlink($part);
$got = count($take) - $bad;
if ($got === 0) {
    xs_cl_wipe($stage);
    $end('failed', 'none of the cheat lists could be unpacked: the lists were not changed');
}

// ---- in place of the lists that were here, now that all of it is in ----------------
xs_cl_wipe($old);
if (is_dir($dest) && !@rename($dest, $old)) {
    xs_cl_wipe($stage);
    $end('failed', 'the cheat lists already here could not be moved aside (' . xs_file_error_reason() . '): they are as they were');
}
if (!@rename($stage, $dest)) {
    $why = xs_file_error_reason();
    if (is_dir($old)) {
        @rename($old, $dest);
    }
    xs_cl_wipe($stage);
    $end('failed', 'the cheat lists could not be put in place (' . $why . ')');
}
xs_cl_wipe($old);
$job['seconds'] = (int) round(microtime(true) - $t0);
xs_log('CHTL', 'fetched ' . round($job['bytes'] / 1048576, 1) . ' MB in ' . round($tFetch - $t0, 1) . 's, unpacked ' . $got . ' cheat files for '
    . count($made) . ' consoles in ' . round(microtime(true) - $tFetch, 1) . 's' . ($bad ? ', ' . $bad . ' would not unpack' : '')
    . ($left ? ', ' . $left . ' other files in the .zip left out' : ''));
$end('done', 'The cheat lists are in: ' . number_format($got) . ' cheat ' . ($got === 1 ? 'file' : 'files') . ' for ' . count($made)
    . ' ' . (count($made) === 1 ? 'console' : 'consoles') . '. A game that plays on RetroArch has them on the Cheats tab of its details.');
