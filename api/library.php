<?php
/**
 * GET /api/library.php  - the library, shaped by the current view settings.
 *
 *   ?q= &platform=<console or @collection> &sort= &reverse= &grouped=
 *   &versions=all &added= &from= &lot=, and the filter switches read below
 *
 * Read-only over data\library.json. Sort, group and filter come from
 * settings, never hardcoded: one code path with different parameters.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';
require_once __DIR__ . '/../includes/cheats.php';
require_once __DIR__ . '/../includes/platform-art.php';
require_once __DIR__ . '/../includes/tags.php';
require_once __DIR__ . '/../includes/scan.php';     // xs_disc_info
require_once __DIR__ . '/../includes/extras.php';   // documents, spines, cartridges and discs
require_once __DIR__ . '/../includes/hackof.php';   // which games are hacks, or in doubt

// Which games have a documents folder: one listing, not a look per game.
$docsHave = xs_docs_have();

// Read once for the whole library, not once per game.
$cheatPicks = xs_cheats_read();
// Your tags (includes\tags.php), read once the same way.
$tagMap = xs_tags_read();

$s   = xs_settings();
$lib = xs_library();
$games = $lib['games'] ?? [];
// Hacks and the games still in doubt (includes\hackof.php), for the mark on each.
$hackMarks = xs_hackof_marks($games);
// Settings > View > Show games with no art, off: a game with no box picture
// is in no view and no count. Only in this read, the page's own: Get Pictures
// goes on seeing it, which is how it gets a picture and comes back.
$hideNoArt = isset($s['view']['showMissingArt']) && $s['view']['showMissingArt'] === false;
if ($hideNoArt) {
    $games = array_values(array_filter($games, static fn(array $g): bool => ($g['art']['box'] ?? null) !== null));
}

// ---- recency, from our own session log -----------------------------------
$recent = [];
foreach (xs_read_jsonl(xs_sessions_path()) as $row) {
    $id = $row['gameId'] ?? '';
    if ($id === '') {
        continue;
    }
    if (!isset($recent[$id])) {
        $recent[$id] = ['seconds' => 0, 'count' => 0, 'last' => null];
    }
    $recent[$id]['seconds'] += (int) ($row['seconds'] ?? 0);
    $recent[$id]['count']   += (int) ($row['count'] ?? 1);
    $at = $row['endedAt'] ?? $row['at'] ?? null;
    if ($at && (!$recent[$id]['last'] || $at > $recent[$id]['last'])) {
        $recent[$id]['last'] = $at;
    }
}

// ---- filter -------------------------------------------------------------
$q        = trim((string) ($_GET['q'] ?? ''));
$platform = trim((string) ($_GET['platform'] ?? ''));
$qKey     = $q === '' ? '' : art_key($q);

// The Filter by switches: they narrow whatever is open, and stack. Two players
// or more and Never played are their collections' own rules ($inCollection),
// so a filter and its collection cannot disagree.
$favOnly      = ($_GET['fav'] ?? '') === '1';
$playersOnly  = ($_GET['players'] ?? '') === '1';
$readyOnly    = ($_GET['ready'] ?? '') === '1';
$unplayedOnly = ($_GET['unplayed'] ?? '') === '1';
// Not rated by you: no stars of your own on it (data\my-ratings.json).
$unratedOnly  = ($_GET['unrated'] ?? '') === '1';
// Missing art: lacks one of the five pictures or its video ($missingArt below).
$missingOnly  = ($_GET['missing'] ?? '') === '1';
// Your rating at least: 1 to 5 of your own stars; 0 is off. The one filter with a value.
$minMine      = max(0, min(5, (int) ($_GET['myrating'] ?? 0)));
// Has a manual, Cheats on, and the two about hacks: each read off what the row itself says (docs, cheats, hack).
$docsOnly     = ($_GET['docs'] ?? '') === '1';
$cheatsOnly   = ($_GET['cheats'] ?? '') === '1';
$hacksOnly    = ($_GET['hacks'] ?? '') === '1';
$noHacks      = ($_GET['nohacks'] ?? '') === '1';
// Your own tags, as many as are selected: a game must carry them all, as the
// other filters stack. Compared without case.
$tagWant = [];
foreach ((array) ($_GET['tag'] ?? []) as $t) {
    $t = trim((string) $t);
    if ($t !== '') {
        $tagWant[] = mb_strtolower($t);
    }
}
$tagWant = array_values(array_unique($tagWant));
// The games that need fixing (includes\needsfix.php): the last runs check
// could not start them, or their last launch failed, whichever is newer.
$failsOnly = ($_GET['fails'] ?? '') === '1';
require_once __DIR__ . '/../includes/needsfix.php';
$rcFailed = xs_needs_fix();
// The "needs fix" tag is that mark (includes\tags.php): on these games and no other.
$tagMap = xs_tags_effective($tagMap, $rcFailed);
$fixMarks = xs_fix_marks();
$anyFilter    = $favOnly || $playersOnly || $readyOnly || $unplayedOnly || $unratedOnly || $missingOnly || $minMine > 0 || $failsOnly || $tagWant !== []
              || $docsOnly || $cheatsOnly || $hacksOnly || $noHacks;
// The six things a row's has-flags answer, asked the same way, so the filter
// and the list's Missing art column cannot disagree about a game.
$missingArt = static function (array $g) use ($s): bool {
    foreach (['box', 'box3d', 'logo', 'shot', 'fanart'] as $k) {
        if (($g['art'][$k] ?? null) === null) {
            return true;
        }
    }
    return video_for_game($s, $g) === null;
};

// Ready to play means it can start NOW: a game in a games folder that is
// away (xs_rom_away) keeps its launch but is not ready. Every row carries
// this as 'ready', so the Ready column and the filter are one rule.
$canStart = static function (array $g) use ($s): bool {
    if ($g['launch'] === null) {
        return false;
    }
    $rom = (string) ($g['romPath'] ?? '');
    if (!empty($g['local']) || $rom === '') {
        return true;
    }
    return xs_rom_away(xs_rom_real_path($rom, $s), $s) === null;
};

// Stars set in Xsegon outrank the imported flag, both ways. The overlay is
// ours (data\favourites.json): the imported library's files are never written.
$favOverlay = xs_read_json(xs_data_path('favourites.json'), []);
if (!is_array($favOverlay)) {
    $favOverlay = [];
}
// And your own ratings, beside the library's (api\my-rating.php).
$myRatings = xs_read_json(xs_data_path('my-ratings.json'), []);
if (!is_array($myRatings)) {
    $myRatings = [];
}
// And the version of a same-named set selected to play (api\select-version.php).
$verPicks = xs_read_json(xs_data_path('selected-versions.json'), []);
if (!is_array($verPicks)) {
    $verPicks = [];
}

// Looked up live rather than at import: see the video finder in includes.

// ---- plain addresses for media that is already Xsegon's own --------------
// A file in Xsegon's own folders goes out as a plain address (/files/...,
// router.php); anything else goes through api\image.php. One folder listing
// per kind, not a file check per game.
$thumbIndex = [];
$thumbRev   = [];
foreach (array_keys(xs_own_art_kinds()) as $k) {
    $thumbIndex[$k] = [];
    foreach (@scandir(xs_data_path('thumbs' . DIRECTORY_SEPARATOR . $k)) ?: [] as $f) {
        if (preg_match('/^(.+)\.(jpg|png)$/i', $f, $tm)) {
            $thumbIndex[$k][$tm[1]] = $f;
        }
    }
    // Every build rewrites the receipt, so its age stands for the whole cache.
    $thumbRev[$k] = (int) @filemtime(xs_data_path('thumbs-' . $k . '.json'));
}
$copyRev = (int) @filemtime(media_receipt_path());

// ---- collections: the consoles screen's extra entries ---------------------
// Collections sit beside the consoles and are asked for as platform=@favourites
// and so on, so every view, sort and search works inside them.
$collections = [
    '@favourites' => 'Favourites',
    '@recent'     => 'Recently played',
    '@added'      => 'Recently added',
    '@changed'    => 'Recently changed',
    '@unplayed'   => 'Never played',
    '@players'    => 'Two players or more',
    // Games whose file is not on the disk: it empties itself when the files
    // come back.
    '@missing'    => 'Missing files',
];
// Recently added is the latest stretch of DateAdded, compared as ISO text. It
// is sent even when empty, with its reason: time empties it, and an entry
// that vanished would read as broken. How far back is view.addedPeriod in
// days; ?added= outranks it for a read made before the page's save lands.
$addedDays   = ['today' => 0, 'threedays' => 3, 'week' => 7, 'twoweeks' => 14, 'month' => 30, 'year' => 365];
$addedPeriod = (string) ($_GET['added'] ?? $s['view']['addedPeriod'] ?? 'month');
if (!isset($addedDays[$addedPeriod])) {
    $addedPeriod = 'month';
}
$addedCutoff = date('Y-m-d', strtotime('-' . $addedDays[$addedPeriod] . ' days'));
$inLast      = static fn (string $p): string => $p === 'today' ? 'today' : 'in the last ' . ($p === 'year' ? 'year' : $addedDays[$p] . ' days');
$addedEmpty  = 'nothing added ' . $inLast($addedPeriod);
// Recently changed, by the same rules: the games whose pictures, video or
// details came or changed lately (includes\changed.php), its own stretch in
// view.changedPeriod, ?changed= the same way.
$changedAt     = xs_changed();
$changedPeriod = (string) ($_GET['changed'] ?? $s['view']['changedPeriod'] ?? 'week');
if (!isset($addedDays[$changedPeriod])) {
    $changedPeriod = 'week';
}
$changedCutoff = date('Y-m-d', strtotime('-' . $addedDays[$changedPeriod] . ' days'));
$changedEmpty  = 'nothing changed ' . $inLast($changedPeriod);
// Two players or more is MaxPlayers, with PlayMode as the fallback where the
// number is blank.
$inCollection = static function (string $which, array $g) use ($recent, $addedCutoff, $changedAt, $changedCutoff): bool {
    $r = $recent[$g['id']] ?? null;
    switch ($which) {
        case '@favourites': return (bool) $g['favourite'];
        case '@recent':     return $r !== null && !empty($r['last']);
        case '@added':      return (string) ($g['added'] ?? '') >= $addedCutoff && ($g['added'] ?? '') !== '';
        // A time compared as text with a day: "2026-10-15 17:02" is on or after "2026-10-15".
        case '@changed':    return (string) ($changedAt[$g['id']]['at'] ?? '') >= $changedCutoff;
        case '@unplayed':   return $r === null || (int) $r['count'] === 0;
        case '@players':
            $n = (int) ($g['players'] ?? 0);
            return $n >= 2 || ($n === 0
                && preg_match('/multiplayer|cooperative/i', (string) ($g['playMode'] ?? '')) === 1);
        // Read off the mark the library read already made (xs_apply_missing),
        // never by asking the disk again here: one answer about whether a
        // file exists, so a row and this collection cannot disagree.
        case '@missing':
            return empty($g['launch'])
                && str_contains((string) ($g['launchError'] ?? ''), 'the file is not there');
    }
    return false;
};
/* Versions of one game on one console become one card (the roll-up, below
   the rows). Decided up here so every count from here on counts what the
   page will show. */
