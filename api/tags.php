<?php
/**
 * Tags of your own (includes\tags.php says what they are).
 *
 *   GET                              every tag, with how many games carry it
 *   POST {"id": "...", "add": "Couch"}      put a tag on one game
 *   POST {"id": "...", "remove": "Couch"}   take it off again
 *
 * Both POSTs answer with the game's tags and the whole list as they now
 * stand. Written to data\tags.json. "needs fix" is the NEEDS FIX mark itself,
 * so it is written as your word on the mark (data\fix-marks.json) instead.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/tags.php';
require_once __DIR__ . '/../includes/needsfix.php';

$map = xs_tags_read();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    xs_json(['ok' => true, 'tags' => xs_tags_all(xs_tags_effective($map, xs_needs_fix()))]);
}

$body = xs_body();
$id   = xs_id_or_fail($body['id'] ?? '');
$adding = array_key_exists('add', $body);
if (!$adding && !array_key_exists('remove', $body)) {
    xs_fail('say add or remove', 400);
}

// Only a game that is in the library can carry a tag: a typo in an id would
// otherwise leave a tag on nothing, counted in the list and never shown.
$game = xs_game_or_404($id, 'no game with that id');

$name = xs_tag_clean((string) ($adding ? $body['add'] : $body['remove']), $why);
if ($name === null) {
    xs_fail((string) $why, 400);
}

$mine = $map[$id] ?? [];
$key  = mb_strtolower($name);
$has  = array_values(array_filter($mine, static fn($t) => mb_strtolower($t) === $key));

// The tag and the answer as they stand now, "needs fix" being the mark.
$answer = static function (array $map) use ($id): never {
    $fix = xs_needs_fix();
    $shown = xs_tags_effective($map, $fix);
    xs_json(['ok' => true, 'id' => $id, 'tags' => $shown[$id] ?? [], 'all' => xs_tags_all($shown), 'needsFix' => $fix[$id] ?? null]);
};

if ($key === XS_TAG_NEEDS_FIX) {
    if (!xs_fix_mark($id, $adding, $why)) {
        xs_fail('could not save that: ' . (string) $why, 500);
    }
    xs_log('TAG', ($adding ? 'marked ' : 'unmarked ') . ($game['title'] ?? $id) . ' needs fix (the "needs fix" tag)');
    $answer($map);
}

if ($adding) {
    if (!$has) {
        if (count($mine) >= XS_TAGS_PER_GAME) {
            xs_fail('a game can carry at most ' . XS_TAGS_PER_GAME . ' tags', 400);
        }
        $name = xs_tag_spelling($map, $name);
        $mine[] = $name;
        usort($mine, 'strnatcasecmp');
    }
} else {
    $mine = array_values(array_filter($mine, static fn($t) => mb_strtolower($t) !== $key));
}
$map[$id] = $mine;

if (!xs_tags_write($map, $why)) {
    xs_fail((string) $why, 500);
}
xs_log('TAG', ($adding ? 'add ' : 'remove ') . '"' . ($has && !$adding ? $has[0] : $name) . '" '
            . ($adding ? 'to ' : 'from ') . ($game['title'] ?? $id));

$answer(array_filter($map));
