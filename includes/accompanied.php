<?php
/**
 * Xsegon - files that go with a game and are not played: an install disc, a
 * bonus disc.
 *
 *     data\accompanied.json       yours: { "<file's game id>": { "is": "with" | "not",
 *                                 "with": "<game id>" | "", "kind": "install" | "bonus" | "other",
 *                                 "title", "platform", "at" } }
 *     data\accompanied-told.json  the suggestions the mailbox has named: { "<id>": "<date>" }
 *
 * Suggestions come from a file's name; nothing changes until the person says.
 * A file said to go with a game leaves the lists for that game's Accompanied
 * files tab; with no such game it stays, Play greyed. "not" is never suggested again.
 */
declare(strict_types=1);

function xs_acc_path(): string      { return xs_data_path('accompanied.json'); }
function xs_acc_told_path(): string { return xs_data_path('accompanied-told.json'); }

function xs_acc_all(): array
{
    $a = xs_read_json(xs_acc_path(), []);
    return is_array($a) ? $a : [];
}

/** Keeps what was said of one file; null takes it back. */
function xs_acc_set(string $id, ?array $rec, ?string &$why = null): bool
{
    $all = xs_acc_all();
    if ($rec === null) {
        unset($all[$id]);
    } else {
        $all[$id] = $rec + ['at' => time()];
    }
    return xs_write_json(xs_acc_path(), $all ?: new stdClass(), $why);
}

/** What a file's own name says it is: Redump's "(Installation Disc)" and "Bonus Disc". */
function xs_acc_kind_from_name(string $rom): ?string
{
    $n = basename(str_replace('\\', '/', $rom));
    if (preg_match('/\((?:Installation|Install) Disc\)/i', $n)) {
        return 'install';
    }
    return preg_match('/\bBonus Disc\b/i', $n) ? 'bonus' : null;
}

function xs_acc_kind_words(string $kind): string
{
    return ['install' => 'Install disc', 'bonus' => 'Bonus disc'][$kind] ?? 'Accompanied file';
}

/** A file that is a disc image, for the multi-disc mark on the game it goes with. */
function xs_acc_is_disc(string $rom): bool
{
    return in_array(strtolower((string) pathinfo($rom, PATHINFO_EXTENSION)),
        ['iso', 'chd', 'cue', 'gdi', 'cdi', 'img', 'mdf', 'nrg', 'cso', 'zso', 'rvz', 'wia', 'wbfs', 'gcz', 'pbp', 'm3u'], true);
}

/** A game's disc mark with the discs that go with it counted in, so it wears the multi-disc mark. */
function xs_acc_disc_info(array $g, ?array $own): ?array
{
    $acc = 0;
    foreach ($g['accompanied'] ?? [] as $f) {
        $acc += xs_acc_is_disc((string) $f['romPath']) ? 1 : 0;
    }
    if ($acc === 0) {
        return $own;
    }
    $n = is_array($own) && !empty($own['set']) ? (int) ($own['n'] ?? 1) : 1;
    return ['set' => true, 'n' => $n + $acc, 'acc' => $acc];
}

/**
 * Takes each file said to go with a game out of the library and hangs it on
 * that game ('accompanied'). One whose game is not here stays, with Play
 * greyed and 'accompanies' saying why. Counts follow, as for a hidden game.
 */
function xs_apply_accompanied(array $lib): array
{
    $said = xs_acc_all();
    if (!$said || empty($lib['games'])) {
        return $lib;
    }
    $at = [];
    foreach ($lib['games'] as $i => $g) {
        $at[(string) ($g['id'] ?? '')] = $i;
    }
    $drop = [];
    foreach ($said as $id => $rec) {
        $id = (string) $id;
        if (!is_array($rec) || ($rec['is'] ?? '') !== 'with' || !isset($at[$id])) {
            continue;
        }
        $i = $at[$id];
        $g = $lib['games'][$i];
        $kind = (string) ($rec['kind'] ?? 'other');
        $with = (string) ($rec['with'] ?? '');
        // A game that is itself said to go with another cannot hold one: it would vanish with it.
        $home = $with !== '' && $with !== $id && isset($at[$with]) && (($said[$with]['is'] ?? '') !== 'with');
        if ($home) {
            $lib['games'][$at[$with]]['accompanied'][] = ['id' => $id, 'title' => (string) $g['title'], 'platform' => (string) $g['platform'],
                                                          'romPath' => (string) ($g['romPath'] ?? ''), 'kind' => $kind];
            $drop[$id] = true;
            continue;
        }
        $lib['games'][$i]['accompanies'] = ['with' => $with, 'kind' => $kind];
        $lib['games'][$i]['launch'] = null;
        $lib['games'][$i]['launchError'] = xs_acc_kind_words($kind) . ' of a game that is not in the library: it is not played';
    }
    return $drop ? xs_lib_without($lib, $drop) : $lib;
}

