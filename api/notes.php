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
 * A game's versions are one game (includes\versions.php): one note, kept on
 * every version; notes written on versions apart are shown together.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/versions.php';

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
[$game, $ids] = xs_game_versions($id);

if (!$post) {
    // Each version's note, its own first; the same words twice are one note.
    $texts = [];
    $at = 0;
    foreach ($ids as $vid) {
        $have = is_array($all[$vid] ?? null) ? $all[$vid] : [];
        $t = (string) ($have['text'] ?? '');
        if (trim($t) !== '' && !in_array(trim($t), array_map('trim', $texts), true)) {
            $texts[] = $t;
            $at = max($at, (int) ($have['at'] ?? 0));
        }
    }
    if (count($texts) > 1) {
        xs_log('NOTE', xs_versions_said($game, $ids, $id) . ': ' . count($texts) . ' different notes on its versions, shown together;'
            . ' keeping the note writes it to every version');
    }
    xs_json(['ok' => true, 'id' => $id, 'text' => implode("\n\n", $texts), 'at' => $at]);
}

if (!is_string($body['text'] ?? null)) {
    xs_fail('say the note: text', 400);
}
$text = str_replace(["\r\n", "\r"], "\n", $body['text']);
if (mb_strlen($text) > XS_NOTE_MAX) {
    xs_fail('a note holds ' . number_format(XS_NOTE_MAX) . ' characters, and this is ' . number_format(mb_strlen($text)), 409);
}
$title = $game === null ? null : (string) $game['title'];
// Writing needs a game; taking a note away does not, so one left on a game since removed can still go.
if ($title === null && trim($text) !== '') {
    xs_fail('unknown game', 404);
}
$before = [];
$now = time();
foreach ($ids as $vid) {
    $before[] = $vid . ' ' . mb_strlen((string) ($all[$vid]['text'] ?? '')) . ' characters';
    if (trim($text) === '') {
        unset($all[$vid]);
    } else {
        $all[$vid] = ['text' => $text, 'at' => $now];
    }
}
xs_write_or_fail($path, $all, 'the note could not be kept: ');
xs_log('NOTE', (trim($text) === '' ? 'cleared for ' : 'kept for ') . xs_versions_said($game, $ids, $id)
    . (trim($text) === '' ? '' : ' (' . mb_strlen($text) . ' characters)')
    . (count($ids) > 1 ? ' on every version; before: ' . implode(', ', $before) : ''));
xs_json(['ok' => true, 'id' => $id, 'text' => trim($text) === '' ? '' : $text, 'at' => trim($text) === '' ? 0 : $now]);
