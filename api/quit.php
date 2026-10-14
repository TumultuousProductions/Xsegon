<?php
/**
 * POST /api/quit.php - ask the running game to quit.
 *
 * RetroArch's Network Control Interface takes a QUIT over UDP, and
 * retroarch.exe itself sends one with `--command QUIT`: no UDP code here.
 *
 * It needs network_cmd_enable = "true" in retroarch.cfg. That is your
 * RetroArch config, so this reports which line to change rather than edit it.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/retroarch.php';

xs_post_only();

// Only RetroArch can be asked, not a Steam game or a program of your own.
$now = xs_game_running();
if (is_array($now) && ($now['kind'] ?? 'retroarch') !== 'retroarch' && ($now['kind'] ?? '') !== '') {
    xs_fail(($now['title'] ?? 'this game') . ' is not a RetroArch game, so Xsegon cannot quit it: quit it from inside the game', 409);
}

$caps = ra_capabilities(xs_library());

if ($caps['exe'] === null) {
    xs_fail('could not find retroarch.exe next to the emulator in use', 409);
}

if (!$caps['canQuit']) {
    // Said in the log too, with the reason.
    xs_log('FAIL', '409 ' . (is_array($now) ? ($now['title'] ?? 'the game') : 'the game') . ' was not asked to quit: RetroArch network commands are off in '
        . ($caps['config'] ?? 'retroarch.cfg') . ' (quit.php)');
    xs_json([
        'ok'      => false,
        'needs'   => 'network_cmd_enable',
        'error'   => 'RetroArch network commands are disabled',
        'detail'  => 'Set network_cmd_enable = "true" in ' . ($caps['config'] ?? 'retroarch.cfg')
                   . ' (or Settings > Network > Network Commands), then restart RetroArch.',
    ], 409);
}

$port = (string) ($caps['flags']['network_cmd_port'] ?? '55355');
// The port is the person's real RetroArch, so the test server never sends
// to it: a QUIT from a test would end whatever they are playing (xs_test_copy).
if (xs_test_copy()) {
    xs_json(['ok' => true, 'sent' => 'QUIT', 'port' => $port, 'dry' => true]);
}
$cmd  = 'start /B "" "' . $caps['exe'] . '" --command "QUIT;localhost;' . $port . '"';

$handle = popen($cmd, 'r');
if ($handle === false) {
    xs_fail('could not send the quit command', 500);
}
pclose($handle);

xs_json(['ok' => true, 'sent' => 'QUIT', 'port' => $port]);
