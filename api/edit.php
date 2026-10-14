<?php
/**
 * POST /api/edit.php  - edit one game's metadata, or take an edit back.
 *
 *   {"id": "...", "set":   {"title": "New name", "genre": "Racing"}}
 *   {"id": "...", "reset": ["genre"]}          back to the source's value
 *   {"id": "...", "reset": "all"}              every edit to this game
 *
 * Writes data\overrides.json and nothing else. A value the same as the
 * source's is not stored, so "edited" means changed. The source is LaunchBox
 * for an imported game and the file name for a scanned one (xs_override_source).
 * One bad field rejects the whole save.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

xs_post_only();

$body = xs_body();
$id   = xs_id_or_fail($body['id'] ?? '');

// The unoverlaid values to compare against, and where the game lives: only
// your own games are edited in place, not overlaid.
$source = xs_override_source($id, $origin);
if ($source === null) {
    if ($origin === 'own') {
        // One of your own games (includes\local.php): its record is the source.
        xs_json(['ok' => false, 'error' => 'edit this one from its own form: right-click > Edit Game', 'local' => true], 409);
    }
    xs_fail('unknown game', 404);
}

$overlay = xs_overrides();
$mine    = is_array($overlay[$id] ?? null) ? $overlay[$id] : [];

$reset = $body['reset'] ?? null;
if ($reset === 'all') {
    // "Reset all" is about the metadata; a Games Database match chosen by
    // hand (api\gamesdb.php) is not metadata and stays.
    $mine = isset($mine['dbId']) ? ['dbId' => $mine['dbId']] : [];
} elseif (is_array($reset)) {
    foreach ($reset as $field) {
        unset($mine[(string) $field]);
    }
}

$set = $body['set'] ?? [];
if (!is_array($set)) {
    xs_fail('set must be an object of field: value', 400);
}
foreach ($set as $field => $value) {
    $field = (string) $field;
    $clean = xs_override_clean($field, $value, $err);
    if ($err !== null) {
        xs_fail($err, 400);
    }
    $was = $source[$field] ?? null;
    $was = ($was === '' ? null : $was);
    if ($field === 'players' && (int) $was === 0) {
        $was = null;                            // LaunchBox's 0 is "nobody said", the same as blank
    }
    $same = is_float($clean) || is_float($was)
        ? ($clean !== null && $was !== null && abs((float) $clean - (float) $was) < 0.005) || ($clean === null && $was === null)
        : $clean === $was;
    if ($same) {
        unset($mine[$field]);                   // back to agreeing with the source
    } else {
        $mine[$field] = $clean;
    }
}

if ($mine) {
    $overlay[$id] = $mine;
} else {
    unset($overlay[$id]);
}

xs_write_or_fail(xs_overrides_path(), $overlay);

xs_log('EDIT', $id . ' set=' . implode(',', array_keys((array) ($body['set'] ?? []))) . ' reset=' . (is_array($reset) ? implode(',', $reset) : (string) $reset));
xs_json(['ok' => true, 'id' => $id, 'origin' => $origin, 'edited' => array_keys($mine)]);
