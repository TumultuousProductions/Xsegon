<?php
/**
 * Xsegon - "Set up the controller" for the standalone emulators (roadmap CA15).
 *
 * Within the line the user drew (CA2): Xsegon writes only files of its own, named
 * Xsegon, and a game's own settings file; an emulator's main settings never, and
 * nothing at all in LaunchBox's folders. The press writes the emulator's Xsegon
 * profiles; each game's own file gets the lines that name them the first time Xsegon
 * starts it after that, when its ID is read. Put back takes every line and file away
 * again, leaving anything the person or the emulator changed since.
 *
 * Each emulator's file in includes\emus\ says what it writes, under 'setup':
 *   'words' what the press does, in the person's words
 *   'own'   fn(home, exe, &why): [path => text] its own files, or null with why
 *   'game'  fn(home, exe, game, rom, &why): ['file', 'section', 'set' => [key => value], 'from'?] or null with why
 *   'args'  fn(home, exe, launch args, &why): string, options added to its launches while it is on (optional)
 *
 * data\emu-setup.json, guarded as a file of yours (XS_YOURS_JSON): key => ['on', 'at', 'home', 'exe',
 * 'own' => [path => md5], 'kept' => [path => md5] (Xsegon's profiles the person changed since: theirs),
 * 'dirs' => [folders Set up made], 'games' => [file => record]].
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

/** Whether the record reads: on a failed read nothing is changed, as the record holds what Put back needs. False with $why. */
function xs_es_readable(?string &$why = null): bool
{
    $path = xs_es_path();
    if (!is_file($path) || is_array(xs_read_json($path, null))) {
        return true;
    }
    $why = 'Xsegon\'s record of what it set up (' . $path . ') would not read just now, so nothing was changed: it holds what Put back needs. Try again in a moment';
    return false;
}

/** One emulator's record, as it is now: ['on' => false] when never set up. */
function xs_es_rec(string $key): array
{
    $none = ['on' => false, 'own' => [], 'kept' => [], 'dirs' => [], 'games' => []];
    $r = xs_es_read()[$key] ?? null;
    return is_array($r) ? $r + $none : $none;
}

function xs_es_save(string $key, array $rec, ?string &$why = null): bool
{
    $all = xs_es_read();
    $all[$key] = $rec;
    return xs_write_json(xs_es_path(), $all, $why);
}

/**
 * Whether Xsegon may write in this emulator's folders at all: never in LaunchBox's, whose files are
 * LaunchBox's, and never in a real emulator's from a test copy. False with $why.
 */
function xs_es_may_write(string $home, string $exe, ?string &$why = null): bool
{
    if (!function_exists('xs_in_launchbox')) {
        require_once __DIR__ . '/setup.php';
    }
    foreach (array_filter([$home, $exe], 'strlen') as $p) {
        if (xs_in_launchbox($p)) {
            $why = 'this emulator is LaunchBox\'s own copy (' . $p . '), and Xsegon writes nothing in LaunchBox\'s folders; Settings > Emulators can point it at a copy of its own';
            return false;
        }
        if (xs_test_keep_out($p)) {
            $why = 'a test copy never writes into a real emulator\'s folder';
            return false;
        }
    }
    return true;
}

/**
 * A file as it was, kept in data\emu-kept before Xsegon changes it, never over another copy: its name,
 * a mark of its folder, the time and a count; where.txt says which file each is of. The first copy of
 * a file and its newest ten stay. The copy's path, or null when it could not be kept.
 */
function xs_es_keep(string $file): ?string
{
    $dir = xs_data_path('emu-kept');
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        return null;
    }
    $stem = pathinfo($file, PATHINFO_FILENAME) . '.' . substr(md5(strtolower(xs_norm_path(dirname($file)))), 0, 8);
    $ext = pathinfo($file, PATHINFO_EXTENSION);
    $at = date('Ymd-His');
    $to = '';
    for ($n = 0; $n < 100; $n++) {
        $to = $dir . DIRECTORY_SEPARATOR . $stem . '.' . $at . '-' . sprintf('%02d', $n) . ($ext !== '' ? '.' . $ext : '');
        if (!is_file($to)) {
            break;
        }
    }
    if (is_file($to) || !@copy($file, $to)) {
        return null;
    }
    @file_put_contents($dir . DIRECTORY_SEPARATOR . 'where.txt', basename($to) . "\t" . $file . "\r\n", FILE_APPEND | LOCK_EX);
    $all = array_values(array_filter(@scandir($dir) ?: [], static fn(string $f): bool => str_starts_with($f, $stem . '.')));
    sort($all, SORT_STRING);
    foreach (array_slice($all, 1, max(0, count($all) - 11)) as $old) {
        @unlink($dir . DIRECTORY_SEPARATOR . $old);
    }
    return $to;
}

