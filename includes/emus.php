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

/** One [Section] of a flat ini, as ordered key => value pairs; $raw keeps the quotes and backticks round a value. */
function xs_emus_ini_section(string $file, string $section, bool $raw = false): array
{
    $out = [];
    $in = false;
    foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $line = trim($line, " \t\xEF\xBB\xBF");
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
        return ['by' => 'xsegon', 'on' => $on, 'words' => $on
            ? 'Hold the Xbox button for 2 seconds: Xsegon closes ' . $e['name'] . ' and comes back. ' . $e['name'] . ' has no pad press of its own for that.'
            : $e['name'] . ' has no pad press that leaves a game, and Xsegon\'s held Xbox button is off (Settings > Launching > Leave a game by holding the Xbox button).'];
    }
    return ['by' => 'own', 'on' => true, 'words' => ($e['leave'])($home)];
}
