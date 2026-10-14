<?php
/**
 * Xsegon - emulators moved out of LaunchBox's folder.
 *
 * LaunchBox's folders are read only to Xsegon, so an emulator there is copied whole to a
 * folder of the person's own and the table pointed at the copy; LaunchBox's copy is left
 * as it is, and going back is pointing the table at it again. xs_in_launchbox() is asked
 * before anything writes into an emulator's folder.
 *
 * The copy runs in bin\emumove.php (progress in data\emumove-job.json); what moved and
 * from where is kept in data\emumove.json.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/setup.php';        // xs_in_launchbox()

/** A folder being filled by a copy carries this file until the copy is whole: a folder with it is a copy cut short. */
const XS_EMUMOVE_MARK = '.xsegon-copying';

/** The LaunchBox folder $path is inside, or null: an ancestor holding LaunchBox's program or its list of emulators. */
function xs_launchbox_root_of(string $path): ?string
{
    static $seen = [];
    $dir = rtrim(str_replace('/', '\\', $path), '\\');
    $walked = [];
    $found = null;
    for ($i = 0; $i < 24 && $dir !== '' && !preg_match('/^[A-Za-z]:$/', $dir); $i++) {
        $k = strtolower($dir);
        if (array_key_exists($k, $seen)) {
            $found = $seen[$k];
            break;
        }
        $walked[] = $k;
        if (is_file($dir . '\\LaunchBox.exe') || is_file($dir . '\\Data\\Emulators.xml')) {
            $found = $dir;
            break;
        }
        $up = dirname($dir);
        if ($up === $dir) {
            break;
        }
        $dir = $up;
    }
    foreach ($walked as $k) {
        $seen[$k] = $found;
    }
    return $found;
}

/* Whether a path is inside LaunchBox at all is xs_in_launchbox(), in includes\setup.php. */

/**
 * The whole folder of an emulator inside LaunchBox: its folder under Emulators, else its
 * program's folder. '' when the program lies loose in LaunchBox's or Emulators itself.
 */
function xs_emumove_folder(string $exe, string $root): string
{
    $root = rtrim($root, '\\');
    $dir  = dirname($exe);
    $pool = $root . '\\Emulators';
    if (str_starts_with(strtolower($dir) . '\\', strtolower($pool) . '\\')) {
        $rest = trim(substr($dir, strlen($pool)), '\\');
        return $rest === '' ? '' : $pool . '\\' . explode('\\', $rest)[0];
    }
    return strtolower($dir) === strtolower($root) ? '' : $dir;
}

/** Where the copies would go when nobody has said: the folder most of the other emulators share, else Xsegon's own. */
function xs_emumove_default_dest(array $table): string
{
    $count = [];
    foreach ($table['programs'] ?? [] as $p) {
        $exe = (string) ($p['exe'] ?? '');
        if ($exe === '' || xs_in_launchbox($exe)) {
            continue;
        }
        // Its folder's parents, never a drive itself.
        $dir = dirname($exe);
        for ($i = 0; $i < 3; $i++) {
            $dir = dirname($dir);
            if (preg_match('/^[A-Za-z]:\\\\?$/', $dir) || $dir === '' || $dir === '.') {
                break;
            }
            $count[strtolower($dir)] = [$dir, ($count[strtolower($dir)][1] ?? 0) + 1];
        }
    }
    $best = null;
    foreach ($count as [$dir, $n]) {
        if ($n >= 2 && is_dir($dir) && ($best === null || $n > $best[1] || ($n === $best[1] && strlen($dir) > strlen($best[0])))) {
            $best = [$dir, $n];
        }
    }
    return $best !== null ? $best[0] : xs_data_path('emulators');
}

function xs_emumove_job_path(): string
{
    return xs_data_path('emumove-job.json');
}

function xs_emumove_stop_path(): string
{
    return xs_data_path('emumove-stop');
}

/** What was moved: [program key => ['from', 'to', 'fromFolder', 'toFolder', 'at']]. */
function xs_emumove_moved(): array
{
    $m = xs_read_json(xs_data_path('emumove.json'), null);
    return is_array($m) && is_array($m['moved'] ?? null) ? $m['moved'] : [];
}