$roll = !isset($s['view']['rollVersions']) || $s['view']['rollVersions'] !== false;
if (isset($_GET['versions'])) {
    $roll = $_GET['versions'] !== 'all';
}
$cardKey = static fn(array $g): string => mb_strtolower((string) $g['platform']) . '|' . mb_strtolower(trim((string) $g['title']));
$counted = static function (array &$seen, string $bucket, array $g) use ($roll, $cardKey): bool {
    $k = $roll ? $cardKey($g) : (string) $g['id'];
    if (isset($seen[$bucket][$k])) {
        return false;
    }
    $seen[$bucket][$k] = true;
    return true;
};
$seenAll = $seenPassing = [];
if ($roll || $hideNoArt) {
    $perConsole = [];
    $seenConsole = [];
    foreach ($games as $g) {
        if ($counted($seenConsole, 'all', $g)) {
            $perConsole[$g['platform']] = ($perConsole[$g['platform']] ?? 0) + 1;
        }
    }
    $lib['platforms'] = $perConsole;
}
$collectionCounts = array_fill_keys(array_keys($collections), 0);
// The same counts again for what the filters let through, whatever console
// or search was asked for: the consoles screen's numbers while a filter is
// on, so a console with nothing that passes can step aside instead of
// opening onto an empty screen.
$collectionFiltered = $collectionCounts;
$tagCounts = [];
$platformFiltered   = [];

