<?php
/**
 * Xsegon - which game a hack is a hack of.
 *
 *     data\hack-of.json   { "<game id>": { "is": "hack" | "not", "of": "<game id>" | "", "at": <unix time> } }
 *
 * A hack stays in its console's list with a mark, and shows in its base game's Hacks tab.
 * Xsegon suggests which games may be hacks and of what; nothing counts until the person
 * says so, and a game waiting for that wears "Hack?".
 */
declare(strict_types=1);

require_once __DIR__ . '/filecheck.php';      // the lists read this file, so it loads no more than they need

function xs_hackof_path(): string
{
    return xs_data_path('hack-of.json');
}

function xs_hackof_all(): array
{
    $a = xs_read_json(xs_hackof_path(), []);
    return is_array($a) ? $a : [];
}

/** Keeps what was said of one game; null takes it back, and the game is in doubt again. */
function xs_hackof_set(string $id, ?array $rec, ?string &$why = null): bool
{
    $all = xs_hackof_all();
    if ($rec === null) {
        unset($all[$id]);
    } else {
        $all[$id] = ['is' => $rec['is'] === 'hack' ? 'hack' : 'not', 'of' => $rec['is'] === 'hack' ? (string) ($rec['of'] ?? '') : '', 'at' => time()];
    }
    return xs_write_json(xs_hackof_path(), $all, $why);
}

/**
 * Whether an unsettled game may be a hack: 'ask', or null. A patch file is asked about
 * too. $consoles: the lists that hold games which are not your own.
 */
function xs_hackof_may(array $g, ?array $rec, array $consoles): ?string
{
    if (!empty($g['local'])) {
        // A program of yours filed under a console is there as a version of one of its games.
        return (string) ($g['romPath'] ?? '') !== '' && empty($g['steam']) && isset($consoles[(string) $g['platform']]) ? 'ask' : null;
    }
    if ($rec !== null) {
        if (($rec['kind'] ?? '') === 'patch') {
            return 'ask';
        }
        return ($rec['kind'] ?? '') === 'unknown' && !in_array($rec['guess'] ?? null, ['translation', 'homebrew'], true) ? 'ask' : null;
    }
    // Not checked, or a console the check cannot read: its name and its folder are all there is.
    return xs_fc_guess((string) ($g['romPath'] ?? ''), null) === 'hack' ? 'ask' : null;
}

/** Each game's mark for the lists: 'yes' a hack, 'ask' in doubt until you say. Two small files, read once. */
function xs_hackof_marks(array $games): array
{
    $said = xs_hackof_all();
    $fc = xs_fc_all();
    $consoles = [];
    foreach ($games as $g) {
        if (empty($g['local'])) {
            $consoles[(string) $g['platform']] = true;
        }
    }
    $out = [];
    foreach ($games as $g) {
        $id = (string) $g['id'];
        if (isset($said[$id])) {
            if (($said[$id]['is'] ?? '') === 'hack') {
                $out[$id] = 'yes';
            }
            continue;
        }
        $may = xs_hackof_may($g, isset($fc[$id]) && is_array($fc[$id]) ? $fc[$id] : null, $consoles);
        if ($may !== null) {
            $out[$id] = $may;
        }
    }
    return $out;
}

/**
 * Games just added: cartridges are checked as they come in and possible hacks counted, only
 * where the console's list is fresh (nothing fetched while the scan waits), the first $most.
 * 'looked', 'unknown' and 'once' are for the log.
 */
