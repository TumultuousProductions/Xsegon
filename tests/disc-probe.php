<?php
/**
 * xs_disc_info() over made-up files (tests\t-writes.js): argv[1] is a folder
 * the test filled, argv[2] a JSON list of file names. Prints one JSON object,
 * file name => what xs_disc_info says about a game launching that file.
 */
require __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/scan.php';

$dir = $argv[1];
$out = [];
foreach (json_decode($argv[2], true) as $name) {
    $out[$name] = xs_disc_info(['romPath' => $dir . DIRECTORY_SEPARATOR . $name], xs_settings());
}
echo json_encode($out);
