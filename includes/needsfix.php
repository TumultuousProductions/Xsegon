<?php
/**
 * Which games need fixing, and why: a game whose last launch failed, or whose
 * last runs check could not start it, is greyed out under a red NEEDS FIX
 * (js\util.js fixMark).
 *
 * Three records:
 *   data\launch-results.json  every Play, written by bin\launch.ps1: the
 *                             last launch of each game, ok or not, and why
 *   data\runcheck\results.json  the runs check (includes\runcheck.php)
 *   data\fix-marks.json       your own word: the "needs fix" tag put on or
 *                             taken off
 * The newest launch or check wins. Your "needs fix" stays until you take it
 * off (a game can start and still need fixing); taking it off clears what
 * came before, and a failure after that marks the game again.
 *
 * The "needs fix" tag (includes\tags.php xs_tags_effective) is on exactly the
 * games listed here.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/runcheck.php';
require_once __DIR__ . '/tags.php';

function xs_fix_marks_path(): string
{
    return xs_data_path('fix-marks.json');
}

/** id => ['fix' => bool, 'at' => when]: your word on each game you gave one for. */
function xs_fix_marks(): array
{
    $m = xs_read_json(xs_fix_marks_path(), []);
    return is_array($m) ? $m : [];
}

/** Your word on one game: true it needs fixing (until you say otherwise), false it does not. */
function xs_fix_mark(string $id, bool $fix, ?string &$why = null): bool
{
    $m = xs_fix_marks();
    $m[$id] = ['fix' => $fix, 'at' => date('c')];
    return xs_write_json(xs_fix_marks_path(), $m, $why);
}

/** The reason a game marked by you gives. */
const XS_FIX_MINE = 'you marked it needs fix';

/** Game id => the reason it needs fixing, for every game that does. */
function xs_needs_fix(): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $launches = xs_read_json(xs_data_path('launch-results.json'), []);
    if (!is_array($launches)) {
        xs_log('FIX', 'data\\launch-results.json is not a list of launches; launch failures are not marked until the next launch rewrites it');
        $launches = [];
    }
    $when = static fn($at): int => is_string($at) && ($t = strtotime($at)) !== false ? $t : 0;

    /* The newest word on each game decides: [when, needs fixing, why, rank].
       On the same second, your word outranks a launch, and a launch the
       check. "look at it" says nothing either way, so it is not a word. */
    $last = [];
    $offer = static function (string $id, int $at, bool $bad, string $why, int $rank) use (&$last): void {
        $cur = $last[$id] ?? null;
        if ($cur === null || $at > $cur[0] || ($at === $cur[0] && $rank > $cur[3])) {
            $last[$id] = [$at, $bad, $why, $rank];
        }
    };
    foreach (xs_runcheck_results() as $id => $rc) {
        if (!is_array($rc)) {
            continue;
        }
        $result = (string) ($rc['result'] ?? '');
        if ($result === 'boots') {
            $offer((string) $id, $when($rc['at'] ?? null), false, '', 0);
        } elseif (in_array($result, ['crashed', 'nostart', 'noanswer'], true)) {
            $offer((string) $id, $when($rc['at'] ?? null), true, 'the runs check could not start it: ' . (string) ($rc['reason'] ?? $result), 0);
        }
    }
    foreach ($launches as $id => $l) {
        if (is_array($l)) {
            $offer((string) $id, $when($l['at'] ?? null), empty($l['ok']), 'the last launch failed: ' . (string) ($l['why'] ?? 'no reason given'), 1);
        }
    }
    $mine = [];
    foreach (xs_fix_marks() as $id => $mark) {
        if (!is_array($mark)) {
            continue;
        }
        if (!empty($mark['fix'])) {
            $mine[(string) $id] = true;                 // yours stays until you take it off
        } else {
            $offer((string) $id, $when($mark['at'] ?? null), false, '', 2);
        }
    }
    $map = [];
    foreach ($last as $id => $word) {
        if ($word[1]) {
            $map[(string) $id] = $word[2];
        }
    }
    foreach ($mine as $id => $_) {
        $map[$id] = XS_FIX_MINE;
    }
    return $map;
}
