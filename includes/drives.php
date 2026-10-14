<?php
/**
 * Xsegon - a drive that has stopped answering.
 *
 * A look at a hung drive (a share whose computer is off, a hung USB disk) waits half a
 * minute or more, and this server answers one request at a time, so everything waits.
 *
 * So a request's first look at a drive is announced in a temp file, removed once it
 * answers. An announcement over two seconds old means the drive is stuck: later requests
 * do not look, and show its games as they stand. bin\drive-wait.php waits on it and clears
 * the announcements once it answers. Only a stuck drive is kept across requests.
 */
declare(strict_types=1);

const XS_DRIVE_STUCK_S  = 2.0;       // an announced look this old is a drive holding someone up
const XS_DRIVE_WAITER_S = 180;       // a waiter not heard from for this long is gone: the drive is asked again

/** The drive a path is on, as its root: "E:\" or "\\host\share"; '' when the path names none. */
function xs_drive_of(string $path): string
{
    if (isset($path[1]) && $path[1] === ':') {
        return strtoupper($path[0]) . ':\\';
    }
    $p = str_replace('/', '\\', $path);
    if (!str_starts_with($p, '\\\\')) {
        return '';
    }
    return preg_match('/^(\\\\\\\\[^\\\\]+\\\\[^\\\\]+)/', $p, $m) ? $m[1] : '';
}

/** Where the announcements are kept: one folder per data folder, in the system's temp folder. Never in data\, where the fast lane writes nothing. */
function xs_drive_dir(): string
{
    static $dir = null;
    if ($dir === null) {
        $dir = rtrim(sys_get_temp_dir(), '\\/') . DIRECTORY_SEPARATOR . 'xsegon-drives-' . substr(md5(strtolower(xs_data_dir())), 0, 10);
    }
    return $dir;
}

/** The start of every file about one drive, in that folder. */
function xs_drive_stem(string $drive): string
{
    return substr(md5(strtolower($drive)), 0, 12);
}

/**
 * The drive this path is on when it is not answering, or null when it
 * answers (there or not) and the path may be looked at. Asked once a drive
 * in a request.
 */
function xs_drive_stuck(string $path): ?string
{
    static $said = [];
    static $own  = null;
    $drive = xs_drive_of($path);
    if ($drive === '') {
        return null;
    }
    $key = strtolower($drive);
    if (array_key_exists($key, $said)) {
        return $said[$key];
    }
    // The drives Xsegon itself runs from answer, or nothing here would be running.
    if ($own === null) {
        $own = array_flip(array_map('strtolower', array_filter([xs_drive_of(XS_ROOT), xs_drive_of(xs_data_dir()), xs_drive_of(sys_get_temp_dir())])));
    }
    if (isset($own[$key])) {
        return $said[$key] = null;
    }

    $dir  = xs_drive_dir();
    $stem = xs_drive_stem($drive);
    $now  = microtime(true);
    $held = 0.0;                         // how long the oldest announced look has waited
    foreach (@scandir($dir) ?: [] as $f) {
        if (str_starts_with($f, $stem . '-') && str_ends_with($f, '.look')) {
            $at = (float) @file_get_contents($dir . DIRECTORY_SEPARATOR . $f);
            $held = max($held, $now - ($at > 0 ? $at : (float) @filemtime($dir . DIRECTORY_SEPARATOR . $f)));
        }
    }
    if ($held >= XS_DRIVE_STUCK_S) {
        $wait  = $dir . DIRECTORY_SEPARATOR . $stem . '.wait';
        $heard = @filemtime($wait);
        if ($heard !== false && time() - $heard > XS_DRIVE_WAITER_S) {
            // Its waiter is gone, so nothing would ever say it is back: the announcements go, and it is asked as before.
            xs_drive_forget($drive);
            xs_log('DRIV', 'drive ' . $drive . ' was marked as not answering and its waiter is gone: it is asked again');
        } else {
            if ($heard === false) {
                xs_drive_wait($drive);
            }
            xs_log('DRIV', 'drive ' . $drive . ' has not answered a look for ' . round($held) . 's: what is on it is shown without being looked at');
            return $said[$key] = $drive;
        }
    }

    // The look, announced first. No announcement (the temp folder will not take one) is a look as it always was.
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    $mine = $dir . DIRECTORY_SEPARATOR . $stem . '-' . getmypid() . '.look';
    @file_put_contents($mine, (string) $now);
    $t = microtime(true);
    @is_dir($drive);
    $took = microtime(true) - $t;
    @unlink($mine);
    @rmdir($dir);                        // gone when nothing else is kept in it: a copy that is deleted leaves no folder behind
    if ($took >= XS_DRIVE_STUCK_S) {
        xs_log('DRIV', 'drive ' . $drive . ' took ' . round($took, 1) . 's to answer a look');
    }
    return $said[$key] = null;
}

/** Whether a file is there. Not asked when its drive is not answering: then nothing can say it is gone, and it counts as there. */
function xs_file_seen(string $file): bool
{
    return xs_drive_stuck($file) !== null || is_file($file);
}

/** Start the process that waits for a drive to answer again. One a drive: whoever makes its mark starts it. */
function xs_drive_wait(string $drive): void
{
    $dir  = xs_drive_dir();
    $wait = $dir . DIRECTORY_SEPARATOR . xs_drive_stem($drive) . '.wait';
    $h = @fopen($wait, 'x');
    if ($h === false) {
        return;                          // another request made it first
    }
    fclose($h);
    $script  = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'drive-wait.php';
    $command = 'start /B "" "' . xs_php_exe() . '" "' . $script . '" "' . rtrim($drive, '\\') . '" > NUL 2>&1';
    $p = @popen($command, 'r');
    if ($p === false) {
        @unlink($wait);
        xs_log('DRIV', 'the wait for drive ' . $drive . ' could not be started: it is asked again by the next request');
        xs_drive_forget($drive);
        return;
    }
    pclose($p);
}

/** Take away everything kept about one drive: it is asked again, as before. */
function xs_drive_forget(string $drive): void
{
    $dir  = xs_drive_dir();
    $stem = xs_drive_stem($drive);
    foreach (@scandir($dir) ?: [] as $f) {
        if (str_starts_with($f, $stem . '-') || $f === $stem . '.wait') {
            @unlink($dir . DIRECTORY_SEPARATOR . $f);
        }
    }
    @rmdir($dir);
}
