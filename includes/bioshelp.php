<?php
/**
 * BIOS help beyond the check (includes\bios.php): what one game lacks, for a failed
 * start (api\launch.php) and the Runs check (api\runcheck.php), and a person's own
 * files put in place from a folder they choose (api\bios.php).
 *
 * Nothing here downloads a file or stops a game starting: a table can be wrong.
 */
declare(strict_types=1);

require_once __DIR__ . '/bios.php';
require_once __DIR__ . '/setup.php';
require_once __DIR__ . '/news.php';

/** BIOS sets a core reads whole as a zip, known by name: where each goes. */
const XS_BIOS_ZIPS = ['neogeo.zip' => 'neogeo.zip', 'naomi.zip' => 'dc/naomi.zip',
                      'naomi2.zip' => 'dc/naomi2.zip', 'awbios.zip' => 'dc/awbios.zip'];

/** The regions a game's file name claims (jp, us, eu); [] when it names none. */
function xs_bios_regions(string $name): array
{
    $words = [
        'us' => ['usa', 'us', 'ntsc-u', 'america', 'canada'],
        'jp' => ['japan', 'jp', 'jpn', 'ntsc-j'],
        'eu' => ['europe', 'eu', 'eur', 'pal', 'uk', 'germany', 'france', 'spain', 'italy', 'australia'],
    ];
    $letters = ['u' => 'us', 'j' => 'jp', 'e' => 'eu'];
    $out = [];
    preg_match_all('/[(\[]([^()\[\]]*)[)\]]/', $name, $m);
    foreach ($m[1] as $tag) {
        $hit = false;
        foreach (preg_split('/\s*,\s*/', strtolower(trim($tag))) ?: [] as $word) {
            foreach ($words as $region => $list) {
                if (in_array($word, $list, true)) {
                    $out[$region] = true;
                    $hit = true;
                }
            }
        }
        // The older one-letter tags: (U), (J), (E), (UE), (JU).
        if (!$hit && preg_match('/^[uje]{1,3}$/i', trim($tag))) {
            foreach (str_split(strtolower(trim($tag))) as $c) {
                $out[$letters[$c]] = true;
            }
        }
    }
    return array_keys($out);
}

/**
 * The required BIOS files a game on this core lacks, or null. A regional file counts
 * when the name says that region; a name with none, or an anyRegion core, takes any.
 */
function xs_bios_lack(string $exe, string $core, string $platform, string $name, ?array &$memo = null): ?array
{
    $memo ??= [];
    $key = strtolower($exe . '|' . $core . '|' . $platform);
    if (!array_key_exists($key, $memo)) {
        $memo[$key] = null;
        $need = ($core === '' || $exe === '') ? null : xs_bios_core_need(xs_bios_needs(), $exe, $core, $platform);
        if ($need !== null && $need['need'] === 'required' && $need['files']) {
            $dir = xs_bios_system_dir($exe);
            $files = [];
            foreach ($need['files'] as $f) {
                $files[] = xs_bios_look($dir, $f) + ['region' => $f['region'] ?? null];
            }
            $memo[$key] = ['dir' => $dir, 'files' => $files, 'anyRegion' => !empty($need['anyRegion'])];
        }
    }
    $n = $memo[$key];
    if ($n === null) {
        return null;
    }
    $ok = static fn(array $f): bool => $f['status'] === 'ok';
    $lack = [];
    $regional = [];
    foreach ($n['files'] as $f) {
        if ($f['region'] !== null) {
            $regional[] = $f;
        } elseif (!$ok($f)) {
            $lack[] = $f;
        }
    }
    $anyOf = false;
    if ($regional) {
        $mine = $n['anyRegion'] ? [] : xs_bios_regions($name);
        $forMe = array_values(array_filter($regional, static fn(array $f): bool => (bool) array_intersect($f['region'], $mine)));
        $pool = $forMe ?: $regional;
        if (!array_filter($pool, $ok)) {
            $anyOf = !$lack && count($pool) > 1;
            array_push($lack, ...$pool);
        }
    }
    if (!$lack) {
        return null;
    }
    return ['platform' => $platform, 'core' => $core, 'dir' => $n['dir'], 'anyOf' => $anyOf,
            'files' => array_map(static fn(array $f): array => ['file' => $f['file'], 'note' => $f['note'], 'status' => $f['status']], $lack)];
}