// What a search looks at besides the title and your tags. Inside one console
// its name would match every game, so it is left out.
$searchIn = ['developer', 'publisher', 'genre'];
if ($platform === '' || isset($collections[$platform])) {
    $searchIn[] = 'platform';
}

$rows = [];
foreach ($games as $g) {
    $isFav = array_key_exists($g['id'], $favOverlay)
        ? (bool) $favOverlay[$g['id']]
        : $g['favourite'];
    $g['favourite'] = $isFav;
    $passes = (!$favOnly || $isFav)
        && (!$playersOnly || $inCollection('@players', $g))
        && (!$readyOnly || $canStart($g))
        && (!$unplayedOnly || $inCollection('@unplayed', $g))
        && (!$unratedOnly || empty($myRatings[$g['id']]))
        && (!$missingOnly || $missingArt($g))
        && ($minMine === 0 || (int) ($myRatings[$g['id']] ?? 0) >= $minMine)
        && (!$failsOnly || isset($rcFailed[$g['id']]))
        && (!$docsOnly || isset($docsHave[$g['id']]))
        && (!$cheatsOnly || !empty($cheatPicks[$g['id']]['on']))
        && (!$hacksOnly || ($hackMarks[$g['id']] ?? null) === 'yes')
        && (!$noHacks || ($hackMarks[$g['id']] ?? null) !== 'yes')
        && ($tagWant === [] || !array_diff($tagWant, array_map('mb_strtolower', $tagMap[$g['id']] ?? [])));
    // How many games carry each tag, counted over the library as it stands,
    // so a tag on a game that has since gone is not offered.
    foreach ($tagMap[$g['id']] ?? [] as $t) {
        $tagCounts[$t] = ($tagCounts[$t] ?? 0) + 1;
    }
    foreach ($collections as $ck => $_) {
        if ($inCollection($ck, $g)) {
            if ($counted($seenAll, $ck, $g)) {
                $collectionCounts[$ck]++;
            }
            if ($anyFilter && $passes && $counted($seenPassing, $ck, $g)) {
                $collectionFiltered[$ck]++;
            }
        }
    }
    if ($anyFilter && $passes && $counted($seenPassing, 'console', $g)) {
        $platformFiltered[$g['platform']] = ($platformFiltered[$g['platform']] ?? 0) + 1;
    }
    if (!$passes) {
        continue;
    }
    if ($platform !== '') {
        if (isset($collections[$platform])) {
            if (!$inCollection($platform, $g)) {
                continue;
            }
        } elseif ($g['platform'] !== $platform) {
            continue;
        }
    }
    // Title first, then the same normalised compare over the other fields.
    if ($qKey !== '' && !str_contains($g['key'], $qKey)) {
        $alsoIn = false;
        // Your tags too: typing "couch" finds what you tagged Couch.
        foreach ($tagMap[$g['id']] ?? [] as $t) {
            if (str_contains(art_key($t), $qKey)) {
                $alsoIn = true;
            }
        }
        foreach ($searchIn as $field) {
            if (str_contains(art_key((string) ($g[$field] ?? '')), $qKey)) {
                $alsoIn = true;
                break;
            }
        }
        if (!$alsoIn) {
            continue;
        }
    }
    $id = $g['id'];
    $video = video_for_game($s, $g);
    $img = [];
    $imgFull = [];
    foreach ($g['art'] as $k => $p) {
        if (!is_string($p) || $p === '' || !isset($thumbIndex[$k])) {
            continue;
        }
        $replaced = isset($g['artSource']) && array_key_exists($k, $g['artSource']);
        $fullUrl  = media_url($p, $replaced ? (int) ($g['artRev'] ?? 0) : $copyRev);
        if ($fullUrl !== null) {
            $imgFull[$k] = $fullUrl;
        }
        if (isset($thumbIndex[$k][$id])) {
            $img[$k] = 'files/thumbs/' . $k . '/' . rawurlencode($thumbIndex[$k][$id]) . '?v=' . $thumbRev[$k];
        } elseif ($fullUrl !== null) {
            $img[$k] = $fullUrl;         // no thumbnail yet: our own full-size file
        }
    }
    $rows[] = [
        'id'        => $id,
        'title'     => $g['title'],
        // The file's name, for telling versions apart (the roll-up below).
        'file'      => basename(str_replace(chr(92), '/', (string) ($g['romPath'] ?? ''))) ?: null,
        // What tells it from another game of the same name on the same
        // console, off its file name (includes\import.php, xs_apply_variants).
        'variant'   => $g['variant'] ?? null,
        'platform'  => $g['platform'],
        'genre'     => $g['genre'],
        'developer' => $g['developer'],
        'publisher' => $g['publisher'] ?? null,
        'sortTitle' => ($g['sortTitle'] ?? '') !== '' ? $g['sortTitle'] : $g['title'],
        'released'  => $g['released'],
        'rating'    => $g['rating'],                  // the library's, shown as the global rating
        'myRating'  => (int) ($myRatings[$id] ?? 0),  // yours, 0 for none (api\my-rating.php)
        'favourite' => $g['favourite'],
        'hasArt'    => $g['art']['box'] !== null,
        'hasLogo'   => $g['art']['logo'] !== null,   // the wheel's banner art
        'hasFanart' => $g['art']['fanart'] !== null, // the systems wall's scenery
        'hasShot'   => ($g['art']['shot'] ?? null) !== null, // the grid's Image Group
        'hasBox3d'  => ($g['art']['box3d'] ?? null) !== null, // likewise; null until a re-import on an old library.json
        'artRev'    => $g['artRev'] ?? 0,              // see artUrl() in js\util.js
        'edited'    => !empty($g['edited']) || !empty($g['artSource']),
        'local'     => !empty($g['local']),          // one of your own (includes\local.php)
        // Found on the disk by Scan for Games (includes\scan.php).
        'scanned'   => !empty($g['scanned']),
        'hasVideo'  => $video !== null,
        'videoRev'  => $video !== null ? (int) @filemtime($video) : 0,   // cache-buster, like artRev
        'videoUrl'  => $video !== null ? media_url($video, (int) @filemtime($video)) : null,
        'img'       => $img ?: null,       // plain addresses, thumbnail size (see above)
        'imgFull'   => $imgFull ?: null,   // and full size
        'playable'  => $g['launch'] !== null,
        // The emulator it runs in, when that is not RetroArch: the menu's Open Ryujinx (api\emuopen.php).
        'emu'       => xs_emu_name($g['launch']),
        'why'       => $g['launchError'],
        'ready'     => $canStart($g),      // can start now: playable, and its folder is here
        'needsFix'  => $rcFailed[$id] ?? null,         // greyed, NEEDS FIX (includes\needsfix.php)
        // Marked by you: it stays until you take the tag off, not on the next good play.
        'needsFixMine' => isset($rcFailed[$id]) && !empty($fixMarks[$id]['fix']),
        'seconds'   => $recent[$id]['seconds'] ?? 0,
        'plays'     => $recent[$id]['count'] ?? 0,
        'lastPlayed'=> $recent[$id]['last'] ?? null,
        'addedAt'   => substr((string) ($g['added'] ?? ''), 0, 10) ?: null,
        'changedAt' => $changedAt[$id]['at'] ?? null,  // its pictures, video or details last (includes\changed.php)
        'players'   => (int) ($g['players'] ?? 0),   // 0 where nobody said
        // A Steam game of yours (api\steam.php): its app number, and whether
        // it has a program of its own for Play without Steam.
        'steam'     => !empty($g['steam']) ? ['id' => $g['steam']['id'], 'direct' => $g['steam']['exe'] !== ''] : null,
        // How many cheats this game launches with, for its badge.
        'cheats'    => count($cheatPicks[$id]['on'] ?? []),
        // 'yes' a hack, 'ask' one in doubt until you say (Games > Hacks to settle).
        'hack'      => $hackMarks[$id] ?? null,
        'tags'      => $tagMap[$id] ?? [],     // yours (includes\tags.php)
        // A game known to be one of several discs, from its own files:
        // see xs_disc_info() in includes\scan.php. null for every other game.
        'discs'     => xs_acc_disc_info($g, xs_disc_info($g, $s)),
        // Files said to go with this game (its Accompanied files tab), and, for a file
        // whose game is not in the library, what it is (includes\accompanied.php).
        'accompanied' => count($g['accompanied'] ?? []),
        'accompanies' => $g['accompanies'] ?? null,
        // What came in the box (includes\extras.php): the box's side, the
        // cartridge or disc, each with its size so the page knows its shape
        // before it loads; and whether the game has any document to open.
        'spine'     => xs_extra_pic('spine', $id),
        'medium'    => xs_extra_medium($id),
        'docs'      => isset($docsHave[$id]),
    ];
}

