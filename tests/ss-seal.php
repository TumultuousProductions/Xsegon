<?php
/**
 * The file Xsegon's website serves as its own ScreenScraper developer ID, for
 * the screenscraper group's stand-in:
 *
 *   php tests\ss-seal.php < {"devid": "...", "devpassword": "..."}
 *
 * Sealed by includes\screenscraper.php itself and printed; nothing written.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/screenscraper.php';

$dev = json_decode((string) stream_get_contents(STDIN), true);
if (!is_array($dev) || !is_string($dev['devid'] ?? null) || !is_string($dev['devpassword'] ?? null)) {
    fwrite(STDERR, "give {\"devid\": ..., \"devpassword\": ...} on standard input\n");
    exit(2);
}
echo xs_ss_site_file($dev);
