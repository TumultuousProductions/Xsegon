<?php
/**
 * /api/manual-place.php - where each game's manual was left, read by the
 * manual reader (js\reader.js), so a manual opens on the page it was closed on.
 *
 *   GET  ?id=<game id>&doc=<file>          {page, marks, one}: page 1 and no marks when never opened
 *   POST {"id", "doc", "page", "marks", "one"}   keep them; marks or one left out stay as kept
 *                                                (the phone's booklet sends the page alone, router-phone.php)
 *
 * One file of Xsegon's own, data\manual-places.json: game id => document file
 * => {page, marks (the pages bookmarked, at most XS_MARKS_MAX), one (one page
 * at a time, chosen on a wide screen), at}. Only a document the game has.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/extras.php';

/** A bookmark or two, and room to spare: the reader's bar shows them all. */
const XS_MARKS_MAX = 5;

$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$body = [];
if ($post) {
    xs_local_origin_only();
    $body = xs_body();
}
$id  = xs_id_or_fail($post ? ($body['id'] ?? '') : ($_GET['id'] ?? ''));
$doc = (string) ($post ? ($body['doc'] ?? '') : ($_GET['doc'] ?? ''));
if (!in_array($doc, array_column(xs_docs_for($id), 'file'), true)) {
    xs_fail('no such document for this game', 404);
}
$path = xs_data_path('manual-places.json');
$all  = xs_read_json($path, []);
if (!is_array($all)) {
    $all = [];
}
$have = is_array($all[$id][$doc] ?? null) ? $all[$id][$doc] : [];

if (!$post) {
    xs_json(['ok' => true, 'id' => $id, 'doc' => $doc, 'page' => max(1, (int) ($have['page'] ?? 1)),
             'marks' => array_values(array_map('intval', (array) ($have['marks'] ?? []))), 'one' => !empty($have['one'])]);
}

$page = $body['page'] ?? null;
if (!is_int($page) || $page < 1 || $page > 100000) {
    xs_fail('say the page: a whole number from 1', 400);
}
$marks = array_key_exists('marks', $body) ? $body['marks'] : array_map('intval', (array) ($have['marks'] ?? []));
if (!is_array($marks) || count($marks) > XS_MARKS_MAX) {
    xs_fail('a manual keeps up to ' . XS_MARKS_MAX . ' bookmarks', 409);
}
foreach ($marks as $m) {
    if (!is_int($m) || $m < 1 || $m > 100000) {
        xs_fail('a bookmark is a page number from 1', 400);
    }
}
$marks = array_values(array_unique($marks));
sort($marks);
$one = array_key_exists('one', $body) ? !empty($body['one']) : !empty($have['one']);

$was = $all[$id][$doc] ?? null;
$all[$id][$doc] = ['page' => $page, 'marks' => $marks, 'one' => $one, 'at' => time()];
xs_write_or_fail($path, $all, 'the place in the manual could not be kept: ');
// A bookmark or the page view changed is a line; turning pages alone is not, or every read would fill the log.
if (!is_array($was) || ($was['marks'] ?? []) !== $marks || !empty($was['one']) !== $one) {
    $game = xs_game($id);
    xs_log('DOC', 'kept for ' . ($game === null ? $id : (string) $game['title']) . ', ' . $doc . ': page ' . $page
        . ($marks ? ', bookmarks ' . implode(', ', $marks) : ', no bookmarks') . ($one ? ', one page at a time' : ''));
}
xs_json(['ok' => true, 'id' => $id, 'doc' => $doc, 'page' => $page, 'marks' => $marks, 'one' => $one]);
