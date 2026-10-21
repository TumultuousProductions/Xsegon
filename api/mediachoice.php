<?php
/**
 * /api/mediachoice.php - one game's pictures, video or manual from every place, for the Media tab's
 * compare (includes\mediachoice.php, js\mediacompare.js).
 *
 *   GET  ?id=<id>&places=1                     the places that fit this game, by group, in the person's order
 *   GET  ?id=<id>&kind=<kind>[&only=<place>]   ask them: {ticket, places}; 'all' kinds with one place only
 *   GET  ?id=<id>&find=<kind>,<kind>           Find any: every place that is on, for these kinds, the first of each
 *   GET  ?ticket=<t>                           what has come: {places: {key: {state, why, items}}, prep, done}
 *   GET  ?ticket=<t>&file=<name>               a picture, video or manual brought down, to be seen
 *   POST {"ticket","ref","prepare":true}       bring a video or manual down to be seen and used
 *   POST {"ticket","ref","id","use":true,"how","doc","holder"}   use it; how "keep": a manual beside the others
 *   POST {"ticket","id","back":"<kind>","holder"}   put back what that kind was before the last press here
 *   POST {"ticket","done":true}                the compare closed: its folder goes
 *   POST ?id=<id>&doc=<name>&part=&of=         a PDF or picture of your own, one of the game's documents
 *
 * Nothing here asks a place itself: the server answers one request at a time, so the asking is
 * bin\mediachoice.php's and bin\screenscraper.ps1's, in the background.
 */
declare(strict_types=1);
require_once __DIR__ . '/../includes/mediachoice.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$ticket = (string) ($_GET['ticket'] ?? '');

/** A compare that is no longer on the server: 'gone' tells the page to stop asking it, unlike a failed read. */
function xs_mc_gone(): void
{
    xs_log('FAIL', '404 that compare has closed (mediachoice.php)');
    xs_json(['ok' => false, 'error' => 'that compare has closed; open it again', 'gone' => true], 404);
}

if (in_array($method, ['GET', 'HEAD'], true)) {
    if ($ticket !== '') {
        if (!xs_mc_ticket_ok($ticket)) {
            xs_mc_gone();
        }
        $file = (string) ($_GET['file'] ?? '');
        if ($file !== '') {
            $path = xs_mc_path($ticket, $file);
            // Only what is there to be seen: the ticket's own notes hold paths on the disk and addresses.
            if (!xs_mc_file_ok($file) || preg_match('/\.(json|tmp|part)$/i', $file) || !is_file($path)) {
                xs_fail('that file is not here (the compare may have closed)', 404);
            }
            $ext  = strtolower(pathinfo($file, PATHINFO_EXTENSION));
            $mime = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif',
                     'mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm', 'pdf' => 'application/pdf'][$ext]
                  ?? ((@getimagesize($path) ?: [])['mime'] ?? 'application/octet-stream');
            require_once __DIR__ . '/../includes/stream.php';
            xs_stream_file($path, $mime, 'no-store');
            exit;
        }
        $job = xs_mc_read($ticket);
        if ($job === null) {
            xs_mc_gone();
        }
        xs_mc_touch($ticket);
        xs_json(['ok' => true] + xs_mc_public($ticket, $job));
    }
    $id   = xs_id_or_fail($_GET['id'] ?? '');
    $game = xs_game_or_404($id);
    $s    = xs_settings();
    if (isset($_GET['places'])) {
        $out = [];
        foreach (['pictures' => 'box', 'videos' => 'video', 'manuals' => 'manual'] as $group => $kind) {
            $out[$group] = xs_mc_places($s, $game, $kind);
        }
        xs_json(['ok' => true, 'id' => $id, 'places' => $out]);
    }
    // Find any: every place that is on, for the kinds the game has none of.
    if (isset($_GET['find'])) {
        $find = array_values(array_unique(array_filter(explode(',', (string) $_GET['find']), 'strlen')));
        if (!$find || array_diff($find, xs_mc_kinds())) {
            xs_fail('find is a list of: ' . implode(', ', xs_mc_kinds()), 400);
        }
        $got = xs_mc_start($s, $game, 'find', '', $why, $find);
        if ($got === null) {
            xs_fail((string) $why, 500);
        }
        xs_json(['ok' => true, 'id' => $id, 'kind' => 'find', 'find' => $find, 'look' => $s['library']['look'] ?? new stdClass()] + $got);
    }
    $kind = (string) ($_GET['kind'] ?? '');
    $only = (string) ($_GET['only'] ?? '');
    if ($kind !== 'all' && !in_array($kind, xs_mc_kinds(), true)) {
        xs_fail('kind must be all or one of: ' . implode(', ', xs_mc_kinds()), 400);
    }
    if (($kind === 'all' && $only === '') || ($only !== '' && !isset(XS_MC_PLACES[$only]))) {
        xs_fail('everything a place has is asked of one place: only=' . implode('|', array_keys(XS_MC_PLACES)), 400);
    }
    $got = xs_mc_start($s, $game, $kind, $only, $why);
    if ($got === null) {
        xs_fail((string) $why, 500);
    }
    // Look in as it is saved, for the page to change one place and save the whole again.
    xs_json(['ok' => true, 'id' => $id, 'kind' => $kind, 'look' => $s['library']['look'] ?? new stdClass()] + $got);
}

xs_local_origin_only();

