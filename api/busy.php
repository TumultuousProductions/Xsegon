<?php
/**
 * POST /api/busy.php {"check": "running.php", "ms": 4106} - the page's
 * still-alive check took seconds: bin\busy.ps1 logs what the PC is busy with,
 * as a BUSY line. With logging off nothing is started.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';

xs_post_only();
xs_local_origin_only();

$body  = xs_body();
$check = preg_replace('/[^a-z0-9.\-]/i', '', (string) ($body['check'] ?? ''));
$ms    = max(0, (int) ($body['ms'] ?? 0));

if (!xs_log_enabled()) {
    xs_json(['ok' => true, 'looked' => false, 'why' => 'logging is off']);
}
// A test copy's slow answers are not a choked PC: it looks only when a test asks.
if (xs_test_copy() && empty($body['look'])) {
    xs_json(['ok' => true, 'looked' => false, 'why' => 'a test copy']);
}

$command = xs_ps_call(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'busy.ps1', [
    'DataDir' => xs_data_dir(),
    'Why'     => ($check !== '' ? $check : 'a check') . ' took ' . $ms . ' ms',
    'Log'     => true,
]);
if (!xs_spawn_ps($command, ['hidden' => true])) {
    xs_log('BUSY', 'the look at what the PC is busy with could not be started');
    xs_json(['ok' => true, 'looked' => false, 'why' => 'could not be started']);
}
xs_json(['ok' => true, 'looked' => true]);
