<?php
/**
 * Xsegon - cheats for a RetroArch game, kept as an overlay: find a game's file in
 * RetroArch's cheat database, pick cheats from it, apply them at launch.
 *
 *   1. RetroArch loads a cheat file only from <cheat_database_path>\<core name>\<rom name>.cht.
 *   2. Applying it needs apply_cheats_after_load.
 *   3. --appendconfig values are saved into retroarch.cfg on exit unless
 *      config_save_on_exit = "false" is appended too.
 *
 * So the file goes in data\cheats\, the launch points cheat_database_path there for that
 * run, and the config save is off so nothing outlives the game; the picker says that
 * settings changed in RetroArch during such a run are not saved. The cheat folder is the
 * core's info file's `database` value, as RetroArch itself decides.
 */
declare(strict_types=1);

require_once __DIR__ . '/states.php';

/** Where the choices live. */
function xs_cheats_path(): string
{
    return xs_data_path('cheats.json');
}

/** Where Xsegon stages the files it hands RetroArch. */
function xs_cheats_dir(): string
{
    return xs_data_path('cheats');
}

/** Every choice, as [game id => ['file' => ..., 'on' => [['i'=>int,'desc'=>string], ...]]]. */
function xs_cheats_read(): array
{
    $raw = xs_read_json(xs_cheats_path(), []);
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $id => $pick) {
        if (!is_string($id) || $id === '' || !is_array($pick)) {
            continue;
        }
        $file = (string) ($pick['file'] ?? '');
        $on   = [];
        foreach ((array) ($pick['on'] ?? []) as $c) {
            if (is_array($c) && isset($c['i'])) {
                $on[] = ['i' => (int) $c['i'], 'desc' => (string) ($c['desc'] ?? '')];
            }
        }
        if ($file !== '' && $on) {
            $out[$id] = ['file' => $file, 'on' => $on];
        }
    }
    return $out;
}

/** The cheats chosen for one game, or null. */
function xs_cheats_for(string $id): ?array
{
    return xs_cheats_read()[$id] ?? null;
}

/** Remember a choice, or forget it when $pick is null. */
function xs_cheats_set(string $id, ?array $pick, ?string &$why = null): bool
{
    $all = xs_cheats_read();
    if ($pick === null || empty($pick['on'])) {
        unset($all[$id]);
    } else {
        $all[$id] = $pick;
    }
    return xs_write_json(xs_cheats_path(), $all, $why);
}

/**
 * The databases a core reads, from its info file ("|"-separated), or []. Never guessed
 * from the console name: a wrong folder gives another console's cheats, worse than none.
 */
function xs_cheat_databases(array $game): array
{
    $launch = $game['launch'] ?? [];
    if (($launch['kind'] ?? '') !== 'retroarch' || empty($launch['exe'])) {
        return [];
    }
    $raDir = dirname((string) $launch['exe']);
    $args  = (string) ($launch['args'] ?? '');
    if (!preg_match('/-L\s+"([^"]+)"|-L\s+(\S+)/', $args, $m)) {
        return [];
    }
    $core  = pathinfo(str_replace('/', DIRECTORY_SEPARATOR, $m[1] !== '' ? $m[1] : $m[2]), PATHINFO_FILENAME);
    $flags = ra_flags(ra_config_path((string) $launch['exe']));
    $info  = ra_resolve_dir($raDir, (string) ($flags['libretro_info_path'] ?? ''), 'info')
           . DIRECTORY_SEPARATOR . $core . '.info';
    if (!is_file($info)) {
        return [];
    }
    $raw = file_get_contents($info);
    if ($raw === false || !preg_match('/^database\s*=\s*"([^"\r\n]*)"/m', $raw, $d)) {
        return [];
    }
    $out = [];
    foreach (explode('|', $d[1]) as $one) {
        $one = trim($one);
        if ($one !== '') {
            $out[] = $one;
        }
    }
    return $out;
}

/** Where a game's cheat lists are read from, read only. */
function xs_cheat_root(array $game): ?string
{
    return xs_cheat_root_of((string) ($game['launch']['exe'] ?? ''));
}

/**
 * The cheat lists for the RetroArch at $exe: its own folder when it holds any, else the
 * ones Xsegon fetched (includes\cheatlists.php), else null.
 */