/** The job as its worker left it, or null; a worker that is gone is said. */
function xs_emumove_job(): ?array
{
    $job = xs_read_json(xs_emumove_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_emumove_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'the copy stopped before it finished: ' . $dead;
    }
    return $job;
}

/**
 * The emulators of the table that sit inside LaunchBox, one row a folder:
 *   keys (the programs in it), name, folder, exe, consoles (how many start
 *   in it), dest (where its copy would be), there (a folder of that name is
 *   at the destination already), why (it cannot be moved, in words).
 */
function xs_emumove_rows(array $table, string $dest): array
{
    $uses = [];
    foreach ($table['platforms'] ?? [] as $p) {
        $opts = $p['options'] ?? [];
        $use  = null;
        foreach ($opts as $o) {
            if (!empty($o['default'])) {
                $use = $o;
                break;
            }
        }
        $use ??= $opts[0] ?? null;
        if ($use !== null) {
            $uses[$use['program']] = ($uses[$use['program']] ?? 0) + 1;
        }
    }
    $rows = [];
    foreach ($table['programs'] ?? [] as $key => $p) {
        $exe  = (string) ($p['exe'] ?? '');
        $root = $exe !== '' ? xs_launchbox_root_of($exe) : null;
        if ($root === null) {
            continue;
        }
        $folder = xs_emumove_folder($exe, $root);
        $id = $folder !== '' ? strtolower($folder) : 'loose:' . $key;
        if (isset($rows[$id])) {
            $rows[$id]['keys'][] = (string) $key;
            $rows[$id]['consoles'] += $uses[$key] ?? 0;
            continue;
        }
        $to = $folder !== '' ? rtrim($dest, '\\') . '\\' . basename($folder) : '';
        $rows[$id] = [
            'keys' => [(string) $key], 'name' => (string) ($p['name'] ?? $key), 'exe' => $exe, 'folder' => $folder,
            'consoles' => $uses[$key] ?? 0, 'dest' => $to,
            // A copy cut short (Xsegon closed in the middle of it) is not "there": the next copy clears it first.
            'there' => $to !== '' && file_exists($to) && !is_file($to . '\\' . XS_EMUMOVE_MARK),
            'why' => $folder === '' ? 'its program lies loose in LaunchBox\'s folder, not in a folder of its own'
                   : (!is_file($exe) ? 'it is not where the table says' : null),
        ];
    }
    return array_values($rows);
}

/** How many emulators of the table sit inside LaunchBox: for the page, which offers the tool only then. */
function xs_emumove_count(): int
{
    $n = 0;
    foreach (xs_emulators()['programs'] ?? [] as $p) {
        $n += xs_in_launchbox((string) ($p['exe'] ?? '')) ? 1 : 0;
    }
    return $n;
}

/** Every file under $dir as [path relative to it => size], and the folders; null when it cannot be read. */
function xs_emumove_tree(string $dir): ?array
{
    if (!is_dir($dir)) {
        return null;
    }
    $files = [];
    $dirs  = [];
    try {
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
        foreach ($it as $f) {
            $rel = substr($f->getPathname(), strlen($dir) + 1);
            if ($f->isDir()) {
                $dirs[] = $rel;
            } else {
                $files[$rel] = $f->getSize();
            }
        }
    } catch (\Throwable $e) {
        return null;
    }
    return ['files' => $files, 'dirs' => $dirs];
}

/**
 * Starts the copy of these rows (by their first key) into $dest. Every check is made
 * first, so a refusal comes at the press and not half way.
 */
