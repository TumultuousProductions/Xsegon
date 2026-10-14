<?php
/**
 * Tags of your own: short labels you put on any game, and the Filter by list
 * narrows to.
 *
 *     data\tags.json      { "<game id>": ["Couch", "Kids"], ... }
 *
 * A tag exists only while some game carries it: there is no separate list to
 * keep in step. One spelling per tag: adding "couch" where "Couch" exists files
 * it as "Couch", so the Filter by list never shows a tag twice.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

const XS_TAG_MAX_LEN      = 24;   // characters; a tag is a label, not a note
const XS_TAGS_PER_GAME    = 30;

/* Two tags are always offered: "runs" (the runs check tags the games that boot)
   and "needs fix". The second is not kept in tags.json: it is the NEEDS FIX mark
   (includes\needsfix.php), so the tag and the mark never disagree (xs_fix_mark). */
const XS_TAG_NEEDS_FIX    = 'needs fix';
const XS_TAG_RUNS         = 'runs';
const XS_TAGS_STANDARD    = [XS_TAG_NEEDS_FIX, XS_TAG_RUNS];

function xs_tags_path(): string
{
    return xs_data_path('tags.json');
}

/** id => list of tag names; anything malformed in the file is left out. */
function xs_tags_read(): array
{
    $raw = xs_read_json(xs_tags_path(), []);
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $id => $list) {
        if (!is_string($id) || !is_array($list)) {
            continue;
        }
        $names = array_values(array_filter($list, static fn($t) => is_string($t) && $t !== ''));
        if ($names) {
            $out[$id] = $names;
        }
    }
    return $out;
}

function xs_tags_write(array $map, ?string &$why = null): bool
{
    // A game with no tags left is dropped from the file.
    $map = array_filter($map, static fn($l) => is_array($l) && $l !== []);
    return xs_write_json(xs_tags_path(), $map, $why);
}

/**
 * A name as it will be stored: spaces tidied, within the length, and no
 * control characters. Null, with the reason, for a name that cannot be one.
 */
function xs_tag_clean(string $name, ?string &$why = null): ?string
{
    $name = trim((string) preg_replace('/\s+/u', ' ', $name));
    if ($name === '') {
        $why = 'a tag needs a name';
        return null;
    }
    if (preg_match('/[\x00-\x1F\x7F]/', $name)) {
        $why = 'a tag cannot hold control characters';
        return null;
    }
    if (mb_strlen($name) > XS_TAG_MAX_LEN) {
        $why = 'a tag is at most ' . XS_TAG_MAX_LEN . ' characters';
        return null;
    }
    return $name;
}

/** The spelling a tag already has anywhere in the map, if it has one. */
function xs_tag_spelling(array $map, string $name): string
{
    $key = mb_strtolower($name);
    foreach ($map as $list) {
        foreach ($list as $t) {
            if (mb_strtolower($t) === $key) {
                return $t;
            }
        }
    }
    return $name;
}

/**
 * The tags as shown: yours, with "needs fix" on exactly the games in $fix
 * (xs_needs_fix: id => why) and on no other, whatever tags.json says.
 */
function xs_tags_effective(array $map, array $fix): array
{
    $out = [];
    foreach ($map as $id => $list) {
        $list = array_values(array_filter($list, static fn($t) => mb_strtolower((string) $t) !== XS_TAG_NEEDS_FIX));
        if ($list) {
            $out[$id] = $list;
        }
    }
    foreach ($fix as $id => $_) {
        $out[$id][] = XS_TAG_NEEDS_FIX;
        usort($out[$id], 'strnatcasecmp');
    }
    return $out;
}

/** The standard tags (XS_TAGS_STANDARD) added at 0 to a name => count list that lacks them. */
function xs_tags_with_standard(array $count): array
{
    foreach (XS_TAGS_STANDARD as $std) {
        $has = false;
        foreach ($count as $name => $_) {
            $has = $has || mb_strtolower((string) $name) === $std;
        }
        if (!$has) {
            $count[$std] = 0;
        }
    }
    return $count;
}

/** Every tag with how many games carry it, A to Z, the standard ones always among them. */
function xs_tags_all(array $map): array
{
    $count = [];
    foreach ($map as $list) {
        foreach ($list as $t) {
            $count[$t] = ($count[$t] ?? 0) + 1;
        }
    }
    $count = xs_tags_with_standard($count);
    uksort($count, static fn($a, $b) => strnatcasecmp((string) $a, (string) $b));
    $out = [];
    foreach ($count as $name => $n) {
        $out[] = ['name' => (string) $name, 'count' => $n];
    }
    return $out;
}
