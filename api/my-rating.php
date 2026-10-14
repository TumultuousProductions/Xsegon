<?php
/**
 * POST /api/my-rating.php  {id, stars}  - your own rating of one game, 0 to 5.
 *
 * Beside the library's own (global) rating. Kept in data\my-ratings.json,
 * since the imported library's files are never written. Whole stars; 0 takes
 * yours off, and the entry with it.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

xs_post_only();

$body  = xs_body();
$id    = xs_id_or_fail($body['id'] ?? '');
$stars = $body['stars'] ?? null;

if (!is_int($stars) || $stars < 0 || $stars > 5) {
    xs_fail('stars must be a whole number from 0 to 5', 400);
}

// Rating needs a game, as starring does; taking a rating off does not, so one
// left on a game since removed can still go.
if ($stars > 0 && xs_game($id) === null) {
    xs_fail('unknown game', 404);
}

$path    = xs_data_path('my-ratings.json');
$overlay = xs_read_json($path, []);
if (!is_array($overlay)) {
    $overlay = [];
}

if ($stars === 0) {
    unset($overlay[$id]);
} else {
    $overlay[$id] = $stars;
}
xs_write_or_fail($path, $overlay);

xs_log('RATE', $id . ($stars ? ' ' . $stars . ' of 5' : ' rating taken off'));
xs_json(['ok' => true, 'id' => $id, 'stars' => $stars]);
