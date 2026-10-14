<?php
/**
 * GET /api/lane.php - which server this is, for the fast lane's checks
 * (router-fast.php, includes\fastlane.php).
 *
 * The main server asks the port above it whether that is its own fast lane
 * (the id is the folder, hashed), not another program or another Xsegon.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';

xs_json([
    'ok'   => true,
    'app'  => 'xsegon',
    'lane' => xs_fast_lane() ? 'fast' : 'main',
    'id'   => md5(strtolower(dirname(__DIR__))),
    'pid'  => getmypid(),
]);
