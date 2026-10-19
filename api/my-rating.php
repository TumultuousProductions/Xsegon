<?php
/**
 * POST /api/my-rating.php  {id, stars}  - your own rating of one game, 0 to 5.
 *
 * Beside the library's own (global) rating. Kept in data\my-ratings.json,
 * since the imported library's files are never written. Whole stars; 0 takes
 * yours off, and the entry with it. A game's versions are one game
 * (includes\versions.php): the rating goes on every one.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/versions.php';

xs_post_only();

$body  = xs_body();
$id    = xs_id_or_fail($body['id'] ?? '');
$stars = $body['stars'] ?? null;

if (!is_int($stars) || $stars < 0 || $stars > 5) {
    xs_fail('stars must be a whole number from 0 to 5', 400);
}

[$game, $ids] = xs_game_versions($id);
// Rating needs a game, as starring does; taking a rating off does not, so one
// left on a game since removed can still go.
if ($stars > 0 && $game === null) {
    xs_fail('unknown game', 404);
}

$path    = xs_data_path('my-ratings.json');
$overlay = xs_read_json($path, []);
if (!is_array($overlay)) {
    $overlay = [];
}

$before = [];
foreach ($ids as $vid) {
    $before[] = $vid . ' ' . (isset($overlay[$vid]) ? $overlay[$vid] . ' of 5' : 'none');
    if ($stars === 0) {
        unset($overlay[$vid]);
    } else {
        $overlay[$vid] = $stars;
    }
}
xs_write_or_fail($path, $overlay);

// The id first, as before, so a report is searched by it; then the game and its versions.
xs_log('RATE', $id . ($stars ? ' ' . $stars . ' of 5' : ' rating taken off') . ': ' . xs_versions_said($game, $ids, $id)
    . (count($ids) > 1 ? ', on every version; before: ' . implode(', ', $before) : ''));
xs_json(['ok' => true, 'id' => $id, 'stars' => $stars, 'ids' => $ids]);
