<?php
/**
 * Xsegon - the file work under a game's texture pack (includes\texpacks.php): the
 * emulator's switch written and put back, the textures found inside a pack, a pack
 * counted and deleted, and the name an N64 cartridge gives itself.
 *
 * Every write here keeps the file as it was first (data\texpacks-kept), and puts
 * back only what Xsegon itself changed.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/emucheats.php';
require_once __DIR__ . '/retroarch.php';
require_once __DIR__ . '/zipstore.php';

/** Files and bytes under a folder, giving up past $most files (then 'whole' is false). */
function xs_tp_count(string $dir, int $most = 300000): array
{
    $out = ['files' => 0, 'bytes' => 0, 'whole' => true];
    $walk = static function (string $d) use (&$walk, &$out, $most): void {
        foreach (@scandir($d) ?: [] as $n) {
            if ($n === '.' || $n === '..' || !$out['whole']) {
                continue;
            }
            $p = $d . DIRECTORY_SEPARATOR . $n;
            if (is_link($p)) {
                continue;
            }
            if (is_dir($p)) {
                $walk($p);
            } elseif (++$out['files'] > $most) {
                $out['whole'] = false;
            } else {
                $out['bytes'] += (int) @filesize($p);
            }
        }
    };
    $walk($dir);
    return $out;
}

/** A folder and all in it gone, only ever one under $base. $tick(files) after each file; false from it stops. */
function xs_tp_wipe(string $dir, string $base, ?callable $tick = null): bool
{
    $base = xs_norm_path($base) . DIRECTORY_SEPARATOR;
    if (strncasecmp(xs_norm_path($dir) . DIRECTORY_SEPARATOR, $base, strlen($base)) !== 0 || strlen(xs_norm_path($dir)) < strlen($base)) {
        return false;
    }
    if (is_file($dir)) {
        return @unlink($dir);
    }
    if (!is_dir($dir)) {
        return true;
    }
    $gone = 0;
    $walk = static function (string $d) use (&$walk, &$gone, $tick): bool {
        foreach (@scandir($d) ?: [] as $n) {
            if ($n === '.' || $n === '..') {
                continue;
            }
            $p = $d . DIRECTORY_SEPARATOR . $n;
            if (is_dir($p) && !is_link($p)) {
                if (!$walk($p)) {
                    return false;
                }
            } else {
                @unlink($p);
                $gone++;
                if ($tick !== null && $tick($gone) === false) {
                    return false;
                }
            }
        }
        return @rmdir($d) || !is_dir($d);
    };
    return $walk(xs_norm_path($dir));
}

/**
 * A pack's own folder name inside the game's, from the pack's name: one Windows can
 * keep, short enough for a pack's deep folders, no leading dot (the N64 core skips
 * those), and not taken already.
 */
function xs_tp_sub_name(string $name, string $into): string
{
    $n = trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/[<>:"\/\\\\|?*\x00-\x1f]+/', ' ', $name)), ' .');
    $n = rtrim(mb_substr($n, 0, 40), ' .');
    if ($n === '' || preg_match('/^(con|prn|aux|nul|com\d|lpt\d)$/i', $n)) {
        $n = 'Texture pack';
    }
    $try = $n;
    for ($i = 2; file_exists($into . DIRECTORY_SEPARATOR . $try); $i++) {
        $try = $n . ' ' . $i;
    }
    return $try;
}

/** Is a program from that exe's folder open? It writes its settings again as it closes. As ra_open_from(). */
function xs_tp_open(string $exe): bool
{
    $name = basename($exe);
    $out  = (string) @shell_exec('tasklist /FI "IMAGENAME eq ' . str_replace('"', '', $name) . '" /NH /FO CSV 2>NUL');
    if (stripos($out, '"' . $name . '"') === false) {
        return false;
    }
    $proc  = (string) preg_replace('/[^A-Za-z0-9_.-]/', '', pathinfo($name, PATHINFO_FILENAME));
    $said  = (string) @shell_exec('powershell -NoProfile -NonInteractive -Command "(Get-Process ' . $proc . ' -ErrorAction SilentlyContinue).Path" 2>NUL');
    $paths = array_values(array_filter(array_map('trim', preg_split('/\R/', $said) ?: []), 'strlen'));
    if (!$paths) {
        return true;                                   // open, and it will not say where from: taken as this one
    }
    foreach ($paths as $p) {
        if (strcasecmp(xs_norm_path(dirname($p)), xs_norm_path(dirname($exe))) === 0) {
            return true;
        }
    }
    return false;
}

/** A file as it was, kept before Xsegon writes it. False when it could not be kept. */
function xs_tp_keep(string $file): bool
{
    $dir = xs_data_path('texpacks-kept');
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        return false;
    }
    return @copy($file, $dir . DIRECTORY_SEPARATOR . pathinfo($file, PATHINFO_FILENAME) . '.' . date('Ymd-His') . '.' . pathinfo($file, PATHINFO_EXTENSION));
}