// No emulator on a console RetroArch plays: the words name the press, and raOffer says which (js\raoffer.js).
if (array_filter($rows, static fn($r) => !$r['playable'] && str_starts_with((string) $r['why'], 'no emulator'))) {
    require_once __DIR__ . '/../includes/setup.php';
    $raOffer = xs_setup_ra_offer($lib);
    foreach ($rows as $i => $r) {
        $said = $r['playable'] ? null : xs_setup_ra_why((string) $r['why'], (string) $r['platform'], $raOffer);
        if ($said !== null && $said !== $r['why']) {
            $rows[$i]['why'] = $said;
            $rows[$i]['raOffer'] = $raOffer;
        }
    }
}

// ---- versions: one card per game on a console ----------------------------
/*
 * Games that share a console and a title become one card, wearing the version
 * with the most to show (box art first, then the most played) and carrying
 * every version in 'versions', most recently played first, for Play to offer.
 *
 * After the filters, so two of four versions let through make a card of two.
 * Plays and play time are summed and the last play is the latest, so sorts
 * see the game. view.rollVersions off, or ?versions=all, leaves every file its
 * own row. The key is xs_apply_variants' own: console and title, case aside.
 */
if ($roll) {
    $sets = [];
    foreach ($rows as $i => $r) {
        $sets[$cardKey($r)][] = $i;
    }
    $drop = [];
    foreach ($sets as $idx) {
        if (count($idx) < 2) {
            continue;
        }
        usort($idx, static fn($a, $b) => [$rows[$b]['hasArt'], $rows[$b]['plays'], $rows[$b]['playable']]
                                     <=> [$rows[$a]['hasArt'], $rows[$a]['plays'], $rows[$a]['playable']]);
        $versions = array_map(static fn($i) => $rows[$i], $idx);
        usort($versions, static fn($a, $b) => strcmp((string) $b['lastPlayed'], (string) $a['lastPlayed']));
        $lead = $idx[0];
        $rows[$lead]['versions'] = $versions;
        $rows[$lead]['variant']  = null;
        // The version selected in its details, when the filters let it
        // through: it rides the card and Play starts it without the ask.
        $pick = $verPicks[$cardKey($rows[$lead])] ?? null;
        if (is_string($pick) && in_array($pick, array_column($versions, 'id'), true)) {
            $rows[$lead]['chosen'] = $pick;
        }
        // Versions that are the discs of one set, each its own file (an emulator that reads no
        // playlist): the card stands for the whole set, and Play asks which disc to start.
        $nos = array_map(static fn($v) => is_array($v['discs'] ?? null) && empty($v['discs']['set']) ? ($v['discs']['disc'] ?? null) : null, $versions);
        sort($nos);
        if (!in_array(null, $nos, true) && $nos === range(1, count($nos))) {
            $rows[$lead]['discs'] = ['set' => true, 'n' => count($nos), 'pick' => true];
        }
        $rows[$lead]['plays']    = array_sum(array_column($versions, 'plays'));
        $rows[$lead]['seconds']  = array_sum(array_column($versions, 'seconds'));
        $rows[$lead]['lastPlayed'] = $versions[0]['lastPlayed'];
        // Playable when any version is: Play then asks which.
        $rows[$lead]['playable'] = in_array(true, array_column($versions, 'playable'), true);
        $rows[$lead]['ready']    = in_array(true, array_column($versions, 'ready'), true);
        // What came in the box is the game's, whichever file it was found
        // for: the card shows the first version's that has one.
        foreach (['spine', 'medium'] as $k) {
            foreach ($versions as $v) {
                $rows[$lead][$k] = $rows[$lead][$k] ?? $v[$k];
            }
        }
        $rows[$lead]['docs'] = in_array(true, array_column($versions, 'docs'), true);
        foreach (array_slice($idx, 1) as $i) {
            $drop[$i] = true;
        }
    }
    if ($drop) {
        $rows = array_values(array_diff_key($rows, $drop));
    }
}
// The library counted the same way, so versions riding with their games do
// not read as games filtered out.
$totalShown = count($games);
if ($roll) {
    $allSets = [];
    foreach ($games as $g) {
        $allSets[$cardKey($g)] = true;
    }
    $totalShown = count($allSets);
}

