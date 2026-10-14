<?php
/**
 * Xsegon - the Skraper helper (doc\skraper.md): a staging script at
 * %USERPROFILE%\Skraper-xsegon that lets Skraper fetch videos for exactly the
 * games picked, with no ScreenScraper logins typed into Xsegon.
 *
 * build stages a stand-in for each picked game and points Skraper's settings
 * at them (backed up; no path into LaunchBox or the ROM drive is written),
 * check reads what arrived, restore puts Skraper's settings back. Each step
 * runs in bin\skraper.php in the background: the script asks this server's
 * own API, and a request cannot wait on itself.
 *
 * Without the helper folder none of this is offered. Tests reach a stand-in
 * through XSEGON_SKRAPER, never the real one.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';

/**
 * The steps the window may ask for. retry is the second go (the games Skraper
 * missed, asked under the names on the helper's own list) and tidy files what
 * it brought. The helper's other modes stay on the command line.
 */
const XS_SKR_MODES = ['build', 'check', 'restore', 'retry', 'tidy'];

/** The helper's folder, or '' where there is none. */
function xs_skr_dir(): string
{
    if (xs_test_copy()) {
        $t = (string) getenv('XSEGON_SKRAPER');
        return $t !== '' && is_dir($t) ? $t : '';
    }
    $home = (string) getenv('USERPROFILE');
    return $home !== '' && is_dir($home . '\\Skraper-xsegon') ? $home . '\\Skraper-xsegon' : '';
}

function xs_skr_script(): string
{
    $d = xs_skr_dir();
    return $d !== '' && is_file($d . '\\stage.js') ? $d . '\\stage.js' : '';
}

function xs_skr_here(): bool
{
    return xs_skr_script() !== '';
}

/** Skraper's own program, or '' when it is not installed where it was. */
function xs_skr_ui(): string
{
    if (xs_test_copy()) {
        return '';                                     // a test never opens the real Skraper
    }
    $exe = (string) getenv('USERPROFILE') . '\\Skraper\\SkraperUI.exe';
    return is_file($exe) ? $exe : '';
}

/** Whether Skraper's window is open: open, closed, or unknown when Windows will not say. */
function xs_skr_ui_open(): string
{
    if (xs_test_copy()) {
        return is_file(xs_skr_dir() . DIRECTORY_SEPARATOR . 'skraper-open') ? 'open' : 'closed';
    }
    $said = @shell_exec('tasklist /FI "IMAGENAME eq SkraperUI.exe" 2>NUL');
    if (!is_string($said) || trim($said) === '') {
        return 'unknown';
    }
    return stripos($said, 'SkraperUI.exe') !== false ? 'open' : 'closed';
}

/** Node runs the helper script. '' when it is not on this PC's PATH. */
function xs_skr_node(): string
{
    $said = @shell_exec('where node 2>NUL');
    $first = is_string($said) ? trim((string) strtok($said, "\r\n")) : '';
    return $first !== '' && is_file($first) ? $first : '';
}

function xs_skr_job_path(): string
{
    return xs_data_path('skraper-job.json');
}

/** The job as its runner left it, or null; a runner that is gone is said. */
function xs_skr_job(): ?array
{
    $job = xs_read_json(xs_skr_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_skr_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'the step stopped before it finished: ' . $dead;
    }
    return $job;
}

function xs_skr_running(): bool
{
    return (xs_skr_job()['state'] ?? '') === 'running';
}

/** Opens Skraper for the person to press Start in. The worker calls it once a build is done. */
function xs_skr_open_ui(?string &$why = null): bool
{
    $why = null;
    $exe = xs_skr_ui();
    if ($exe === '') {
        $why = xs_test_copy() ? 'Skraper is not opened on a test copy' : 'Skraper was not found at its usual place: open it yourself';
        return false;
    }
    if (xs_skr_ui_open() === 'open') {
        return true;
    }
    $h = @popen('start "" "' . $exe . '"', 'r');
    if ($h === false) {
        $why = 'Skraper would not open: open it yourself';
        return false;
    }
    pclose($h);
    return true;
}

/** Whether videos fetched under another name wait to be given their own: the helper's list of them is not empty. */
function xs_skr_second_waits(): bool
{
    $list = xs_read_json(xs_skr_dir() . DIRECTORY_SEPARATOR . 'second-go.json', null);
    return is_array($list) && $list !== [];
}

/** Starts one step: the picked ids written for build, the job written, the runner started and left. */
function xs_skr_ask(string $mode, array $ids, ?string &$why = null): bool
{
    $why = null;
    if (!xs_skr_here()) {
        $why = 'the Skraper helper is not on this PC';
        return false;
    }
    if (!in_array($mode, XS_SKR_MODES, true)) {
        $why = 'no such step';
        return false;
    }
    if (xs_skr_running()) {
        $why = 'a step is already running; wait for it';
        return false;
    }
    // A game staged under another name has its video under that name until it is filed:
    // with Skraper closed, reading what arrived is the step that files it.
    if ($mode === 'check' && xs_skr_second_waits() && xs_skr_ui_open() !== 'open') {
        $mode = 'tidy';
    }
    if ($mode === 'build') {
        $ids = array_values(array_filter(array_map('strval', $ids), static fn ($i) => $i !== ''));
        if (!$ids) {
            $why = 'no games are selected';
            return false;
        }
        if (!xs_write_json(xs_skr_dir() . DIRECTORY_SEPARATOR . 'pick.json', ['ids' => $ids, 'asked' => time()], $why)) {
            return false;
        }
    }
    $job = ['state' => 'running', 'mode' => $mode, 'games' => $mode === 'build' ? count($ids) : null,
            'started' => time(), 'said' => ''];
    if (!xs_write_json(xs_skr_job_path(), $job, $why)) {
        return false;
    }
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'skraper.php',
            '--server=http://127.0.0.1:' . (int) ($_SERVER['SERVER_PORT'] ?? 0)];
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        $why = 'the step could not be started';
        xs_write_json(xs_skr_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    pclose($h);
    xs_log('SKRP', 'asked for ' . $mode . ($mode === 'build' ? ' with ' . count($ids) . ' games picked' : ''));
    return true;
}

/** Everything the window shows: whether the helper and Skraper are here, and the step at work or how the last one ended. */
function xs_skr_status(): array
{
    if (!xs_skr_here()) {
        return ['here' => false];
    }
    return ['here' => true, 'skraper' => xs_skr_ui() !== '' || xs_test_copy() ? xs_skr_ui_open() : 'missing',
            'job' => xs_skr_job(), 'time' => time()];
}
