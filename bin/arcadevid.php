<?php
/**
 * Xsegon - the worker that fetches videos from the Arcade Database
 * (includes\arcadevid.php), run in the background.
 *
 *   php bin\arcadevid.php
 *
 * The plan is in data\arcadevid-job.json. Each arcade game with no video is
 * asked about by its file name, then its video fetched with curl.exe: one
 * connection at a time. A game gets its own video, else its parent's.
 *
 * When the online archives fetch waits on this one ('then' in the plan), its
 * Stop stops this too, and its worker is started as this ends.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';
require_once __DIR__ . '/../includes/arcadevid.php';

set_time_limit(0);

$job = xs_read_json(xs_ad_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\arcadevid-job.json\n");
    exit(1);
}
$job['pid'] = getmypid();
$then = !empty($job['then']);
$last = 0.0;
$save = static function (bool $now = true) use (&$job, &$last, $then): void {
    if (!$now && microtime(true) - $last < 0.4) {
        return;
    }
    $last = microtime(true);
    $job['beat'] = time();
    xs_write_json(xs_ad_job_path(), $job);
    if ($then) {
        @touch(xs_av_job_path());       // the waiting job has no worker yet: keeps it from reading as never started
    }
};
$save();
$tmp  = xs_data_path('arcadevid-tmp');
$tidy = static function () use ($tmp): void {
    foreach (xs_glob($tmp, '*') as $f) {
        @unlink($f);
    }
    @rmdir($tmp);
};
register_shutdown_function(static function () use (&$job, $save, $tidy, $then): void {
    $tidy();
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $save();
    }
    if ($then) {
        xs_ad_hand_on();
    }
});
// The Stop of the fetch that waits on this one is a Stop of both.
$stopped = static fn (): bool => is_file(xs_ad_stop_path()) || ($then && is_file(xs_av_stop_path()));
$end = static function (string $state, string $words) use (&$job, $save, $then): void {
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job['now']   = '';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    // One Stop for both: the fetch that waits on this one is stopped too.
    if ($state === 'stopped' && $then) {
        @touch(xs_av_stop_path());
    }
    @unlink(xs_ad_stop_path());
    xs_log('ARCD', $state === 'stopped' ? $words : $state . ': ' . $words);
    exit(0);
};
$n = static fn (int $count, string $one, string $many): string => $count . ' ' . ($count === 1 ? $one : $many);
// What follows a part that did not end well, when the other fetch is waiting on this one.
$next = $then ? ' The online archives are asked for the arcade games as well.' : '';
$t0 = microtime(true);
$curl = xs_curl_exe();
if ($curl === '') {
    $end('failed', 'Windows\' own curl.exe is not on this PC, and that is what fetches the videos');
}

/**
 * One address fetched into a file by one curl.exe, waited for.
 * [true, ''] or [false, why]; null when Stop was pressed, with the file removed.
 */