/** Whether a game may be said to go with another: a file of a console, holding none itself. */
function xs_acc_may(array $g): bool
{
    return (string) ($g['romPath'] ?? '') !== '' && empty($g['steam']) && empty($g['local']) && empty($g['accompanied']);
}

/** The games a file could go with: its console's own, none of them going with another. */
function xs_acc_homes(array $file, array $games): array
{
    $said = xs_acc_all();
    $out = [];
    foreach ($games as $g) {
        $gid = (string) $g['id'];
        if ((string) $g['platform'] !== (string) $file['platform'] || $gid === (string) $file['id'] || !empty($g['local'])
            || !empty($g['steam']) || ($said[$gid]['is'] ?? '') === 'with') {
            continue;
        }
        $out[] = ['id' => $gid, 'title' => (string) $g['title'], 'file' => basename(str_replace('\\', '/', (string) ($g['romPath'] ?? '')))];
    }
    usort($out, static fn(array $a, array $b): int => strnatcasecmp($a['title'], $b['title']));
    return $out;
}

/**
 * The game a file most likely goes with, with why: the same Games Database
 * match first, then the game whose name the file's name starts with. null
 * when none can be named.
 */
function xs_acc_suggest(array $file, array $games): ?array
{
    require_once __DIR__ . '/hackof.php';     // the name matching hacks use; only here, since every library read loads this file
    $said = xs_acc_all();
    $cands = [];
    foreach ($games as $g) {
        $gid = (string) $g['id'];
        if ((string) $g['platform'] !== (string) $file['platform'] || $gid === (string) $file['id'] || !empty($g['local'])
            || !empty($g['steam']) || ($said[$gid]['is'] ?? '') === 'with' || xs_acc_kind_from_name((string) ($g['romPath'] ?? '')) !== null) {
            continue;
        }
        $cands[$gid] = $g;
    }
    $db = (int) ($file['dbId'] ?? 0);
    if ($db > 0) {
        foreach ($cands as $gid => $g) {
            if ((int) ($g['dbId'] ?? 0) === $db) {
                return ['id' => $gid, 'title' => (string) $g['title'], 'why' => 'both are the same game in the Games Database'];
            }
        }
    }
    $want = xs_hackof_words((string) ($file['romPath'] ?? ''));
    $flat = str_replace(' ', '', $want);
    $best = null;
    $len = 0;
    foreach ($cands as $gid => $g) {
        foreach ([xs_hackof_norm((string) $g['title']), xs_hackof_norm((string) ($g['romPath'] ?? ''))] as $n) {
            if (strlen($n) < 4) {
                continue;
            }
            if ($n === $flat) {
                return ['id' => $gid, 'title' => (string) $g['title'], 'why' => 'it is named like that game'];
            }
            if (strlen($n) >= 6 && strlen($n) > $len && str_starts_with($flat, $n) && !xs_hackof_goes_on($want, strlen($n))) {
                $best = $gid;
                $len = strlen($n);
            }
        }
    }
    return $best !== null ? ['id' => $best, 'title' => (string) $cands[$best]['title'], 'why' => 'its name starts with that game\'s name'] : null;
}