// ---- sort ---------------------------------------------------------------
/*
 * Arrange By. Each key has a NATURAL direction (titles A to Z, ratings best
 * first, most recent first) and "reverse" flips it: one switch, not an
 * ascending/descending pair. Text keys put blanks LAST both ways. Every
 * comparison falls through to the title, so equals are never in random order.
 */
$sort    = (string) ($_GET['sort'] ?? $s['view']['sort']);
// Inside Recently added the default sort is newest first; any other order
// picked in Arrange By still applies. Recently changed the same, by its time.
if ($platform === '@added' && ($sort === 'title' || $sort === '')) {
    $sort = 'added';
}
if ($platform === '@changed' && ($sort === 'title' || $sort === '')) {
    $sort = 'changed';
}
$reverse = isset($_GET['reverse']) ? $_GET['reverse'] === '1' : !empty($s['view']['sortReverse']);
$flip    = $reverse ? -1 : 1;
$textKeys = ['developer' => 'developer', 'publisher' => 'publisher', 'genre' => 'genre', 'platform' => 'platform'];
// Unrated, never played and undated games have no value to sort by: last either way, like blanks.
// Play counts and time are counts, so 0 sorts as the smallest.
$noValueLast = ['rating' => 'rating', 'myrating' => 'myRating', 'recent' => 'lastPlayed', 'added' => 'addedAt', 'changed' => 'changedAt',
                'players' => 'players', 'cheats' => 'cheats', 'docs' => 'docs', 'hack' => 'hack', 'discs' => 'discs'];
