<?php
/**
 * /api/getmedia.php - what the Get Media window counts (js\getmedia.js).
 *
 *   GET    {games, noCover, noVideo, steam, steamNoVideo, noManual}
 *
 * The games with no cover, the games with no video, and the Steam games among
 * them, asked the way the library list asks (api\library.php), so the window and
 * the list cannot disagree. noManual: the games with no manual, versions of one
 * game counted once, as Manuals from online archives counts them (includes\archivedoc.php).
 * One read of the library; nothing is fetched or written.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';
require_once __DIR__ . '/../includes/archivedoc.php';

$s     = xs_settings();
$lib   = xs_library();
$games = $lib['games'] ?? [];
$out   = ['ok' => true, 'games' => count($games), 'noCover' => 0, 'noVideo' => 0, 'steam' => 0, 'steamNoVideo' => 0,
          'noManual' => count(xs_ma_need($lib))];
foreach ($games as $g) {
    $steam = !empty($g['steam']);
    $out['noCover'] += ($g['art']['box'] ?? null) === null ? 1 : 0;
    $out['steam']   += $steam ? 1 : 0;
    if (video_for_game($s, $g) === null) {
        $out['noVideo']++;
        $out['steamNoVideo'] += $steam ? 1 : 0;
    }
}
xs_json($out);