/** The same for a game about to start, from the command it starts with. */
function xs_bios_lack_for(array $game, string $exe, string $args, ?array &$memo = null): ?array
{
    $load = lb_core_load($args);
    if ($load === null) {
        return null;
    }
    $name = basename(str_replace('\\', '/', (string) ($game['rom'] ?? $game['romPath'] ?? ''))) . ' ' . (string) ($game['title'] ?? '');
    return xs_bios_lack($exe, strtolower(lb_core_name($load)), (string) ($game['platform'] ?? ''), $name, $memo);
}

/** One sentence for a failed start: which file, and where to see to it. */
function xs_bios_hint(array $lack): string
{
    $names = array_column($lack['files'], 'file');
    $last = array_pop($names);
    $list = $names ? implode(', ', $names) . ($lack['anyOf'] ? ' or ' : ' and ') . $last : $last;
    if ($lack['anyOf']) {
        $what = 'None of its BIOS files is in place (' . $list . ')';
    } elseif (!$names) {
        $what = 'Its BIOS file ' . $list . ($lack['files'][0]['status'] === 'wrong' ? ' is there but is not the real one' : ' is missing');
    } else {
        $what = 'Its BIOS files ' . $list . ' are not in place';
    }
    return $what . ': Emulators > BIOS check';
}

/**
 * The automatic Runs check's plan without the games a missing BIOS would
 * stop: [the plan that is left, what was left out, a row per console].
 */
function xs_bios_leave_out(array $plan): array
{
    $memo = [];
    $keep = [];
    $out = [];
    foreach ($plan as $row) {
        $lack = ($row['mode'] ?? '') === 'emu' ? null
            : xs_bios_lack_for($row, (string) ($row['exe'] ?? ''), (string) ($row['args'] ?? ''), $memo);
        if ($lack === null) {
            $keep[] = $row;
            continue;
        }
        $p = (string) $row['platform'];
        $out[$p] ??= ['platform' => $p, 'games' => 0, 'dir' => $lack['dir'], 'files' => []];
        $out[$p]['games']++;
        foreach ($lack['files'] as $f) {
            $out[$p]['files'][$f['file']] = $f;
        }
    }
    foreach ($out as $p => $o) {
        ksort($o['files']);
        $out[$p]['files'] = array_values($o['files']);
    }
    ksort($out, SORT_NATURAL | SORT_FLAG_CASE);
    return [$keep, array_values($out)];
}

/** "A", "A and B", "A, B and C". */
function xs_bios_and(array $names): string
{
    $last = array_pop($names);
    return $names ? implode(', ', $names) . ' and ' . $last : (string) $last;
}

/**
 * One message naming the consoles whose games were left out, said again
 * only when the consoles or their files change (setup.json biosTold).
 */
function xs_bios_tell(array $out): bool
{
    if (!$out) {
        return false;
    }
    $lines = [];
    $key = [];
    foreach ($out as $o) {
        $files = array_map(static fn(array $f): string => $f['file'] . ($f['note'] ? ' (' . $f['note'] . ')' : ''), $o['files']);
        $lines[] = $o['platform'] . ': ' . $o['games'] . ($o['games'] === 1 ? ' game' : ' games') . ', wanting ' . implode(', ', $files);
        $key[] = $o['platform'] . '|' . implode(',', array_column($o['files'], 'file'));
    }
    $key = md5(implode("\n", $key));
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    if (($asked['biosTold'] ?? '') === $key) {
        return false;
    }
    $names = array_column($out, 'platform');
    xs_messages_add([
        'id'    => 'msg-' . bin2hex(random_bytes(6)),
        'at'    => date('c'),
        'kind'  => 'bios',
        'title' => 'BIOS files are needed for ' . (count($names) > 3 ? count($names) . ' consoles' : xs_bios_and($names)),
        'body'  => 'The check that each game starts left these games out: without the console\'s own startup files '
                 . 'they do not start. Those files are copyrighted, so Xsegon never downloads one; each comes from a '
                 . 'console you own. Emulators > BIOS check names every file and puts yours in place from a folder you choose.',
        'items' => array_slice($lines, 0, 12),
        'n'     => count($lines),
        'open'  => 'bios',                // the page turns this into "Open the BIOS check"
        'read'  => false,
    ]);
    $asked['biosTold'] = $key;
    xs_write_json(xs_data_path('setup.json'), $asked);
    xs_log('BIOS', 'a message says which consoles want BIOS files: ' . implode('; ', $lines));
    return true;
}

