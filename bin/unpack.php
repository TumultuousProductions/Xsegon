<?php
/**
 * Xsegon - the unpacking worker (includes\unpack.php): each archive waiting
 * in data\unpack-queue, one at a time.
 *
 *   php bin\unpack.php --server=http://127.0.0.1:8099
 *
 * Each is moved first when asked, unpacked into its folder, then taken in by
 * the main server's scan. Under Unpack all, a game in another console's
 * folder stays packed. data\unpack-stop ends the run and removes what the
 * archive in hand wrote. The archive itself is never changed or deleted.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/unpack.php';

set_time_limit(0);
$server = '';
foreach ($argv as $a) {
    if (str_starts_with($a, '--server=')) {
        $server = rtrim(substr($a, 9), '/');
    }
}

$job = xs_read_json(xs_unpack_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "no job waiting in data\\unpack-job.json\n");
    exit(1);
}
$job['pid'] = getmypid();
$save = static function () use (&$job): void {
    $job['beat'] = time();
    xs_write_json(xs_unpack_job_path(), $job);
};
$save();

/** One request to the main server, answered as JSON; null when it does not answer. */
$ask = static function (string $path, ?array $body = null) use ($server): ?array {
    if ($server === '') {
        return null;
    }
    $opts = ['timeout' => 300, 'ignore_errors' => true];
    if ($body !== null) {
        $opts += ['method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => json_encode($body)];
    }
    $got = @file_get_contents($server . $path, false, stream_context_create(['http' => $opts]));
    $val = $got === false ? null : json_decode($got, true);
    return is_array($val) ? $val : null;
};

/**
 * One archive, start to finish. Returns how it ended: ['ok', 'dest', 'added',
 * 'note'] or ['ok' => false, 'why']; 'stopped' when the run was told to end.
 */
$one = static function (array $item) use (&$job, $save, $ask): array {
    $archive = (string) $item['archive'];
    $job['now'] = ['archive' => $archive, 'title' => (string) pathinfo($archive, PATHINFO_FILENAME), 'phase' => 'starting', 'bytes' => 0, 'total' => 0];
    $save();
    if (!xs_unpack_allowed($archive, $why)) {
        return ['ok' => false, 'why' => (string) $why];
    }
    // Looked at before anything is moved or written: what is in it, then Windows Defender's word.
    // Asked for with the rest, nobody looked into it on the page: its disc is read here.
    $all = !empty($item['all']);
    if ($all) {
        $job['now']['phase'] = 'looking';
        $save();
    }
    $t0 = microtime(true);
    $look = xs_unpack_look($archive, $why, $all);
    if ($look === null || $look['shape'] === 'none') {
        return ['ok' => false, 'why' => $look === null ? (string) $why : 'there is no disc and no game folder in it'];
    }
    $unsafe = xs_unpack_unsafe($look);
    if ($unsafe !== null) {
        return ['ok' => false, 'why' => $unsafe . ': nothing was unpacked'];
    }
    // Unpack all has nobody to ask: a game in another console's folder stays packed, and nothing is moved.
    if ($all) {
        $plan = xs_unpack_plan($archive, $look);
        xs_log('UNPK', 'Unpack all looked into ' . basename($archive) . ': ' . ($look['console'] ?? 'no console said') . ', ' . $plan['verdict']
            . ', in ' . (int) round((microtime(true) - $t0) * 1000) . 'ms');
        // 'kept': left packed on purpose, which is no failure. A spare copy has nowhere to move to.
        if ($plan['verdict'] === 'wrong') {
            $twin = $plan['move']['twin'] ?? null;
            return ['ok' => false, 'kept' => true, 'why' => $twin === 'same'
                ? 'it is a spare copy of the archive already in ' . $plan['move']['dir'] . ', where this ' . $look['console']
                    . ' game belongs. Delete this one yourself if you want its room back'
                : 'it is a ' . $look['console'] . ' game in the ' . $plan['here'] . ' folder, and Unpack all moves nothing. Its own Unpack and add button '
                    . ($twin === 'other' ? 'says what can be done with it' : 'offers to move it')];
        }
        if ($plan['verdict'] === 'done') {
            xs_unpack_remember($archive, $look, $plan);
            return ['ok' => false, 'kept' => true, 'why' => 'its game is unpacked already, at ' . $plan['already']];
        }
    }
    $checked = xs_unpack_defender() === '' ? 'none' : 'skipped';
    if ($checked === 'skipped' && ($item['scan'] ?? true)) {
        $job['now'] = ['phase' => 'checking', 'since' => time(), 'about' => (int) ceil($look['bytes'] / XS_UNPACK_DEFENDER_RATE)] + $job['now'];
        $save();
        $t0 = microtime(true);
        $checked = xs_unpack_defender_scan($archive, $what, static fn (): bool => !is_file(xs_unpack_stop_path()));
        xs_log('UNPK', 'Windows Defender on ' . basename($archive) . ': ' . $checked . ($what !== null ? ' (' . $what . ')' : '')
            . ', in ' . round(microtime(true) - $t0, 1) . 's');
        if ($checked === 'stopped') {
            return ['ok' => false, 'why' => 'stopped', 'stopped' => true];
        }
        if ($checked === 'found') {
            return ['ok' => false, 'checked' => 'found',
                    'why' => 'Windows Defender found ' . $what . ' in it, so nothing was unpacked. The archive is still where it was: delete it'];
        }
    }
    if (!empty($item['moveTo'])) {
        $job['now']['phase'] = 'moving';
        $save();
        $to = xs_norm_path((string) $item['moveTo']);
        $target = $to . DIRECTORY_SEPARATOR . basename($archive);
        if (file_exists($target)) {
            return ['ok' => false, 'why' => 'a file of that name is already in ' . $to . ', so it was not moved'];
        }
        if ((!is_dir($to) && !@mkdir($to, 0777, true)) || !@rename($archive, $target)) {
            return ['ok' => false, 'why' => 'it could not be moved to ' . $to . ' (' . xs_file_error_reason() . ')'];
        }
        xs_log('UNPK', 'moved ' . $archive . ' to ' . $to);
        $archive = $target;
    }
    $home = xs_unpack_home($archive);
    $dest = xs_unpack_dest($archive, $look, $home['dir']);
    foreach ($look['names'] as $n) {
        if (file_exists($dest . DIRECTORY_SEPARATOR . $n)) {
            return ['ok' => false, 'why' => $n . ' is already in ' . $dest . ': nothing is unpacked over what is there'];
        }
    }
    $free = @disk_free_space(is_dir($dest) ? $dest : dirname($dest));
    if ($free !== false && $free < $look['bytes'] + 1073741824) {
        return ['ok' => false, 'why' => 'it needs ' . round($look['bytes'] / 1073741824, 1) . ' GB and the drive has ' . round($free / 1073741824, 1) . ' GB free'];
    }
    $made = !is_dir($dest);
    if ($made && !@mkdir($dest, 0777, true)) {
        return ['ok' => false, 'why' => 'the folder ' . $dest . ' could not be made (' . xs_file_error_reason() . ')'];
    }
    /* Unpacked into a working folder and moved in when whole, so a run that
       ends part way leaves nothing under a game's name for a scan to offer.
       What such a run left is cleared first. */
    $work = $dest . DIRECTORY_SEPARATOR . XS_UNPACK_WORK;
    if (is_dir($work)) {
        xs_log('UNPK', 'cleared what an unpack that never finished left in ' . $work);
        xs_unpack_remove($work);
    }
    if (!@mkdir($work, 0777, true)) {
        $why = xs_file_error_reason();
        if ($made) {
            @rmdir($dest);
        }
        return ['ok' => false, 'why' => 'a working folder could not be made in ' . $dest . ' (' . $why . ')'];
    }
    // What this run wrote goes again when it does not finish.
    $moved = [];
    $undo = static function () use ($dest, $work, $made, &$moved): void {
        xs_unpack_remove($work);
        foreach ($moved as $n) {
            xs_unpack_remove($dest . DIRECTORY_SEPARATOR . $n);
        }
        if ($made) {
            @rmdir($dest);
        }
    };

    $is7z = (bool) preg_match('/\.7z$/i', $archive);
    // Of a disc image only the disc is asked for by name; a game kept as a folder comes whole.
    // tar reads a name as a pattern, so the marks it would take for one are made plain.
    // -m: tar leaves the files' dates alone. An exFAT drive refuses them, and tar calls that a failure.
    $only = (array) ($look['take'] ?? []);
    $cmd = $is7z && xs_unpack_7zr() !== ''
        ? array_merge([xs_unpack_7zr(), 'x', '-y', '-bso0', '-bsp0', '-o' . $work, '--', $archive], $only)
        : (xs_unpack_tar() !== '' ? array_merge([xs_unpack_tar(), '-xmf', $archive, '-C', $work],
            array_map(static fn ($n) => (string) preg_replace('/[\\\\\[\]*?]/', '\\\\$0', $n), $only)) : null);
    $says = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xs-unpack-says-' . getmypid() . '.txt';
    $run = $cmd === null ? null : xs_unpack_run($cmd, false, $says);
    if ($run === null) {
        $undo();
        return ['ok' => false, 'why' => 'the program that unpacks it would not start'];
    }
    $job['now'] = ['phase' => 'unpacking', 'total' => $look['bytes'], 'dest' => $dest] + $job['now'];
    $save();
    $t0 = microtime(true);
    $code = null;
    for ($tick = 0; ; $tick++) {
        $st = proc_get_status($run[0]);
        if (!$st['running']) {
            $code = (int) $st['exitcode'];
            break;
        }
        if (is_file(xs_unpack_stop_path())) {
            @proc_terminate($run[0]);
            proc_close($run[0]);
            usleep(300000);                         // the file it was writing is let go
            $undo();
            @unlink($says);
            return ['ok' => false, 'why' => 'stopped', 'stopped' => true];
        }
        usleep(250000);
        if ($tick % 4 === 3) {
            $job['now']['bytes'] = xs_unpack_size($work, $look['names']);
            $save();
        }
    }
    proc_close($run[0]);
    $said = xs_unpack_said($says);
    $main = $work . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $look['main']);
    clearstatcache();
    if ($code !== 0 || !is_file($main) || (int) filesize($main) !== (int) $look['mainBytes']) {
        $undo();
        return ['ok' => false, 'why' => 'it would not unpack whole (' . ($is7z ? '7zr' : 'tar') . ' ended with ' . $code
            . ($said !== '' ? ', saying: ' . $said : '') . '); what it had written was taken away'];
    }
    // Whole: moved in under its own names. The same drive, so it takes no time.
    foreach ($look['names'] as $n) {
        $from = $work . DIRECTORY_SEPARATOR . $n;
        $to   = $dest . DIRECTORY_SEPARATOR . $n;
        if (!file_exists($from)) {
            continue;                               // a name the archive listed and did not hold
        }
        if (file_exists($to) || !@rename($from, $to)) {
            $why = file_exists($to) ? 'a file of that name is there now' : xs_file_error_reason();
            $undo();
            return ['ok' => false, 'why' => $n . ' could not be put in ' . $dest . ' (' . $why . '); what was unpacked was taken away'];
        }
        $moved[] = $n;
    }
    xs_unpack_remove($work);
    $main = $dest . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $look['main']);
    xs_log('UNPK', 'unpacked ' . basename($archive) . ' to ' . $dest . ': ' . round($look['bytes'] / 1048576) . ' MB in ' . round(microtime(true) - $t0, 1) . 's');

    // Taken in the way Scan for Games takes a game in: its walk finds it, its accept keeps it.
    $job['now'] = ['phase' => 'adding', 'bytes' => $look['bytes']] + $job['now'];
    $save();
    // Only what this archive unpacked: another new game in the same folder is not this press's to add.
    $mine = array_map(static fn ($n) => strtolower(xs_norm_path($dest . DIRECTORY_SEPARATOR . $n)), $look['names']);
    $scan = $ask('/api/scan.php');
    $new = array_values(array_filter((array) ($scan['new'] ?? []), static function ($g) use ($mine): bool {
        $rom = strtolower(xs_norm_path((string) ($g['rom'] ?? '')));
        foreach ($mine as $m) {
            if ($rom === $m || str_starts_with($rom, $m . DIRECTORY_SEPARATOR)) {
                return true;
            }
        }
        return false;
    }));
    $added = [];
    $note = '';
    if ($scan === null) {
        $note = 'Xsegon did not answer, so it is not in the library yet: Scan for Games will offer it';
    } elseif (!$new) {
        $note = 'Scan for Games has nothing new to offer there: it is in the library already, or it is not a game it can add';
    } else {
        $took = $ask('/api/scan.php', ['action' => 'accept', 'games' => $new]);
        if (($took['ok'] ?? false) && (int) ($took['added'] ?? 0) > 0) {
            $added = array_map(static fn ($g) => (string) $g['title'], $new);
        } else {
            $note = 'it could not be added: ' . (string) ($took['error'] ?? ($took['skipped'][0]['why'] ?? 'no answer')) . '. Scan for Games will offer it';
        }
    }
    $done = xs_read_json(xs_unpack_done_path(), []);
    $done = is_array($done) ? $done : [];
    $done[strtolower($archive)] = ['dest' => $dest, 'main' => $main, 'at' => time(), 'size' => (int) filesize($archive), 'added' => $added];
    xs_write_json(xs_unpack_done_path(), $done);
    return ['ok' => true, 'dest' => $dest, 'added' => $added, 'note' => $note, 'now' => $archive, 'checked' => $checked,
            'left' => array_map('basename', (array) $look['left'])];
};