$get = static function (string $url, string $to) use ($curl, $save, $stopped): ?array {
    @unlink($to);
    // Given up only when nothing comes for a minute: no limit on the whole of a file.
    $proc = @proc_open([$curl, '-L', '--fail', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20',
                        '--speed-limit', '1024', '--speed-time', '60', '-A', 'Xsegon', '-o', $to, $url],
        [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $to . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        return [false, 'curl.exe could not be started'];
    }
    while (true) {
        $st = proc_get_status($proc);
        if (!$st['running']) {
            break;
        }
        if ($stopped()) {
            proc_terminate($proc);
            proc_close($proc);
            @unlink($to);
            @unlink($to . '.err');
            return null;
        }
        $save(false);
        usleep(50000);
    }
    proc_close($proc);
    // curl writes a line for each of its tries: the last is why it gave up.
    $lines = preg_split('/\R/', trim((string) @file_get_contents($to . '.err'))) ?: [''];
    $said  = trim((string) end($lines));
    @unlink($to . '.err');
    clearstatcache(true, $to);
    if ((int) $st['exitcode'] === 0 && is_file($to) && (int) filesize($to) > 0) {
        return [true, ''];
    }
    @unlink($to);
    return [false, $said !== '' ? mb_substr($said, 0, 200) : 'curl ended with ' . (int) $st['exitcode']];
};

// ---- the arcade games with no video ---------------------------------------------
$job['phase'] = 'reading';
$save();
$s       = xs_settings();
$library = xs_library();
$byId    = [];
$consoles = [];     // each console's games, for the look before a video is named (xs_vp_dest_now)
foreach ($library['games'] ?? [] as $g) {
    $byId[(string) $g['id']] = $g;
    $consoles[art_key((string) $g['platform'])][] = $g;
}
$none  = [];        // the games that got no video here, with why
$games = [];
foreach (xs_ad_need($s, $library, (array) ($job['platforms'] ?? [])) as $g) {
    if ($g['name'] === null) {
        $none[] = $g + ['why' => 'its file is not named the way MAME names a game (sf2.zip), so the Arcade Database was not asked about it'];
        continue;
    }
    $games[] = $g;
}
$job['games'] = count($games);
$listNone = static fn (array $rows): array
    => array_slice(array_map(static fn ($r) => ['title' => $r['title'], 'platform' => $r['platform'], 'why' => $r['why']], $rows), 0, 20000);
if (!$games) {
    $job['none'] = $listNone($none);
    $end('done', 'No arcade game with no video could be asked about at the Arcade Database: nothing was fetched from it.' . $next);
}
if (!is_dir($tmp) && !@mkdir($tmp, 0777, true)) {
    $end('failed', 'the folder ' . $tmp . ' could not be made.' . $next);
}
$source = xs_ad_source();
$before = static function () use (&$job, $n): string {
    return $n((int) $job['added'], 'video was', 'videos were') . ' fetched from the Arcade Database before that';
};

// ---- is it there, and will it give files today ----------------------------------
$job['phase'] = 'asking';
$save();
$got = $get($source['left'], $tmp . DIRECTORY_SEPARATOR . 'left.json');
if ($got === null) {
    $end('stopped', 'stopped: no video was fetched from the Arcade Database');
}
if (!$got[0]) {
    $end('failed', 'the Arcade Database could not be reached (is the internet there?): ' . $got[1] . '.' . $next);
}
$left = xs_ad_left((string) @file_get_contents($tmp . DIRECTORY_SEPARATOR . 'left.json'));
@unlink($tmp . DIRECTORY_SEPARATOR . 'left.json');
if ($left === 0) {
    $end('failed', 'the Arcade Database is giving no more files for now: it keeps an allowance for everyone together. Try again tomorrow.' . $next);
}
xs_log('ARCD', count($games) . ' arcade games to ask about' . ($none ? ', ' . count($none) . ' with a file not named as MAME names games' : '')
    . '; the Arcade Database says ' . ($left === null ? 'nothing of its allowance' : $left . ' files may still be fetched'));

/** What it said of one game, asked once a run. [answer or null, why] ; false when Stop was pressed. */
$asked = [];
$ask = static function (string $name) use (&$asked, $get, $source, $tmp) {
    if (!isset($asked[$name])) {
        $to  = $tmp . DIRECTORY_SEPARATOR . 'ask.json';
        $got = $get(str_replace('{name}', rawurlencode($name), $source['ask']), $to);
        if ($got === null) {
            return false;
        }
        $answer = $got[0] ? xs_ad_answer((string) @file_get_contents($to)) : null;
        @unlink($to);
        $asked[$name] = [$answer, $got[0] ? 'what came was not an answer' : $got[1]];
        usleep(120000);     // a breath between asks: its makers serve everyone from one server
    }
    return $asked[$name];
};

// ---- a game at a time: ask, then fetch -------------------------------------------
$job['phase'] = 'fetching';
$deaf   = 0;        // asks in a row that got no answer
$refuse = 0;        // videos in a row that would not come
$parent = 0;
$shared = 0;        // versions of a game whose video was in already
$tally  = ['unknown' => 0, 'no video' => 0, 'not fetched' => 0];
foreach ($games as $k => $g) {
    if ($stopped()) {
        $end('stopped', 'stopped: ' . $before());
    }
    $job['at']  = $k;
    $job['now'] = $g['title'];
    $job['none'] = $listNone($none);
    $save(false);
    $full = $byId[$g['id']] ?? null;
    $has  = false;
    $said = 'its name has no letter or digit a video can be filed under';
    $dest = $full !== null ? xs_vp_dest_now($s, $full, $consoles[art_key((string) $g['platform'])] ?? [], 'mp4', $said, $has) : null;
    // One video a game. Versions of one game share a name: the first found is the one all of them use.
    if ($has) {
        $shared++;
        continue;
    }
    if ($dest === null) {
        $none[] = $g + ['why' => $said];
        continue;
    }
    $a = $ask($g['name']);
    if ($a === false) {
        $end('stopped', 'stopped: ' . $before());
    }
    if ($a[0] === null) {
        $none[] = $g + ['why' => 'the Arcade Database gave no answer about ' . $g['name'] . ': ' . $a[1]];
        if (++$deaf >= 3) {
            $job['none'] = $listNone($none);
            $end('failed', 'the Arcade Database stopped answering (is the internet there?): ' . $a[1] . '. ' . ucfirst($before()) . '.' . $next);
        }
        continue;
    }
    $deaf = 0;
    if (!$a[0]['known']) {
        $none[] = $g + ['why' => 'the Arcade Database knows no game named ' . $g['name']];
        $tally['unknown']++;
        continue;
    }
    $url  = $a[0]['video'];
    $from = $g['name'];
    // No video of this version: the game it is a version of has the same play.
    if ($url === '' && $a[0]['parent'] !== '') {
        $p = $ask($a[0]['parent']);
        if ($p === false) {
            $end('stopped', 'stopped: ' . $before());
        }
        if ($p[0] !== null && $p[0]['known']) {
            $url  = $p[0]['video'];
            $from = $a[0]['parent'];
        }
    }
    if ($url === '') {
        $none[] = $g + ['why' => 'the Arcade Database has no video of it yet'];
        $tally['no video']++;
        continue;
    }
    if (!is_dir(dirname($dest)) && !@mkdir(dirname($dest), 0777, true)) {
        $end('failed', 'the folder ' . dirname($dest) . ' could not be made.' . $next);
    }
    $free = (float) @disk_free_space(xs_data_dir());
    if ($free > 0 && $free < 64 * 1048576) {
        $job['none'] = $listNone($none);
        $end('failed', 'there is not enough room for more videos: ' . round($free / 1048576) . ' MB is free on the drive Xsegon keeps its data on. '
            . ucfirst($before()) . '.');
    }
    // A name of its own while it comes: another fetch at work on the same game writes <name>.part.
    $part = $dest . '.adb.part';
    $got  = $get($url, $part);
    if ($got === null) {
        $end('stopped', 'stopped: ' . $before());
    }
    [$ok, $why] = $got;
    if ($ok && !xs_vp_is_video($part)) {
        [$ok, $why] = [false, 'what came is not a video a browser can play'];
    }
    $bytes = $ok ? (int) filesize($part) : 0;
    // Looked at again: a video of it from elsewhere meanwhile was first and stays the only one,
    // and a name another game's video took meanwhile is not used.
    if ($ok) {
        $now = xs_vp_dest_now($s, $full, $consoles[art_key((string) $g['platform'])] ?? [], 'mp4', $said, $has);
        if ($has) {
            @unlink($part);
            xs_log('ARCD', $g['title'] . ' (' . $from . '): a video of it arrived from elsewhere meanwhile, so this one was not kept');
            continue;
        }
        if ($now === null) {
            @unlink($part);
            $none[] = $g + ['why' => (string) $said];
            xs_log('ARCD', $g['title'] . ' (' . $from . '): not kept: ' . $said);
            continue;
        }
        $dest = $now;
    }
    if ($ok && !@rename($part, $dest)) {
        [$ok, $why] = [false, 'it could not be given its name in ' . dirname($dest)];
    }
    if (!$ok) {
        @unlink($part);
        $none[] = $g + ['why' => 'its video could not be fetched: ' . $why];
        $tally['not fetched']++;
        xs_log('ARCD', $g['title'] . ' (' . $from . '): not fetched: ' . $why);
        if (++$refuse >= 3) {
            $job['none'] = $listNone($none);
            $end('failed', 'the Arcade Database is not giving videos just now: ' . $why . '. ' . ucfirst($before()) . '.' . $next);
        }
        continue;
    }
    $refuse = 0;
    $job['added']++;
    $job['bytes'] += $bytes;
    $parent += $from !== $g['name'] ? 1 : 0;
}
$job['at']      = count($games);
$job['asked']   = count($asked);
$job['none']    = $listNone($none);
$job['seconds'] = (int) round(microtime(true) - $t0);
xs_log('ARCD', 'asked about ' . count($asked) . ' names in ' . $job['seconds'] . 's; ' . $job['added'] . ' videos in, ' . $parent
    . ' of them the video of the game it is a version of, ' . $shared . ' more games share one of those; ' . count($none) . ' games got none ('
    . implode(', ', array_map(static fn ($what, $c) => $what . ' ' . $c, array_keys($tally), $tally)) . ')');

// The ending never puts a count of games beside a count of videos: the two are misread as one.
$added = (int) $job['added'];
$lack  = count($none);
$rest  = $then && $lack ? ' The online archives are asked for ' . ($lack === 1 ? 'it' : 'those') . ' next.' : '';
if ($added === 0) {
    $end('done', 'No video came from ' . XS_AD_NAME . ' for '
        . ($lack === 1 ? $none[0]['title'] . ': ' . $none[0]['why'] : 'the ' . $n($lack, 'arcade game', 'arcade games') . ' with none') . '.' . $rest);
}
$end('done', $n($added, 'video', 'videos') . ' came from ' . XS_AD_NAME . ', ' . round($job['bytes'] / 1048576) . ' MB in ' . $job['seconds'] . ' s.'
    . ($lack === 1 ? ' None came for ' . $none[0]['title'] . ': ' . $none[0]['why'] . '.' : ($lack ? ' None came for ' . $lack . ' other arcade games.' : ''))
    . $rest);