/** Every file whose name says it goes with a game and that nobody has spoken for, with the game Xsegon would name. */
function xs_acc_unsettled(array $games): array
{
    $said = xs_acc_all();
    $out = [];
    foreach ($games as $g) {
        $id = (string) $g['id'];
        $kind = xs_acc_kind_from_name((string) ($g['romPath'] ?? ''));
        if ($kind === null || isset($said[$id]) || !xs_acc_may($g)) {
            continue;
        }
        $out[] = ['id' => $id, 'title' => (string) $g['title'], 'platform' => (string) $g['platform'], 'kind' => $kind,
                  'words' => xs_acc_kind_words($kind), 'file' => basename(str_replace('\\', '/', (string) $g['romPath'])),
                  'suggest' => xs_acc_suggest($g, $games)];
    }
    usort($out, static fn(array $a, array $b): int => [strtolower($a['platform']), strtolower($a['title'])] <=> [strtolower($b['platform']), strtolower($b['title'])]);
    return $out;
}

/** What one game's Files tab says: the files that go with it, and what it is itself. */
function xs_acc_state(array $game, array $games): array
{
    $id = (string) $game['id'];
    $rec = xs_acc_all()[$id] ?? null;
    $files = [];
    foreach ($game['accompanied'] ?? [] as $f) {
        $files[] = ['id' => (string) $f['id'], 'title' => (string) $f['title'], 'kind' => (string) $f['kind'],
                    'words' => xs_acc_kind_words((string) $f['kind']), 'file' => basename(str_replace('\\', '/', (string) $f['romPath']))];
    }
    $kind = xs_acc_kind_from_name((string) ($game['romPath'] ?? ''));
    $state = is_array($rec) ? (($rec['is'] ?? '') === 'with' ? 'with' : 'not') : ($kind !== null && xs_acc_may($game) ? 'ask' : null);
    $with = null;
    if ($state === 'with' && (string) ($rec['with'] ?? '') !== '') {
        $with = ['id' => (string) $rec['with'], 'title' => null];
        foreach ($games as $g) {
            if ((string) $g['id'] === $with['id']) {
                $with['title'] = (string) $g['title'];
            }
        }
    }
    $k = is_array($rec) ? (string) ($rec['kind'] ?? 'other') : ($kind ?? 'other');
    return ['files' => $files, 'state' => $state, 'with' => $with, 'kind' => $k, 'words' => xs_acc_kind_words($k),
            'may' => xs_acc_may($game) || $state === 'with',
            'suggest' => $state === 'ask' ? xs_acc_suggest($game, $games) : null];
}

/** Names new suggestions in the mailbox, once each. How many it named. */
function xs_acc_tell(string $by): int
{
    require_once __DIR__ . '/news.php';
    $told = xs_read_json(xs_acc_told_path(), []);
    $told = is_array($told) ? $told : [];
    $new = array_values(array_filter(xs_acc_unsettled(xs_library()['games'] ?? []), static fn(array $r): bool => !isset($told[$r['id']])));
    if (!$new) {
        return 0;
    }
    foreach ($new as $r) {
        $told[$r['id']] = date('c');
    }
    // Kept before it is said, so a failed write is not said again at every look.
    if (!xs_write_json(xs_acc_told_path(), $told)) {
        return 0;
    }
    $lines = array_map(static fn(array $r): string => $r['file'] . ': ' . ($r['suggest']
        ? 'may be the ' . strtolower($r['words']) . ' of ' . $r['suggest']['title']
        : 'its name says ' . strtolower($r['words']) . ', and no game in the library could be named for it'), $new);
    $one = count($new) === 1;
    xs_messages_add([
        'id'    => 'msg-' . bin2hex(random_bytes(6)),
        'at'    => date('c'),
        'kind'  => 'tip',
        'title' => $one ? 'A file that may go with a game' : count($new) . ' files that may go with a game',
        'body'  => 'Read from ' . ($one ? 'its name' : 'their names') . '. Nothing changes until you say: until then '
                 . ($one ? 'it stays a game' : 'each stays a game') . ' in its list. Said yes, ' . ($one ? 'it moves' : 'each moves')
                 . ' into the Files tab of the game it goes with, and Play on it is greyed.',
        'items' => $lines,
        'n'     => count($lines),
        'opens' => ['accompanied'],
        'read'  => false,
    ]);
    xs_log('ACC', 'mailbox told of ' . count($new) . ' file(s) that may go with a game (' . $by . '): '
        . implode('; ', array_map(static fn(array $r): string => $r['file'] . ' -> ' . ($r['suggest']['title'] ?? 'none'), $new)));
    return count($new);
}
