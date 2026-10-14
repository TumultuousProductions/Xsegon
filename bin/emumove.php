<?php
/**
 * Xsegon - the worker that copies emulators out of LaunchBox's folder
 * (includes\emumove.php), run in the background for Emulators > Move out of
 * LaunchBox.
 *
 *   php bin\emumove.php
 *
 * The plan is in data\emumove-job.json. Each emulator's folder is copied with
 * its dates, checked against what was measured, its whole-path settings
 * rewritten and the emulator table pointed at it; then the saves beside the
 * games are picked up (includes\saves.php).
 *
 * LaunchBox's folder is only ever read. A stopped or failed copy is removed,
 * and only a folder that carries this run's mark is ever removed.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/emumove.php';

set_time_limit(0);

$job = xs_read_json(xs_emumove_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "no copy waiting in data\\emumove-job.json\n");
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
    xs_write_json(xs_emumove_job_path(), $job);
};
$save();
register_shutdown_function(static function () use (&$job, $save): void {
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'the copy stopped on a fault: the log has it';
        $save();
    }
});

/** Takes away a folder this run was filling: only one that carries the mark. */
$undo = static function (string $dir): void {
    if (!is_file($dir . '\\' . XS_EMUMOVE_MARK)) {
        return;
    }
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $f) {
        $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    @rmdir($dir);
};
$stopped = static fn (): bool => is_file(xs_emumove_stop_path());

// ---- how much there is ------------------------------------------------------
$job['phase'] = 'measuring';
$save();
$trees = [];
foreach ($job['items'] as $i => $item) {
    $tree = xs_emumove_tree((string) $item['from']);
    if ($tree === null) {
        $job['state'] = 'failed';
        $job['error'] = $item['name'] . '\'s folder could not be read: ' . $item['from'];
        $save();
        exit(0);
    }
    $trees[$i] = $tree;
    $job['items'][$i]['total'] = array_sum($tree['files']);
    $job['items'][$i]['files'] = count($tree['files']);
    $job['total'] += $job['items'][$i]['total'];
    $save();
}
$free = (float) @disk_free_space((string) $job['dest']);
if ($free > 0 && $free < $job['total'] * 1.02 + 64 * 1048576) {
    $job['state'] = 'failed';
    $job['error'] = 'there is not enough room in ' . $job['dest'] . ': the emulators are '
        . round($job['total'] / 1073741824, 1) . ' GB and ' . round($free / 1073741824, 1) . ' GB is free';
    $save();
    exit(0);
}

