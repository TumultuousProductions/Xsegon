<?php
/**
 * /api/notes.php - your own notes on a game: anything worth remembering about
 * it, written in the Notes tab of its details (js\notestab.js).
 *
 *   GET  ?id=<game id>                 the note kept for that game, '' when none
 *   POST {"id": "...", "text": "..."}  keep it; an empty one takes the note away
 *
 * One file of Xsegon's own, data\notes.json, game id => {text, at}: nothing
 * of the imported library's is written. The words are kept exactly as typed.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

/** Longer than any note, and short enough that the file stays small. */
const XS_NOTE_MAX = 20000;

$post = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
$body = [];
if ($post) {
    xs_local_origin_only();
    $body = xs_body();
}
$id = xs_id_or_fail($post ? ($body['id'] ?? '') : ($_GET['id'] ?? ''));
$path = xs_data_path('notes.json');
$all  = xs_read_json($path, []);
if (!is_array($all)) {
    $all = [];
}

if (!$post) {
    $have = is_array($all[$id] ?? null) ? $all[$id] : [];
    xs_json(['ok' => true, 'id' => $id, 'text' => (string) ($have['text'] ?? ''), 'at' => (int) ($have['at'] ?? 0)]);
}

if (!is_string($body['text'] ?? null)) {
    xs_fail('say the note: text', 400);
}
$text = str_replace(["\r\n", "\r"], "\n", $body['text']);
if (mb_strlen($text) > XS_NOTE_MAX) {
    xs_fail('a note holds ' . number_format(XS_NOTE_MAX) . ' characters, and this is ' . number_format(mb_strlen($text)), 409);
}
$game  = xs_game($id);
$title = $game === null ? null : (string) $game['title'];
// Writing needs a game; taking a note away does not, so one left on a game since removed can still go.
if ($title === null && trim($text) !== '') {
    xs_fail('unknown game', 404);
}
if (trim($text) === '') {
    unset($all[$id]);
} else {
    $all[$id] = ['text' => $text, 'at' => time()];
}
xs_write_or_fail($path, $all, 'the note could not be kept: ');
xs_log('NOTE', trim($text) === '' ? 'cleared for ' . ($title ?? $id) : 'kept for ' . $title . ' (' . mb_strlen($text) . ' characters)');
xs_json(['ok' => true, 'id' => $id, 'text' => trim($text) === '' ? '' : $text, 'at' => trim($text) === '' ? 0 : $all[$id]['at']]);