/** Written beside its name first, then given it. */
function xs_tp_put(string $file, string $text, ?string &$why = null): bool
{
    if (!is_dir(dirname($file)) && !@mkdir(dirname($file), 0777, true)) {
        $why = 'the folder ' . dirname($file) . ' could not be made';
        return false;
    }
    $tmp = $file . '.xsegon-new';
    if (@file_put_contents($tmp, $text) !== strlen($text) || !@rename($tmp, $file)) {
        @unlink($tmp);
        $why = 'the settings file could not be written (' . xs_file_error_reason() . ')';
        return false;
    }
    return true;
}

/** A few keys of a RetroArch core options file, raw. Its names have capitals and hyphens, which ra_cfg_keys() does not read. */
function xs_tp_opt_keys(string $file, array $names): array
{
    $out = [];
    foreach (is_file($file) ? (@file($file, FILE_IGNORE_NEW_LINES) ?: []) : [] as $line) {
        if (preg_match('/^\s*([A-Za-z0-9_.-]+)\s*=\s*"(.*)"\s*$/', (string) $line, $m) && in_array($m[1], $names, true)) {
            $out[$m[1]] = $m[2];
        }
    }
    return $out;
}

/** The game's own switch as its file has it now: true or false, null when it has none. */
function xs_tp_switch_now(array $sw): ?bool
{
    if ($sw['kind'] === 'opt') {
        $k = (string) array_key_first($sw['keys']);
        $v = xs_tp_opt_keys($sw['file'], [$k])[$k] ?? null;
        return $v === null ? null : strtolower($v) === 'true';
    }
    $v = (xs_pcsx2_ini($sw['file'])[$sw['section']][$sw['key']] ?? [])[0] ?? null;
    return $v === null ? null : strtolower(trim((string) $v)) === 'true';
}

/**
 * The emulator's texture switch for one game, in the game's own settings file,
 * every other byte as it was. On: answers what was there, to put back (null when
 * nothing was written for want of it, with $why). Off: $rec, that answer, put back.
 * $more: keys to set too (an N64 .hts pack's storage), for a RetroArch options file.
 */
function xs_tp_switch(array $sw, bool $on, ?array $rec, ?string &$why = null, array $more = []): ?array
{
    $why = null;
    return $sw['kind'] === 'opt' ? xs_tp_switch_opt($sw, $on, $rec, $why, $more) : xs_tp_switch_ini($sw, $on, $rec, $why);
}

