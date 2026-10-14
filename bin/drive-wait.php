<?php
/**
 * Xsegon - wait for a drive that has stopped answering.
 *
 *     php bin\drive-wait.php E:            (or \\host\share)
 *     php bin\drive-wait.php E: 5          answered quickly for 5 seconds is enough (the tests)
 *
 * Started by a request that found a look at this drive announced and never
 * answered (includes\drives.php). Requests leave the drive alone while this
 * looks at it; once it has answered quickly for a minute, the announcements
 * are taken away. Its mark (<drive>.wait) is touched every turn: a stale mark
 * tells a request this process has died. It ends after six hours at most.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/drives.php';

$drive = xs_drive_of((string) ($argv[1] ?? '') . '\\');
$good  = max(1, (int) ($argv[2] ?? 60));
if ($drive === '') {
    fwrite(STDERR, "say which drive: E: or \\\\host\\share\n");
    exit(2);
}
$dir  = xs_drive_dir();
$stem = xs_drive_stem($drive);
$wait = $dir . DIRECTORY_SEPARATOR . $stem . '.wait';
$waiting = static function () use ($dir, $stem): bool {
    foreach (@scandir($dir) ?: [] as $f) {
        if (str_starts_with($f, $stem . '-') && str_ends_with($f, '.look')) {
            return true;
        }
    }
    return false;
};

$began = microtime(true);
$goodSince = null;
xs_log('DRIV', 'waiting for drive ' . $drive . ' to answer again (process ' . getmypid() . ')');
while (microtime(true) - $began < 6 * 3600) {
    @touch($wait);
    if (!$waiting()) {
        break;                           // taken away by hand, or by a request that found this process gone
    }
    $t = microtime(true);
    @is_dir($drive);
    $took = microtime(true) - $t;
    if ($took < 1.5) {
        $goodSince ??= microtime(true);
        if (microtime(true) - $goodSince >= $good) {
            xs_drive_forget($drive);
            xs_log('DRIV', 'drive ' . $drive . ' answers again, after ' . round(microtime(true) - $began) . 's: what is on it is looked at again');
            exit(0);
        }
    } else {
        // A slow answer is no answer: Windows gives a quick "not there" for a while after one, and then waits again.
        $goodSince = null;
    }
    sleep($good < 10 ? 1 : 5);
}
@unlink($wait);
