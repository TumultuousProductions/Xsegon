<?php
/**
 * Xsegon - a game's versions: the files the list rolls into one card, the same
 * console and title (api\library.php). They are one game: what a person
 * chooses is kept on every version (the star, the rating, tags, the note, the
 * cheats). What lives in a file stays with that file: saves, save slots,
 * texture packs, achievements, the file check and the NEEDS FIX mark.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';

/** The card a game sits on, as the list rolls versions into one. */
function xs_version_key(array $g): string
{
    return mb_strtolower((string) ($g['platform'] ?? '')) . '|' . mb_strtolower(trim((string) ($g['title'] ?? '')));
}

/**
 * This game and every version of it: [game or null, [id, ...]], its own id first,
 * each a string (an id kept as an array key would turn "12345" into a number).
 * A game not in the library (since removed) stands alone, so a mark left on it can
 * still be taken off.
 */
function xs_game_versions(string $id): array
{
    $game = null;
    $all  = xs_library_build($id)['games'] ?? [];
    foreach ($all as $g) {
        if ((string) ($g['id'] ?? '') === $id) {
            $game = $g;
            break;
        }
    }
    return [$game, $game === null ? [$id] : xs_versions_of($game, $all)];
}

/** The ids of every version of $game among $games, its own first. */
function xs_versions_of(array $game, array $games): array
{
    $id  = (string) $game['id'];
    $key = xs_version_key($game);
    $ids = [$id];
    foreach ($games as $g) {
        $other = (string) ($g['id'] ?? '');
        if ($other !== '' && $other !== $id && xs_version_key($g) === $key) {
            $ids[] = $other;
        }
    }
    return $ids;
}

/** "Tetris (NES), 3 versions" or "Tetris (NES)": who a log line is about. */
function xs_versions_said(?array $game, array $ids, string $id): string
{
    $name = $game === null ? $id : (string) $game['title'] . ' (' . (string) $game['platform'] . ')';
    return $name . (count($ids) > 1 ? ', ' . count($ids) . ' versions' : '');
}