// A document of your own: pieces as a picture's are (api\art.php), checked whole as a PDF or a picture.
if (isset($_GET['doc'])) {
    $id   = xs_id_or_fail($_GET['id'] ?? '');
    $game = xs_game_or_404($id);
    $name = trim((string) preg_replace('/[^A-Za-z0-9 ,()._-]+/', ' ', (string) $_GET['doc']));
    $name = $name === '' ? 'Manual' : mb_substr($name, 0, 60);
    $dir  = xs_docs_dir() . DIRECTORY_SEPARATOR . $id;
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        xs_fail('could not create data\documents\\' . $id, 500);
    }
    $tmp = $dir . DIRECTORY_SEPARATOR . '.upload.part';
    xs_upload_piece($tmp, 200 * 1024 * 1024, 'that file is larger than 200 MB');
    $head = (string) @file_get_contents($tmp, false, null, 0, 1024);
    $info = @getimagesize($tmp);
    $ext  = str_contains($head, '%PDF-') ? 'pdf' : ([IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp', IMAGETYPE_GIF => 'gif'][$info[2] ?? 0] ?? '');
    // A folder made for this file goes again when it is refused: an empty one reads as the game having documents.
    if ($ext === '') {
        @unlink($tmp);
        @rmdir($dir);
        xs_log('CMPR', $game['title'] . ': a document of your own not kept: it is not a PDF or a picture');
        xs_fail('that file is not a PDF or a picture', 415);
    }
    if (($same = xs_mc_same_doc($id, $tmp)) !== null) {
        @unlink($tmp);
        @rmdir($dir);
        xs_log('CMPR', $game['title'] . ': a document of your own not kept: it has it already, as ' . $same);
        xs_fail('the game has this file already, as ' . $same, 409);
    }
    $have = array_column(xs_docs_for($id), 'file');
    $file = $name . '.' . $ext;
    for ($n = 2; xs_mc_name_taken($have, $file); $n++) {
        $file = $name . ' ' . $n . '.' . $ext;
    }
    if (!@rename($tmp, $dir . DIRECTORY_SEPARATOR . $file)) {
        @unlink($tmp);
        @rmdir($dir);
        xs_fail('the document could not be kept (' . xs_file_error_reason() . ')', 500);
    }
    xs_changed_note([$id], 'manual');
    xs_log('CMPR', $game['title'] . ': a document of your own kept as ' . $file . ' (' . round(filesize($dir . DIRECTORY_SEPARATOR . $file) / 1048576, 1) . ' MB)');
    xs_json(['ok' => true, 'id' => $id, 'doc' => $file]);
}

$body   = xs_body();
$ticket = (string) ($body['ticket'] ?? '');
if (!xs_mc_ticket_ok($ticket)) {
    xs_mc_gone();
}
if (!empty($body['done'])) {
    $gone = xs_mc_remove($ticket);
    if (!$gone) {
        xs_log('CMPR', 'a closed compare\'s folder could not all be removed yet (ticket ' . $ticket . '): the sweep takes the rest');
    }
    xs_json(['ok' => $gone]);
}
$job = xs_mc_read($ticket);
if ($job === null) {
    xs_mc_gone();
}
xs_mc_touch($ticket);
$ref = (string) ($body['ref'] ?? '');

if (!empty($body['prepare'])) {
    if (!xs_mc_prepare($ticket, $job, $ref, $why)) {
        xs_log('CMPR', 'could not bring down ' . $ref . ': ' . $why);
        xs_fail((string) $why, 409);
    }
    xs_json(['ok' => true] + xs_mc_public($ticket, xs_mc_read($ticket) ?? $job));
}

$id     = xs_id_or_fail($body['id'] ?? '');
$game   = xs_game_or_404($id);
// A compare changes only the game it was opened for, and its manuals only in that game's own folders.
if ($id !== (string) ($job['id'] ?? '')) {
    xs_log('CMPR', 'refused: a press for ' . $id . ' came to the compare of ' . ($job['id'] ?? '?') . ' (ticket ' . $ticket . ')');
    xs_fail('that compare is for another game; open it again', 409);
}
$holder = (string) ($body['holder'] ?? '') !== '' ? xs_id_or_fail($body['holder']) : $id;
if ($holder !== $id) {
    require_once __DIR__ . '/../includes/versions.php';
    if (!in_array($holder, (array) (xs_game_versions($id)[1] ?? []), true)) {
        xs_log('CMPR', 'refused: ' . $holder . ' is not one of the versions of ' . $id);
        xs_fail('that is not one of this game\'s versions', 400);
    }
}

if (isset($body['back'])) {
    $kind = (string) $body['back'];
    if (!in_array($kind, xs_mc_kinds(), true)) {
        xs_fail('back must be one of: ' . implode(', ', xs_mc_kinds()), 400);
    }
    $said = xs_mc_back($ticket, $game, $kind, $holder, $why);
    if ($said === null) {
        xs_log('CMPR', $game['title'] . ': ' . $kind . ' not put back: ' . $why);
        xs_fail((string) $why, 409);
    }
    xs_log('CMPR', $game['title'] . ': ' . $said);
    xs_json(['ok' => true, 'id' => $id, 'kind' => $kind]);
}

if (!empty($body['use'])) {
    $how  = (string) ($body['how'] ?? '') === 'keep' ? 'keep' : 'replace';
    $done = xs_mc_use($ticket, $job, $game, $ref, $how, (string) ($body['doc'] ?? ''), $holder, $why);
    if ($done === null) {
        xs_log('CMPR', $game['title'] . ': ' . $ref . ' not used: ' . $why);
        xs_fail((string) $why, 409);
    }
    xs_log('CMPR', $game['title'] . ': ' . $done['what']);
    xs_json(['ok' => true, 'id' => $id] + $done);
}

xs_fail('say prepare, use, back or done', 400);