register_shutdown_function(static function () use (&$job, $save): void {
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'the unpacking worker stopped on a fault: the log has it';
        $job['now'] = null;
        $save();
    }
});

$state = 'done';
while (true) {
    if (is_file(xs_unpack_stop_path())) {
        $state = 'stopped';
        break;
    }
    $waiting = xs_unpack_waiting();
    if (!$waiting) {
        break;
    }
    $item = $waiting[0];
    @unlink($item['file']);
    $result = $one($item);
    $job['results'][] = ['archive' => (string) $item['archive'], 'at' => time()] + $result;
    $job['now'] = null;
    $save();
    xs_log('UNPK', basename((string) $item['archive']) . ': ' . ($result['ok']
        ? 'done' . ($result['added'] ? ', added ' . implode(', ', $result['added']) : '') . ($result['note'] !== '' ? ' (' . $result['note'] . ')' : '')
        : (!empty($result['kept']) ? 'left packed: ' : 'not unpacked: ') . $result['why']));
    if (!empty($result['stopped'])) {
        $state = 'stopped';
        break;
    }
}
// Told to stop: what was still waiting is let go, so it does not start by itself next time.
if ($state === 'stopped') {
    foreach (xs_unpack_waiting() as $w) {
        @unlink($w['file']);
    }
}
@unlink(xs_unpack_stop_path());
$job['state'] = $state;
$job['finished'] = time();
$job['now'] = null;
$save();
