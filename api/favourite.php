<?php
/**
 * POST /api/favourite.php  {id, fav}  - star or unstar one game.
 *
 * The imported library's files are never written, so stars live in
 * data\favourites.json, an overlay that outranks the imported flag both ways.
 * A game's versions are one game (includes\versions.php): the star goes on every one.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/versions.php';

xs_post_only();

$body = xs_body();
$id   = xs_id_or_fail($body['id'] ?? '');
$fav  = (bool) ($body['fav'] ?? false);

[$game, $ids] = xs_game_versions($id);
// Starring needs a game, as hiding and tagging do; unstarring does not, so a
// star left on a game since removed can still be taken off.
if ($fav && $game === null) {
    xs_fail('unknown game', 404);
}

$path    = xs_data_path('favourites.json');
$overlay = xs_read_json($path, []);
if (!is_array($overlay)) {
    $overlay = [];
}

// What each version wore before, for the log: the overlay's word, else the imported flag (only this game's is read).
$before = [];
foreach ($ids as $vid) {
    $before[] = $vid . (array_key_exists($vid, $overlay) ? ($overlay[$vid] ? ' starred' : ' unstarred')
        : ($vid !== $id ? ' as imported' : (!empty($game['favourite']) ? ' starred (imported)' : ' no star')));
    $overlay[$vid] = $fav;
}
xs_write_or_fail($path, $overlay);

// The id first, as before, so a report is searched by it; then the game and its versions.
xs_log('FAV', $id . ($fav ? ' starred' : ' unstarred') . ': ' . xs_versions_said($game, $ids, $id)
    . (count($ids) > 1 ? ', on every version; before: ' . implode(', ', $before) : ''));
xs_json(['ok' => true, 'id' => $id, 'fav' => $fav, 'ids' => $ids]);