/** An ini of PCSX2's or Dolphin's: one `Key = value` line under its [Section]. */
function xs_tp_switch_ini(array $sw, bool $on, ?array $rec, ?string &$why): ?array
{
    $file = $sw['file'];
    $line = $sw['key'] . ' = ' . $sw['on'];
    $made = '[' . $sw['section'] . "]\r\n" . $line . "\r\n";
    if ($on && !is_file($file)) {
        return xs_tp_put($file, $made, $why) ? ['was' => null, 'section' => true] : null;
    }
    if (!$on && !is_file($file)) {
        return ['was' => null, 'section' => false];
    }
    $raw = @file_get_contents($file);
    if (!is_string($raw)) {
        $why = 'the game\'s settings file would not read';
        return null;
    }
    $madeIt = is_array($rec) && array_key_exists('was', $rec) && $rec['was'] === null;
    if (!$on && $madeIt && trim($raw) === trim($made)) {
        if (!@unlink($file)) {
            $why = 'the game\'s settings file Xsegon made could not be taken away';
            return null;
        }
        return ['was' => null, 'section' => false];
    }
    $eol   = str_contains($raw, "\r\n") ? "\r\n" : "\n";
    $lines = preg_split('/\r?\n/', $raw);
    $head  = null;
    $at    = null;
    foreach ($lines as $i => $l) {
        $tl = trim($l, " \t\xEF\xBB\xBF");
        if (preg_match('/^\[(.+)\]$/', $tl, $m)) {
            if ($head !== null) {
                break;                                 // the next section: the key is not in this one
            }
            if ($m[1] === $sw['section']) {
                $head = $i;
            }
        } elseif ($head !== null && preg_match('/^' . preg_quote($sw['key'], '/') . '\s*=/', $tl)) {
            $at = $i;
            break;
        }
    }
    if ($on) {
        $out = ['was' => $at !== null ? $lines[$at] : '', 'section' => $head === null];
        if ($at !== null && strtolower(trim(explode('=', $lines[$at], 2)[1] ?? '')) === 'true') {
            return $out;                               // on already: nothing to write
        }
        if ($at !== null) {
            $lines[$at] = $line;
        } elseif ($head !== null) {
            array_splice($lines, $head + 1, 0, [$line]);
        } else {
            while ($lines && end($lines) === '') {
                array_pop($lines);
            }
            array_push($lines, '', '[' . $sw['section'] . ']', $line, '');
        }
    } else {
        $out = ['was' => null, 'section' => false];
        if ($at === null) {
            return $out;                               // gone already
        }
        $was = is_array($rec) ? ($rec['was'] ?? '') : '';
        if (is_string($was) && $was !== '') {
            $lines[$at] = $was;
        } else {
            array_splice($lines, $at, 1);
            // A section Xsegon added for the line goes with it when nothing else came into it.
            $next = $lines[$head + 1] ?? null;
            if (!empty($rec['section']) && ($next === null || trim($next) === '' || str_starts_with(trim($next), '['))) {
                array_splice($lines, $head, 1);
                if ($head > 0 && trim($lines[$head - 1] ?? 'x') === '' && trim($lines[$head] ?? '') === '') {
                    array_splice($lines, $head - 1, 1);
                }
            }
        }
    }
    if (!xs_tp_keep($file)) {
        $why = 'the game\'s settings file as it was could not be kept';
        return null;
    }
    return xs_tp_put($file, implode($eol, $lines), $why) ? $out : null;
}

/**
 * A RetroArch game options file. RetroArch reads it in place of its shared one,
 * so one Xsegon makes starts as a copy of the core's lines there ($sw['from']).
 */
function xs_tp_switch_opt(array $sw, bool $on, ?array $rec, ?string &$why, array $more): ?array
{
    $file = $sw['file'];
    $want = $sw['keys'] + $more;
    $lineOf = static fn (string $k, string $v): string => $k . ' = "' . $v . '"';
    if ($on && !is_file($file)) {
        $lines = [];
        $base  = array_fill_keys(array_keys($want), '');      // the core's own lines for these, as the shared file had them
        foreach (@file($sw['from'], FILE_IGNORE_NEW_LINES) ?: [] as $l) {
            if (preg_match('/^\s*(' . preg_quote($sw['prefix'], '/') . '[A-Za-z0-9_]+)\s*=/', (string) $l, $m)) {
                if (isset($want[$m[1]])) {
                    $base[$m[1]] = rtrim((string) $l);
                } else {
                    $lines[] = rtrim((string) $l);
                }
            }
        }
        foreach ($want as $k => $v) {
            $lines[] = $lineOf($k, $v);
        }
        $text = implode("\n", $lines) . "\n";
        return xs_tp_put($file, $text, $why) ? ['was' => null, 'wrote' => md5($text), 'set' => array_keys($want), 'base' => $base] : null;
    }
    if (!is_file($file)) {
        return ['was' => null];
    }
    $raw = @file_get_contents($file);
    if (!is_string($raw)) {
        $why = 'the game\'s options file would not read';
        return null;
    }
    if (!$on && is_array($rec) && array_key_exists('was', $rec) && $rec['was'] === null) {
        if (md5($raw) === ($rec['wrote'] ?? '')) {
            if (!@unlink($file)) {
                $why = 'the game\'s options file Xsegon made could not be taken away';
                return null;
            }
            return ['was' => null];
        }
        // Changed since: only Xsegon's lines go back, to what the core had before Xsegon.
        $rec = ['was' => (array) ($rec['base'] ?? []) + array_fill_keys((array) ($rec['set'] ?? []), '')];
    }
    $eol   = str_contains($raw, "\r\n") ? "\r\n" : "\n";
    $lines = preg_split('/\r?\n/', rtrim($raw, "\r\n"));
    $was   = [];
    $keys  = $on ? $want : (is_array($rec['was'] ?? null) ? $rec['was'] : []);
    foreach ($keys as $k => $v) {
        $at = null;
        foreach ($lines as $i => $l) {
            if (preg_match('/^\s*' . preg_quote((string) $k, '/') . '\s*=/', $l)) {
                $at = $i;
                break;
            }
        }
        if ($on) {
            $was[$k] = $at !== null ? $lines[$at] : '';
            if ($at !== null) {
                $lines[$at] = $lineOf((string) $k, (string) $v);
            } else {
                $lines[] = $lineOf((string) $k, (string) $v);
            }
        } elseif ($at !== null) {
            if ((string) $v !== '') {
                $lines[$at] = (string) $v;
            } else {
                array_splice($lines, $at, 1);
            }
        }
    }
    if (!xs_tp_keep($file)) {
        $why = 'the game\'s options file as it was could not be kept';
        return null;
    }
    $text = implode($eol, $lines) . $eol;
    if (!xs_tp_put($file, $text, $why)) {
        return null;
    }
    return $on ? ['was' => $was, 'set' => array_keys($want), 'before' => md5($raw), 'wrote' => md5($text)] : ['was' => null];
}