function xs_cheat_root_of(string $exe): ?string
{
    require_once __DIR__ . '/cheatlists.php';
    $cfg = $exe !== '' ? ra_config_path($exe) : null;
    if ($cfg !== null) {
        $flags = ra_flags($cfg);
        $dir   = ra_resolve_dir(dirname($exe), (string) ($flags['cheat_database_path'] ?? ''), 'cheats');
        if (xs_cl_has($dir)) {
            return $dir;
        }
    }
    return xs_cl_has(xs_cl_dir()) ? xs_cl_dir() : null;
}

/** Whether the cheat lists are on this PC: Xsegon's own, or those of a RetroArch a game here plays on. */
function xs_cheat_lists_here(array $library): bool
{
    require_once __DIR__ . '/cheatlists.php';
    if (xs_cl_has(xs_cl_dir())) {
        return true;
    }
    $seen = [];
    foreach ($library['games'] ?? [] as $g) {
        $exe = ($g['launch']['kind'] ?? '') === 'retroarch' ? strtolower((string) ($g['launch']['exe'] ?? '')) : '';
        if ($exe === '' || isset($seen[$exe])) {
            continue;
        }
        $seen[$exe] = true;
        if (xs_cheat_root_of((string) $g['launch']['exe']) !== null) {
            return true;
        }
    }
    return false;
}

/** Case, punctuation and anything in brackets dropped, for matching names. */
function xs_cheat_key(string $name): string
{
    $name = preg_replace('/\.[A-Za-z0-9]{1,4}$/', '', $name);
    $name = preg_replace('/\([^)]*\)|\[[^\]]*\]/', '', (string) $name);
    return strtolower(preg_replace('/[^A-Za-z0-9]+/', '', (string) $name));
}

/**
 * The cheat files that could belong to this game, best first: the exact No-Intro ROM name
 * finds the right region and revision. Many games match several files that differ widely,
 * so the rest are offered rather than dropped.
 */
function xs_cheat_files(array $game): array
{
    $root = xs_cheat_root($game);
    $dbs  = xs_cheat_databases($game);
    if ($root === null || !$dbs) {
        return [];
    }
    $rom     = basename((string) ($game['launch']['rom'] ?? ''));
    $romBase = preg_replace('/\.[A-Za-z0-9]{1,4}$/', '', $rom);
    $romKey  = xs_cheat_key($rom);
    $titleKey = xs_cheat_key((string) ($game['title'] ?? ''));

    $out = [];
    foreach ($dbs as $db) {
        $dir = $root . DIRECTORY_SEPARATOR . $db;
        if (!is_dir($dir)) {
            continue;
        }
        foreach ((array) scandir($dir) as $f) {
            if (!is_string($f) || strtolower((string) pathinfo($f, PATHINFO_EXTENSION)) !== 'cht') {
                continue;
            }
            $key = xs_cheat_key($f);
            if ($key !== $romKey && $key !== $titleKey) {
                continue;
            }
            $stem = (string) pathinfo($f, PATHINFO_FILENAME);
            // 3: the ROM's own name, to the letter. 2: the same normalised name
            // as the ROM. 1: the same as the title and nothing better.
            $score = ($stem === $romBase) ? 3 : (($key === $romKey) ? 2 : 1);
            $out[] = [
                'file'   => $db . '/' . $f,
                'db'     => $db,
                'name'   => $stem,
                'cheats' => xs_cheat_count($dir . DIRECTORY_SEPARATOR . $f),
                'score'  => $score,
            ];
        }
    }
    // Best score first, then the fuller file, which is the one a person means.
    usort($out, function (array $a, array $b): int {
        return $b['score'] <=> $a['score'] ?: ($b['cheats'] <=> $a['cheats'] ?: strcmp($a['name'], $b['name']));
    });
    return $out;
}

/**
 * How many cheats a file holds, from its header alone: files run to megabytes, and
 * this is asked per candidate while a menu opens.
 */
function xs_cheat_count(string $path): int
{
    $h = @fopen($path, 'rb');
    if ($h === false) {
        return 0;
    }
    $head = (string) fread($h, 512);
    fclose($h);
    return preg_match('/^cheats\s*=\s*"?(\d+)/m', $head, $m) ? (int) $m[1] : 0;
}

/**
 * Every cheat in a file, as [['i' => int, 'desc' => string, 'code' => string]].
 * A .cht is retroarch.cfg syntax. The codes are read but never shown.
 */
