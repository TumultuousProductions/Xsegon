<?php
/**
 * Xsegon - games taken out of the library on purpose.
 *
 *     data\deleted.json   [ { id, title, platform, rom, at }, ... ]
 *
 * Not hiding: a hidden game stays a game, one press from coming back; a deleted entry is
 * not part of the library, asked twice.
 *
 * It never touches a file on the disk: "Delete from Xsegon" means the entry, and every
 * screen says so. The row kept here restores it (api\deleted.php `restore`), overlays
 * intact. Deleted titles join the scanner's known set, or a scan would offer them back.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

function xs_deleted_path(): string
{
    return xs_data_path('deleted.json');
}

/** Every deleted entry, oldest first. */
function xs_deleted(): array
{
    $d = xs_read_json(xs_deleted_path(), []);
    return is_array($d) ? array_values(array_filter($d, 'is_array')) : [];
}

/** id => true, for the read path. */
function xs_deleted_ids(): array
{
    $ids = [];
    foreach (xs_deleted() as $d) {
        if (!empty($d['id'])) {
            $ids[(string) $d['id']] = true;
        }
    }
    return $ids;
}

/** Drop deleted games, and keep the counts honest, exactly as hiding does. */
function xs_apply_deleted(array $lib): array
{
    return xs_lib_without($lib, xs_deleted_ids());
}

/**
 * Take games out of the library, keeping title and platform with the id so the list
 * still reads once the game is out of reach. How many, or false with $why.
 */
function xs_delete_games(array $games, ?string &$why = null): int|false
{
    $all  = xs_deleted();
    $have = xs_deleted_ids();
    $n = 0;
    foreach ($games as $g) {
        $id = (string) ($g['id'] ?? '');
        if ($id === '' || isset($have[$id])) {
            continue;
        }
        $all[] = [
            'id'       => $id,
            'title'    => (string) ($g['title'] ?? '?'),
            'platform' => (string) ($g['platform'] ?? '?'),
            'rom'      => (string) ($g['romPath'] ?? ''),
            'at'       => date('c'),
        ];
        $have[$id] = true;
        $n++;
    }
    if ($n > 0 && !xs_write_json(xs_deleted_path(), $all, $why)) {
        return false;
    }
    return $n;
}

/** Put one back. */
function xs_undelete(string $id, ?string &$why = null): bool
{
    $all  = xs_deleted();
    $kept = array_values(array_filter($all, static fn($d) => (string) ($d['id'] ?? '') !== $id));
    if (count($kept) === count($all)) {
        $why = 'nothing deleted with that id';
        return false;
    }
    return xs_write_json(xs_deleted_path(), $kept, $why);
}
