<?php
/**
 * GET /api/game.php?id=<game id>  - one game, in full.
 *
 * The library rows stay lean, so the fields only the details screen wants
 * (the notes above all) are fetched here when details opens.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/cores.php';
require_once __DIR__ . '/../includes/cheats.php';
require_once __DIR__ . '/../includes/extras.php';
require_once __DIR__ . '/../includes/filecheck.php';
require_once __DIR__ . '/../includes/needsfix.php';

$id = xs_id_or_fail($_GET['id'] ?? '');

$g = xs_game_or_404($id);

/* Which core will run this, and whose choice it was: otherwise a core that
   plays a game badly looks like a broken game. */
$core = null;
$coreMine = false;
if (($g['launch']['kind'] ?? '') === 'retroarch') {
    $chosen   = xs_core_for($id);
    $load     = lb_core_load((string) ($g['launch']['args'] ?? ''));
    $core     = $chosen ?? ($load !== null ? lb_core_name($load) : null);
    $coreMine = $chosen !== null;
}
/* And how many cheats it plays with, for the same reason. */
$cheatPick = xs_cheats_for($id);
// With none on: how many there are to choose from, so the game says it has cheats before its tab is opened.
$cheatsThere = 0;
if ($cheatPick === null && ($g['launch']['kind'] ?? '') === 'retroarch') {
    try {
        $cheatsThere = (int) ((xs_cheat_files($g)[0] ?? [])['cheats'] ?? 0);
    } catch (\Throwable $e) {
        $cheatsThere = 0;
    }
}
// A standalone emulator's own cheats that are on, for the Cheats tab's count.
$emuOn = 0;
if (($g['launch']['kind'] ?? '') === 'emulator') {
    require_once __DIR__ . '/../includes/emucheats.php';
    try {
        $emuOn = (int) (xs_emucheats($g)['on'] ?? 0);
    } catch (\Throwable $e) {
        $emuOn = 0;
    }
}
// How many saves the Saves tab would list, for its count: a few folder reads.
$saves = 0;
require_once __DIR__ . '/../includes/saves.php';
try {
    $saves = (int) xs_saves_for($g)['count'];
} catch (\Throwable $e) {
    $saves = 0;
}

/* Whether this game's buttons can be set per game: a RetroArch game of a
   console whose buttons Xsegon knows. */
require_once __DIR__ . '/../includes/padmap.php';
require_once __DIR__ . '/../includes/rahotkeys.php';
$padable = ($g['launch']['kind'] ?? '') === 'retroarch'
        && isset(xs_pad_layouts()[mb_strtolower((string) $g['platform'])]);
// Its own buttons (null: none; []: standard on purpose) and its own turbo.
$gameMap   = $padable ? xs_game_map($id) : null;
$turboMine = false;
if ($padable) {
    xs_ra_turbo_for($id, $turboMine);
}

/* Its play time, counted fresh from the play history as the list counts it:
   the page asks here the moment a game ends. */
$played = ['seconds' => 0, 'plays' => 0, 'lastPlayed' => null];
foreach (xs_read_jsonl(xs_sessions_path()) as $row) {
    if (($row['gameId'] ?? '') !== $id) {
        continue;
    }
    $played['seconds'] += (int) ($row['seconds'] ?? 0);
    $played['plays']   += (int) ($row['count'] ?? 1);
    $at = $row['endedAt'] ?? $row['at'] ?? null;
    if ($at && (!$played['lastPlayed'] || $at > $played['lastPlayed'])) {
        $played['lastPlayed'] = $at;
    }
}

xs_json(['ok' => true, 'game' => $played + [
    // Why it wears NEEDS FIX, or null, as the list says it (includes\needsfix.php):
    // the page asks here when a game ends, so the mark follows that launch at once.
    'needsFix'  => xs_needs_fix()[$id] ?? null,
    'core'      => $core,
    'coreMine'  => $coreMine,
    'cheats'    => $cheatPick === null ? 0 : count($cheatPick['on']),
    'cheatsThere' => $cheatsThere,
    'emuCheats' => $emuOn,
    'saves'     => $saves,
    'id'        => $g['id'],
    'title'     => $g['title'],
    'platform'  => $g['platform'],
    'developer' => $g['developer'],
    'publisher' => $g['publisher'],
    'genre'     => $g['genre'],
    'region'    => $g['region'],
    'playMode'  => $g['playMode'],
    'players'   => (int) ($g['players'] ?? 0),
    'released'  => $g['released'],
    'rating'    => $g['rating'],
    'notes'     => $g['notes'],
    'wikipedia' => $g['wikipedia'],
    'sortTitle' => $g['sortTitle'] ?? $g['title'],
    // For the edit dialog: which fields were changed in Xsegon, and what
    // the source says they are (so each can be put back on its own).
    'edited'    => $g['edited'] ?? [],
    'source'    => (object) ($g['source'] ?? []),
    // And whose values those are, for the dialog to name: from the flags
    // the merges set, never from the shape of the id.
    'origin'    => !empty($g['local']) ? 'own' : (!empty($g['scanned']) ? 'scanned' : 'launchbox'),
    // Its manual, maps and guides, the manual first.
    'documents' => xs_docs_for($id),
    // Its own buttons: whether they can be set, how many are moved, and
    // whether anything there is its own (buttons, standard kept, or turbo).
    'padable'   => $padable,
    'gameButtons' => $gameMap === null ? 0 : count($gameMap),
    'gameOwn'   => $gameMap !== null || $turboMine,
    // What its file really is, by checksum, as last checked (includes\filecheck.php).
    'fileCheck' => xs_fc_for($g),
    // Whether you wrote a note on it (api\notes.php), for the mark on its Notes tab.
    'myNote'    => trim((string) (((array) xs_read_json(xs_data_path('notes.json'), []))[$id]['text'] ?? '')) !== '',
]]);
