<?php
/**
 * Xsegon - "Set up the controller" for the standalone emulators (roadmap CA15).
 *
 * Within the line the user drew (CA2): Xsegon writes only files of its own, named
 * Xsegon, and a game's own settings file; an emulator's main settings never. The
 * press writes the emulator's Xsegon profiles; each game's own file gets the lines
 * that name them the first time Xsegon starts it after that, when its ID is read.
 * Put back takes every line and file away again, leaving anything the person or
 * the emulator changed since.
 *
 * Each emulator's file in includes\emus\ says what it writes, under 'setup':
 *   'words' what the press does, in the person's words
 *   'own'   fn(home, exe, &why): [path => text] its own files, or null with why
 *   'game'  fn(home, exe, game, rom, &why): ['file', 'section', 'set' => [key => value], 'from'?] or null with why
 *   'args'  fn(home, exe): string, options added to its launches while it is on (optional)
 *
 * data\emu-setup.json: key => ['on', 'at', 'own' => [path => md5], 'games' => [file => record]].
 */
declare(strict_types=1);

require_once __DIR__ . '/emus.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/texpacks-files.php';

function xs_es_path(): string
{
    return xs_data_path('emu-setup.json');
}

function xs_es_read(): array
{
    $raw = xs_read_json(xs_es_path(), []);
    return is_array($raw) ? $raw : [];
}

/** One emulator's record, as it is now: ['on' => false] when never set up. */
function xs_es_rec(string $key): array
{
    $r = xs_es_read()[$key] ?? null;
    return is_array($r) ? $r + ['on' => false, 'own' => [], 'games' => []] : ['on' => false, 'own' => [], 'games' => []];
}

function xs_es_save(string $key, array $rec, ?string &$why = null): bool
{
    $all = xs_es_read();
    $all[$key] = $rec;
    return xs_write_json(xs_es_path(), $all, $why);
}

/** A file as it was, kept in data\emu-kept before Xsegon changes it. False when it could not be kept. */
function xs_es_keep(string $file): bool
{
    $dir = xs_data_path('emu-kept');
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        return false;
    }
    return @copy($file, $dir . DIRECTORY_SEPARATOR . pathinfo($file, PATHINFO_FILENAME) . '.' . date('Ymd-His') . '.' . pathinfo($file, PATHINFO_EXTENSION));
}

/**
 * Keys set under one [section] of a game's own ini, every other byte as it was. A file
 * not there starts as $from's text (Cemu reads a game's own profile in place of the one
 * it ships). Answers the record that puts it back, or null with $why.
 */
function xs_es_ini_set(string $file, string $section, array $set, ?string $from, ?string &$why = null): ?array
{
    $made = !is_file($file);
    $raw  = $made ? ($from !== null && is_file($from) ? (string) @file_get_contents($from) : '') : @file_get_contents($file);
    if (!is_string($raw)) {
        $why = 'the game\'s settings file would not read';
        return null;
    }
    $eol   = str_contains($raw, "\r\n") || $raw === '' ? "\r\n" : "\n";
    $lines = $raw === '' ? [] : preg_split('/\r?\n/', $raw);
    $head  = null;
    $end   = count($lines);
    foreach ($lines as $i => $l) {
        if (preg_match('/^\[(.+)\]$/', trim($l, " \t\xEF\xBB\xBF"), $m)) {
            if ($head !== null) {
                $end = $i;
                break;
            }
            if (strcasecmp($m[1], $section) === 0) {
                $head = $i;
            }
        }
    }
    $rec = ['file' => $file, 'made' => $made, 'from' => $made ? $from : null, 'section' => $section, 'added' => $head === null, 'was' => []];
    if ($head === null) {
        while ($lines && end($lines) === '') {
            array_pop($lines);
        }
        if ($lines) {
            $lines[] = '';
        }
        $lines[] = '[' . $section . ']';
        $head = count($lines) - 1;
        $end = count($lines);
        $lines[] = '';
    } else {
        // New lines go after the section's last line, not after the blank lines that end it.
        while ($end - 1 > $head && trim($lines[$end - 1]) === '') {
            $end--;
        }
    }
    foreach ($set as $k => $v) {
        $at = null;
        for ($i = $head + 1; $i < $end; $i++) {
            if (preg_match('/^\s*' . preg_quote((string) $k, '/') . '\s*=/i', $lines[$i])) {
                $at = $i;
                break;
            }
        }
        $line = $k . ' = ' . $v;
        $rec['was'][$k] = $at !== null ? $lines[$at] : null;
        if ($at !== null) {
            $lines[$at] = $line;
        } else {
            array_splice($lines, $end, 0, [$line]);
            $end++;
        }
    }
    if (!$made && !xs_es_keep($file)) {
        $why = 'the game\'s settings file as it was could not be kept';
        return null;
    }
    $rec['lines'] = array_map(static fn($k, $v): string => $k . ' = ' . $v, array_keys($set), array_values($set));
    return xs_tp_put($file, implode($eol, $lines) . ($made ? $eol : ''), $why) ? $rec : null;
}