/**
 * Where a known file goes: [by checksum, by name for a file with no one
 * checksum, every size a checksummed file has, the table's entry per place].
 */
function xs_bios_targets(): array
{
    $sums = [];
    $names = [];
    $sizes = [];
    $specs = [];
    foreach (xs_bios_needs() as $need) {
        foreach ($need['files'] as $f) {
            $specs[$f['file']] = $f;
            if ($f['md5'] === null) {
                $names[strtolower(basename((string) $f['file']))][$f['file']] = true;
                continue;
            }
            foreach ((array) $f['md5'] as $sum) {
                $sums[$sum][$f['file']] = true;
            }
            $sizes[(int) $f['size']] = true;
        }
    }
    return [$sums, $names, $sizes, $specs];
}

/**
 * A PlayStation BIOS of any version, by Sony's name at 0x108 and, from 2.0 on,
 * "System ROM Version ... A" near the end. [version, region letter] or null.
 */
function xs_bios_ps1(string $path): ?array
{
    if (@filesize($path) !== 524288) {
        return null;
    }
    $b = (string) @file_get_contents($path);
    if (!str_starts_with(substr($b, 0x108, 27), 'Sony Computer Entertainment')) {
        return null;
    }
    return preg_match('/System ROM Version ([0-9.]+) [0-9\/]+ ([AEJ])/', $b, $m) ? [$m[1], $m[2]] : ['1.0', 'J'];
}

/**
 * Each RetroArch's BIOS folder that a console here launches through, and
 * whether Xsegon may write there: never inside a folder it only reads.
 */
function xs_bios_dirs(): array
{
    $s = xs_settings();
    $table = xs_emulators(xs_norm_path((string) ($s['paths']['launchbox'] ?? '')));
    $dirs = [];
    foreach ($table['platforms'] ?? [] as $entry) {
        foreach ($entry['options'] ?? [] as $o) {
            $exe = (string) ($table['programs'][$o['program'] ?? '']['exe'] ?? '');
            if (($o['core'] ?? '') === '' || $o['core'] === null || $exe === '' || !is_file($exe)) {
                continue;
            }
            $dir = xs_bios_system_dir($exe);
            $dirs[strtolower($dir)] ??= ['dir' => $dir, 'writable' => !xs_in_launchbox($dir . DIRECTORY_SEPARATOR . 'x') && !xs_test_keep_out($dir)];
        }
    }
    return array_values($dirs);
}

/** The files in a chosen folder, four levels down at most, 4000 at most. */
function xs_bios_walk(string $folder): array
{
    $out = [];
    $stack = [[$folder, 0]];
    while ($stack && count($out) < 4000) {
        [$dir, $depth] = array_pop($stack);
        foreach (@scandir($dir) ?: [] as $n) {
            if ($n === '.' || $n === '..') {
                continue;
            }
            $full = $dir . DIRECTORY_SEPARATOR . $n;
            if (is_dir($full)) {
                if ($depth < 4) {
                    $stack[] = [$full, $depth + 1];
                }
                continue;
            }
            $out[] = $full;
        }
    }
    sort($out, SORT_NATURAL | SORT_FLAG_CASE);
    return $out;
}

/**
 * What a chosen folder holds that an emulator wants and where it would go: 'place',
 * 'replace' or 'there'. Reads only; only files of a known BIOS size are summed.
 */
