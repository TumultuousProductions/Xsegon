<?php
/**
 * A drive that has stopped answering, asked with no server (tests\t-writes.js
 * and by hand). XSEGON_DATA names a data folder of the check's own.
 *
 *     php tests\drive-probe.php where <path>     the announcements' folder and this drive's file stem
 *     php tests\drive-probe.php stuck <path>     is its drive held to be not answering, and how long asking took
 *     php tests\drive-probe.php games            the scanned games as the library reads them, and how long it took
 *     php tests\drive-probe.php alone            the same with every drive left alone (the status check), and the looks made
 */
declare(strict_types=1);

$root = getenv('XS_PROBE_ROOT') ?: dirname(__DIR__);     // another copy of the code, for a before and after by hand
require_once $root . '/includes/scan.php';
require_once $root . '/includes/drives.php';

$mode = (string) ($argv[1] ?? '');
$path = (string) ($argv[2] ?? '');
$t = microtime(true);
if ($mode === 'where') {
    $out = ['dir' => xs_drive_dir(), 'stem' => xs_drive_stem(xs_drive_of($path)), 'drive' => xs_drive_of($path)];
} elseif ($mode === 'stuck') {
    $out = ['stuck' => xs_drive_stuck($path), 'seen' => xs_file_seen($path)];
} elseif ($mode === 'alone') {
    // Every drive left alone, as the status check reads the library: the games, and every look made at a drive.
    xs_drives_alone(true);
    $out = ['games' => array_map(static fn(array $g): array => [$g['title'], $g['launchError'], $g['launch'] !== null], xs_scanned_games()),
            'looks' => array_map(static fn(array $l): int => $l[0], $GLOBALS['xs_looks'])];
} else {
    $out = ['games' => array_map(static fn(array $g): array => [$g['title'], $g['launchError'], $g['launch'] !== null], xs_scanned_games())];
}
echo json_encode($out + ['ms' => (int) round((microtime(true) - $t) * 1000)]), "\n";
