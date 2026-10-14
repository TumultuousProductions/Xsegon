<?php
/**
 * GET  /api/jobs.php                 the background jobs at work or just ended,
 *                                    one row each, for the corner bars
 *                                    (js\jobbars.js).
 * POST /api/jobs.php {"stop": key}   asks one to stop, the way its own window
 *                                    does; refused for a job with no stop.
 *
 * Reads only, but for that one touch. Each job's own door (api\steamvid.php
 * and the rest) still starts it and still tells its own window everything.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/jobs.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    $key = (string) (xs_body()['stop'] ?? '');
    if ($key === '' || !xs_jobs_stop($key)) {
        xs_fail('that job cannot be stopped from here', 400);
    }
    xs_json(['ok' => true, 'stopping' => $key]);
}

xs_json(['ok' => true, 'jobs' => xs_jobs()]);
