<?php
/**
 * Xsegon - the worker that fetches manuals from the Internet Archive
 * (includes\archivedoc.php), run in the background.
 *
 *   php bin\archivedoc.php
 *
 * The plan is in data\archivedoc-job.json: the consoles chosen. Games with no
 * manual are matched to each set's file list by name and the sure matches
 * fetched; a manual is checked against the Archive's checksum, and that it is
 * a PDF, before it becomes the game's Manual.pdf.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/archivedoc.php';
require_once __DIR__ . '/../includes/curlmany.php';

set_time_limit(0);
ini_set('memory_limit', '1024M');

$job = xs_read_json(xs_ma_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\archivedoc-job.json\n");
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
    xs_write_json(xs_ma_job_path(), $job);
};
$save();
// Manuals come down here first: a folder in data\documents is a game's only once its manual is whole.
$tmp = xs_data_path('archivedoc-tmp');
$tidy = static function () use ($tmp): void {
    foreach (xs_glob($tmp, '*') as $f) {
        @unlink($f);
    }
    @rmdir($tmp);
};
register_shutdown_function(static function () use (&$job, $save, $tidy): void {
    $tidy();
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $save();
    }
});
$stopped = static fn (): bool => is_file(xs_ma_stop_path());
$end = static function (string $state, string $words) use (&$job, $save): void {
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    @unlink(xs_ma_stop_path());
    xs_log('MANU', $state === 'stopped' ? $words : $state . ': ' . $words);
    exit(0);
};
$n  = static fn (int $count, string $one, string $many): string => $count . ' ' . ($count === 1 ? $one : $many);
$t0 = microtime(true);
if (xs_curl_exe() === '') {
    $end('failed', 'Windows\' own curl.exe is not on this PC, and that is what fetches the manuals');
}
$look = static function () use ($save, $stopped): bool {
    $save(false);
    return !$stopped();
};

// ---- the games with no manual, on the consoles chosen --------------------------
$job['phase'] = 'reading';
$save();
$library = xs_library();
$chosen  = array_flip(array_map('strval', (array) ($job['platforms'] ?? [])));
$lacking = array_values(array_filter(xs_ma_need($library), static fn ($c) => isset($chosen[$c['platform']])));
// One looked for before with nothing found is left out until Look again.
$games = xs_ma_unlooked($lacking);
$job['games'] = count($games);
if (!$games) {
    $end('done', $lacking
        ? 'Every game with no manual on the consoles chosen was looked for before and the online archives had none: nothing was fetched. Look again in Get Media > Manuals from online archives asks for them once more'
        : 'Every game on the consoles chosen has a manual already: nothing was fetched');
}

// ---- each set's own list of files, asked of the Archive ------------------------
$sets = [];
foreach (array_keys($chosen) as $platform) {
    foreach (xs_ma_sets_for((string) $platform) as $set) {
        $sets[$set['id']] = $set;
    }
}
$job['phase'] = 'listing';
$job['sets']  = count($sets);
$save();
if (!is_dir($tmp) && !@mkdir($tmp, 0777, true)) {
    $end('failed', 'the folder ' . $tmp . ' could not be made');
}
$source = xs_av_source();
$want   = [];
$i      = 0;
foreach ($sets as $id => $set) {
    $want[$id] = ['url' => str_replace('{id}', rawurlencode((string) $id), $source['list']), 'to' => $tmp . DIRECTORY_SEPARATOR . 'list-' . (++$i) . '.json', 'lane' => 'lists'];
}
$shelves = [];      // by console folder: the manuals of its sets
$missed  = [];      // the sets whose list would not come
$whole = xs_curl_many($want, 6, 6, static function ($id, bool $ok, string $why) use (&$job, &$shelves, &$missed, $want, $sets): void {
    $manuals = $ok ? xs_ma_manuals($sets[$id], (string) @file_get_contents($want[$id]['to'])) : null;
    @unlink($want[$id]['to']);
    $job['setsAt']++;
    if ($manuals === null) {
        $missed[$id] = $ok ? 'what came was not a list of files' : $why;
        xs_log('MANU', 'the list of the set ' . $id . ' would not come: ' . $missed[$id]);
        return;
    }
    $folder = (string) $sets[$id]['folder'];
    $shelves[$folder] = array_merge($shelves[$folder] ?? [], $manuals);
}, $look);
if (!$whole) {
    $end('stopped', 'stopped: no manual was fetched');
}
if ($sets && count($missed) === count($sets)) {
    $end('failed', 'the Internet Archive could not be reached (is the internet there?): ' . reset($missed));
}
foreach ($shelves as $folder => $manuals) {
    xs_vm_shelf(XS_MA_ROOT, (string) $folder, $manuals);
}
xs_log('MANU', 'read ' . (count($sets) - count($missed)) . ' of ' . count($sets) . ' sets\' lists in ' . round(microtime(true) - $t0, 1) . 's: '
    . array_sum(array_map('count', $shelves)) . ' manuals for ' . count($shelves) . ' console folders');

// ---- which manual is each game's ----------------------------------------------
$job['phase'] = 'matching';
$save();
$plan = [];         // by the manual it will be: ['games' => [card, ...], 'v']
$none = [];
$how  = [];
foreach ($games as $k => $c) {
    if ($stopped()) {
        $end('stopped', 'stopped: no manual was fetched');
    }
    $job['at'] = $k + 1;
    $save(false);
    // Each version's own file name is tried, then the title: the best way any of them matched wins.
    $best = null;
    $file = '';
    foreach ($c['files'] ?: [''] as $f) {
        $m = xs_vm_match(XS_MA_ROOT, ['title' => $c['title'], 'platform' => $c['platform'], 'file' => $f]);
        if ($best === null || ($m['video'] !== null && ($best['video'] === null || $m['kind'] < $best['kind']))) {
            [$best, $file] = [$m, $f];
        }
    }
    // 'notFound': the sets were read and hold nothing sure for it, which is no failure to try again.
    if ($best['video'] === null) {
        $none[] = $c + ['why' => xs_ma_words((string) $best['why']), 'notFound' => true];
        continue;
    }
    if (!xs_ma_language_ok($best['video'], $file, $regions)) {
        $none[] = $c + ['why' => 'only a manual of another region was found (' . $regions . '), and that is left out: ' . $best['video']['name'], 'notFound' => true];
        continue;
    }
    $how[XS_VM_KINDS[$best['kind']]] = ($how[XS_VM_KINDS[$best['kind']]] ?? 0) + 1;
    $job['found']++;
    $key = $best['video']['id'] . '/' . $best['video']['path'];
    if (!isset($plan[$key])) {
        $plan[$key] = ['games' => [], 'v' => $best['video']];
        $job['total'] += $best['video']['size'];
    }
    $plan[$key]['games'][] = $c;
}
xs_log('MANU', 'matched ' . $job['found'] . ' of ' . count($games) . ' games (' . implode(', ', array_map(static fn ($kind, $q) => $kind . ' ' . $q, array_keys($how), $how))
    . '), ' . count($plan) . ' manuals to fetch, ' . round($job['total'] / 1048576) . ' MB');
$listNone = static fn (array $rows): array
    => array_slice(array_map(static fn ($r) => ['title' => $r['title'], 'platform' => $r['platform'], 'why' => $r['why']], $rows), 0, 20000);
$job['none'] = $listNone($none);
$free = (float) @disk_free_space(xs_data_dir());
if ($plan && $free > 0 && $free < $job['total'] + 64 * 1048576) {
    $end('failed', 'there is not enough room for the manuals: they are ' . round($job['total'] / 1073741824, 1) . ' GB and '
        . round($free / 1073741824, 1) . ' GB is free on the drive Xsegon keeps its data on');
}

// ---- the manuals themselves ----------------------------------------------------
$job['phase'] = 'fetching';
$save();
$want = [];
$i    = 0;
foreach ($plan as $key => $p) {
    $want[$key] = ['url' => xs_av_file_url($p['v']['id'], $p['v']['path']), 'to' => $tmp . DIRECTORY_SEPARATOR . 'manual-' . (++$i) . '.pdf', 'lane' => $p['v']['id']];
}
$done = 0;          // bytes of the manuals that are in
$bad  = [];
$whole = xs_curl_many($want, 6, 3, static function ($key, bool $ok, string $why) use (&$job, &$done, &$bad, $plan, $want): void {
    $p    = $plan[$key];
    $part = $want[$key]['to'];
    if ($ok && $p['v']['md5'] !== '' && md5_file($part) !== $p['v']['md5']) {
        [$ok, $why] = [false, 'it did not arrive whole (its checksum is not the Archive\'s)'];
    }
    if ($ok && !str_contains((string) @file_get_contents($part, false, null, 0, 1024), '%PDF-')) {
        [$ok, $why] = [false, 'what came is not a PDF'];
    }
    if (!$ok) {
        @unlink($part);
        foreach ($p['games'] as $c) {
            $bad[] = $c + ['why' => 'its manual could not be fetched: ' . $why];
        }
        xs_log('MANU', $p['games'][0]['title'] . ' (' . $p['games'][0]['platform'] . '): ' . $p['v']['id'] . '/' . $p['v']['path'] . ' not fetched: ' . $why);
        return;
    }
    // Looked at again just before it is named: a manual that came meanwhile stays.
    foreach ($p['games'] as $c) {
        if (array_filter($c['ids'], 'xs_ma_has')) {
            $job['added']++;
            xs_log('MANU', $c['title'] . ' (' . $c['platform'] . '): it has a manual now, so this one was not kept');
            continue;
        }
        $dest = xs_ma_place((string) $c['id']);
        $dir  = dirname($dest);
        $put  = (is_dir($dir) || @mkdir($dir, 0777, true)) && @copy($part, $dest . '.part') && @rename($dest . '.part', $dest);
        if (!$put) {
            @unlink($dest . '.part');
            if (is_dir($dir) && count(scandir($dir) ?: []) <= 2) {
                @rmdir($dir);
            }
            $bad[] = $c + ['why' => 'its manual could not be put in ' . $dir];
            continue;
        }
        $job['added']++;
        xs_log('MANU', $c['title'] . ' (' . $c['platform'] . '): ' . $p['v']['name'] . ' from ' . $p['v']['id'] . ', ' . round((int) filesize($dest) / 1048576, 1) . ' MB');
    }
    $done += $p['v']['size'];
    @unlink($part);
}, static function (array $parts) use (&$job, &$done, $save, $stopped): bool {
    $live = 0;
    foreach ($parts as $part) {
        clearstatcache(true, $part);
        $live += (int) @filesize($part);
    }
    $job['bytes'] = $done + $live;
    $save(false);
    return !$stopped();
});
$job['bytes'] = $done;
$still = array_merge($bad, $none);
$job['none'] = $listNone($still);
if (!$whole) {
    $end('stopped', 'stopped: ' . $n($job['added'], 'manual was', 'manuals were') . ' fetched before that');
}

// Not found on every list for its console: left out of the next Start until Look again.
// A list that did not come or a failed fetch proves nothing, so those are asked again.
$missedFor = static fn (string $p): bool => (bool) array_intersect_key(array_flip(array_column(xs_ma_sets_for($p), 'id')), $missed);
$sure = array_values(array_filter($still, static fn ($c) => !empty($c['notFound']) && !$missedFor((string) $c['platform'])));
xs_ma_remember_none($library, $sure);
if ($sure) {
    xs_log('MANU', count($sure) . ' of the ' . count($still) . ' with none kept as looked for with nothing found: the next Start leaves them out until Look again');
}
xs_ma_tell($still);
$job['seconds'] = (int) round(microtime(true) - $t0);
$got   = $job['added'];
$lists = $missed ? ' ' . count($missed) . ' of the Archive\'s lists would not come, so another go may find more.' : '';
$end('done', ($got === 0
    ? 'None of the ' . $n(count($games), 'game', 'games') . ' with no manual has one on the online archives that Xsegon is sure of: nothing was fetched.'
    : $got . ' of ' . $n(count($games), 'game', 'games') . ' with no manual got one from the online archives (' . round($done / 1048576) . ' MB in ' . $job['seconds'] . ' s).')
    . ($still ? ' ' . count($still) . ' got none: Get Media > Manuals from online archives lists them.' : '') . $lists);
