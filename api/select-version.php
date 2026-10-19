<?php
/**
 * POST /api/select-version.php  {id, selected}  - which version of a game plays.
 *
 * A card holding several versions asks at Play which file to start; one
 * selected in its Versions tab rides the card as 'chosen' and starts without
 * asking. Kept in data\selected-versions.json, keyed as the roll-up groups
 * (console and title, case aside), whichever file leads the card.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/versions.php';

xs_post_only();

$body     = xs_body();
$id       = xs_id_or_fail($body['id'] ?? '');
$selected = $body['selected'] ?? null;

if (!is_bool($selected)) {
    xs_fail('selected must be true or false', 400);
}

$path    = xs_data_path('selected-versions.json');
$overlay = xs_read_json($path, []);
if (!is_array($overlay)) {
    $overlay = [];
}

// Selecting needs the game; deselecting does not, so a selection left on a
// game since removed can still go, by the id the entry holds.
$g = xs_game($id);
if ($g === null && $selected) {
    xs_fail('unknown game', 404);
}
if ($g !== null) {
    $key = xs_version_key($g);
    if ($selected) {
        $overlay[$key] = $id;
    } elseif (($overlay[$key] ?? null) === $id) {
        unset($overlay[$key]);
    }
} else {
    $overlay = array_filter($overlay, static fn($v) => $v !== $id);
}
xs_write_or_fail($path, $overlay, 'the selection could not be kept: ');

xs_log('VERS', ($g === null ? $id : (string) $g['title'] . ' (' . (string) $g['platform'] . '): '
    . basename(str_replace(chr(92), '/', (string) ($g['romPath'] ?? ''))) . ', ' . $id)
    . ($selected ? ' selected; Play starts it, and its saves, save slots, texture packs, achievements and file check show in details'
                 : ' deselected; Play asks which, and the per-file tabs ask for a version'));
xs_json(['ok' => true, 'id' => $id, 'selected' => $selected]);
