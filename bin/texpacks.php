<?php
/**
 * Xsegon - the worker that puts a game's texture pack in place, or takes it away
 * (includes\texpacks.php), run in the background.
 *
 *   php bin\texpacks.php
 *
 * The plan is in data\texpacks-job.json. A pack is fetched, unpacked or copied into a
 * folder beside the game's own on the same drive, and given a folder of its own in the
 * game's place only when all of it is in; the packs it replaces go only after that.
 * The N64 core's .htc, made from the packs there before, goes whenever a pack comes
 * or goes: the core reads it in place of the packs.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/texpacks.php';

set_time_limit(0);
ini_set('memory_limit', '512M');

$job = xs_read_json(xs_tp_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\texpacks-job.json\n");
    exit(1);
}
$job['pid'] = getmypid();
$last = 0.0;
$save = static function (bool $now = true) use (&$job, &$last): void {
    if (!$now && microtime(true) - $last < 0.4) {
        return;
    }
    $last = microtime(true);
    $job['beat'] = time();
    xs_write_json(xs_tp_job_path(), $job);
};
$save();

$t     = (array) $job['target'];
$base  = (string) $t['base'];
$tag   = substr(md5((string) $t['key']), 0, 8);
$work  = $base . '\\.xsegon-part-' . $tag;
$fetch = $base . '\\.xsegon-fetch-' . $tag;
$title = (string) $job['title'];
$emu   = (string) $t['emulator'];
register_shutdown_function(static function () use (&$job, $save, $fetch): void {
    foreach (glob($fetch . '*') ?: [] as $f) {
        @unlink($f);
    }
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $save();
    }
});
$stopped = static fn (): bool => is_file(xs_tp_stop_path());
$end = static function (string $state, string $words) use (&$job, $save): void {
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    @unlink(xs_tp_stop_path());
    xs_log('TPAK', $state === 'stopped' ? $words : $state . ': ' . $words);
    exit(0);
};
$size = static fn (int $b): string => $b >= 1073741824 ? round($b / 1073741824, 2) . ' GB' : max(0.1, round($b / 1048576, 1)) . ' MB';
$n = static fn (int $c, string $one, string $many): string => number_format($c) . ' ' . ($c === 1 ? $one : $many);
// The N64 core reads its folder packs whole at the next start: said, so a still window is not taken for a hang.
$readSaid = static fn (int $bytes): string => ' Its next start reads ' . ($bytes > 314572800 ? 'all ' . $size($bytes) . ' first, which can take minutes'
    : 'the packs first, which can take a while') . ': RetroArch\'s window does not answer until then. Later starts are quicker.';
$t0 = microtime(true);
if (!is_dir($base) && !@mkdir($base, 0777, true)) {
    $end('failed', $emu . '\'s texture folder ' . $base . ' could not be made (' . xs_file_error_reason() . ')');
}
// The core's .htc of the packs before: it would be read in place of the packs now.
$dropCache = static function () use ($t): void {
    if (($t['cache'] ?? null) !== null && is_file($t['cache']) && @unlink($t['cache'])) {
        xs_log('TPAK', 'the N64 core\'s cache of the packs before is deleted (' . basename($t['cache']) . '): it makes a new one at the next start');
    }
};

// ---- uninstalling one pack ---------------------------------------------------------
if (($job['action'] ?? '') === 'remove') {
    $job['phase'] = 'removing';
    $rec  = is_array($job['record'] ?? null) ? $job['record'] : null;
    $drop = (array) ($job['drop'] ?? []);
    $isLast = !empty($drop['last']);                    // not $last: that is $save's clock
    $what = (string) ($drop['from'] ?? '') !== '' ? (string) $drop['from'] : 'The texture pack put there by hand';
    $gone = $base . '\\.xsegon-gone-' . $tag;
    xs_tp_wipe($gone, $base);
    // Out of the emulator's way at once, by renames; the files go after.
    if (!@mkdir($gone . '\\pack', 0777, true)) {
        $end('failed', 'a folder to uninstall the pack into could not be made (' . xs_file_error_reason() . '): it is as it was');
    }
    $moved = [];
    foreach (array_values((array) ($drop['paths'] ?? [])) as $i => $p) {
        $p = (string) $p;
        // Only what is in the game's folder, or its N64 .hts or .htc.
        $ours = stripos($p, $t['into'] . '\\') === 0 || in_array(strtolower($p), array_map('strtolower', array_filter([$t['file'], $t['cache']])), true);
        if (!$ours || !file_exists($p)) {
            continue;
        }
        $to = $gone . '\\pack\\' . $i . '-' . basename($p);
        if (!@rename($p, $to)) {
            $why = xs_file_error_reason();
            foreach (array_reverse($moved) as [$a, $b]) {
                @rename($b, $a);
            }
            $end('failed', 'the pack could not be moved out of ' . $emu . '\'s folder (' . $why . '): it is as it was');
        }
        $moved[] = [$p, $to];
    }
    $dropCache();
    $count = xs_tp_count($gone);
    $job['files'] = $count['files'];
    $job['total'] = $count['bytes'];
    $save();
    $note = '';
    if ($isLast && $rec !== null && is_array($rec['setting'] ?? null)) {
        $why = null;
        if (xs_tp_switch($t['switch'], false, $rec['setting'], $why) === null) {
            $note = ' ' . $t['setWords'] . ' could not be put back as it was for this game (' . $why . ').';
        }
    }
    xs_tp_wipe($gone, $base, static function (int $done) use (&$job, $save): bool {
        $job['at'] = $done;
        $save(false);
        return true;
    });
    if ($isLast) {
        @rmdir($t['into']);                              // each only when nothing else is in it
        @rmdir($t['dir']);
        xs_tp_record_set((string) $job['id'], null);
    } elseif ($rec !== null) {
        $rec['packs'] = array_values(array_filter((array) $rec['packs'], static fn (array $p): bool => $p['id'] !== ($drop['id'] ?? '')));
        xs_tp_record_set((string) $job['id'], $rec);
    }
    $stay = $isLast ? 0 : max(1, (int) ($job['beside'] ?? 2) - 1);
    $end('done', $what . ' is uninstalled from ' . $title . ': ' . $n($count['files'], 'file', 'files') . ', ' . $size($count['bytes']) . '. '
        . ($isLast ? $emu . ' shows the game\'s own textures again.' : ($stay === 1 ? 'The other pack stays.' : 'The other ' . $stay . ' packs stay.')
            . (($bytes = xs_tp_reads_first($rec)) > 0 ? $readSaid($bytes) : ''))
        . $note);
}

$src  = (array) $job['source'];
$kind = (string) $src['kind'];
$from = (string) $src['path'];
$how  = (string) ($job['how'] ?? 'new');                // 'new' (nothing there), 'beside' or 'replace'
// An N64 .hts or .htc is loaded alone: one found inside a pack asked to go beside another is refused before anything moves.
$alone = static function (?array $found, ?callable $undo = null) use ($how, $src, $end): void {
    if ($how === 'beside' && isset($found['file'])) {
        if ($undo !== null) {
            $undo();
        }
        $end('failed', $src['name'] . ' is one .' . strtolower(pathinfo((string) $found['file'], PATHINFO_EXTENSION)) . ' file, which the N64 core loads alone, '
            . 'so it cannot go beside the pack there: install it again and choose Replace. Nothing was changed');
    }
};

// ---- a listed pack's own download, fetched first --------------------------------------
if ($kind === 'url') {
    $curl = xs_curl_exe();
    if ($curl === '') {
        $end('failed', 'Windows\' own curl.exe is not on this PC, and that is what fetches the pack');
    }
    $end7 = strtolower(pathinfo((string) parse_url((string) $src['url'], PHP_URL_PATH), PATHINFO_EXTENSION));
    $kind = in_array($end7, ['zip', '7z', 'hts', 'htc'], true) ? ($end7 === 'htc' ? 'hts' : $end7) : 'zip';
    $part = $fetch . '.' . ($kind === 'hts' ? $end7 : $kind);
    $job['phase'] = 'fetching';
    $job['total'] = (int) ($src['bytes'] ?? 0);
    $save();
    $free = (float) @disk_free_space($base);
    if ($free > 0 && $job['total'] > 0 && $free < $job['total'] * 2.1 + 52428800) {
        $end('failed', 'there is not enough room on the drive: the pack needs about ' . $size((int) ($job['total'] * 2.1)) . ' while it is unpacked, and there is ' . $size((int) $free) . ' free');
    }
    @unlink($part);
    $proc = @proc_open([$curl, '-L', '--fail', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20',
                        '--speed-limit', '1024', '--speed-time', '60', '-A', 'Xsegon', '-o', $part, (string) $src['url']],
        [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $part . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        $end('failed', 'curl.exe could not be started');
    }
    while (true) {
        $st = proc_get_status($proc);
        clearstatcache(true, $part);
        $job['bytes'] = (int) @filesize($part);
        $save(false);
        if (!$st['running']) {
            break;
        }
        if ($stopped()) {
            proc_terminate($proc);
            proc_close($proc);
            usleep(300000);
            $end('stopped', 'stopped: no texture pack was put in place');
        }
        usleep(100000);
    }
    proc_close($proc);
    $lines = preg_split('/\R/', trim((string) @file_get_contents($part . '.err'))) ?: [''];
    @unlink($part . '.err');
    clearstatcache(true, $part);
    if ((int) $st['exitcode'] !== 0 || !is_file($part) || (int) filesize($part) === 0) {
        $said = trim((string) end($lines));
        $end('failed', 'the pack could not be fetched (is the internet there?): ' . ($said !== '' ? mb_substr($said, 0, 200) : 'curl ended with ' . (int) $st['exitcode']));
    }
    $from = $part;
    xs_log('TPAK', 'fetched ' . $src['name'] . ' (' . $size((int) filesize($part)) . ') from ' . parse_url((string) $src['url'], PHP_URL_HOST) . ' in ' . round(microtime(true) - $t0, 1) . 's');
    $job['bytes'] = 0;
}

// ---- what the pack holds, and room for it -------------------------------------------
$job['phase'] = 'reading';
$save();
$entries = null;
$total   = 0;
$files   = 0;
$found   = null;
if ($kind === 'folder') {
    $found = xs_tp_root($from, $t);
    if ($found === null) {
        $end('failed', 'there are no textures in ' . $from . ': Xsegon found no .png or .dds picture in it');
    }
    $alone($found);
    if (isset($found['file'])) {
        [$total, $files] = [(int) filesize($found['file']), 1];
    } else {
        $count = xs_tp_count($found['dir'], 400000);
        if (!$count['whole']) {
            $end('failed', 'that folder holds more than 400,000 files: choose the pack\'s own folder');
        }
        [$total, $files] = [$count['bytes'], $count['files']];
    }
} elseif ($kind === 'hts' || $kind === 'file') {
    if ($t['file'] === null) {
        $end('failed', 'an .hts or .htc file is a pack for RetroArch\'s N64 core, not for ' . $emu);
    }
    $found = ['file' => $from, 'for' => null];
    $alone($found);
    [$total, $files] = [(int) @filesize($from), 1];
} elseif ($kind === 'zip') {
    $entries = xs_zs_list($from);
    if ($entries === null) {
        $end('failed', $src['name'] . ' could not be read as a .zip: it may be damaged, or a download that has not finished');
    }
    foreach ($entries as $e) {
        $total += (int) $e['size'];
        $files++;
    }
} else {
    require_once __DIR__ . '/../includes/unpack.php';
    $why = null;
    $list = xs_unpack_entries($from, $why);
    if ($list === null) {
        $end('failed', $src['name'] . ' could not be read: ' . $why);
    }
    foreach ($list as $e) {
        $total += (int) $e['size'];
        $files++;
    }
}
$job['total'] = $total;
$job['files'] = $files;
$save();
$free = (float) @disk_free_space($base);
$need = $total * 1.05 + 52428800;
if ($free > 0 && $free < $need) {
    $end('failed', 'there is not enough room on the drive: the pack needs about ' . $size((int) $need) . ' and there is ' . $size((int) $free) . ' free');
}

// ---- unpacked or copied beside the game's place --------------------------------------
xs_tp_wipe($work, $base);
if (!@mkdir($work, 0777, true)) {
    $end('failed', 'a folder to unpack into could not be made in ' . $base . ' (' . xs_file_error_reason() . ')');
}
$undo = static function () use ($work, $base, $fetch): void {
    xs_tp_wipe($work, $base);
    foreach (glob($fetch . '*') ?: [] as $f) {
        @unlink($f);
    }
};
$job['phase'] = $kind === 'zip' || $kind === '7z' ? 'unpacking' : 'copying';
$save();
$safe = static function (string $name): bool {
    foreach (explode('/', str_replace('\\', '/', $name)) as $b) {
        if ($b === '' || $b === '.' || $b === '..' || preg_match('/[<>:"|?*\x00-\x1f]|[ .]$/', $b)) {
            return false;
        }
    }
    return true;
};
// One file copied a piece at a time, so the bar moves and Stop is heard inside a big one.
$copyFile = static function (string $p, string $q) use (&$job, $save, $stopped, $undo, $end): void {
    $in = @fopen($p, 'rb');
    $out = $in === false ? false : @fopen($q, 'wb');
    if ($in === false || $out === false) {
        $undo();
        $end('failed', basename($p) . ' could not be copied (' . xs_file_error_reason() . '): nothing was put in place');
    }
    while (!feof($in)) {
        $buf = (string) fread($in, 4194304);
        if (fwrite($out, $buf) !== strlen($buf)) {
            fclose($in);
            fclose($out);
            $undo();
            $end('failed', basename($p) . ' could not be copied whole (is the drive full?): nothing was put in place');
        }
        $job['bytes'] += strlen($buf);
        $save(false);
        if ($stopped()) {
            fclose($in);
            fclose($out);
            $undo();
            $end('stopped', 'stopped: no texture pack was put in place');
        }
    }
    fclose($in);
    fclose($out);
};
$left = 0;                                               // names Windows cannot keep, or that would leave the folder
if ($kind === 'folder' || $kind === 'hts' || $kind === 'file') {
    if (isset($found['file'])) {
        $copyFile($found['file'], $work . '\\' . basename($found['file']));
        $found['file'] = $work . '\\' . basename($found['file']);
    } else {
        $copy = static function (string $d, string $to) use (&$copy, &$job, $copyFile, $undo, $end): void {
            foreach (@scandir($d) ?: [] as $nm) {
                if ($nm === '.' || $nm === '..') {
                    continue;
                }
                $p = $d . DIRECTORY_SEPARATOR . $nm;
                $q = $to . DIRECTORY_SEPARATOR . $nm;
                if (is_link($p)) {
                    continue;
                }
                if (is_dir($p)) {
                    if (!is_dir($q) && !@mkdir($q, 0777, true)) {
                        $undo();
                        $end('failed', 'the folder ' . $q . ' could not be made (' . xs_file_error_reason() . ')');
                    }
                    $copy($p, $q);
                    continue;
                }
                $copyFile($p, $q);
                $job['at']++;
            }
        };
        $copy($found['dir'], $work);
        $found['dir'] = $work;
    }
} else {
    $use7zr = false;
    $useTar = false;
    if ($kind === 'zip') {
        foreach ($entries as $e) {
            if (!in_array($e['method'], [0, 8], true)) {
                $useTar = true;                              // packed in a way the .zip reader does not read: Windows' tar does
                break;
            }
        }
    } else {
        require_once __DIR__ . '/../includes/unpack.php';
        $use7zr = xs_unpack_7zr() !== '';
        $useTar = !$use7zr;
    }
    if ($kind === 'zip' && !$useTar) {
        foreach ($entries as $name => $e) {
            if ($stopped()) {
                $undo();
                $end('stopped', 'stopped: no texture pack was put in place');
            }
            if (!$safe((string) $name)) {
                $left++;
                continue;
            }
            $dest = $work . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $name);
            if (!is_dir(dirname($dest)) && !@mkdir(dirname($dest), 0777, true)) {
                $undo();
                $end('failed', 'the folder ' . dirname($dest) . ' could not be made (' . xs_file_error_reason() . ')');
            }
            $why = null;
            $ok = xs_zs_take($from, $e, $dest, static function (int $len) use (&$job, $save, $stopped): bool {
                $job['bytes'] += $len;
                $save(false);
                return !$stopped();
            }, $why);
            if (!$ok) {
                $undo();
                if ($why === 'stopped') {
                    $end('stopped', 'stopped: no texture pack was put in place');
                }
                $end('failed', basename((string) $name) . ' in ' . $src['name'] . ' ' . $why . ': nothing was put in place');
            }
            $job['at']++;
        }
    } else {
        require_once __DIR__ . '/../includes/unpack.php';
        $cmd = $use7zr ? [xs_unpack_7zr(), 'x', '-y', '-bso0', '-bsp1', '-o' . $work, '--', $from]
                       : (xs_unpack_tar() !== '' ? [xs_unpack_tar(), '-xmf', $from, '-C', $work] : null);
        if ($cmd === null) {
            $undo();
            $end('failed', 'Windows\' tar.exe is not here to open ' . $src['name']);
        }
        $says = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xs-texpacks-says-' . getmypid() . '.txt';
        $prog = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xs-texpacks-prog-' . getmypid() . '.txt';
        $run = xs_unpack_run($cmd, false, $says, $use7zr ? $prog : null);
        if ($run === null) {
            $undo();
            $end('failed', 'the program that unpacks it would not start');
        }
        for ($tick = 0; ; $tick++) {
            $st = proc_get_status($run[0]);
            if (!$st['running']) {
                $code = (int) $st['exitcode'];
                break;
            }
            if ($stopped()) {
                @proc_terminate($run[0]);
                proc_close($run[0]);
                usleep(300000);                              // the file it was writing is let go
                $undo();
                @unlink($says);
                @unlink($prog);
                $end('stopped', 'stopped: no texture pack was put in place');
            }
            usleep(250000);
            if ($tick % 4 === 3) {
                // 7zr says how far it is; tar's progress is what it has written.
                $job['bytes'] = $use7zr ? (int) round($total * ((xs_7zr_percent($prog) ?? 0) / 100)) : xs_tp_count($work)['bytes'];
                $save();
            }
        }
        proc_close($run[0]);
        @unlink($prog);
        $said = xs_unpack_said($says);
        if ($code !== 0) {
            $undo();
            $end('failed', $src['name'] . ' would not unpack whole (' . ($use7zr ? '7zr' : 'tar') . ' ended with ' . $code
                . ($said !== '' ? ', saying: ' . $said : '') . '): nothing was put in place');
        }
        $job['bytes'] = $total;
    }
    foreach (glob($fetch . '*') ?: [] as $f) {
        @unlink($f);                                     // a fetched pack, now that it is unpacked
    }
    $found = xs_tp_root($work, $t);
    if ($found === null) {
        $undo();
        $end('failed', 'there are no textures in ' . $src['name'] . ': Xsegon found no .png or .dds picture in it');
    }
    if (isset($found['file']) && $t['file'] === null) {
        $undo();
        $end('failed', $src['name'] . ' is a pack for RetroArch\'s N64 core (an .hts file), not for ' . $emu);
    }
    $alone($found, $undo);
}
$tCopy = microtime(true);

// ---- in the game's place, now that all of it is in ----------------------------------
$job['phase'] = 'placing';
$save();
$isFile = isset($found['file']);
$isHtc  = $isFile && preg_match('/\.htc$/i', (string) $found['file']) === 1;
$old = $base . '\\.xsegon-old-' . $tag;
xs_tp_wipe($old, $base);
// Replaced: all of what was there moves aside together, its folder, its .hts and the core's .htc. Beside: nothing moves.
$aside = $how === 'beside' ? [] : array_values(array_filter([$t['into'], $t['file'], $t['cache']], static fn ($p): bool => $p !== null && file_exists($p)));
$putBack = static function () use ($aside, $old): void {
    foreach ($aside as $i => $p) {
        if (file_exists($old . '\\' . $i)) {
            if (is_dir($p)) {
                @rmdir($p);                              // the empty folder made for the new pack
            }
            @rename($old . '\\' . $i, $p);
        }
    }
};
if ($aside && !@mkdir($old, 0777, true)) {
    $undo();
    $end('failed', 'a folder to move the packs there aside into could not be made (' . xs_file_error_reason() . '): they are as they were');
}
foreach ($aside as $i => $p) {
    if (!@rename($p, $old . '\\' . $i)) {
        $why = xs_file_error_reason();
        $putBack();
        $undo();
        $end('failed', 'the packs there now could not be moved aside (' . $why . '): they are as they were');
    }
}
// A folder pack gets a folder of its own in the game's, named after it; an N64 .hts or .htc goes where the core looks for one.
$name = (string) ($src['title'] ?? '') !== '' ? (string) $src['title'] : (string) preg_replace('/\.(zip|7z)$/i', '', (string) $src['name']);
$dest = $isFile ? (string) ($isHtc ? $t['cache'] : $t['file']) : $t['into'] . '\\' . xs_tp_sub_name($name, $t['into']);
if (!is_dir(dirname($dest)) && !@mkdir(dirname($dest), 0777, true)) {
    $why = xs_file_error_reason();
    $putBack();
    $undo();
    $end('failed', 'the folder ' . dirname($dest) . ' could not be made (' . $why . ')');
}
if (!@rename($isFile ? $found['file'] : $found['dir'], $dest)) {
    $why = xs_file_error_reason();
    $putBack();
    $undo();
    $end('failed', 'the pack could not be put in ' . $emu . '\'s folder (' . $why . ')' . ($how !== 'new' ? ': the packs there are as they were' : ''));
}
$undo();                                                 // what the pack held besides its textures
if ($how === 'beside') {
    $dropCache();
}
$count = $isFile ? ['files' => 1, 'bytes' => (int) filesize($dest)] : xs_tp_count($dest);

// ---- the emulator told to load it, for this game alone ---------------------------------
$job['phase'] = 'setting';
$save();
$prev    = is_array($job['record'] ?? null) ? $job['record'] : null;
$note    = '';
$why     = null;
$sw      = (array) $t['switch'];
$did     = null;
if ($sw['kind'] === 'opt' && empty($sw['perGame'])) {
    $why = 'RetroArch\'s Settings > Core > Game-specific core options is off';
} else {
    // Only an .hts is read by the core's file storage; an .htc is its memory cache, read with that off.
    $did = xs_tp_switch($sw, true, null, $why, $isFile && !$isHtc ? (array) ($sw['hts'] ?? []) : []);
}
// A pack replaced keeps what the line was before the first; a line changed for the first time now is added.
$setting = $prev !== null ? xs_tp_switch_merge($prev['setting'] ?? null, $did) : $did;
if ($did === null) {
    $note = ' ' . $t['setWords'] . ' could not be turned on for this game (' . $why . '): turn it on in ' . $emu . ' for the pack to show.';
}
if ($aside) {
    $job['phase'] = 'tidying';
    $save();
    xs_tp_wipe($old, $base);
}
$other = $found['for'] ?? null;
$when  = time();
$pack  = ['id' => xs_tp_pack_id($dest, $when), 'from' => (string) ($src['title'] ?? '') !== '' ? (string) $src['title'] : (string) $src['name'],
          'path' => (string) $src['path'], 'k' => (string) ($src['k'] ?? ''), 'at' => $dest, 'kind' => $isFile ? 'file' : 'folder', 'when' => $when,
          'files' => $count['files'], 'bytes' => $count['bytes'], 'for' => $other];
$rec = ['emu' => $t['emu'], 'key' => $t['key'], 'setting' => $setting, 'cache' => $t['cache'],
        'packs' => array_merge($how === 'beside' && $prev !== null ? (array) $prev['packs'] : [], [$pack])];
xs_tp_record_set((string) $job['id'], $rec);
$beside = (int) ($job['beside'] ?? 0);
xs_log('TPAK', 'put ' . $src['name'] . ' in place for ' . $title . ' (' . $emu . ', ' . $t['key'] . '): ' . $count['files'] . ' files, ' . $size($count['bytes'])
    . ' in ' . round($tCopy - $t0, 1) . 's into ' . $dest . ($left ? ', ' . $left . ' names left out' : '')
    . ($how === 'beside' ? ', beside the ' . $beside . ' there' : ($how === 'replace' ? ', the ' . $beside . ' there replaced' : ''))
    . ($other ? ', made for ' . $other : '') . ($did === null ? ', the setting not written: ' . $why : ''));
$end('done', 'The texture pack is in place for ' . $title . ': ' . $n($count['files'], 'file', 'files') . ', ' . $size($count['bytes'])
    . '. ' . $emu . ' loads it the next time the game starts.'
    . ($how === 'beside' ? ' It sits beside ' . ($beside === 1 ? 'the pack there' : 'the ' . $beside . ' packs there')
        . ': where two change the same texture, ' . $emu . ' shows one of them.' : '')
    . ($other ? ' It was made for ' . $other . ', another release than yours (' . $t['key'] . '), so some textures may stay as they were.' : '')
    . ($left ? ' ' . $n($left, 'file was', 'files were') . ' left out: their names cannot be kept on Windows.' : '')
    . (($bytes = xs_tp_reads_first($rec)) > 0 ? $readSaid($bytes) : '') . $note);
