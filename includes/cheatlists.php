<?php
/**
 * Xsegon - the cheat lists, for a RetroArch that came without them.
 *
 * The RetroArch package has no cheat lists; they are libretro's cheats.zip (as Online
 * Updater > Update Cheats takes), kept in Xsegon's own folder, never in a person's
 * RetroArch, and read where RetroArch's own is missing or empty (includes\cheats.php).
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** Said in the asking windows: the .zip changes daily, so these are about. */
const XS_CL_ABOUT_MB = 35;
const XS_CL_DISK_MB  = 230;

/** Beside Xsegon's own RetroArch: left out of backups and of a test copy with it. */
function xs_cl_dir(): string
{
    return xs_data_path('emulators' . DIRECTORY_SEPARATOR . 'cheat-lists');
}

function xs_cl_job_path(): string
{
    return xs_data_path('cheatlists-job.json');
}

function xs_cl_stop_path(): string
{
    return xs_data_path('cheatlists-stop');
}

/** Whether a folder holds cheat lists: a console's folder in it. One RetroArch made empty does not. */
function xs_cl_has(string $dir): bool
{
    return $dir !== '' && is_dir($dir) && xs_glob($dir, '*', true) !== [];
}

/** Where the lists come from. A test points it at a stand-in of its own (XSEGON_CHEATLISTS). */
function xs_cl_source(): string
{
    $test = getenv('XSEGON_CHEATLISTS');
    return is_string($test) && $test !== '' && xs_test_copy() ? $test : 'https://buildbot.libretro.com/assets/frontend/cheats.zip';
}

/** The fetch as its worker left it, or null; a worker that is gone is said. */
function xs_cl_job(): ?array
{
    $job = xs_read_json(xs_cl_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_cl_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/** What the asking windows say: whether they are being fetched, from where, and into which folder. */
function xs_cl_view(): array
{
    return ['job' => xs_cl_job(), 'own' => xs_cl_has(xs_cl_dir()),
            'get' => ['url' => xs_cl_source(), 'dest' => xs_cl_dir(), 'mb' => XS_CL_ABOUT_MB, 'disk' => XS_CL_DISK_MB]];
}

/** Fetch the lists into Xsegon's own folder, in the background. */
function xs_cl_start(?string &$why = null): bool
{
    $why = null;
    if ((xs_cl_job()['state'] ?? '') === 'running') {
        $why = 'the cheat lists are being fetched already: that has to finish first';
        return false;
    }
    if (xs_curl_exe() === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on), and that is what fetches the cheat lists';
        return false;
    }
    $free = (float) @disk_free_space(xs_data_dir());
    $need = (XS_CL_ABOUT_MB + XS_CL_DISK_MB) * 1048576 * 1.2;
    if ($free > 0 && $free < $need) {
        $why = 'there is not enough room on the drive: the cheat lists need about ' . round($need / 1048576) . ' MB and there is '
             . round($free / 1048576) . ' MB free';
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'url' => xs_cl_source(),
            'bytes' => 0, 'total' => 0, 'at' => 0, 'files' => 0, 'said' => ''];
    @unlink(xs_cl_stop_path());
    if (!xs_write_json(xs_cl_job_path(), $job, $why)) {
        return false;
    }
    if (!xs_spawn_worker('cheatlists.php')) {
        $why = 'it could not be started';
        xs_write_json(xs_cl_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    xs_log('CHTL', 'asked to fetch the cheat lists from ' . $job['url'] . ' into ' . xs_cl_dir());
    return true;
}

/** A folder and all in it, gone. Only ever a folder of the lists' own, under data\emulators. */
function xs_cl_wipe(string $dir): bool
{
    $base = xs_data_path('emulators') . DIRECTORY_SEPARATOR . 'cheat-lists';
    if (strncasecmp($dir, $base, strlen($base)) !== 0 || !is_dir($dir)) {
        return !is_dir($dir);
    }
    foreach ((array) scandir($dir) as $f) {
        if ($f === '.' || $f === '..' || !is_string($f)) {
            continue;
        }
        $p = $dir . DIRECTORY_SEPARATOR . $f;
        is_dir($p) ? xs_cl_wipe($p) : @unlink($p);
    }
    return @rmdir($dir);
}
