<?php
// Used by tests\t-menus.js: the hotkeys of one RetroArch settings file, as
// includes\rahotkeys.php reads them, with any override files laid over it.
//   php hotkeys-probe.php <retroarch.cfg> [<override.cfg> ...]
//   php hotkeys-probe.php --ids                 every hotkey the table knows
//   php hotkeys-probe.php --kept <retroarch.cfg>   the keys kept off the buttons
declare(strict_types=1);
require __DIR__ . '/../includes/rahotkeys.php';
if (($argv[1] ?? '') === '--ids') {
    echo json_encode(array_keys(xs_ra_hotkey_table()));
    exit;
}
if (($argv[1] ?? '') === '--kept') {
    require __DIR__ . '/../includes/padmap.php';
    echo json_encode((object) xs_ra_hotkey_keys(xs_ra_read_keys((string) $argv[2])));
    exit;
}
echo json_encode(xs_ra_hotkeys((string) $argv[1], array_slice($argv, 2)));