/** A record of xs_es_ini_set's put back: only lines still as Xsegon wrote them change. */
function xs_es_ini_unset(array $rec, ?string &$why = null): bool
{
    $file = (string) $rec['file'];
    if (!is_file($file)) {
        return true;                                   // gone already
    }
    $raw = @file_get_contents($file);
    if (!is_string($raw)) {
        $why = 'the game\'s settings file would not read';
        return false;
    }
    $eol = str_contains($raw, "\r\n") ? "\r\n" : "\n";
    $lines = preg_split('/\r?\n/', $raw);
    $mine = array_flip((array) ($rec['lines'] ?? []));
    foreach ($lines as $i => $l) {
        if (!isset($mine[trim($l)])) {
            continue;
        }
        $k = trim(explode('=', $l, 2)[0]);
        $was = $rec['was'][$k] ?? null;
        if (is_string($was)) {
            $lines[$i] = $was;
        } else {
            unset($lines[$i]);
        }
    }
    $lines = array_values($lines);
    if (!empty($rec['added'])) {
        // The section Xsegon added goes with its lines when nothing else came into it.
        foreach ($lines as $i => $l) {
            if (strcasecmp(trim($l), '[' . $rec['section'] . ']') === 0) {
                $next = $lines[$i + 1] ?? null;
                if ($next === null || trim($next) === '' || str_starts_with(trim($next), '[')) {
                    array_splice($lines, $i, $next !== null && trim($next) === '' ? 2 : 1);
                }
                break;
            }
        }
    }
    $text = implode($eol, $lines);
    // A file Xsegon made goes when what is left is what it started from.
    if (!empty($rec['made'])) {
        $from = $rec['from'] ?? null;
        $start = is_string($from) && is_file($from) ? (string) @file_get_contents($from) : '';
        if (trim($text) === trim($start)) {
            if (!@unlink($file)) {
                $why = 'the game\'s settings file Xsegon made could not be taken away';
                return false;
            }
            return true;
        }
    }
    if (!xs_es_keep($file)) {
        $why = 'the game\'s settings file as it was could not be kept';
        return false;
    }
    return xs_tp_put($file, $text, $why);
}

/**
 * A list section's line: taken out of [section] and, with $add, put back once at its end,
 * the section made at the file's end when there is none. A section left empty goes with its
 * header. Dolphin's "$Name" lists and PCSX2's repeated "Enable = Name" lines are both this.
 */
function xs_es_list_line(array $lines, string $section, string $line, bool $add): array
{
    $head = null;
    $end = count($lines);
    foreach ($lines as $i => $l) {
        if (preg_match('/^\[(.+)\]\s*$/', trim($l), $m)) {
            if ($head !== null) {
                $end = $i;
                break;
            }
            if ($m[1] === $section) {
                $head = $i;
            }
        }
    }
    if ($head !== null) {
        for ($i = $end - 1; $i > $head; $i--) {
            if (preg_replace('/\s*=\s*/', ' = ', trim($lines[$i])) === preg_replace('/\s*=\s*/', ' = ', $line)) {
                array_splice($lines, $i, 1);
                $end--;
            }
        }
    }
    if ($add) {
        if ($head === null) {
            array_push($lines, '[' . $section . ']', $line);
        } else {
            while ($end - 1 > $head && trim($lines[$end - 1]) === '') {
                $end--;
            }
            array_splice($lines, $end, 0, [$line]);
        }
    } elseif ($head !== null) {
        $empty = true;
        for ($i = $head + 1; $i < $end; $i++) {
            $empty = $empty && trim($lines[$i]) === '';
        }
        if ($empty) {
            array_splice($lines, $head, $end - $head);   // the header and the blank lines under it
        }
    }
    return $lines;
}

/** A game file's lines written back, a copy kept first; no lines left, no file, as before anything was switched. */
function xs_es_lines_put(string $file, array $lines, string $eol, ?string &$why = null): bool
{
    if (is_file($file) && !xs_es_keep($file)) {
        $why = 'the game\'s settings file as it was could not be kept';
        return false;
    }
    if (trim(implode('', $lines)) === '') {
        return !is_file($file) || @unlink($file);
    }
    return xs_tp_put($file, implode($eol, $lines) . $eol, $why);
}

/** The program a standalone emulator runs from, from the emulator table: [key => exe], the console's default first. */
function xs_es_programs(): array
{
    $s = xs_settings();
    $table = xs_emulators(xs_norm_path((string) ($s['paths']['launchbox'] ?? '')));
    $out = [];
    foreach ((array) ($table['platforms'] ?? []) as $v) {
        foreach ((array) ($v['options'] ?? []) as $o) {
            $exe = (string) ($table['programs'][$o['program'] ?? '']['exe'] ?? '');
            $e = $exe !== '' ? xs_emu_of($exe) : null;
            if ($e !== null && (!isset($out[$e['key']]) || !empty($o['default']))) {
                $out[$e['key']] = $exe;
            }
        }
    }
    return $out;
}