/** "Key=Value" and "Key = Value" read alike, as the emulators write either. */
function xs_es_norm(string $line): string
{
    return (string) preg_replace('/\s*=\s*/', ' = ', trim($line), 1);
}

/**
 * Keys set under one [section] of a game's own ini, every other byte as it was. A file
 * not there starts as $from's text (Cemu reads a game's own profile in place of the one
 * it ships). Answers the record that puts it back, or null with $why.
 */
function xs_es_ini_set(string $file, string $section, array $set, ?string $from, ?string &$why = null): ?array
{
    $made = !is_file($file);
    $raw  = $made ? ($from !== null && is_file($from) ? @file_get_contents($from) : '') : @file_get_contents($file);
    if (!is_string($raw)) {
        $why = 'the game\'s settings file would not read';
        return null;
    }
    $eol   = str_contains($raw, "\r\n") || $raw === '' ? "\r\n" : "\n";
    $lines = $raw === '' ? [] : preg_split('/\r?\n/', $raw);
    $head  = null;
    $end   = count($lines);
    foreach ($lines as $i => $l) {
        if (preg_match('/^\[(.+)\]$/', trim($i === 0 ? xs_emus_nobom($l) : $l), $m)) {
            if ($head !== null) {
                $end = $i;
                break;
            }
            if (strcasecmp($m[1], $section) === 0) {
                $head = $i;
            }
        }
    }
    // 'start': what a file Xsegon makes began as, so Put back knows it untouched however the copy it came from changes.
    $rec = ['file' => $file, 'made' => $made, 'from' => $made ? $from : null, 'start' => $made ? md5(trim($raw)) : null,
            'section' => $section, 'added' => $head === null, 'was' => []];
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
    $kept = null;
    if (!$made && ($kept = xs_es_keep($file)) === null) {
        $why = 'the game\'s settings file as it was could not be kept';
        return null;
    }
    $text = implode($eol, $lines) . ($made ? $eol : '');
    // 'kept' and 'after': untouched since, Put back gives the file back byte for byte from the copy.
    $rec['lines'] = array_map(static fn($k, $v): string => $k . ' = ' . $v, array_keys($set), array_values($set));
    $rec['kept'] = $kept;
    $rec['after'] = md5($text);
    return xs_tp_put($file, $text, $why) ? $rec : null;
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
    // Nothing changed in it since Xsegon wrote it: as it was before, byte for byte.
    if (isset($rec['after']) && md5($raw) === $rec['after']) {
        if (!empty($rec['made'])) {
            if (!@unlink($file)) {
                $why = 'the game\'s settings file Xsegon made could not be taken away';
                return false;
            }
            return true;
        }
        $was = is_string($rec['kept'] ?? null) && is_file($rec['kept']) ? @file_get_contents($rec['kept']) : false;
        if (is_string($was)) {
            return xs_tp_put($file, $was, $why);
        }
    }
    $eol = str_contains($raw, "\r\n") ? "\r\n" : "\n";
    $lines = preg_split('/\r?\n/', $raw);
    $mine = array_flip(array_map('xs_es_norm', (array) ($rec['lines'] ?? [])));
    foreach ($lines as $i => $l) {
        if (!isset($mine[xs_es_norm($l)])) {
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
        $start = $rec['start'] ?? null;
        if (!is_string($start)) {
            $from = $rec['from'] ?? null;
            $start = md5(trim(is_string($from) && is_file($from) ? (string) @file_get_contents($from) : ''));
        }
        if (md5(trim($text)) === $start) {
            if (!@unlink($file)) {
                $why = 'the game\'s settings file Xsegon made could not be taken away';
                return false;
            }
            return true;
        }
    }
    if ($text === $raw) {
        return true;                                   // none of Xsegon's lines left in it: nothing to write
    }
    if (xs_es_keep($file) === null) {
        $why = 'the game\'s settings file as it was could not be kept';
        return false;
    }
    return xs_tp_put($file, $text, $why);
}

/** Whether a game's file has every one of these lines under [section], as the file is now. */
function xs_es_has_lines(string $file, string $section, array $want): bool
{
    $in = false;
    $have = [];
    foreach (is_file($file) ? (@file($file, FILE_IGNORE_NEW_LINES) ?: []) : [] as $i => $l) {
        $t = trim($i === 0 ? xs_emus_nobom($l) : $l);
        if (preg_match('/^\[(.+)\]$/', $t, $m)) {
            $in = strcasecmp($m[1], $section) === 0;
            continue;
        }
        if ($in) {
            $have[xs_es_norm($t)] = true;
        }
    }
    foreach ($want as $w) {
        if (!isset($have[xs_es_norm($w)])) {
            return false;
        }
    }
    return true;
}

/**
 * A list section's line: taken out of [section] and, with $add, put back once at its end,
 * the section made at the file's end when there is none. A section left empty goes with its
 * header. Dolphin's "$Name" lists and PCSX2's repeated "Enable = Name" lines are both this;
 * a section's name is matched as the emulators match it, in any case.
 */
function xs_es_list_line(array $lines, string $section, string $line, bool $add): array
{
    $head = null;
    $end = count($lines);
    foreach ($lines as $i => $l) {
        if (preg_match('/^\[(.+)\]\s*$/', trim($i === 0 ? xs_emus_nobom($l) : $l), $m)) {
            if ($head !== null) {
                $end = $i;
                break;
            }
            if (strcasecmp($m[1], $section) === 0) {
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

/** A game file's lines written back, a copy kept first; no lines left, no file, as before anything was switched. $final: end on a line break, as the file did. */
function xs_es_lines_put(string $file, array $lines, string $eol, ?string &$why = null, bool $final = true): bool
{
    if (is_file($file) && xs_es_keep($file) === null) {
        $why = 'the game\'s settings file as it was could not be kept';
        return false;
    }
    if (trim(implode('', $lines)) === '') {
        if (is_file($file) && !@unlink($file)) {
            $why = 'the game\'s settings file, empty now, could not be taken away (' . xs_file_error_reason() . ')';
            return false;
        }
        return true;
    }
    return xs_tp_put($file, implode($eol, $lines) . ($final ? $eol : ''), $why);
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

/** The folders a file's write would make, deepest first. */
function xs_es_new_dirs(string $path): array
{
    $out = [];
    for ($d = dirname($path); $d !== '' && dirname($d) !== $d && !is_dir($d); $d = dirname($d)) {
        $out[] = $d;
    }
    return $out;
}

/** Folders Set up made, taken away where nothing else came into them: deepest first, only when empty. */
function xs_es_rmdirs(array $dirs): void
{
    $dirs = array_values(array_unique(array_map('strval', $dirs)));
    usort($dirs, static fn(string $a, string $b): int => strlen($b) <=> strlen($a));
    foreach ($dirs as $d) {
        if (is_dir($d) && count(@scandir($d) ?: []) <= 2) {
            @rmdir($d);
        }
    }
}

/**
 * Turn an emulator's setup on: its own files written. A profile of Xsegon's the person changed since
 * in the emulator is theirs, used as it is and never written over. False with $why, nothing half
 * written left; $said says what the person should know of a press that worked.
 */
function xs_es_on(array $e, string $exe, ?string &$why = null, ?string &$said = null): bool
{
    $why = null;
    $said = null;
    if (empty($e['setup'])) {
        $why = isset($e['setupNone']) ? $e['name'] . ' needs nothing set up: ' . $e['setupNone'] : (string) ($e['setupLater'] ?? $e['name'] . ' is not set up by Xsegon');
        return false;
    }
    $home = xs_emu_home($e, $exe);
    if (!xs_es_may_write($home, $exe, $why)) {
        return false;
    }
    if (xs_tp_open($exe)) {
        $why = $e['name'] . ' is open; close it first, as it writes its settings again when it closes';
        return false;
    }
    if (!xs_es_readable($why)) {
        return false;
    }
    $files = ($e['setup']['own'])($home, $exe, $why);
    if ($files === null) {
        return false;
    }
    $rec = xs_es_rec($e['key']);
    $kept = (array) $rec['kept'];
    $done = [];
    $fresh = [];
    $dirs = [];
    $theirs = [];
    foreach ($files as $path => $text) {
        if (is_file($path)) {
            $now = @file_get_contents($path);
            if (!is_string($now)) {
                $why = $path . ' would not read just now, so nothing was written';
                break;
            }
            $sum = $rec['own'][$path] ?? null;
            if (isset($kept[$path]) || (is_string($sum) && md5($now) !== $sum)) {
                $theirs[$path] = md5($now);
                continue;
            }
            if ($sum === null) {
                $why = basename($path) . ' is already in ' . dirname($path) . ' and is not one Xsegon wrote, so nothing was written: rename or move it, then Set up again';
                break;
            }
        } else {
            $fresh[] = $path;
            $dirs = array_merge($dirs, xs_es_new_dirs($path));
        }
        if (!xs_tp_put($path, $text, $why)) {
            break;
        }
        $done[$path] = md5($text);
    }
    $undo = static function () use (&$fresh, &$dirs): void {
        foreach ($fresh as $p) {
            @unlink($p);
        }
        xs_es_rmdirs($dirs);
    };
    if ($why !== null) {
        $undo();
        return false;
    }
    foreach ($kept as $p => $sum) {
        if (!isset($files[$p]) && is_file($p)) {
            $theirs[$p] = $sum;                        // theirs still, though Set up no longer writes that file
        }
    }
    $rec['own'] = $done;
    $rec['kept'] = $theirs;
    $rec['dirs'] = array_values(array_unique(array_merge((array) $rec['dirs'], $dirs)));
    $rec['on'] = true;
    $rec['at'] = date('c');
    $rec['home'] = $home;
    $rec['exe'] = $exe;
    $w = null;
    if (!xs_es_save($e['key'], $rec, $w)) {
        // Not written down, so not left on disk: Put back could never find it.
        $undo();
        $why = 'what Xsegon wrote could not be written down (' . ($w ?? 'data\\emu-setup.json') . '), so it was taken away again';
        return false;
    }
    if ($theirs) {
        $said = count($theirs) . ' of Xsegon\'s profiles, changed since in ' . $e['name'] . ', ' . (count($theirs) === 1 ? 'is' : 'are') . ' used as you left '
              . (count($theirs) === 1 ? 'it' : 'them') . ': ' . implode(', ', array_map(static fn($p): string => pathinfo((string) $p, PATHINFO_FILENAME), array_keys($theirs)));
    }
    xs_log('EMUS', $e['name'] . ': set up, ' . count($done) . ' file(s) of Xsegon\'s written in ' . $home
           . ($theirs ? ', ' . count($theirs) . ' changed by the person used as they are' : ''));
    return true;
}

/**
 * Put back: every game's lines, then its own files where they are still as written. While any game's
 * file could not be put back, the profiles stay and it stays on: a game naming a missing profile
 * would stop at its start. Works from the record alone, so an emulator gone from the table can be
 * put back too. False with $why; $said names profiles left because the person changed them.
 */
function xs_es_off(array $e, string $exe, ?string &$why = null, ?string &$said = null): bool
{
    $why = null;
    $said = null;
    $rec = xs_es_rec($e['key']);
    $exe = $exe !== '' ? $exe : (string) ($rec['exe'] ?? '');
    $home = (string) ($rec['home'] ?? ($exe !== '' ? xs_emu_home($e, $exe) : ''));
    if ($exe !== '' && xs_tp_open($exe)) {
        $why = $e['name'] . ' is open; close it first, as it writes its settings again when it closes';
        return false;
    }
    if (!xs_es_may_write($home, $exe, $why) || !xs_es_readable($why)) {
        return false;
    }
    $left = [];
    $first = null;
    foreach ((array) $rec['games'] as $file => $g) {
        $w = null;
        if (!xs_es_ini_unset((array) $g, $w)) {
            $left[$file] = $g;
            $first ??= basename((string) $file) . ': ' . $w;
        }
    }
    if ($left) {
        $rec['games'] = $left;
        $rec['at'] = date('c');
        xs_es_save($e['key'], $rec);
        $n = count($left);
        $why = $n . ($n === 1 ? ' game\'s settings file' : ' games\' settings files') . ' could not be put back (' . $first . '), so Xsegon\'s profiles stay set up for now: press Put back again once '
             . ($n === 1 ? 'it is' : 'they are') . ' free';
        xs_log('EMUS', $e['name'] . ': put back stopped, ' . $n . ' game file(s) not put back (' . $first . '); its profiles left as they are');
        return false;
    }
    $kept = (array) $rec['kept'];
    $changed = [];
    foreach ((array) $rec['own'] as $path => $sum) {
        if (!is_file($path)) {
            continue;
        }
        // One changed since (in the emulator's own screen) is the person's now, and stays.
        $now = @file_get_contents($path);
        if (is_string($now) && md5($now) === $sum) {
            @unlink($path);
        } else {
            $kept[$path] = is_string($now) ? md5($now) : '';
            $changed[] = pathinfo((string) $path, PATHINFO_FILENAME);
        }
    }
    xs_es_rmdirs((array) $rec['dirs']);
    $kept = array_filter($kept, static fn($p): bool => is_file((string) $p), ARRAY_FILTER_USE_KEY);
    if ($changed) {
        $said = count($changed) . ' of Xsegon\'s profiles ' . (count($changed) === 1 ? 'was' : 'were') . ' changed since in ' . $e['name'] . ', so '
              . (count($changed) === 1 ? 'it is yours now and stays' : 'they are yours now and stay') . ': ' . implode(', ', $changed);
    }
    xs_log('EMUS', $e['name'] . ': put back, ' . count((array) $rec['games']) . ' game file(s) as they were'
           . ($changed ? ', ' . count($changed) . ' profile(s) changed since kept' : ''));
    $rec = ['on' => false, 'own' => [], 'kept' => $kept, 'dirs' => [], 'games' => [], 'at' => date('c'), 'home' => $home, 'exe' => $exe];
    return xs_es_save($e['key'], $rec, $why);
}

/**
 * At a launch: the game's own lines written the first time it starts while its emulator is set up,
 * and any options the setup adds. ['args' => string, 'said' => string]. Nothing is written for
 * another copy of the emulator than the one set up, while a profile of Xsegon's is gone, or while
 * the emulator is open. $write false (a dry launch): what would be written is said, and nothing is.
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
    if (isset($rec['home']) && strcasecmp(rtrim(xs_norm_path((string) $rec['home']), '\\'), rtrim(xs_norm_path($home), '\\')) !== 0) {
        $out['said'] = 'nothing handed over: set up for the ' . $e['name'] . ' that keeps its settings in ' . $rec['home'] . ', and this one keeps them in ' . $home;
        return $out;
    }
    foreach (array_keys((array) $rec['own'] + (array) $rec['kept']) as $p) {
        if (!is_file((string) $p)) {
            $out['said'] = 'nothing handed over: Xsegon\'s profile ' . basename((string) $p) . ' is gone from ' . dirname((string) $p)
                         . '; Put back, then Set up, in Settings > RetroArch + Emulator Controls > Other emulators';
            return $out;
        }
    }
    if (isset($e['setup']['args'])) {
        $w = null;
        $out['args'] = ($e['setup']['args'])($home, $exe, (string) ($launch['args'] ?? ''), $w);
        if ($w !== null) {
            $out['said'] = $w;
        }
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
    $want = array_map(static fn($k, $v): string => $k . ' = ' . $v, array_keys($t['set']), array_values($t['set']));
    // There already when the file itself still has every line, not when the record alone says so.
    if (xs_es_has_lines($t['file'], $t['section'], $want)) {
        $out['said'] = 'game lines there already';
        return $out;
    }
    if (!$write) {
        $out['said'] = 'game lines would be written in ' . basename($t['file']);
        return $out;
    }
    if (!xs_es_may_write($home, $exe, $why) || !xs_es_readable($why)) {
        $out['said'] = 'game lines not written: ' . $why;
        return $out;
    }
    if (xs_tp_open($exe)) {
        $out['said'] = 'game lines not written: ' . $e['name'] . ' is open already, and writes a game\'s settings again when it closes';
        return $out;
    }
    $old = $rec['games'][$t['file']] ?? null;
    $r = xs_es_ini_set($t['file'], $t['section'], $t['set'], $t['from'] ?? null, $why);
    if ($r === null) {
        $out['said'] = 'game lines not written: ' . $why;
        return $out;
    }
    // A second write keeps the first one's record of what was there before Xsegon, and every line either wrote.
    if (is_array($old)) {
        $r['was'] = (array) $old['was'] + $r['was'];
        $r['lines'] = array_values(array_unique(array_merge((array) ($old['lines'] ?? []), $r['lines'])));
        $r['made'] = !empty($old['made']);
        $r['from'] = $old['from'] ?? null;
        $r['added'] = !empty($old['added']);
        $r['start'] = $old['start'] ?? $r['start'];
        $r['kept'] = array_key_exists('kept', $old) ? $old['kept'] : null;
    }
    $rec['games'][$t['file']] = $r;
    $w = null;
    if (!xs_es_save($e['key'], $rec, $w)) {
        // Not written down, so not left in the file: Put back could never find it.
        xs_es_ini_unset($r);
        $out['said'] = 'game lines not written: what Xsegon wrote could not be written down (' . ($w ?? 'data\\emu-setup.json') . ')';
        return $out;
    }
    $out['said'] = 'game lines written in ' . basename($t['file']);
    return $out;
}
