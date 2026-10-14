<?php
/**
 * POST /api/import.php - bring a LaunchBox library in, or read it again.
 *
 *   {"folder": "<LaunchBox folder>"}   the one chosen in Games > Bring in a LaunchBox library: checked, read, and kept
 *   {}                                 the folder kept before, read again
 *
 * The same code bin\import.php runs from a terminal. Only the list of games
 * and the person's own play data come in; nothing of LaunchBox's is copied,
 * shown from its folder or written to it.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

xs_post_only();
xs_local_origin_only();

$s = xs_settings();
$folder = trim((string) (xs_body()['folder'] ?? ''));
if ($folder !== '') {
    $folder = rtrim(xs_norm_path($folder), '\\');
    if (!is_file(lb_data_dir($folder) . DIRECTORY_SEPARATOR . 'Platforms.xml')) {
        xs_fail('that folder is not a LaunchBox folder: it has no Data\Platforms.xml. Choose the folder LaunchBox.exe is in', 409);
    }
    $s['paths']['launchbox'] = $folder;
}

$report = xs_import($s);
if (($report['ok'] ?? false) && $folder !== '' && $folder !== xs_norm_path((string) (xs_settings()['paths']['launchbox'] ?? ''))) {
    xs_settings_save(['paths' => ['launchbox' => $folder]], $why);
    xs_log('IMP', 'LaunchBox library brought in from ' . $folder);
}
xs_json($report, ($report['ok'] ?? false) ? 200 : 500);