function xs_hackof_check_new(array $ids, int $most = 20): array
{
    $ids = array_values(array_unique(array_filter(array_map('strval', $ids))));
    $out = ['checked' => 0, 'ask' => 0, 'looked' => count($ids), 'unknown' => 0, 'once' => count($ids) > 2];
    // Reading one game builds every row: three or more are looked up in one build, one or two alone.
    $rows = [];
    if ($out['once']) {
        foreach (xs_library()['games'] ?? [] as $g) {
            $rows[(string) ($g['id'] ?? '')] ??= $g;
        }
    }
    $kept = xs_fc_all();
    foreach ($ids as $i => $id) {
        $g = $out['once'] ? ($rows[$id] ?? null) : xs_game($id);
        if ($g === null) {
            $out['unknown']++;
            continue;
        }
        if (!empty($g['local'])) {
            continue;
        }
        if ($i < $most && xs_fc_can((string) $g['platform'])) {
            $have = xs_read_json(xs_lr_cache_name((string) xs_lr_system((string) $g['platform']), 'releases'), null);
            if (is_array($have) && time() - (int) ($have['at'] ?? 0) < XS_LR_KEEP_DAYS * 86400 && xs_fc_check($g) !== null) {
                $out['checked']++;
                $kept = xs_fc_all();     // the check kept a new answer
            }
        }
        $rec = $kept[$id] ?? null;
        if (xs_hackof_may($g, is_array($rec) ? $rec : null, []) === 'ask') {
            $out['ask']++;
        }
    }
    return $out;
}

/** A name's words as two files of one game share them: no tags, no file ending, no "the", lower case. */
function xs_hackof_words(string $name): string
{
    $n = strtolower((string) preg_replace('/\s*[\[(].*$/', '', (string) pathinfo(str_replace('\\', '/', $name), PATHINFO_BASENAME)));
    $n = (string) preg_replace('/\.(zip|7z|nes|sfc|smc|z64|n64|v64|gba|gbc|gb|nds|md|gen|bin|sms|gg|32x|iso|chd|cue)$/', '', $n);
    $n = (string) preg_replace('/\bthe\b/', ' ', str_replace('&', ' and ', $n));
    return trim((string) preg_replace('/[^a-z0-9]+/', ' ', $n));
}

function xs_hackof_norm(string $name): string
{
    return str_replace(' ', '', xs_hackof_words($name));
}

/** Whether the words go on, past their first $taken letters, with a number: the next game of a series, not this one. */
function xs_hackof_goes_on(string $words, int $taken): bool
{
    $i = 0;
    for ($at = 0, $n = strlen($words); $i < $n && $at < $taken; $i++) {
        $at += $words[$i] === ' ' ? 0 : 1;
    }
    $rest = substr($words, $i);
    if ($rest === '' || $rest[0] !== ' ') {
        return $rest !== '' && ctype_digit($rest[0]);       // cut inside a word: sonic3
    }
    return preg_match('/^ (\d+|i{2,3}|iv|v|vi{1,3}|ix|x)( |$)/', $rest) === 1;     // "2p" is two players, not a second game
}

/** The games one could be a hack of: its console's own, none of them a hack or in doubt. */
function xs_hackof_bases(array $game, array $games, array $marks): array
{
    $out = [];
    foreach ($games as $g) {
        if ((string) $g['platform'] !== (string) $game['platform'] || $g['id'] === $game['id'] || !empty($g['local']) || isset($marks[(string) $g['id']])) {
            continue;
        }
        $out[] = ['id' => (string) $g['id'], 'title' => (string) $g['title']];
    }
    usort($out, static fn(array $a, array $b): int => strnatcasecmp($a['title'], $b['title']));
    return $out;
}

/**
 * The game a hack most likely comes from, with why: ['id', 'title', 'why'],
 * id '' when the game it names is not in the library. null when none can be named.
 */