function xs_bios_place_plan(string $folder): array
{
    $dirs = xs_bios_dirs();
    [$sums, $names, $sizes, $specs] = xs_bios_targets();
    $found = [];
    $ps1 = [];
    $unknown = 0;
    // Named like a checksummed file and not it: said by name, never copied.
    $wanted = [];
    foreach ($specs as $rel => $f) {
        if ($f['md5'] !== null) {
            $wanted[strtolower(basename((string) $rel))] = true;
        }
    }
    $notReal = [];
    foreach (xs_bios_walk($folder) as $path) {
        $name = strtolower(basename($path));
        $size = (int) @filesize($path);
        $to = null;
        if (isset(XS_BIOS_ZIPS[$name])) {
            $to = [XS_BIOS_ZIPS[$name]];
        } elseif (isset($sizes[$size])) {
            $sum = (string) @md5_file($path);
            $to = isset($sums[$sum]) ? array_keys($sums[$sum]) : null;
        }
        if ($to === null && isset($names[$name])) {
            $to = array_keys($names[$name]);
        }
        if ($to === null && ($v = xs_bios_ps1($path)) !== null) {
            $ps1[] = [$path, $v[0], $v[1]];
            continue;
        }
        if ($to === null && isset($wanted[$name])) {
            $notReal[basename($path)] = true;
            continue;
        }
        if ($to === null) {
            $unknown++;
            continue;
        }
        foreach ($to as $rel) {
            $found[$rel] ??= ['from' => $path, 'note' => $specs[$rel]['note'] ?? null];
        }
    }
    /* Any other PlayStation BIOS serves PCSX ReARMed as scph1001.bin, which it does
       not check. USA first, then the newest. */
    usort($ps1, static fn ($a, $b) => [$a[2] !== 'A', -(float) $a[1]] <=> [$b[2] !== 'A', -(float) $b[1]]);
    if ($ps1) {
        $found['scph1001.bin'] ??= ['from' => $ps1[0][0],
            'note' => 'PlayStation BIOS ' . $ps1[0][1] . ', for the PCSX ReARMed core'];
        $unknown += count($ps1) - 1;
    }
    ksort($found, SORT_NATURAL | SORT_FLAG_CASE);

    $rows = [];
    $todo = 0;
    $byHand = 0;
    foreach ($dirs as $d) {
        foreach ($found as $rel => $hit) {
            $dest = $d['dir'] . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
            $state = 'place';
            if (is_file($dest)) {
                $spec = $specs[$rel] ?? null;
                $same = strcasecmp((string) realpath($dest), (string) realpath($hit['from'])) === 0
                     || @md5_file($dest) === @md5_file($hit['from']);
                // A file with no one checksum cannot be judged: it is left as it is.
                $genuine = $spec === null || $spec['md5'] === null || xs_bios_look($d['dir'], $spec)['status'] === 'ok';
                $state = ($same || $genuine) ? 'there' : 'replace';
            }
            if ($state !== 'there') {
                $d['writable'] ? $todo++ : $byHand++;
            }
            $rows[] = ['file' => $rel, 'note' => $hit['note'], 'from' => $hit['from'], 'to' => $dest,
                       'state' => $state, 'writable' => $d['writable']];
        }
    }
    return ['folder' => $folder, 'dirs' => $dirs, 'rows' => $rows, 'found' => count($found),
            'unknown' => $unknown, 'notReal' => array_slice(array_keys($notReal), 0, 12),
            'todo' => $todo, 'byHand' => $byHand];
}

/**
 * Makes the copies the plan names. A source is never moved or changed; a file that was
 * not the real one is kept beside the new one as NAME.not-genuine.
 */
function xs_bios_place(string $folder): array
{
    $plan = xs_bios_place_plan($folder);
    $placed = [];
    $failed = [];
    foreach ($plan['rows'] as $r) {
        if (!$r['writable'] || $r['state'] === 'there') {
            continue;
        }
        @mkdir(dirname($r['to']), 0777, true);
        // Copied whole under a working name first: nothing that is there moves until the new one is ready.
        $part = $r['to'] . '.part';
        if (!@copy($r['from'], $part) || @filesize($part) !== @filesize($r['from'])) {
            @unlink($part);
            $failed[] = $r['file'];
            continue;
        }
        $aside = null;
        if ($r['state'] === 'replace' && is_file($r['to'])) {
            // Kept beside it, and never over one kept before: a second try does not lose the first.
            $aside = $r['to'] . '.not-genuine';
            for ($n = 2; file_exists($aside) && $n < 50; $n++) {
                $aside = $r['to'] . '.not-genuine-' . $n;
            }
            if (!@rename($r['to'], $aside)) {
                @unlink($part);
                $failed[] = $r['file'];
                continue;
            }
        }
        if (@rename($part, $r['to'])) {
            $placed[] = $r['file'];
        } else {
            @unlink($part);
            if ($aside !== null) {
                @rename($aside, $r['to']);       // back where it was
            }
            $failed[] = $r['file'];
        }
    }
    xs_log('BIOS', count($placed) . ' file(s) put in place from ' . $folder
        . ($placed ? ': ' . implode(', ', $placed) : '')
        . ($failed ? '; could not copy ' . implode(', ', $failed) : ''));
    return ['placed' => $placed, 'failed' => $failed, 'plan' => xs_bios_place_plan($folder)];
}
