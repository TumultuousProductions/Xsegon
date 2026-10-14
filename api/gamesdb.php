<?php
/**
 * /api/gamesdb.php - the LaunchBox Games Database, for one game.
 *
 *   GET  ?id=<game id>&what=images         every picture on record, by slot
 *   GET  ?id=<game id>&what=game           its metadata
 *   GET  ?id=<game id>&what=search[&q=..]  candidates, for a game with no database number
 *   POST ?id=<game id>&kind=logo   {"file": "<FileName from images>"}
 *        downloads that picture into data\art as the game's replacement
 *   POST ?id=<game id>&link=<database id>  remembers the match for a game LaunchBox never matched
 *
 * The database is the copy that ships with Xsegon, read by bin\gamesdb.php.
 * A fetched picture gets the same checks as an uploaded file. A match chosen
 * by hand is kept in data\overrides.json under 'dbId'.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/gamesdb.php';

$id = xs_id_or_fail($_GET['id'] ?? '');
$game = xs_game_or_404($id);

$dbId = (int) ($game['dbId'] ?? 0);

// HEAD reads too: it arrives from other sites with no Origin header, so it
// must never reach the writes below, which take everything from the query.
if (in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    $what = (string) ($_GET['what'] ?? 'images');
    // The reader not answering is a 502, as in api\fill.php; the dbId stays
    // on the answer, as the picture panel names it either way.
    $answer = static function (array $r) use ($dbId): void {
        $r['dbId'] = $dbId;
        if (empty($r['ok'])) {
            xs_log('FAIL', '502 ' . (string) ($r['error'] ?? 'the database did not answer') . ' (gamesdb.php)');
        }
        xs_json($r, empty($r['ok']) ? 502 : 200);
    };
    if ($what === 'search') {
        $q = trim((string) ($_GET['q'] ?? $game['title']));
        $answer(xs_gamesdb(['search', $game['platform'], $q]));
    }
    if ($dbId <= 0) {
        xs_json(['ok' => true, 'dbId' => 0, 'unmatched' => true,
                 'note' => 'LaunchBox never matched this game to its database. Search for it to choose a match.']);
    }
    $answer(xs_gamesdb([$what === 'game' ? 'game' : 'images', (string) $dbId]));
}

xs_local_origin_only();

// ---- remember a match chosen by hand -------------------------------------
if (isset($_GET['link'])) {
    $link = (int) $_GET['link'];
    if (!xs_gamesdb_link($id, $link, $why)) {
        xs_fail((string) $why, 500);
    }
    xs_log('DB', 'match ' . $game['title'] . ' -> #' . $link);
    xs_json(['ok' => true, 'id' => $id, 'dbId' => $link]);
}

// ---- download one picture as the game's replacement -----------------------
// xs_gamesdb_fetch is shared with the pass over scanned games.
$kind = (string) ($_GET['kind'] ?? '');
$body = xs_body();
$file = (string) ($body['file'] ?? '');
$got = xs_gamesdb_fetch($id, $kind, $file, $why);
if ($got === null) {
    $codes = ['kind must be' => 400, 'not a Games Database picture name' => 400,
              'could not fetch' => 502, 'larger than 40 MB' => 413, 'not an image' => 415];
    $code = 500;
    foreach ($codes as $needle => $c) {
        if (str_contains((string) $why, $needle)) {
            $code = $c;
        }
    }
    xs_fail((string) $why, $code);
}
xs_log('DB', 'picture ' . $kind . ' for ' . $game['title'] . ' ' . $file . ' ' . $got['width'] . 'x' . $got['height']);
xs_json(['ok' => true] + $got);