/**
 * A switch answer kept from before, with what a later one changed for the first
 * time added. A file Xsegon made and nobody else changed stays Xsegon's to take away.
 */
function xs_tp_switch_merge(?array $first, ?array $now): ?array
{
    if ($first === null || $now === null) {
        return $first ?? $now;
    }
    $first['set'] = array_values(array_unique(array_merge((array) ($first['set'] ?? []), (array) ($now['set'] ?? []))));
    if (array_key_exists('was', $first) && $first['was'] === null && isset($now['wrote'])) {
        if (($now['before'] ?? '') === ($first['wrote'] ?? '')) {
            $first['wrote'] = $now['wrote'];
        } else {
            // Changed by the person meanwhile: theirs now, Xsegon's own lines put back to the core's from before Xsegon.
            $first['was'] = array_intersect_key((array) ($first['base'] ?? []), (array) ($now['was'] ?? [])) + (array) ($now['was'] ?? []);
        }
    } elseif (is_array($first['was'] ?? null) && is_array($now['was'] ?? null)) {
        $first['was'] += $now['was'];
    }
    return $first;
}

/**
 * The name an N64 cartridge gives itself (its header's 20 letters), from a .z64,
 * .n64 or .v64, or the first of those in a .zip. The N64 core files a pack by it.
 */
function xs_tp_n64_name(string $rom, ?string &$why = null): ?string
{
    $why = null;
    $end = strtolower(pathinfo($rom, PATHINFO_EXTENSION));
    $b = '';
    if ($end === 'zip') {
        foreach (xs_zs_list($rom) ?? [] as $name => $e) {
            if (in_array(strtolower(pathinfo((string) $name, PATHINFO_EXTENSION)), ['z64', 'n64', 'v64'], true)) {
                xs_zs_read($rom, $e, static function (string $buf) use (&$b): bool { $b .= $buf; return strlen($b) < 64; });
                break;
            }
        }
    } elseif (in_array($end, ['z64', 'n64', 'v64'], true)) {
        $b = (string) @file_get_contents($rom, false, null, 0, 64);
    } else {
        $why = 'the cartridge\'s name cannot be read from a .' . $end . ' file';
        return null;
    }
    $b = substr($b, 0, 64);
    if (strlen($b) < 64) {
        $why = 'the cartridge\'s name could not be read from its file';
        return null;
    }
    $magic = bin2hex(substr($b, 0, 4));
    if ($magic === '37804012') {                       // .v64: every two bytes swapped
        $b = implode('', array_map('strrev', str_split($b, 2)));
    } elseif ($magic === '40123780') {                 // .n64: every four bytes reversed
        $b = implode('', array_map('strrev', str_split($b, 4)));
    } elseif ($magic !== '80371240') {
        $why = 'the file is not an N64 cartridge the core reads';
        return null;
    }
    $name = rtrim(substr($b, 0x20, 20), " \0");
    if ($name === '' || !preg_match('/^[\x20-\x7e]+$/', $name) || preg_match('/[<>:"\/\\\\|?*]|[ .]$/', $name)) {
        $why = 'the cartridge names itself in a way that cannot name a folder';
        return null;
    }
    return $name;
}