// ---- the copies ------------------------------------------------------------
$job['phase'] = 'copying';
$t0 = microtime(true);
$moved = [];
foreach ($job['items'] as $i => $item) {
    $from = (string) $item['from'];
    $to   = (string) $item['to'];
    $job['at'] = $i;
    $job['items'][$i]['state'] = 'copying';
    $save();
    $fail = null;
    $undo($to);                    // what a copy cut short left there, and only that
    if (file_exists($to)) {
        $fail = 'there is a ' . basename($to) . ' in ' . dirname($to) . ' already';
    } elseif (!@mkdir($to, 0777, true) || @file_put_contents($to . '\\' . XS_EMUMOVE_MARK, 'Xsegon is copying ' . $from . " here.\n") === false) {
        $fail = 'the folder ' . $to . ' could not be made';
    }
    if ($fail === null) {
        foreach ($trees[$i]['dirs'] as $d) {
            if (!is_dir($to . '\\' . $d) && !@mkdir($to . '\\' . $d, 0777, true)) {
                $fail = 'the folder ' . $d . ' could not be made';
                break;
            }
        }
    }
    if ($fail === null) {
        foreach ($trees[$i]['files'] as $rel => $size) {
            if ($stopped()) {
                $fail = 'stopped';
                break;
            }
            $in  = @fopen($from . '\\' . $rel, 'rb');
            $out = $in !== false ? @fopen($to . '\\' . $rel, 'wb') : false;
            if ($in === false || $out === false) {
                $fail = $rel . ' could not be ' . ($in === false ? 'read' : 'written');
                if ($in !== false) { fclose($in); }
                break;
            }
            $wrote = 0;
            while (!feof($in)) {
                $buf = fread($in, 4 * 1048576);
                if ($buf === false || ($buf !== '' && fwrite($out, $buf) !== strlen($buf))) {
                    $fail = $rel . ' could not be copied whole (is the drive full?)';
                    break;
                }
                $wrote += strlen($buf);
                $job['bytes'] += strlen($buf);
                $job['items'][$i]['bytes'] += strlen($buf);
                $save(false);
                if ($size > 64 * 1048576 && $stopped()) {
                    $fail = 'stopped';
                    break;
                }
            }
            fclose($in);
            fclose($out);
            if ($fail !== null) {
                break;
            }
            // The dates matter: a save is read as older or newer by them.
            @touch($to . '\\' . $rel, filemtime($from . '\\' . $rel) ?: time());
        }
    }
    // Counted against what was measured: every file there, every one its size.
    if ($fail === null) {
        $job['phase'] = 'checking';
        $save();
        $got = xs_emumove_tree($to);
        unset($got['files'][XS_EMUMOVE_MARK]);
        if ($got === null || $got['files'] != $trees[$i]['files']) {
            $fail = 'the copy is not the same as the folder it was made from';
        }
        $job['phase'] = 'copying';
    }
    if ($fail !== null) {
        $undo($to);
        $job['items'][$i]['state'] = $fail === 'stopped' ? 'stopped' : 'failed';
        $job['items'][$i]['error'] = $fail;
        $job['state'] = $fail === 'stopped' ? 'stopped' : 'failed';
        $job['error'] = $fail === 'stopped' ? 'stopped: ' . $item['name'] . ' was not moved, and its half-made copy is taken away'
                                            : $item['name'] . ': ' . $fail . '. Its half-made copy is taken away';
        xs_log('EMUM', $item['name'] . ' not moved: ' . $fail);
        break;
    }
    @unlink($to . '\\' . XS_EMUMOVE_MARK);
    $fixed = xs_emumove_fix_paths($from, $to);
    $why = null;
    if (!xs_emumove_point($item, $why)) {
        $job['items'][$i]['state'] = 'failed';
        $job['items'][$i]['error'] = (string) $why;
        $job['state'] = 'failed';
        $job['error'] = $item['name'] . ' was copied to ' . $to . ', but the emulator table could not be pointed at it: ' . $why;
        xs_log('EMUM', $job['error']);
        break;
    }
    $job['items'][$i]['state'] = 'done';
    $job['items'][$i]['fixed'] = $fixed;
    $moved[] = $item['name'];
    xs_log('EMUM', $item['name'] . ' copied to ' . $to . ' (' . count($trees[$i]['files']) . ' files, '
        . round($job['items'][$i]['total'] / 1048576) . ' MB) and the table pointed at it'
        . ($fixed ? '; paths rewritten in ' . implode(', ', array_map(static fn ($f, $n) => $f . ' (' . $n . ')', array_keys($fixed), $fixed)) : '')
        . '; ' . $from . ' is left as it is');
    $save();
}
@unlink(xs_emumove_stop_path());

// ---- the saves beside the games, now that there is somewhere to put them ----
$picked = [];
if ($moved) {
    $job['phase'] = 'saves';
    $save();
    try {
        require_once __DIR__ . '/../includes/import.php';
        require_once __DIR__ . '/../includes/saves.php';
        $picked = xs_saves_pickup_all();
    } catch (\Throwable $e) {
        xs_log('EMUM', 'the saves beside the games were not looked at: ' . $e->getMessage());
    }
}
// xs_saves_pickup_all() answers a game at a time: the saves are what is counted and said.
$saves = array_sum(array_map('count', $picked));
$job['picked'] = $saves;
$job['pickedGames'] = count($picked);
if ($job['state'] === 'running') {
    $job['state'] = 'done';
}
$job['phase'] = 'end';
$job['seconds'] = (int) round(microtime(true) - $t0);
$job['said'] = $moved
    ? implode(', ', $moved) . (count($moved) === 1 ? ' now starts' : ' now start') . ' from ' . $job['dest']
      . ($saves ? '. ' . $saves . ($saves === 1 ? ' save' : ' saves') . ' kept beside ' . (count($picked) === 1 ? 'one game' : count($picked) . ' games') . ' '
                . ($saves === 1 ? 'was' : 'were') . ' put where RetroArch loads them' : '')
    : '';
$save();
