<?php
// Used by tests\t-report.js: the sittings read off a folder of day logs, and
// what Windows lists as plugged in, as includes\sittings.php and
// includes\padplugged.php answer them.
//   php [-d extension=ffi -d ffi.enable=1] sittings-probe.php <folder of YYYY-MM-DD.log files>
declare(strict_types=1);
require __DIR__ . '/../includes/sittings.php';
require __DIR__ . '/../includes/padplugged.php';

$files = [];
foreach (glob(($argv[1] ?? '') . '/*.log') ?: [] as $p) {
    $files[basename($p, '.log')] = $p;
}
$sittings = xs_sittings($files);
$why  = null;
$pads = xs_pads_plugged($why);
echo json_encode(['sittings' => $sittings, 'text' => xs_sittings_text($sittings), 'none' => xs_sittings_text([]),
                  'seen' => xs_sittings_pads($files), 'ffi' => extension_loaded('FFI'), 'pads' => $pads,
                  'words' => xs_pads_plugged_words($pads, $why)]);
