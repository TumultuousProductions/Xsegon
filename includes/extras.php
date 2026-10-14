<?php
/**
 * What came in the box, beside the pictures Xsegon already shows:
 *
 *   data\documents\<game id>\    a manual, a map, a guide. A file's own name
 *                                is its label on screen: "Manual.pdf" reads
 *                                Manual, "Map 2.png" reads Map 2. A PDF or a
 *                                picture.
 *   data\extras\spine\<id>.png   the side of the box, for the Shelf view
 *   data\extras\cart\<id>.png    the cartridge
 *   data\extras\disc\<id>.png    the disc
 *
 * Found by game id, so a renamed game keeps them. None ships with Xsegon: they come from
 * a person's own ScreenScraper account, or by hand.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

function xs_docs_dir(): string
{
    return xs_data_path('documents');
}

function xs_extras_dir(): string
{
    return xs_data_path('extras');
}

/** The kinds of picture kept in data\extras, each a folder of its own. */
function xs_extras_kinds(): array
{
    return ['spine', 'cart', 'disc'];
}

/** What a document can be, by its ending: a PDF, or a picture. */
function xs_doc_types(): array
{
    return ['pdf' => 'pdf', 'png' => 'image', 'jpg' => 'image', 'jpeg' => 'image', 'webp' => 'image', 'gif' => 'image'];
}

/**
 * Every picture in data\extras with its width and height, kept in index.json: the shelf
 * needs each spine's shape before it loads, and reading every header per library read is
 * slow. Rebuilt when a folder's date or count changes; the fast lane never writes it.
 */
function xs_extras_index(): array
{
    static $memo = null;
    if ($memo !== null) {
        return $memo;
    }
    $dir   = xs_extras_dir();
    $names = [];
    $stamp = [];
    foreach (xs_extras_kinds() as $k) {
        $names[$k] = [];
        foreach (@scandir($dir . DIRECTORY_SEPARATOR . $k) ?: [] as $f) {
            if (preg_match('/^([A-Za-z0-9\-]{1,64})\.(png|jpe?g|webp|gif)$/i', $f, $m)) {
                $names[$k][$m[1]] = $f;
            }
        }
        $stamp[$k] = [(int) @filemtime($dir . DIRECTORY_SEPARATOR . $k), count($names[$k])];
    }
    $cacheFile = $dir . DIRECTORY_SEPARATOR . 'index.json';
    $kept = is_file($cacheFile) ? xs_read_json($cacheFile, null) : null;
    if (is_array($kept) && ($kept['stamp'] ?? null) === $stamp) {
        return $memo = $kept;
    }
    $out = ['stamp' => $stamp];
    foreach ($names as $k => $list) {
        $out[$k] = [];
        foreach ($list as $id => $f) {
            $size = @getimagesize($dir . DIRECTORY_SEPARATOR . $k . DIRECTORY_SEPARATOR . $f);
            if ($size !== false && $size[0] > 0 && $size[1] > 0) {
                $out[$k][$id] = [$f, (int) $size[0], (int) $size[1]];
            }
        }
    }
    if (is_dir($dir) && !xs_fast_lane()) {
        xs_write_json($cacheFile, $out);
    }
    return $memo = $out;
}

/** One picture of a game from data\extras: its address and its size, or null. */
function xs_extra_pic(string $kind, string $id): ?array
{
    $ix = xs_extras_index();
    $e  = $ix[$kind][$id] ?? null;
    if (!is_array($e)) {
        return null;
    }
    return ['url' => 'files/extras/' . $kind . '/' . rawurlencode((string) $e[0]) . '?v=' . (int) ($ix['stamp'][$kind][0] ?? 0),
            'w' => (int) $e[1], 'h' => (int) $e[2]];
}

/** What a game is played from, as a picture: its cartridge, or its disc. */
function xs_extra_medium(string $id): ?array
{
    foreach (['cart', 'disc'] as $kind) {
        $pic = xs_extra_pic($kind, $id);
        if ($pic !== null) {
            return ['kind' => $kind] + $pic;
        }
    }
    return null;
}

/** The games that have a documents folder, by id: one folder listing, for the library's rows. */
function xs_docs_have(): array
{
    $out = [];
    foreach (@scandir(xs_docs_dir()) ?: [] as $d) {
        if ($d !== '.' && $d !== '..') {
            $out[$d] = true;
        }
    }
    return $out;
}

/**
 * A game's documents, the manual first, the rest in natural order (Map 2 before Map 10):
 * file, label, kind (pdf | image), bytes, url.
 */
function xs_docs_for(string $id): array
{
    if (!xs_game_id_ok($id)) {
        return [];
    }
    $dir   = xs_docs_dir() . DIRECTORY_SEPARATOR . $id;
    $types = xs_doc_types();
    $out   = [];
    foreach (@scandir($dir) ?: [] as $f) {
        $ext  = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        $path = $dir . DIRECTORY_SEPARATOR . $f;
        if (!isset($types[$ext]) || !is_file($path)) {
            continue;
        }
        $out[] = [
            'file'  => $f,
            'label' => pathinfo($f, PATHINFO_FILENAME),
            'kind'  => $types[$ext],
            'bytes' => (int) filesize($path),
            'url'   => 'files/documents/' . rawurlencode($id) . '/' . rawurlencode($f) . '?v=' . (int) filemtime($path),
        ];
    }
    usort($out, static function (array $a, array $b): int {
        $am = stripos($a['label'], 'manual') === 0 ? 0 : 1;
        $bm = stripos($b['label'], 'manual') === 0 ? 0 : 1;
        return $am <=> $bm ?: strnatcasecmp($a['label'], $b['label']);
    });
    return $out;
}