function xs_emumove_start(array $keys, string $dest, ?string &$why = null): bool
{
    $why  = null;
    $dest = rtrim(xs_norm_path($dest), '\\');
    if ((xs_emumove_job()['state'] ?? '') === 'running') {
        $why = 'emulators are being copied already';
        return false;
    }
    if (xs_game_running() !== null) {
        $why = 'a game is running: close it first, so no file of its emulator is copied half written';
        return false;
    }
    if ($dest === '' || !preg_match('/^[A-Za-z]:\\\\|^\\\\\\\\/', $dest . '\\')) {
        $why = 'choose a folder for the emulators first';
        return false;
    }
    if (xs_in_launchbox($dest . '\\x')) {
        $why = 'that folder is inside LaunchBox: choose one outside it';
        return false;
    }
    // A test's copy goes into no real emulator's folder, and not beside one either: it would land among the real ones.
    if (xs_test_keep_out($dest) || xs_test_keep_out_beside($dest)) {
        $why = 'a test copy never writes into a real emulator\'s folder';
        return false;
    }
    $table = xs_emulators();
    $rows  = [];
    foreach (xs_emumove_rows($table, $dest) as $r) {
        if (!array_intersect($r['keys'], array_map('strval', $keys))) {
            continue;
        }
        if ($r['why'] !== null) {
            $why = $r['name'] . ' cannot be moved: ' . $r['why'];
            return false;
        }
        if ($r['there']) {
            $why = 'there is a ' . basename($r['dest']) . ' in ' . $dest . ' already: choose another folder, or move that one away';
            return false;
        }
        if (str_starts_with(strtolower($dest) . '\\', strtolower($r['folder']) . '\\')) {
            $why = 'that folder is inside ' . $r['name'] . ' itself';
            return false;
        }
        $rows[] = $r;
    }
    if (!$rows) {
        $why = 'no emulator is selected';
        return false;
    }
    if (!is_dir($dest) && !@mkdir($dest, 0777, true)) {
        $why = 'the folder ' . $dest . ' could not be made';
        return false;
    }
    @unlink(xs_emumove_stop_path());
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'dest' => $dest,
            'items' => array_map(static fn (array $r): array => ['keys' => $r['keys'], 'name' => $r['name'], 'exe' => $r['exe'],
                'from' => $r['folder'], 'to' => $r['dest'], 'state' => 'waiting', 'bytes' => 0, 'total' => 0], $rows),
            'bytes' => 0, 'total' => 0, 'said' => ''];
    if (!xs_write_json(xs_emumove_job_path(), $job, $why)) {
        return false;
    }
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'emumove.php'];
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        $why = 'the copy could not be started';
        xs_write_json(xs_emumove_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    pclose($h);
    xs_log('EMUM', 'asked to copy ' . implode(', ', array_map(static fn (array $r): string => $r['name'], $rows)) . ' out of LaunchBox into ' . $dest);
    return true;
}

/**
 * Whole paths elsewhere in the table (a core's -L, a program's args) pointed from $from
 * to $to, so nothing still loads from the old folder. How many changed.
 */
function xs_emumove_repath(array &$table, string $from, string $to): int
{
    $n = 0;
    $swap = static function ($v) use ($from, $to, &$n) {
        if (!is_string($v) || $v === '') {
            return $v;
        }
        $out = str_ireplace($from . '\\', $to . '\\', $v, $c);
        $n += $c;
        return $out;
    };
    foreach ($table['programs'] ?? [] as $k => $p) {
        if (isset($p['args'])) {
            $table['programs'][$k]['args'] = $swap($p['args']);
        }
    }
    foreach ($table['platforms'] ?? [] as $pk => $pl) {
        foreach ($pl['options'] ?? [] as $i => $o) {
            foreach (['args', 'load'] as $f) {
                if (isset($o[$f])) {
                    $table['platforms'][$pk]['options'][$i][$f] = $swap($o[$f]);
                }
            }
        }
    }
    return $n;
}

/**
 * Points the table at the copy of one moved folder, every program in it, and
 * remembers where each came from. The table as it was is kept beside it once.
 */