// How many discs a row's game has: a set's count, 1 for a single disc of a set, 0 for any other game.
$discCount = static fn(array $r): int => is_array($r['discs']) ? (!empty($r['discs']['set']) ? (int) ($r['discs']['n'] ?? 2) : 1) : 0;
// The list's other columns (js\list.js), each sorted by what its cell says.
// Text made here rather than read off a field; Source is in the page's words.
$textOf = [
    'tags'     => static fn(array $r): string => implode(' · ', $r['tags']),
    'needsfix' => static fn(array $r): string => (string) $r['needsFix'],
    'file'     => static fn(array $r): string => (string) $r['file'],
    'source'   => static fn(array $r): string => $r['steam'] ? 'Steam' : ($r['local'] ? 'Your own' : ($r['scanned'] ? 'Scanned' : 'LaunchBox')),
];
// What a game lacks, a 1 per kind in the Missing art column's order: box art first.
$lacks = static fn(array $r): string => implode('', array_map(static fn(string $k): string => $r[$k] ? '0' : '1',
                                                             ['hasArt', 'hasBox3d', 'hasLogo', 'hasShot', 'hasFanart', 'hasVideo']));

$byTitle = static fn(array $a, array $b): int => strnatcasecmp($a['sortTitle'], $b['sortTitle']);

// Random: one draw per game, compared like any other key. A comparator that
// answers at random is undefined for usort (a biased shuffle at best).
$rnd = [];
if ($sort === 'random') {
    foreach ($rows as $r) {
        $rnd[$r['id']] = random_int(0, PHP_INT_MAX);
    }
}

