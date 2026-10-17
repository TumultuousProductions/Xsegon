<?php
/**
 * Xsegon - the worker behind Set up and Get on the Extensions page (includes\extensions.php),
 * run in the background.
 *
 *   php bin\extensions.php
 *
 * The plan is in data\extensions-job.json. Set up: the helper's release for this Flashpoint
 * from its own GitHub, checked against the size and SHA-256 the list gives, looked at by
 * Windows Defender, and its program put beside Flashpoint. Get: Flashpoint's own download from
 * its makers, checked against the SHA-256 their page publishes, looked at by Windows Defender
 * and unpacked into the folder chosen. Nothing half done is left behind.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/extensions.php';
require_once __DIR__ . '/../includes/fanmake.php';     // xs_fm_download, xs_fm_unpack
require_once __DIR__ . '/../includes/unpack.php';      // xs_unpack_defender_scan, xs_unpack_remove

set_time_limit(0);
$DS = DIRECTORY_SEPARATOR;

$job = xs_read_json(xs_ext_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\extensions-job.json\n");
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
    xs_write_json(xs_ext_job_path(), $job);
};
$save();

$get = ($job['action'] ?? '') === 'get';
// Flashpoint's download is a gigabyte: it waits on the drive it is going to, not in Xsegon's data folder.
$dl = $get ? dirname((string) $job['to']) . $DS . 'Flashpoint download.part' : xs_data_path('extensions.download');
$tmp = $get ? (string) $job['to'] . '.part' : xs_data_path('extensions-unpack');
register_shutdown_function(static function () use (&$job, $save, $dl, $tmp): void {
    @unlink($dl);
    @unlink($dl . '.err');
    if (is_dir($tmp)) {
        xs_unpack_remove($tmp);
    }
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $save();
    }
});
$name = (string) $job['name'];
$end = static function (string $state, string $words) use (&$job, $save, $name): void {
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    @unlink(xs_ext_stop_path());
    xs_log('EXTN', $name . ': ' . $state . ': ' . $words);
    exit(0);
};
$stopped = static fn (): bool => is_file(xs_ext_stop_path());
$t0 = microtime(true);

if (is_dir($tmp)) {
    xs_unpack_remove($tmp);
}
if ($get) {
    $free = (float) @disk_free_space(dirname((string) $job['to']));
    $want = (int) $job['size'] * 5;          // the download, and up to four times it unpacked
    if ($free > 0 && $free < $want) {
        $end('failed', 'there is not enough room on ' . dirname((string) $job['to']) . ': it needs about ' . round($want / 1073741824, 1) . ' GB free');
    }
}

// ---- fetched, and checked against the size and checksum its makers give ----
$job['phase'] = 'fetching';
$job['total'] = (int) $job['size'];
$save();
if (!xs_fm_download((string) $job['url'], $dl, static function (int $b) use (&$job, $save): void { $job['bytes'] = $b; $save(false); }, $stopped, $w)) {
    $end('failed', $w === 'stopped' ? 'stopped: nothing was kept' : (string) $w);
}
clearstatcache(true, $dl);
if ((int) filesize($dl) !== (int) $job['size']) {
    $end('failed', 'the download of ' . $job['file'] . ' came to ' . number_format((int) filesize($dl)) . ' bytes, and its makers give '
        . number_format((int) $job['size']) . ', so it was not used');
}
$job['phase'] = 'verifying';
$save();
if (hash_file('sha256', $dl) !== strtolower((string) $job['sha256'])) {
    $end('failed', $job['file'] . ' is not the file its makers list (its SHA-256 differs), so it was not used');
}
xs_log('EXTN', $name . ': fetched ' . $job['file'] . ' in ' . round(microtime(true) - $t0, 1) . 's, its size and SHA-256 as its makers give them');

$job['phase'] = 'checking';
$save();
$said = xs_unpack_defender_scan($dl, $what, static fn(): bool => !$stopped());
if ($said === 'stopped') {
    $end('failed', 'stopped: nothing was kept');
}
if ($said === 'found') {
    $end('failed', 'Windows Defender found ' . $what . ' in ' . $job['file'] . ', so it was not unpacked and nothing was kept');
}
xs_log('EXTN', $name . ': Windows Defender ' . ($said === 'clean' ? 'found nothing in ' . $job['file'] : 'is not here or would not say'));

// ---- unpacked, and put in place ----
$job['phase'] = 'unpacking';
$save();
if (!$get) {
    $exe = XS_FP_HELPER;
    if (!xs_fm_unpack($dl, $tmp, $w, false, ['bin/' . $exe])) {
        $end('failed', $job['file'] . ': ' . $w);
    }
    $job['phase'] = 'placing';
    $save();
    $to = (string) $job['root'] . $DS . $exe;
    if (is_file($to)) {
        $end('failed', 'a ' . $exe . ' is beside Flashpoint already, and Xsegon does not replace one it did not put there');
    }
    if (!@copy($tmp . $DS . 'bin' . $DS . $exe, $to)) {
        $end('failed', $exe . ' could not be put in ' . $job['root'] . ' (' . xs_file_error_reason() . ')');
    }
    $put = (array) (xs_ext_state()['flashpoint']['put'] ?? []);
    xs_ext_state_set('flashpoint', ['put' => ['helper' => (string) $job['tag'], 'helperAt' => $to, 'helperOn' => date('c')] + $put]);
    $end('done', $job['helper'] . ' ' . $job['tag'] . ' is beside Flashpoint: its games can be played from Xsegon');
}
if (!xs_fm_unpack($dl, $tmp, $w, true)) {
    $end('failed', $job['file'] . ': ' . $w);
}
@unlink($dl);
$job['phase'] = 'placing';
$save();
if (!@rename($tmp, (string) $job['to']) && !(is_dir((string) $job['to']) && !array_diff((array) @scandir((string) $job['to']), ['.', '..']) && @rmdir((string) $job['to']) && @rename($tmp, (string) $job['to']))) {
    $end('failed', 'it was unpacked but could not be moved to ' . $job['to'] . ' (' . xs_file_error_reason() . ')');
}
$put = (array) (xs_ext_state()['flashpoint']['put'] ?? []);
xs_ext_state_set('flashpoint', ['folder' => (string) $job['to'], 'put' => ['flashpoint' => (string) $job['to'], 'version' => (string) $job['version'], 'on' => date('c')] + $put]);
$end('done', 'Flashpoint ' . $job['version'] . ' is in ' . $job['to'] . ': open it once from the Extensions page, so it finishes setting itself up');
