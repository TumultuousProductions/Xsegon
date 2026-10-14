<?php
/**
 * /api/wanted.php - games you do not have, and the ones you starred.
 *
 *   GET                      the consoles on record (yours first) and your stars
 *   GET  ?platform=<name>    every game on record for it, each marked have or not
 *   GET  ?export=csv|txt[&platform=<name>]   your starred games, as a file
 *   POST {"id": <database id>, "want": true|false, "title", "platform", "year"}
 *
 * includes\wanted.php says what this is and where it is kept.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/wanted.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'POST') {
    $body = xs_body();
    $id = (int) ($body['id'] ?? 0);
    if ($id <= 0) {
        xs_fail('which game? (no database id)', 400);
    }
    $all = xs_wanted_read();
    $was = (string) ($all[(string) $id]['title'] ?? ('#' . $id));
    if (!empty($body['want'])) {
        $title = trim((string) ($body['title'] ?? ''));
        $platform = trim((string) ($body['platform'] ?? ''));
        if ($title === '' || $platform === '' || mb_strlen($title) > 300 || mb_strlen($platform) > 120) {
            xs_fail('a starred game needs its title and console', 400);
        }
        $all[(string) $id] = ['title' => $title, 'platform' => $platform,
                              'year' => mb_substr(trim((string) ($body['year'] ?? '')), 0, 4), 'at' => date('c')];
        $was = $title;
    } else {
        unset($all[(string) $id]);
    }
    if (!xs_write_json(xs_wanted_path(), (object) $all, $why)) {
        xs_fail($why ?? 'could not save the star', 500);
    }
    xs_log('WANT', (!empty($body['want']) ? 'starred ' : 'unstarred ') . $was . ' (' . count($all) . ' wanted)');
    xs_json(['ok' => true, 'wanted' => count($all)]);
}

$export = (string) ($_GET['export'] ?? '');
if ($export !== '') {
    if (!in_array($export, ['csv', 'txt'], true)) {
        xs_fail('export is csv or txt', 400);
    }
    $rows = xs_wanted_rows(trim((string) ($_GET['platform'] ?? '')));
    $name = 'xsegon-wanted-' . date('Y-m-d') . '.' . $export;
    if ($export === 'csv') {
        // The mark at the front is what makes Excel read the accents right.
        $out = "\xEF\xBB\xBF" . "Title,Console,Year,Starred\r\n";
        foreach ($rows as $r) {
            $out .= implode(',', array_map('xs_wanted_csv', [$r['title'], $r['platform'], $r['year'], substr($r['at'], 0, 10)])) . "\r\n";
        }
        header('Content-Type: text/csv; charset=utf-8');
    } else {
        $out = 'Games I want (' . count($rows) . '), from Xsegon, ' . date('Y-m-d') . "\r\n";
        $last = null;
        foreach ($rows as $r) {
            if ($r['platform'] !== $last) {
                $out .= "\r\n" . $r['platform'] . "\r\n";
                $last = $r['platform'];
            }
            $out .= '  ' . $r['title'] . ($r['year'] !== '' ? ' (' . $r['year'] . ')' : '') . "\r\n";
        }
        header('Content-Type: text/plain; charset=utf-8');
    }
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Cache-Control: no-store');
    xs_log('WANT', 'exported ' . count($rows) . ' as ' . $export);
    echo $out;
    exit;
}

if (!xs_gamesdb_ready()) {
    xs_fail('There is no Games Database here yet, and this list is read from it. It comes with the Xsegon download, and is fetched when missing (needs the internet once).', 409);
}

$platform = trim((string) ($_GET['platform'] ?? ''));
if ($platform !== '') {
    $res = xs_wanted_list($platform);
    if (empty($res['ok'])) {
        xs_fail((string) ($res['error'] ?? 'the Games Database did not answer'), 502);
    }
    xs_json(['ok' => true, 'platform' => $platform, 'games' => $res['games'] ?? [],
             'wanted' => array_map('intval', array_keys(xs_wanted_read()))]);
}

// The consoles: the ones you have games for first, then every other on record.
$res = xs_gamesdb(['platforms'], 20);
if (empty($res['ok'])) {
    xs_fail((string) ($res['error'] ?? 'the Games Database did not answer'), 502);
}
$mine = [];
foreach (xs_library()['games'] ?? [] as $g) {
    $p = (string) ($g['platform'] ?? '');
    $p = $p === 'Steam' ? 'Windows' : $p;
    $mine[$p] = ($mine[$p] ?? 0) + 1;
}
$starred = [];
foreach (xs_wanted_read() as $w) {
    $p = (string) ($w['platform'] ?? '');
    $starred[$p] = ($starred[$p] ?? 0) + 1;
}
$rows = [];
foreach ($res['platforms'] ?? [] as $p) {
    $n = (string) $p['name'];
    $rows[] = ['name' => $n, 'games' => (int) $p['games'], 'yours' => $mine[$n] ?? 0, 'starred' => $starred[$n] ?? 0];
}
usort($rows, static fn ($a, $b) => [$b['yours'] > 0, strtolower($a['name'])] <=> [$a['yours'] > 0, strtolower($b['name'])]);
xs_json(['ok' => true, 'platforms' => $rows, 'wanted' => xs_wanted_rows()]);
