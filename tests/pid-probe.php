<?php
// Used by tests\t-api.js: whether a process is alive and can be the worker
// started at <since>, as includes\boot.php answers it.
//   php [-d extension=ffi -d ffi.enable=1] pid-probe.php <pid> <since>
declare(strict_types=1);
require __DIR__ . '/../includes/boot.php';
$pid = (int) ($argv[1] ?? 0);
echo json_encode(['ffi' => extension_loaded('FFI'), 'born' => xs_pid_born($pid), 'alive' => xs_pid_alive($pid, (int) ($argv[2] ?? 0))]);
