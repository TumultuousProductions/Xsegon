<?php
/**
 * Xsegon - the standalone emulators it knows, one file each in includes\emus\.
 *
 * Each file returns what Xsegon knows of one emulator: the program names it goes
 * by, where it keeps its settings, its controls as its own files have them, and
 * how a game in it is left with a pad. A new emulator is a new file there.
 *
 * Nothing here writes. Every read is of the emulator's own files, and a file that
 * is not there or will not read is said so, never guessed at.
 */
declare(strict_types=1);

/** Every emulator file, by key (its file name). */
function xs_emus(): array
{
    static $all = null;
    if ($all === null) {
        $all = [];
        foreach (glob(__DIR__ . DIRECTORY_SEPARATOR . 'emus' . DIRECTORY_SEPARATOR . '*.php') ?: [] as $f) {
            // A key is one lower-case word: a copy ("pcsx2 - Copy.php") would declare its functions twice, a fatal error.
            if (!preg_match('/^[a-z0-9]+\.php$/', basename($f))) {
                if (function_exists('xs_log')) {
                    xs_log('EMUS', basename($f) . ' in includes\\emus is not an emulator file\'s name (one lower-case word), so it is left out');
                }
                continue;
            }
            $e = require $f;
            if (is_array($e) && !empty($e['exes'])) {
                $all[basename($f, '.php')] = $e + ['key' => basename($f, '.php')];
            }
        }
    }
    return $all;
}

/** The emulator a program is, by its file name; null for RetroArch and any Xsegon does not know. */
function xs_emu_of(string $exe): ?array
{
    $base = strtolower((string) preg_replace('/\.exe$/i', '', basename(str_replace('\\', '/', $exe))));
    foreach (xs_emus() as $e) {
        if (in_array($base, $e['exes'], true)) {
            return $e;
        }
    }
    return null;
}

/** Where an emulator keeps its settings, decided the way it decides. */
function xs_emu_home(array $e, string $exe): string
{
    return ($e['home'])(dirname($exe));
}

/** A folder under Documents, wherever Windows keeps Documents. */
function xs_emus_docs(string $sub): string
{
    $home = (string) getenv('USERPROFILE');
    foreach ([$home . '\\OneDrive\\Documents', $home . '\\Documents'] as $d) {
        if (is_dir($d . DIRECTORY_SEPARATOR . $sub)) {
            return $d . DIRECTORY_SEPARATOR . $sub;
        }
    }
    return $home . '\\Documents\\' . $sub;
}

/** A folder under the roaming AppData, where Cemu and Eden keep everything. */
function xs_emus_appdata(string $sub): string
{
    return (string) getenv('APPDATA') . DIRECTORY_SEPARATOR . $sub;
}

/** A file that is there but would not read: said so, never taken for an empty one. */
function xs_emus_unreadable(string $file): bool
{
    return is_file($file) && @file_get_contents($file, false, null, 0, 1) === false;
}

/** A line with the byte order mark a file can start with taken off: only those three bytes together, at the start. */
function xs_emus_nobom(string $line): string
{
    return str_starts_with($line, "\xEF\xBB\xBF") ? substr($line, 3) : $line;
}

/** Whether an ini has a [Section] at all, so "no such section" is told from "nothing in it". */
function xs_emus_ini_has(string $file, string $section): bool
{
    foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (preg_match('/^\[(.+)\]$/', trim(xs_emus_nobom($line)), $m) && strcasecmp(trim($m[1]), $section) === 0) {
            return true;
        }
    }
    return false;
}

/** One [Section] of a flat ini, as ordered key => value pairs; $raw keeps the quotes and backticks round a value. */
function xs_emus_ini_section(string $file, string $section, bool $raw = false): array
{
    $out = [];
    $in = false;
    foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $line = trim(xs_emus_nobom($line));
        if (preg_match('/^\[(.+)\]$/', $line, $m)) {
            $in = strcasecmp(trim($m[1]), $section) === 0;
            continue;
        }
        if (!$in || $line === '' || $line[0] === ';' || $line[0] === '#') {
            continue;
        }
        $eq = strpos($line, '=');
        if ($eq === false) {
            continue;
        }
        $out[trim(substr($line, 0, $eq))] = trim(substr($line, $eq + 1), $raw ? " \t" : " \t`\"");
    }
    return $out;
}

/** The answer of a controls reader for a file that is there but would not read. */
function xs_emus_unread_controls(string $name, string $file): array
{
    return ['rows' => [], 'source' => ['file' => $file, 'read' => false,
            'note' => $name . '\'s settings file ' . $file . ' is there but would not read just now (held by another program, or not allowed): nothing is shown rather than a guess.']];
}

/** One value of a toml file's [section], as written; null when it is not there. */
function xs_emus_toml_value(string $file, string $section, string $key): ?string
{
    $in = false;
    foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $t = trim($line);
        if ($t !== '' && $t[0] === '[') {
            $in = strcasecmp($t, '[' . $section . ']') === 0;
        } elseif ($in && preg_match('/^' . preg_quote($key, '/') . '\s*=\s*("[^"]*"|\'[^\']*\'|[^#\s]+)/', $t, $m)) {
            return trim($m[1], '"\'');
        }
    }
    return null;
}

/** Whether Xsegon's own held Xbox button closes a game (Settings > Launching). */
function xs_emus_pad_leave_on(): bool
{
    if (!function_exists('xs_settings')) {
        require_once __DIR__ . '/settings.php';
    }
    return (bool) (xs_settings()['launch']['padLeave'] ?? true);
}

/**
 * How a game in this emulator is left with a pad: ['by' => 'own'|'xsegon', 'on', 'words'].
 * 'xsegon': the emulator has no pad way out, so Xsegon hears a held Xbox button (bin\padleave.ps1).
 */
function xs_emu_leave(array $e, string $home): array
{
    if (($e['leave'] ?? 'xsegon') === 'xsegon') {
        $on = xs_emus_pad_leave_on();
        // As bin\padleave.ps1 hears it: let go between 2 and 5 seconds (longer is a pad being switched off).
        return ['by' => 'xsegon', 'on' => $on, 'words' => $on
            ? 'Hold the Xbox button for 2 seconds and let go, with the game in front: Xsegon closes ' . $e['name'] . ' as its own X button would, and comes back. '
              . 'If ' . $e['name'] . ' asks first, answer it there; if it will not close, the same hold again a few seconds later ends it, without it saving its settings. '
              . 'A hold of 5 seconds or more does nothing, as it switches the pad off. ' . $e['name'] . ' has no pad press of its own for that.'
            : $e['name'] . ' has no pad press that leaves a game, and Xsegon\'s held Xbox button is off (Settings > Launching > Leave a game by holding the Xbox button).'];
    }
    return ['by' => 'own', 'on' => true, 'words' => ($e['leave'])($home)];
}
