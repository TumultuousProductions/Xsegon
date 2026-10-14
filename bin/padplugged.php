<?php
/**
 * Xsegon - which game controllers Windows has plugged in, asked by a PHP of
 * a moment's life and printed as one line of JSON: {"pads": [...], "why": null}.
 *
 *   php -d extension=ffi -d ffi.enable=1 bin\padplugged.php
 *
 * Started by includes\padplugged.php (xs_pads_plugged_helper) for a server
 * that was started without what asking Windows needs. Reads only.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/padplugged.php';

$why  = null;
$pads = xs_pads_plugged($why);
echo json_encode(['pads' => $pads, 'why' => $why]);
