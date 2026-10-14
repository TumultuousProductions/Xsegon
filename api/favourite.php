<?php
/**
 * POST /api/favourite.php  {id, fav}  - star or unstar one game.
 *
 * The imported library's files are never written, so stars live in
 * data\favourites.json, an overlay that outranks the imported flag both ways.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

xs_post_only();

$body = xs_body();
$id   = xs_id_or_fail($body['id'] ?? '');
$fav  = (bool) ($body['fav'] ?? false);

// Starring needs a game, as hiding and tagging do; unstarring does not, so a
// star left on a game since removed can still be taken off.
if ($fav && xs_game($id) === null) {
    xs_fail('unknown game', 404);
}

$path    = xs_data_path('favourites.json');
$overlay = xs_read_json($path, []);
if (!is_array($overlay)) {
    $overlay = [];
}

$overlay[$id] = $fav;
xs_write_or_fail($path, $overlay);

xs_log('FAV', $id . ($fav ? ' starred' : ' unstarred'));
xs_json(['ok' => true, 'id' => $id, 'fav' => $fav]);