function xs_emumove_point(array $item, ?string &$why = null): bool
{
    $table = xs_read_json(xs_emulators_path(), null);
    if (!is_array($table) || empty($table['programs'])) {
        $why = 'the emulator table could not be read';
        return false;
    }
    $keep = xs_data_path('emulators.before-move.json');
    if (!is_file($keep)) {
        @copy(xs_emulators_path(), $keep);
    }
    $moved = xs_emumove_moved();
    foreach ($item['keys'] as $key) {
        $old = (string) ($table['programs'][$key]['exe'] ?? '');
        if ($old === '' || !str_starts_with(strtolower($old), strtolower($item['from']) . '\\')) {
            continue;
        }
        $new = $item['to'] . substr($old, strlen($item['from']));
        if (!is_file($new)) {
            $why = 'the copy has no ' . basename($old);
            return false;
        }
        $table['programs'][$key]['exe'] = $new;
        $moved[$key] = ['from' => $old, 'to' => $new, 'fromFolder' => $item['from'], 'toFolder' => $item['to'], 'at' => date('c')];
    }
    xs_emumove_repath($table, (string) $item['from'], (string) $item['to']);
    if (!xs_emulators_write($table, $why)) {
        return false;
    }
    return xs_write_json(xs_data_path('emumove.json'), ['moved' => $moved], $why);
}

/** Back to LaunchBox's own copy of one program. The copy that was made stays where it is, untouched. */
function xs_emumove_back(string $key, ?string &$why = null): bool
{
    $why   = null;
    $moved = xs_emumove_moved();
    $was   = $moved[$key] ?? null;
    if ($was === null) {
        $why = 'that emulator was not moved by Xsegon';
        return false;
    }
    if (!is_file((string) $was['from'])) {
        $why = 'LaunchBox\'s own copy is not there any more: ' . $was['from'];
        return false;
    }
    if ((xs_emumove_job()['state'] ?? '') === 'running') {
        $why = 'emulators are being copied: wait for that to end';
        return false;
    }
    $table = xs_read_json(xs_emulators_path(), null);
    if (!is_array($table) || !isset($table['programs'][$key])) {
        $why = 'the emulator table has no such program';
        return false;
    }
    // Every program that came out of the same folder goes back with it.
    $names = [];
    foreach ($moved as $k => $m) {
        if (strtolower((string) $m['fromFolder']) !== strtolower((string) $was['fromFolder']) || !isset($table['programs'][$k])) {
            continue;
        }
        $table['programs'][$k]['exe'] = (string) $m['from'];
        $names[] = (string) ($table['programs'][$k]['name'] ?? $k);
        unset($moved[$k]);
    }
    xs_emumove_repath($table, (string) $was['toFolder'], (string) $was['fromFolder']);
    if (!xs_emulators_write($table, $why) || !xs_write_json(xs_data_path('emumove.json'), ['moved' => $moved], $why)) {
        return false;
    }
    xs_log('EMUM', implode(', ', $names) . ' pointed back at ' . $was['fromFolder'] . '; the copy in ' . $was['toFolder'] . ' is left as it is');
    return true;
}

/**
 * Settings files in a copy that name the old folder by whole path (xemu's BIOS and disk
 * image) rewritten to the new one, in the copy only. Changes by file.
 */
function xs_emumove_fix_paths(string $from, string $to): array
{
    $done = [];
    foreach (['xemu.toml', 'inis\\PCSX2.ini', 'retroarch.cfg', 'User\\Config\\Dolphin.ini'] as $rel) {
        $file = $to . '\\' . $rel;
        if (!is_file($file) || filesize($file) > 4 * 1048576) {
            continue;
        }
        $text = file_get_contents($file);
        if ($text === false) {
            continue;
        }
        $n = 0;
        // As it is written, with the slashes doubled, and with them forward; always up to a slash,
        // so a folder whose name only starts the same way is left alone.
        foreach (['\\', '\\\\', '/'] as $sep) {
            $text = str_ireplace(str_replace('\\', $sep, $from) . $sep, str_replace('\\', $sep, $to) . $sep, $text, $c);
            $n += $c;
        }
        if ($n > 0) {
            $at = filemtime($file);
            if (file_put_contents($file, $text) !== false) {
                @touch($file, $at ?: time());
                $done[$rel] = $n;
            }
        }
    }
    return $done;
}
