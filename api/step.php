<?php
/**
 * GET /api/step.php - how far the main server is through the request it is on.
 *
 * The main server answers one request at a time, so the work writes its
 * progress down (xs_step, includes\boot.php) and the fast lane reads it out
 * here. Asked of the main server it would wait its turn and say nothing.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';

xs_json(['ok' => true, 'step' => xs_step_read()]);
