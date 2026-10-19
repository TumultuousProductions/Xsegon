<?php
/**
 * Xsegon - looks once for a newer Xsegon (includes\newversion.php), run in the
 * background as the page loads, at most once a day.
 *
 *   php bin\newversion.php
 *
 * What it found goes into data\newversion.json and, for a version not said
 * before, the mailbox. Prints the same as JSON.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/newversion.php';

set_time_limit(120);
echo json_encode(xs_newversion_check(), JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