// Favourites lead, except in the ranking by your own stars: unrated
// favourites would stand as a gap between the stars. And not in their own
// sort, which could then never be turned round.
$favFirst = !empty($s['view']['favouritesFirst']) && $sort !== 'myrating' && $sort !== 'favourite';

usort($rows, function ($a, $b) use ($sort, $favFirst, $flip, $textKeys, $textOf, $lacks, $noValueLast, $byTitle, $rnd, $discCount) {
    if ($favFirst && $a['favourite'] !== $b['favourite']) {
        return $a['favourite'] ? -1 : 1;
    }
    if (isset($textKeys[$sort]) || isset($textOf[$sort])) {
        $av = trim(isset($textOf[$sort]) ? $textOf[$sort]($a) : (string) $a[$textKeys[$sort]]);
        $bv = trim(isset($textOf[$sort]) ? $textOf[$sort]($b) : (string) $b[$textKeys[$sort]]);
        if (($av === '') !== ($bv === '')) {
            return $av === '' ? 1 : -1;                 // blanks last, either way
        }
        return ($flip * strnatcasecmp($av, $bv)) ?: $byTitle($a, $b);
    }
    if (isset($noValueLast[$sort])) {
        $k = $noValueLast[$sort];
        if (empty($a[$k]) !== empty($b[$k])) {
            return empty($a[$k]) ? 1 : -1;
        }
    }
    switch ($sort) {
        case 'recent':
            $c = strcmp((string) $b['lastPlayed'], (string) $a['lastPlayed']);
            break;
        case 'added':
            $c = strcmp((string) $b['addedAt'], (string) $a['addedAt']);
            break;
        case 'changed':
            $c = strcmp((string) $b['changedAt'], (string) $a['changedAt']);
            break;
        case 'playtime':
            $c = $b['seconds'] <=> $a['seconds'];
            break;
        case 'plays':
            $c = $b['plays'] <=> $a['plays'];
            break;
        case 'rating':
            $c = $b['rating'] <=> $a['rating'];
            break;
        case 'myrating':
            $c = $b['myRating'] <=> $a['myRating'];
            break;
        case 'players':
            $c = $b['players'] <=> $a['players'];
            break;
        case 'cheats':
            $c = $b['cheats'] <=> $a['cheats'];
            break;
        case 'favourite':
            $c = (int) $b['favourite'] <=> (int) $a['favourite'];
            break;
        case 'docs':
            $c = (int) $b['docs'] <=> (int) $a['docs'];
            break;
        case 'hack':
            // A hack before one that may be: "yes" sorts after "ask".
            $c = strcmp((string) $b['hack'], (string) $a['hack']);
            break;
        case 'discs':
            $c = $discCount($b) <=> $discCount($a);
            break;
        case 'ready':
            // What cannot start now comes first: those are the cells with something to say.
            $c = (int) $a['ready'] <=> (int) $b['ready'];
            break;
        case 'missing':
            $am = $lacks($a);
            $bm = $lacks($b);
            if (($am === '000000') !== ($bm === '000000')) {
                return $am === '000000' ? 1 : -1;       // nothing missing: last either way
            }
            // Most kinds first, and games lacking the same kinds side by side.
            $c = (substr_count($bm, '1') <=> substr_count($am, '1')) ?: strcmp($bm, $am);
            break;
        case 'year':
            $ay = (string) $a['released'];
            $by = (string) $b['released'];
            if (($ay === '') !== ($by === '')) {
                return $ay === '' ? 1 : -1;             // undated last, either way
            }
            $c = strcmp($ay, $by);
            break;
        case 'random':
            return ($rnd[$a['id']] ?? 0) <=> ($rnd[$b['id']] ?? 0);
        default:
            return $flip * $byTitle($a, $b);
    }
    return ($flip * $c) ?: $byTitle($a, $b);
});

// ---- group headers ------------------------------------------------------
/*
 * One label per row, from what the list is arranged by (first letter, value,
 * year, star band); the page draws a header wherever it changes. Orders with
 * no meaningful bands (recent, play time, random) get no labels.
 */
