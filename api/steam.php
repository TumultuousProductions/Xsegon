<?php
/**
 * /api/steam.php - Games > Add Steam games (includes\steam.php reads Steam).
 *
 *   GET    what Steam has installed: each app with what it is (game, demo,
 *          tool), which pictures Steam has for it, whether it can be played
 *          without Steam, which of your games it already is, and the Games
 *          Database's best guess for it
 *   POST {"app": "<steam app id>", "dbId": 0, "pictures": true, "details": true, "dry": false}
 *          add that one as a game of your own filed under Steam, or bring the
 *          one already here up to date. One per request, so the screen shows
 *          each row finishing (this server answers one request at a time,
 *          and a picture from the Games Database is a download).
 *
 * What a Steam game becomes (data\local-games.json, includes\local.php):
 *     run  <steam>\steam.exe   args  -applaunch <id>     Play: through Steam
 *     steamId, steamDir                                  which app, and its folder,
 *                                                        which the launcher follows
 *     steamExe, steamArgs                                Play without Steam
 * Started through Steam because Steam knows how: launch options, anti-cheat,
 * the publisher launchers.
 *
 * The fill pass's rules: only an EMPTY field or picture slot is filled, and
 * "use no picture" stays empty. Steam's own pictures come first, from its
 * cache, then the Games Database. Nothing is written into Steam's folders.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/gamesdb.php';
require_once __DIR__ . '/../includes/steam.php';

// Room for a cold drive's slow first read and a 30-second download, and still an end.
@set_time_limit(180);

$root = xs_steam_root();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    if ($root === '') {
        xs_json(['ok' => true, 'found' => false,
                 'why' => 'Steam was not found. If it is installed, say where in Settings > Paths > Steam folder.']);
    }
    // Said as it goes (xs_step), for the bar in the window waiting on this: a cold drive is slow here.
    xs_step('Reading Steam\'s list of installed games');
    $apps    = xs_steam_installed($root);
    xs_step('Reading what Steam knows of each');
    $facts   = xs_steam_appinfo($root, array_keys($apps));
    $entries = xs_local_read();
    $art     = xs_own_art_index();
    $list    = [];
    $seen    = 0;
    foreach ($apps as $id => $a) {
        xs_step('Looking at each game\'s folder and pictures', $seen++, count($apps));
        $f    = $facts[$id] ?? null;
        $kind = xs_steam_kind($a, $f);
        $exe  = $kind === 'none' ? ['exe' => ''] : xs_steam_exe($a, $f);
        $at   = xs_steam_existing($entries, $a);
        $have = $at === null ? null : $entries[$at];
        $title = xs_steam_title($a['name']);
        $list[] = [
            'id'       => (string) $id,
            'name'     => $title,
            'kind'     => $kind,
            'type'     => (string) ($f['type'] ?? ''),
            'dir'      => $a['dir'],
            'direct'   => $exe['exe'] !== '',
            'pictures' => $kind === 'none' ? [] : array_keys(xs_steam_pictures($root, (string) $id)),
            'have'     => $have === null ? null : [
                'id'       => (string) $have['id'],
                'title'    => (string) ($have['title'] ?? ''),
                'linked'   => !empty($have['steamId']),
                'pictures' => array_keys($art[(string) $have['id']] ?? []),
            ],
        ];
    }
    // No Games Database here: asking about every game at once holds this
    // server too long. Each game is asked as it is added (the POST).
    $order = ['game' => 0, 'demo' => 1, 'tool' => 2, 'none' => 3];
    usort($list, static fn($x, $y) => [$order[$x['kind']], strtolower($x['name'])] <=> [$order[$y['kind']], strtolower($y['name'])]);
    $counts = ['game' => 0, 'demo' => 0, 'tool' => 0, 'none' => 0, 'have' => 0];
    foreach ($list as $row) {
        $counts[$row['kind']]++;
        if ($row['have']) {
            $counts['have']++;
        }
    }
    xs_json(['ok' => true, 'found' => true, 'steam' => $root, 'steamExe' => is_file($root . '\\steam.exe'),
             'apps' => $list, 'counts' => $counts]);
}

xs_local_origin_only();
if ($root === '') {
    xs_fail('Steam was not found. If it is installed, say where in Settings > Paths > Steam folder.', 404);
}
$body  = xs_body();
$appid = trim((string) ($body['app'] ?? ''));
if (!preg_match('/^\d{1,10}$/', $appid)) {
    xs_fail('which Steam app? app is its number', 400);
}
$apps = xs_steam_installed($root);
$a = $apps[$appid] ?? null;
if ($a === null) {
    xs_fail('Steam does not have that app installed', 404);
}
if (!$a['folder']) {
    xs_fail('its folder is not there: ' . $a['dir'], 409);
}
$facts = xs_steam_appinfo($root, [$appid])[$appid] ?? null;
$exe   = xs_steam_exe($a, $facts);
$steam = $root . '\\steam.exe';
$dbId  = max(0, (int) ($body['dbId'] ?? 0));
$wantDetails = !array_key_exists('details', $body) || !empty($body['details']);
$wantDbPics  = !array_key_exists('pictures', $body) || !empty($body['pictures']);
$dry   = !empty($body['dry']);

$entries = xs_local_read();
$at  = xs_steam_existing($entries, $a);
$old = $at === null ? null : $entries[$at];
$e   = $old ?? ['title' => xs_steam_title($a['name']), 'platform' => XS_STEAM_PLATFORM];

// ---- how it starts -------------------------------------------------------
// Play goes through Steam; its own program is kept for Play without Steam.
// A game added by hand that ran its program directly keeps that program as
// its way without Steam, if Steam knows of none.
$ownRun = xs_norm_path((string) ($old['run'] ?? ''));
if ($exe['exe'] === '' && $ownRun !== '' && strcasecmp($ownRun, $steam) !== 0 && is_file($ownRun)) {
    $exe = ['exe' => $ownRun, 'args' => (string) ($old['args'] ?? '')];
}
if (is_file($steam)) {
    $e['run']  = $steam;
    $e['args'] = '-applaunch ' . $appid;
} elseif ($exe['exe'] !== '') {
    $e['run']  = $exe['exe'];                  // no steam.exe to go through: its own program
    $e['args'] = $exe['args'];
}
unset($e['url']);
if (empty($e['run'])) {
    xs_fail('there is nothing to start it with: steam.exe is not in the Steam folder, and neither is a program of the game\'s own', 409);
}
$e['steamId']  = $appid;
$e['steamDir'] = $a['dir'];
if ($exe['exe'] !== '') {
    $e['steamExe']  = $exe['exe'];
    $e['steamArgs'] = $exe['args'];
}

// ---- the empty fields ----------------------------------------------------
// The Games Database first: its date is the game's own, where Steam's is its
// release on Steam. Steam's details then fill whatever the database left empty.
$filled = [];
$empty = static function ($v): bool {
    return $v === null || $v === '' || $v === 0 || $v === 0.0;
};
$put = static function (string $k, $v) use (&$e, &$filled, $empty): void {
    if ($empty($v) || !$empty($e[$k] ?? null)) {
        return;
    }
    $e[$k] = $v;
    $filled[] = $k;
};
// The form's own rule for a date, so one odd value cannot refuse the whole game.
$date = static function (string $v): string {
    $v = substr(trim($v), 0, 10);
    return preg_match('/^\d{4}(-\d{2}(-\d{2})?)?$/', $v) ? $v : '';
};
// Which database game: the one asked for (dbId), else the best match for
// Steam's name on Windows, taken only when sure or likely (a guess can be
// another game). One process for match, details and pictures (bin\gamesdb.php fill).
$db = null;
$slots = null;
if (($wantDetails || $wantDbPics) && $dbId > 0) {
    $r = xs_gamesdb(['game', (string) $dbId]);
    $db = !empty($r['ok']) ? ($r['game'] ?? null) : null;
} elseif ($wantDetails || $wantDbPics) {
    $r = xs_gamesdb(['fill', 'Windows', xs_steam_title($a['name'])]);
    if (!empty($r['ok']) && is_array($r['game'] ?? null)) {
        $db = $r['game'];
        $dbId = (int) $db['id'];
        $slots = is_array($r['slots'] ?? null) ? $r['slots'] : null;
    }
}
$dbTitle = is_array($db) ? (string) ($db['title'] ?? '') : '';
if ($wantDetails && is_array($db)) {
    foreach (['genre', 'developer', 'publisher'] as $k) {
        $put($k, mb_substr(trim((string) ($db[$k] ?? '')), 0, 500));
    }
    $put('released', $date((string) ($db['released'] ?? '')));
    $put('notes', mb_substr(trim((string) ($db['notes'] ?? '')), 0, 20000));
    $rating = (float) ($db['rating'] ?? 0);
    $put('rating', $rating > 0 ? round(min(5.0, $rating), 2) : 0);
    $players = (int) ($db['players'] ?? 0);
    $put('players', $players >= 1 && $players <= 64 ? $players : 0);
}
if ($facts) {
    $put('developer', mb_substr($facts['developer'], 0, 500));
    $put('publisher', mb_substr($facts['publisher'], 0, 500));
    $put('released', $date($facts['released']));
}

$clean = xs_local_clean($e, $old['id'] ?? null);
if (is_string($clean)) {
    xs_fail($clean, 422);
}
$clean['added'] = (string) ($old['added'] ?? date('Y-m-d'));
if ($at === null) {
    $entries[] = $clean;
} else {
    $entries[$at] = $clean;
}
if (!$dry && !xs_local_write($entries, $why)) {
    xs_fail((string) $why, 500);
}
$id = (string) $clean['id'];

// ---- the empty picture slots ---------------------------------------------
$pictures = [];
if (!$dry) {
    $have   = xs_own_art_index()[$id] ?? [];
    $hidden = (array) (xs_art_hidden()[$id] ?? []);
    $fromSteam = xs_steam_pictures($root, $appid);
    foreach (['box', 'logo', 'fanart', 'shot'] as $kind) {
        if (isset($have[$kind])) {
            $pictures[$kind] = 'already';
            continue;
        }
        if (in_array($kind, $hidden, true)) {
            $pictures[$kind] = 'kept empty';           // "use no picture", chosen on purpose
            continue;
        }
        if (isset($fromSteam[$kind])) {
            $bytes = @file_get_contents($fromSteam[$kind]);
            if (is_string($bytes) && $bytes !== '' && xs_own_art_store($id, $kind, $bytes, false, $why) !== null) {
                $pictures[$kind] = 'steam';
                continue;
            }
        }
        if ($wantDbPics && $dbId > 0) {
            if ($slots === null) {                      // a game chosen by number: ask for its pictures now
                $imgs = xs_gamesdb(['images', (string) $dbId]);
                $slots = !empty($imgs['ok']) && is_array($imgs['slots'] ?? null) ? $imgs['slots'] : [];
            }
            $best = $slots[$kind][0] ?? null;
            if ($best !== null) {
                $pictures[$kind] = xs_gamesdb_fetch($id, $kind, (string) $best['file'], $why) !== null
                    ? 'database' : 'failed: ' . $why;
                continue;
            }
        }
        $pictures[$kind] = 'none';
    }
}

$fromSteam = array_keys(array_filter($pictures, static fn($v) => $v === 'steam'));
$fromDb    = array_keys(array_filter($pictures, static fn($v) => $v === 'database'));
xs_log('STM', ($old === null ? 'add ' : (empty($old['steamId']) ? 'link ' : 'refresh ')) . $clean['title'] . ' (' . $appid . ')'
    . ': pictures ' . ($fromSteam ? implode(',', $fromSteam) . ' from Steam' : 'none from Steam')
    . ($fromDb ? ', ' . implode(',', $fromDb) . ' from the Games Database' : '')
    . '; ' . ($filled ? implode(',', $filled) : 'no fields') . ($dbTitle !== '' ? ' from #' . $dbId . ' ' . $dbTitle : '')
    . ($dry ? ' (dry)' : ''));
xs_json(['ok' => true, 'id' => $id, 'title' => $clean['title'], 'app' => $appid,
         'added' => $old === null, 'linked' => $old !== null && empty($old['steamId']),
         'filled' => $filled, 'pictures' => $pictures, 'direct' => !empty($clean['steamExe']),
         'viaSteam' => strcasecmp((string) $clean['run'], $steam) === 0, 'dry' => $dry]);