/**
 * Where the textures are in an unpacked pack, for this target: ['dir' => folder]
 * or ['file' => an N64 .hts or .htc], with 'for' naming the other release or
 * cartridge it was made for. Null when it holds no picture at all.
 */
function xs_tp_root(string $dir, array $t): ?array
{
    $reps = [];
    $pics = [];
    $named = [];
    $files = [];
    $walk = static function (string $d, int $deep) use (&$walk, &$reps, &$pics, &$named, &$files): void {
        $has = false;
        foreach (@scandir($d) ?: [] as $n) {
            if ($n === '.' || $n === '..') {
                continue;
            }
            $p = $d . DIRECTORY_SEPARATOR . $n;
            if (is_link($p)) {
                continue;
            }
            if (is_dir($p)) {
                if (strcasecmp($n, 'replacements') === 0) {
                    $reps[] = $p;
                }
                $named[] = $p;
                if ($deep < 12) {
                    $walk($p, $deep + 1);
                }
            } elseif (preg_match('/\.(hts|htc)$/i', $n)) {
                $files[] = $p;
            } elseif (preg_match('/\.(png|dds)$/i', $n)) {
                if (!$has) {
                    $pics[$d] = [];
                }
                $has = true;
                if (count($pics[$d]) < 3) {
                    $pics[$d][] = $n;
                }
            }
        }
    };
    $walk($dir, 0);
    $key = (string) $t['key'];
    $emu = (string) $t['emu'];
    if ($emu === 'pcsx2') {
        foreach ($reps as $r) {
            if (strcasecmp(basename(dirname($r)), $key) === 0) {
                return ['dir' => $r, 'for' => null];
            }
        }
        if ($reps) {
            $other = basename(dirname($reps[0]));
            return ['dir' => $reps[0], 'for' => preg_match('/^[A-Z]{4}-\d{5}$/i', $other) ? strtoupper($other) : null];
        }
    } elseif ($emu === 'dolphin') {
        // A folder named by the game's ID (or its first three letters), else by another release's.
        foreach ([$key, substr($key, 0, 3)] as $want) {
            foreach ($named as $p) {
                if (strcasecmp(basename($p), $want) === 0) {
                    return ['dir' => $p, 'for' => null];
                }
            }
        }
        foreach ($named as $p) {
            if (preg_match('/^[A-Z0-9]{6}$/', basename($p)) && strncasecmp(basename($p), $key, 3) === 0) {
                return ['dir' => $p, 'for' => strtoupper(basename($p))];
            }
        }
    } elseif ($emu === 'mupen') {
        if ($files) {
            usort($files, static fn (string $a, string $b): int => (int) @filesize($b) <=> (int) @filesize($a));
            $made = (string) preg_replace('/_HIRESTEXTURES$/i', '', pathinfo($files[0], PATHINFO_FILENAME));
            return ['file' => $files[0], 'for' => strcasecmp($made, $key) === 0 ? null : $made];
        }
        foreach ($named as $p) {
            if (strcasecmp(basename($p), $key) === 0) {
                return ['dir' => $p, 'for' => null];
            }
        }
        // GLideN64 names each picture after the cartridge: "SUPER MARIO 64#2A3C4D5E#0#2_all.png".
        foreach ($pics as $d => $some) {
            $by = strstr($some[0], '#', true);
            if ($by !== false && $by !== '') {
                return ['dir' => $d, 'for' => strcasecmp($by, $key) === 0 ? null : $by];
            }
        }
    }
    if (!$pics) {
        return null;
    }
    // The folder every picture is under: the pack's own top, under however many wrapping folders.
    $dirs = array_keys($pics);
    $common = explode(DIRECTORY_SEPARATOR, $dirs[0]);
    foreach ($dirs as $p) {
        $bits = explode(DIRECTORY_SEPARATOR, $p);
        $k = 0;
        while ($k < count($common) && $k < count($bits) && strcasecmp($common[$k], $bits[$k]) === 0) {
            $k++;
        }
        $common = array_slice($common, 0, $k);
    }
    $root = implode(DIRECTORY_SEPARATOR, $common);
    if (strlen($root) < strlen($dir)) {
        $root = $dir;
    }
    $top = basename($root);
    $for = $emu === 'pcsx2' && preg_match('/^[A-Z]{4}-\d{5}$/i', $top) && strcasecmp($top, $key) !== 0 ? strtoupper($top) : null;
    return ['dir' => $root, 'for' => $for];
}