$grouped = !empty($s['view']['groupHeaders']);
if (isset($_GET['grouped'])) {
    $grouped = $_GET['grouped'] === '1';
}
// A sort with no bands gets NO labels at all, favourites included: a lone
// "Favourites" header with nothing after it to close it would sit over the
// whole list.
$banded = isset($textKeys[$sort]) || in_array($sort, ['year', 'rating', 'myrating', 'plays', 'title', ''], true);
if ($grouped && $banded) {
    foreach ($rows as &$r) {
        if ($favFirst && $r['favourite']) {
            $r['group'] = "\u{2605} Favourites";
            continue;
        }
        if (isset($textKeys[$sort])) {
            $v = trim((string) $r[$textKeys[$sort]]);
            $r['group'] = $v !== '' ? $v : 'Unknown ' . $sort;
        } elseif ($sort === 'year') {
            $r['group'] = $r['released'] ? substr((string) $r['released'], 0, 4) : 'Undated';
        } elseif ($sort === 'rating') {
            $stars = (int) floor((float) $r['rating']);
            $r['group'] = $r['rating'] ? $stars . ' to ' . ($stars + 1) . ' stars' : 'Unrated';
        } elseif ($sort === 'myrating') {
            $r['group'] = $r['myRating'] ? $r['myRating'] . ($r['myRating'] === 1 ? ' star' : ' stars') . ', yours' : 'Not rated by you';
        } elseif ($sort === 'plays') {
            $r['group'] = $r['plays'] > 0 ? 'Played' : 'Never played';
        } elseif ($sort === 'title' || $sort === '') {
            $first = strtoupper(substr(ltrim($r['sortTitle']), 0, 1));
            $r['group'] = ctype_alpha($first) ? $first : '0-9';
        }
    }
    unset($r);
}

// The first lot goes at once; the page asks for the rest as it goes (js\more.js): from which row, and how many.
$from = isset($_GET['from']) ? max(0, (int) $_GET['from']) : null;
$lot  = $from === null ? (int) $s['view']['pageSize'] : max(1, min(20000, (int) ($_GET['lot'] ?? $s['view']['pageSize'])));

// Wheel, Carousel and the consoles screen wait while no emulator is on this PC and no game can start (js\viewlock.js).
// Their words name RetroArch only while it would play a console here, or there are no games yet.
$viewsLocked = xs_emu_none_here(xs_norm_path((string) ($s['paths']['launchbox'] ?? '')))
               && !in_array(true, array_map(static fn ($g) => ($g['launch'] ?? null) !== null, $lib['games'] ?? []), true);
if ($viewsLocked) {
    require_once __DIR__ . '/../includes/setup.php';
}
$viewsWaitRa = !$viewsLocked || !($lib['games'] ?? [])
               || array_filter(array_unique(array_column($lib['games'], 'platform')), static fn ($p) => xs_setup_ra_plays((string) $p)) !== [];

xs_json([
    'ok'        => true,
    'count'     => count($rows),
    // Which list this is, game for game and in order: the rest is added only while it is still the same list.
    // A random order is made new at every read, so it has no rest to ask for.
    'sig'       => $sort === 'random' ? null : md5(implode(',', array_column($rows, 'id'))),
    'from'      => (int) $from,
    // How many games in the whole library wait for your word on being a hack.
    'hackAsk'   => count(array_keys($hackMarks, 'ask', true)),
    'total'     => $totalShown,
    'platforms' => $lib['platforms'] ?? [],
    // Every tag on a game in the library, A to Z, with how many carry it,
    // "needs fix" and "runs" always among them.
    'tags'      => (static function (array $c): array {
        $c = xs_tags_with_standard($c);
        uksort($c, static fn($a, $b) => strnatcasecmp((string) $a, (string) $b));
        $out = [];
        foreach ($c as $name => $n) {
            $out[] = ['name' => (string) $name, 'count' => $n];
        }
        return $out;
    })($tagCounts),
    // While a filter is on, how many games pass it per console and per
    // collection; objects even when empty, so the page reads them one way.
    'filtered'  => $anyFilter ? [
        'platforms'   => (object) $platformFiltered,
        'collections' => (object) $collectionFiltered,
    ] : null,
    // An empty collection is left out (Recently added and Recently changed
    // aside, with their reason). array_values, or holes in the keys make
    // json_encode ship an OBJECT, not an array.
    'collections' => array_values(array_filter(array_map(
        static function (string $k, string $label) use ($collectionCounts, $addedEmpty, $changedEmpty): array {
            $c = ['key' => $k, 'label' => $label, 'count' => $collectionCounts[$k]];
            $why = ['@added' => $addedEmpty, '@changed' => $changedEmpty];
            if ($c['count'] === 0 && isset($why[$k])) {
                $c['note'] = $why[$k];
            }
            return $c;
        },
        array_keys($collections), $collections
    ), static fn(array $c) => $c['count'] > 0 || $c['key'] === '@added' || $c['key'] === '@changed')),
    // Moves whenever a console picture might have; the page puts it in those
    // pictures' addresses so the browser can keep them (includes\platform-art.php).
    'platformArtRev' => xs_platform_art_rev($s),
    // The day Recently added starts from, for the Rows view's own row.
    'addedSince' => $addedCutoff,
    'viewsLocked' => $viewsLocked,
    'viewsWaitRa' => $viewsWaitRa,
    'generated' => $lib['generatedAt'] ?? null,
    'sort'      => $sort,
    'reverse'   => $reverse,
    'grouped'   => $grouped,
    'games'     => array_slice($rows, (int) $from, $lot),
]);