function xs_hackof_suggest(array $game, array $games, array $marks): ?array
{
    require_once __DIR__ . '/hacks.php';
    $platform = (string) $game['platform'];
    $fc = xs_fc_all();
    $s = xs_settings();
    $cands = [];
    foreach ($games as $g) {
        $gid = (string) $g['id'];
        if ((string) $g['platform'] !== $platform || $gid === (string) $game['id'] || !empty($g['local']) || isset($marks[$gid])) {
            continue;
        }
        $names = [xs_hackof_norm((string) $g['title']), xs_hackof_norm((string) ($g['romPath'] ?? ''))];
        if (($fc[$gid]['kind'] ?? '') === 'known') {
            $names[] = xs_hackof_norm((string) $fc[$gid]['name']);
        }
        $cands[$gid] = ['title' => (string) $g['title'], 'rom' => xs_rom_real_path((string) ($g['romPath'] ?? ''), $s),
                        'names' => array_values(array_unique(array_filter($names, static fn(string $n): bool => strlen($n) >= 4)))];
    }
    if (!$cands) {
        return null;
    }
    $named = static function (string $words, int $least) use ($cands): ?string {
        // The same name first, then the game whose name it starts with, the longest of them.
        $want = str_replace(' ', '', $words);
        $best = null;
        $len = 0;
        foreach ($cands as $gid => $c) {
            foreach ($c['names'] as $n) {
                if ($n === $want) {
                    return (string) $gid;
                }
                if (strlen($n) >= $least && strlen($n) > $len && str_starts_with($want, $n) && !xs_hackof_goes_on($words, strlen($n))) {
                    $best = (string) $gid;
                    $len = strlen($n);
                }
            }
        }
        return $best;
    };

    if (!empty($game['local'])) {
        // A program of yours: the game whose file, or a copy of whose file, its arguments name.
        $args = (string) ($game['launch']['args'] ?? '');
        preg_match_all('/"([^"]+)"|([^\s"=]+)/', $args, $tokens, PREG_SET_ORDER);
        $files = [];
        foreach ($tokens as $t) {
            $f = $t[1] !== '' ? $t[1] : ($t[2] ?? '');
            if (strpbrk($f, '\\/') !== false && @is_file($f)) {
                $files[] = $f;
            }
        }
        foreach ($files as $f) {
            foreach ($cands as $gid => $c) {
                if ($c['rom'] !== '' && strcasecmp(str_replace('/', '\\', $f), str_replace('/', '\\', $c['rom'])) === 0) {
                    return ['id' => (string) $gid, 'title' => $c['title'], 'why' => 'it is started with that game\'s file'];
                }
            }
        }
        if ($files && xs_fc_can($platform)) {
            $idx = xs_hack_index($platform, $games);
            foreach ($files as $f) {
                $size = (int) @filesize($f);
                $same = array_keys(array_filter($idx['games'], static fn(array $gs): bool => (int) $gs['bytes'] === $size && $size > 0 && $size <= XS_HACK_MAX_BYTES));
                if (!$same) {
                    continue;
                }
                $crc = (string) @hash_file('crc32b', $f);
                $sums = xs_hack_index($platform, $games, $same)['games'];
                foreach ($same as $gid) {
                    if (isset($cands[$gid]) && ($sums[$gid]['crc'] ?? null) === $crc) {
                        return ['id' => (string) $gid, 'title' => $cands[$gid]['title'], 'why' => 'it is started with its own copy of that game\'s file'];
                    }
                }
            }
        }
    } else {
        $rec = isset($fc[(string) $game['id']]) && is_array($fc[(string) $game['id']]) ? $fc[(string) $game['id']] : [];
        // Its file is a patch: the game whose checksum the patch carries, when it carries one.
        foreach (($rec['kind'] ?? '') === 'patch' || in_array(strtolower((string) pathinfo((string) ($game['romPath'] ?? ''), PATHINFO_EXTENSION)), ['zip', '7z'], true)
                 ? xs_hacks_for($game, $games)['own'] : [] as $o) {
            if ($o['on'] !== null && $o['how'] === 'checksum' && isset($cands[$o['on']['id']])) {
                return ['id' => (string) $o['on']['id'], 'title' => $cands[$o['on']['id']]['title'], 'why' => 'its patch carries the checksum of that game\'s file'];
            }
            if ($o['needs'] !== null) {
                return ['id' => '', 'title' => trim((string) preg_replace('/\s*\(.*$/', '', (string) $o['needs'])),
                        'why' => 'its patch carries the checksum of ' . $o['needs'] . ', which is not in the library'];
            }
        }
        $base = (string) ($rec['base'] ?? '');
        if ($base !== '') {
            $gid = $named(xs_hackof_words($base), 99);
            $plain = trim((string) preg_replace('/\s*\(.*$/', '', $base));
            return $gid !== null
                ? ['id' => $gid, 'title' => $cands[$gid]['title'], 'why' => 'its cartridge carries the code of ' . $base]
                : ['id' => '', 'title' => $plain, 'why' => 'its cartridge carries the code of ' . $base . ', which is not in the library'];
        }
        $head = (string) ($rec['header']['title'] ?? '');
        $h = xs_hackof_norm($head);
        if (strlen($h) >= 6) {
            // A header cuts a long name short: the game whose name starts with it, the shortest of them.
            $gid = $named(xs_hackof_words($head), 6);
            $len = PHP_INT_MAX;
            if ($gid === null) {
                foreach ($cands as $cid => $c) {
                    foreach ($c['names'] as $n) {
                        if (strlen($n) < $len && str_starts_with($n, $h)) {
                            $gid = (string) $cid;
                            $len = strlen($n);
                        }
                    }
                }
            }
            if ($gid !== null) {
                return ['id' => $gid, 'title' => $cands[$gid]['title'], 'why' => 'its cartridge header says ' . trim($head)];
            }
        }
    }
    foreach ([xs_hackof_words((string) ($game['romPath'] ?? '')), xs_hackof_words((string) $game['title'])] as $mine) {
        $gid = $mine === '' ? null : $named($mine, 6);
        if ($gid !== null) {
            return ['id' => $gid, 'title' => $cands[$gid]['title'], 'why' => 'it is named like that game'];
        }
    }
    return null;
}

