<?php
/**
 * What is left that copies LaunchBox's files, asked with no server
 * (tests\t-writes.js).
 *
 *     php tests\pull-probe.php <a stand-in LaunchBox folder>
 *
 * XSEGON_DATA names a data folder of the check's own, whose settings point at
 * that stand-in (a sound pack, a picture and a video for one game). Prints
 * which copying functions and files exist, the data folder's sounds and media
 * afterwards, and where the game's picture is shown from.
 */
declare(strict_types=1);

$root = $argv[2] ?? dirname(__DIR__);          // another copy of the code, for a before and after by hand
require_once $root . '/includes/import.php';
require_once $root . '/includes/media.php';
require_once $root . '/includes/sounds.php';

$lb = rtrim((string) ($argv[1] ?? ''), '\\/');

$under = static function (string $dir): array {
    $out = [];
    if (is_dir($dir)) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
            $out[] = str_replace('\\', '/', substr((string) $f, strlen($dir) + 1));
        }
    }
    return $out;
};

$game = ['id' => 'stand-in-1', 'platform' => 'Nintendo 64', 'key' => art_key('Stand In Game'), 'romPath' => null,
         'art' => ['box' => $lb . DIRECTORY_SEPARATOR . 'Images' . DIRECTORY_SEPARATOR . 'box.png']];
$shown = xs_apply_media_copy([$game]);

$tool = array_values(array_filter(['api/media.php', 'bin/media-copy.php'], static fn(string $f): bool => is_file($root . '/' . $f)));
foreach (['media_plan', 'media_holds', 'media_progress'] as $fn) {
    if (function_exists($fn)) {
        $tool[] = $fn;
    }
}

// An import from the stand-in: the game and its play data come in, its pictures do not.
$imp = xs_import();
$lib = xs_read_json(xs_library_path(), []);
$in  = ($lib['games'] ?? [])[0] ?? [];
require_once $root . '/includes/video.php';

echo json_encode(['copiers' => array_values(array_filter(['xs_pull_copies', 'xs_sounds_copy'], 'function_exists')),
                  'afterImport' => is_file($root . '/includes/pull.php'),
                  'soundsIn' => $under(xs_data_path('sounds')),
                  'copyTool' => $tool,
                  'shownFrom' => $shown[0]['art']['box'],
                  'made' => $under(media_dir()),
                  'imported' => [$imp['ok'] ?? false, $imp['games'] ?? 0, $in['title'] ?? null, $in['favourite'] ?? null, $in['playCount'] ?? null],
                  'importedArt' => array_values(array_filter($in['art'] ?? [])),
                  'packs' => array_keys(xs_sound_pack_dirs()),
                  'videoRoots' => video_roots(xs_settings())]), "\n";
