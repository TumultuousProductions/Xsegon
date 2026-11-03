<?php
// Used by tests\t-api.js: whether a process is alive and can be the worker
// started at <since>, as includes\boot.php answers it, what Windows said when
// asked directly, and how long the whole answer took.
//   php [-d extension=ffi -d ffi.enable=1] pid-probe.php <pid> <since>
declare(strict_types=1);
require __DIR__ . '/../includes/boot.php';
$pid = (int) ($argv[1] ?? 0);
$t = microtime(true);
$alive = xs_pid_alive($pid, (int) ($argv[2] ?? 0));
$ms = (int) round((microtime(true) - $t) * 1000);
echo json_encode(['ffi' => extension_loaded('FFI'), 'born' => xs_pid_born($pid), 'running' => xs_pid_running($pid), 'alive' => $alive, 'ms' => $ms]);