/** What a game's own Hacks tab says of it: settled or in doubt, the game it comes from, and the suggestion. */
function xs_hackof_state(array $game, array $games, ?array $marks = null): array
{
    $id = (string) $game['id'];
    $marks = $marks ?? xs_hackof_marks($games);
    $said = xs_hackof_all()[$id] ?? null;
    $rec = xs_fc_all()[$id] ?? null;
    $state = is_array($said) ? (($said['is'] ?? '') === 'hack' ? 'hack' : 'not') : (($marks[$id] ?? null) === 'ask' ? 'ask' : null);
    $of = null;
    if ($state === 'hack' && (string) ($said['of'] ?? '') !== '') {
        $of = ['id' => (string) $said['of'], 'title' => null];
        foreach ($games as $g) {
            if ((string) $g['id'] === $of['id']) {
                $of['title'] = (string) $g['title'];
                break;
            }
        }
    }
    // A known release is no hack, and is not asked about.
    $may = !empty($game['local'])
        ? (string) ($game['romPath'] ?? '') !== '' && empty($game['steam'])
        : (is_array($rec) ? ($rec['kind'] ?? '') : '') !== 'known';
    return ['state' => $state, 'of' => $of, 'may' => $may, 'own' => !empty($game['local']),
            'guess' => is_array($rec) ? ($rec['guess'] ?? null) : null,
            'suggest' => $may && $state !== 'not' ? xs_hackof_suggest($game, $games, $marks) : null];
}

/** The games in the library that were said to be hacks of this one. */
function xs_hackof_games(string $baseId, array $games): array
{
    $ids = [];
    foreach (xs_hackof_all() as $id => $rec) {
        if (is_array($rec) && ($rec['is'] ?? '') === 'hack' && (string) ($rec['of'] ?? '') === $baseId) {
            $ids[(string) $id] = true;
        }
    }
    $out = [];
    foreach ($ids ? $games : [] as $g) {
        if (isset($ids[(string) $g['id']])) {
            $out[] = ['id' => (string) $g['id'], 'title' => (string) $g['title'], 'platform' => (string) $g['platform'],
                      'own' => !empty($g['local']), 'ready' => ($g['launch'] ?? null) !== null];
        }
    }
    usort($out, static fn(array $a, array $b): int => strnatcasecmp($a['title'], $b['title']));
    return $out;
}

/** Every game still in doubt, with the game Xsegon would name for it: Games > Hacks to settle. */
function xs_hackof_unsettled(array $games): array
{
    $marks = xs_hackof_marks($games);
    $out = [];
    foreach ($games as $g) {
        if (($marks[(string) $g['id']] ?? null) !== 'ask') {
            continue;
        }
        $out[] = ['id' => (string) $g['id'], 'title' => (string) $g['title'], 'platform' => (string) $g['platform'], 'own' => !empty($g['local']),
                  'file' => basename(str_replace('\\', '/', (string) ($g['romPath'] ?? ''))),
                  'suggest' => xs_hackof_suggest($g, $games, $marks)];
    }
    usort($out, static fn(array $a, array $b): int => [strtolower($a['platform']), strtolower($a['title'])] <=> [strtolower($b['platform']), strtolower($b['title'])]);
    return $out;
}