function xs_cheat_list(string $path): array
{
    $raw = @file_get_contents($path);
    if ($raw === false) {
        return [];
    }
    $n = preg_match('/^cheats\s*=\s*"?(\d+)/m', $raw, $m) ? (int) $m[1] : 0;
    $desc = [];
    $code = [];
    if (preg_match_all('/^cheat(\d+)_desc\s*=\s*"([^"\r\n]*)"/m', $raw, $d, PREG_SET_ORDER)) {
        foreach ($d as $one) {
            $desc[(int) $one[1]] = $one[2];
        }
    }
    if (preg_match_all('/^cheat(\d+)_code\s*=\s*"([^"\r\n]*)"/m', $raw, $c, PREG_SET_ORDER)) {
        foreach ($c as $one) {
            $code[(int) $one[1]] = $one[2];
        }
    }
    $out = [];
    $max = max($n, $desc ? max(array_keys($desc)) + 1 : 0);
    for ($i = 0; $i < $max; $i++) {
        if (!isset($desc[$i])) {
            continue;
        }
        $out[] = ['i' => $i, 'desc' => $desc[$i], 'code' => $code[$i] ?? ''];
    }
    return $out;
}

/**
 * Write the file RetroArch will pick up, chosen cheats on and the rest off. The source is
 * copied whole and only _enable lines change: a cheat can carry many other keys, and
 * keeping only desc and code would break search-built cheats. The path, or null with $why.
 */
function xs_cheat_stage(array $game, array $pick, ?string &$why = null): ?string
{
    $root = xs_cheat_root($game);
    if ($root === null) {
        $why = 'the cheat lists are not on this PC';
        return null;
    }
    $src = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $pick['file']);
    if (!is_file($src)) {
        $why = 'the cheat file has gone: ' . $pick['file'];
        return null;
    }
    $launch = $game['launch'] ?? [];
    $core   = ra_core_name(dirname((string) $launch['exe']), (string) ($launch['args'] ?? ''),
                           ra_flags(ra_config_path((string) $launch['exe'])));
    if ($core === null) {
        $why = 'the core has no info file, so RetroArch would not find the cheats';
        return null;
    }
    $rom = preg_replace('/\.[A-Za-z0-9]{1,4}$/', '', basename((string) ($launch['rom'] ?? '')));
    if ((string) $rom === '') {
        $why = 'this game has no ROM file to name the cheats after';
        return null;
    }

    $raw = file_get_contents($src);
    if ($raw === false) {
        $why = 'could not read ' . $pick['file'];
        return null;
    }

    /* The index applies when its description still matches; else the description finds
       it, as an update to the database can move indexes. A choice matching neither is
       skipped and logged. */
    $byDesc = [];
    foreach (xs_cheat_list($src) as $c) {
        $byDesc[$c['desc']][] = $c['i'];
    }
    $want = [];
    $lost = [];
    foreach ($pick['on'] as $c) {
        $i    = (int) $c['i'];
        $desc = (string) ($c['desc'] ?? '');
        if ($desc !== '' && preg_match('/^cheat' . $i . '_desc\s*=\s*"' . preg_quote($desc, '/') . '"/m', $raw) === 1) {
            $want[$i] = true;
        } elseif ($desc !== '' && isset($byDesc[$desc])) {
            foreach ($byDesc[$desc] as $moved) {
                $want[$moved] = true;
            }
        } elseif ($desc === '') {
            $want[$i] = true;
        } else {
            $lost[] = $desc;
        }
    }
    if ($lost) {
        xs_log('CHEAT', 'skipped ' . count($lost) . ' that are no longer in ' . $pick['file']
            . ': ' . implode(', ', array_slice($lost, 0, 3)));
    }
    if (!$want) {
        $why = 'none of the chosen cheats are in that file any more';
        return null;
    }

    $out = preg_replace_callback(
        '/^cheat(\d+)_enable\s*=\s*"?(?:true|false)"?/m',
        function (array $m) use ($want): string {
            return 'cheat' . $m[1] . '_enable = "' . (isset($want[(int) $m[1]]) ? 'true' : 'false') . '"';
        },
        $raw
    );

    $dir = xs_cheats_dir() . DIRECTORY_SEPARATOR . $core;
    if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
        $why = 'could not make ' . $dir;
        return null;
    }
    $path = $dir . DIRECTORY_SEPARATOR . $rom . '.cht';
    if (file_put_contents($path, $out) === false) {
        $why = 'could not write ' . $path;
        return null;
    }
    return $path;
}

/**
 * The three lines a run with cheats adds to RetroArch's config; the third keeps the
 * other two from outliving the game (see the file header).
 */
function xs_cheat_config_lines(): array
{
    return [
        'cheat_database_path = "' . xs_cheats_dir() . '"',
        'apply_cheats_after_load = "true"',
        'config_save_on_exit = "false"',
    ];
}
