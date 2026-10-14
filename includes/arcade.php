<?php
/**
 * Xsegon - arcade sets, named by MAME's own list.
 *
 * A set's file carries MAME's short name (kof2003.zip); includes\arcade\names.tsv.gz
 * (made by tools\get-arcade-names.php) says what each is. Scan for Games reads through here.
 * BIOS, device and machine sets and clones beside their parent are counted, not offered;
 * a name the list lacks is offered under its file name, as the list ages with its MAME.
 */
declare(strict_types=1);

const XS_ARCADE = 'Arcade';

/** A folder kept for arcade sets, by its name: mame, mame2003, arcade, fbneo, fba, Final Burn Neo. */
function xs_arcade_folder(string $name): bool
{
    return (bool) preg_match('/^(mame|arcade|fbneo|fba|fbalpha|final ?burn)/i', trim($name));
}

/** [short name => its line of the list], read once a request; empty when the list cannot be read. */
function xs_arcade_names(): array
{
    static $names = null;
    if ($names !== null) {
        return $names;
    }
    $names = [];
    $file = XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'arcade' . DIRECTORY_SEPARATOR . 'names.tsv.gz';
    $raw  = @file_get_contents($file);
    $text = $raw === false ? false : @gzdecode($raw);
    if ($text === false) {
        xs_log('SCAN', 'the list of arcade names could not be read (' . $file . '): arcade sets are offered under their file names');
        return $names;
    }
    foreach (explode("\n", $text) as $line) {
        $tab = strpos($line, "\t");
        if ($tab !== false && $line[0] !== '#') {
            $names[substr($line, 0, $tab)] = $line;
        }
    }
    return $names;
}

/** One set by its short name: ['title', 'kind', 'parent'], or null when the list does not hold it. */
function xs_arcade_set(string $short): ?array
{
    $line = xs_arcade_names()[strtolower($short)] ?? null;
    if ($line === null) {
        return null;
    }
    $f = explode("\t", $line);
    return ['title' => $f[1] ?? $short, 'kind' => $f[2] ?? 'g', 'parent' => $f[3] ?? ''];
}

/**
 * The games in a folder of arcade sets, as rows for the scan's passes. What
 * was left out is counted into $out['arcade'], a line a folder.
 */
function xs_arcade_rows(string $dir, array &$out): array
{
    $sets = static function (string $d): array {
        $found = [];
        foreach (@scandir($d) ?: [] as $n) {
            $ext = strtolower((string) pathinfo($n, PATHINFO_EXTENSION));
            if (($ext === 'zip' || $ext === '7z') && is_file($d . DIRECTORY_SEPARATOR . $n)) {
                $found[strtolower((string) pathinfo($n, PATHINFO_FILENAME))] ??= ['rom' => $d . DIRECTORY_SEPARATOR . $n, 'ext' => $ext, 'name' => $n];
            }
        }
        return $found;
    };
    // MAME's own folder, and one laid out like it, keep the sets in roms\.
    $files = $sets($dir);
    $roms  = $dir . DIRECTORY_SEPARATOR . 'roms';
    if (is_dir($roms) && (!$files || is_file($dir . DIRECTORY_SEPARATOR . 'mame.exe'))) {
        $dir   = $roms;
        $files = $sets($dir);
    }
    $said = ['folder' => $dir, 'sets' => count($files), 'games' => 0, 'versions' => 0, 'bios' => 0, 'machines' => 0, 'unknown' => 0];
    $rows = [];
    foreach ($files as $short => $f) {
        $row = ['name' => $f['name'], 'rom' => $f['rom'], 'ext' => $f['ext']];
        $set = xs_arcade_set((string) $short);
        if ($set === null) {
            $said['unknown']++;
            $rows[] = $row;
            continue;
        }
        if ($set['kind'] === 'b' || $set['kind'] === 'd') {
            $said['bios']++;
            continue;
        }
        if ($set['kind'] === 'm' || $set['kind'] === 's') {
            $said['machines']++;
            continue;
        }
        if ($set['parent'] !== '' && isset($files[$set['parent']])) {
            $said['versions']++;
            continue;
        }
        $said['games']++;
        $rows[] = $row + ['title' => xs_scan_title($set['title'])];
    }
    if ($said['sets'] > 0) {
        $out['arcade'][] = $said;
        xs_log('SCAN', 'arcade sets in ' . $dir . ': ' . $said['sets'] . ' files, ' . $said['games'] . ' games by MAME\'s list, '
            . $said['versions'] . ' other versions left out, ' . $said['bios'] . ' BIOS and device sets, ' . $said['machines']
            . ' mechanical machines and computers, ' . $said['unknown'] . ' the list does not know');
    }
    return $rows;
}