/** Turn an emulator's setup on: its own files written. False with $why, nothing half written left. */
function xs_es_on(array $e, string $exe, ?string &$why = null): bool
{
    $why = null;
    if (empty($e['setup'])) {
        $why = isset($e['setupNone']) ? $e['name'] . ' needs nothing set up: ' . $e['setupNone'] : (string) ($e['setupLater'] ?? $e['name'] . ' is not set up by Xsegon');
        return false;
    }
    if (xs_tp_open($exe)) {
        $why = $e['name'] . ' is open; close it first, as it writes its settings again when it closes';
        return false;
    }
    $home = xs_emu_home($e, $exe);
    $files = ($e['setup']['own'])($home, $exe, $why);
    if ($files === null) {
        return false;
    }
    $rec = xs_es_rec($e['key']);
    $done = [];
    foreach ($files as $path => $text) {
        if (is_file($path) && !isset($rec['own'][$path])) {
            $why = $path . ' is there already and is not one Xsegon wrote, so it is left alone';
            break;
        }
        if (!xs_tp_put($path, $text, $why)) {
            break;
        }
        $done[$path] = md5($text);
    }
    if ($why !== null) {
        foreach ($done as $path => $_) {
            @unlink($path);
        }
        return false;
    }
    $rec['own'] = $done + array_intersect_key($rec['own'], $done);
    $rec['on'] = true;
    $rec['at'] = date('c');
    xs_log('EMUS', $e['name'] . ': set up, ' . count($done) . ' file(s) of Xsegon\'s written in ' . $home);
    return xs_es_save($e['key'], $rec, $why);
}

/** Put back: every game's lines, then its own files where they are still as written. */
function xs_es_off(array $e, string $exe, ?string &$why = null): bool
{
    $why = null;
    if (xs_tp_open($exe)) {
        $why = $e['name'] . ' is open; close it first, as it writes its settings again when it closes';
        return false;
    }
    $rec = xs_es_rec($e['key']);
    $left = [];
    foreach ((array) $rec['games'] as $file => $g) {
        $w = null;
        if (!xs_es_ini_unset((array) $g, $w)) {
            $left[$file] = $g;
            $why = $w;
        }
    }
    $kept = 0;
    foreach ((array) $rec['own'] as $path => $sum) {
        // One changed since (in the emulator's own screen) is the person's now, and stays.
        if (is_file($path) && md5((string) @file_get_contents($path)) === $sum) {
            @unlink($path);
        } elseif (is_file($path)) {
            $kept++;
        }
    }
    xs_log('EMUS', $e['name'] . ': put back, ' . (count((array) $rec['games']) - count($left)) . ' game file(s) as they were'
           . ($kept ? ', ' . $kept . ' profile(s) changed since kept' : '') . ($left ? ', ' . count($left) . ' not: ' . $why : ''));
    $rec = ['on' => false, 'own' => [], 'games' => $left, 'at' => date('c')];
    $w = null;
    return xs_es_save($e['key'], $rec, $w) && $left === [];
}

/**
 * At a launch: the game's own lines written the first time it starts while its
 * emulator is set up, and any options the setup adds. ['args' => string, 'said' => string].
 * $write false (a dry launch): what would be written is said, and nothing is.
 */
function xs_es_for_launch(array $game, array $launch, bool $write = true): array
{
    $out = ['args' => '', 'said' => ''];
    $exe = (string) ($launch['exe'] ?? '');
    $e = $exe !== '' ? xs_emu_of($exe) : null;
    if ($e === null || empty($e['setup'])) {
        return $out;
    }
    $rec = xs_es_rec($e['key']);
    if (empty($rec['on'])) {
        return $out;
    }
    $home = xs_emu_home($e, $exe);
    if (isset($e['setup']['args'])) {
        $out['args'] = ($e['setup']['args'])($home, $exe);
    }
    if (!isset($e['setup']['game'])) {
        return $out;
    }
    $why = null;
    $t = ($e['setup']['game'])($home, $exe, $game, (string) ($launch['rom'] ?? ''), $why);
    if ($t === null) {
        $out['said'] = 'no game lines: ' . $why;
        return $out;
    }
    $old = $rec['games'][$t['file']] ?? null;
    if (is_array($old) && array_values((array) $old['lines']) === array_map(static fn($k, $v): string => $k . ' = ' . $v, array_keys($t['set']), array_values($t['set']))) {
        $out['said'] = 'game lines there already';
        return $out;
    }
    if (!$write) {
        $out['said'] = 'game lines would be written in ' . basename($t['file']);
        return $out;
    }
    $r = xs_es_ini_set($t['file'], $t['section'], $t['set'], $t['from'] ?? null, $why);
    if ($r === null) {
        $out['said'] = 'game lines not written: ' . $why;
        return $out;
    }
    // A second write keeps the first one's record of what was there before Xsegon.
    if (is_array($old)) {
        $r['was'] = (array) $old['was'] + $r['was'];
        $r['made'] = !empty($old['made']);
        $r['from'] = $old['from'] ?? null;
        $r['added'] = !empty($old['added']);
    }
    $rec['games'][$t['file']] = $r;
    xs_es_save($e['key'], $rec);
    $out['said'] = 'game lines written in ' . basename($t['file']);
    return $out;
}
