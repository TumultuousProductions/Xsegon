<?php
/**
 * Xsegon - the worker that fetches videos from the Internet Archive
 * (includes\archivevid.php), run in the background.
 *
 *   php bin\archivevid.php
 *
 * The plan is in data\archivevid-job.json: the consoles chosen. Games with no
 * video are matched to each set's file list and the sure matches fetched;
 * a video is checked against the Archive's checksum before it gets its name.
 * A game the sets leave without gets the first 30 seconds of a World of
 * Longplays recording, cut by ffmpeg without fetching the whole file.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/video.php';
require_once __DIR__ . '/../includes/archivevid.php';

set_time_limit(0);
ini_set('memory_limit', '1024M');

$job = xs_read_json(xs_av_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\archivevid-job.json\n");
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
    xs_write_json(xs_av_job_path(), $job);
};
$save();
$tmp = xs_data_path('archivevid-tmp');
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
$stopped = static fn (): bool => is_file(xs_av_stop_path());
// However it ends, the videos that came go to Recently changed and are said in Messages ($s and $consoles are read below).
$end = static function (string $state, string $words) use (&$job, $save, &$s, &$consoles): void {
    if (!empty($job['added']) && is_array($consoles)) {
        xs_changed_tell('the online archives', xs_changed_videos_by_name($s, xs_changed_on($consoles, (array) ($job['platforms'] ?? [])), (int) ($job['started'] ?? 0)));
    }
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    @unlink(xs_av_stop_path());
    xs_log('ARCV', $state === 'stopped' ? $words : $state . ': ' . $words);
    exit(0);
};
$n = static fn (int $count, string $one, string $many): string => $count . ' ' . ($count === 1 ? $one : $many);
$t0 = microtime(true);
$curl = xs_curl_exe();
if ($curl === '') {
    $end('failed', 'Windows\' own curl.exe is not on this PC, and that is what fetches the videos');
}

/**
 * Several addresses fetched side by side, each by its own curl.exe.
 * $want: [key => ['url', 'to', 'lane']]. At most $side at once and $perLane per
 * lane, as a set sits on one or two of the Archive's servers. $each(key, ok,
 * why) as each ends; $look(the files being written) between, false to stop.
 */
$fetch = static function (array $want, int $side, int $perLane, callable $each, callable $look) use ($curl): bool {
    $going = [];
    while ($want || $going) {
        foreach ($want as $key => $w) {
            if (count($going) >= $side) {
                break;
            }
            if (count(array_filter($going, static fn ($g) => $g['lane'] === $w['lane'])) >= $perLane) {
                continue;
            }
            unset($want[$key]);
            @unlink($w['to']);
            // Given up only when nothing comes for a minute: no limit on the whole of a file.
            $proc = @proc_open([$curl, '-L', '--fail', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20',
                                '--speed-limit', '1024', '--speed-time', '60', '-A', 'Xsegon', '-o', $w['to'], $w['url']],
                [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $w['to'] . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
            if (!is_resource($proc)) {
                $each($key, false, 'curl.exe could not be started');
                continue;
            }
            $going[$key] = ['proc' => $proc, 'to' => $w['to'], 'lane' => $w['lane']];
        }
        foreach ($going as $key => $g) {
            $st = proc_get_status($g['proc']);
            if ($st['running']) {
                continue;
            }
            proc_close($g['proc']);
            unset($going[$key]);
            // curl writes a line for each of its tries: the last is why it gave up.
            $lines = preg_split('/\R/', trim((string) @file_get_contents($g['to'] . '.err'))) ?: [''];
            $said  = trim((string) end($lines));
            @unlink($g['to'] . '.err');
            clearstatcache(true, $g['to']);
            $ok = (int) $st['exitcode'] === 0 && is_file($g['to']) && (int) filesize($g['to']) > 0;
            $each($key, $ok, $said !== '' ? mb_substr($said, 0, 200) : 'curl ended with ' . (int) $st['exitcode']);
        }
        if (!$look(array_column($going, 'to'))) {
            foreach ($going as $g) {
                proc_terminate($g['proc']);
                proc_close($g['proc']);
                @unlink($g['to']);
                @unlink($g['to'] . '.err');
            }
            return false;
        }
        usleep(100000);
    }
    return true;
};

// ---- the games with no video, on the consoles chosen ---------------------------
$job['phase'] = 'reading';
$save();
$s       = xs_settings();
$library = xs_library();
$chosen  = array_flip(array_map('strval', (array) ($job['platforms'] ?? [])));
$byId    = [];
$consoles = [];     // each console's games, for the look before a video is named (xs_vp_dest_now)
foreach ($library['games'] ?? [] as $g) {
    $byId[(string) $g['id']] = $g;
    $consoles[art_key((string) $g['platform'])][] = $g;
}
$lacking =array_values(array_filter(xs_vp_need($s, $library), static fn ($g) => isset($chosen[$g['platform']])));
// One looked for before with nothing found is left out until Look again.
$games = xs_av_unlooked($lacking);
$job['games'] = count($games);
if (!$games) {
    $end('done', $lacking
        ? 'Every game with no video on the consoles chosen was looked for before and the online archives had none: nothing was fetched. Look again in Get Media > Videos from online archives asks for them once more'
        : 'Every game on the consoles chosen has a video already: nothing was fetched');
}

// ---- each set's own list of files, asked of the Archive ------------------------
$sets = [];
foreach (array_keys($chosen) as $platform) {
    foreach (xs_av_sets_for((string) $platform) as $set) {
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
$shelves = [];      // by console folder: the videos of its sets
$missed  = [];      // the sets whose list would not come
$whole = $fetch($want, 6, 6, static function ($id, bool $ok, string $why) use (&$job, &$shelves, &$missed, $want, $sets): void {
    $videos = $ok ? xs_av_videos($sets[$id], (string) @file_get_contents($want[$id]['to'])) : null;
    @unlink($want[$id]['to']);
    $job['setsAt']++;
    if ($videos === null) {
        $missed[$id] = $ok ? 'what came was not a list of files' : $why;
        xs_log('ARCV', 'the list of the set ' . $id . ' would not come: ' . $missed[$id]);
        return;
    }
    $folder = (string) $sets[$id]['folder'];
    $shelves[$folder] = array_merge($shelves[$folder] ?? [], $videos);
}, static function () use ($save, $stopped): bool {
    $save(false);
    return !$stopped();
});
if (!$whole) {
    $end('stopped', 'stopped: no video was fetched');
}
// A console served by playthroughs alone brings no set at all: that is not the Archive being away.
if ($sets && count($missed) === count($sets)) {
    $end('failed', 'the Internet Archive could not be reached (is the internet there?): ' . reset($missed));
}
foreach ($shelves as $folder => $videos) {
    xs_vm_shelf(XS_AV_ROOT, (string) $folder, $videos);
}
xs_log('ARCV', 'read ' . (count($sets) - count($missed)) . ' of ' . count($sets) . ' sets\' lists in ' . round(microtime(true) - $t0, 1) . 's: '
    . array_sum(array_map('count', $shelves)) . ' videos for ' . count($shelves) . ' console folders');

// ---- which video is each game's ------------------------------------------------
$job['phase'] = 'matching';
$t1    = microtime(true);
$plan  = [];        // by the file it will be: ['game', 'v', 'dest']
$none  = [];
$how   = [];
$shelfNow = [];     // each console's videos by name as matching began
foreach ($games as $k => $g) {
    if ($stopped()) {
        $end('stopped', 'stopped: no video was fetched');
    }
    $job['at'] = $k + 1;
    $save(false);
    $m = xs_vm_match(XS_AV_ROOT, $g);
    // 'notFound': the sets were read and hold nothing for it, which is no failure to try again.
    if ($m['video'] === null) {
        $none[] = $g + ['why' => str_replace(' in the folder', ' on the Internet Archive', $m['why']), 'notFound' => true];
        continue;
    }
    $v    = $m['video'];
    $ext  = strtolower(pathinfo($v['name'], PATHINFO_EXTENSION));
    $full = $byId[$g['id']] ?? null;
    $pk   = art_key((string) $g['platform']);
    $has  = false;
    $said = 'its name has no letter or digit a video can be filed under';
    $dest = $full !== null && isset(video_types()[$ext])
        ? xs_vp_dest_now($s, $full, $consoles[$pk] ?? [], $ext, $said, $has, $shelfNow[$pk] ??= video_console_now($s, (string) $g['platform']))
        : null;
    if ($has) {
        continue;
    }
    if ($dest === null) {
        $none[] = $g + ['why' => $said];
        continue;
    }
    $how[XS_VM_KINDS[$m['kind']]] = ($how[XS_VM_KINDS[$m['kind']]] ?? 0) + 1;
    $job['found']++;
    // Two versions of one game share a name, and so a video: it is fetched once.
    if (!isset($plan[mb_strtolower($dest)])) {
        $plan[mb_strtolower($dest)] = ['game' => $g, 'twins' => [], 'v' => $v, 'dest' => $dest];
        $job['total'] += $v['size'];
    } else {
        $plan[mb_strtolower($dest)]['twins'][] = $g;
    }
}
xs_log('ARCV', 'matched ' . $job['found'] . ' of ' . count($games) . ' games in ' . round(microtime(true) - $t1, 1) . 's ('
    . implode(', ', array_map(static fn ($kind, $c) => $kind . ' ' . $c, array_keys($how), $how)) . '), ' . count($plan) . ' videos to fetch, '
    . round($job['total'] / 1048576) . ' MB');
$listNone = static fn (array $rows): array
    => array_slice(array_map(static fn ($r) => ['title' => $r['title'], 'platform' => $r['platform'], 'why' => $r['why']], $rows), 0, 20000);
$job['none'] = $listNone($none);
$lists = $missed ? ' ' . count($missed) . ' of the Archive\'s lists would not come, so another go may find more.' : '';
$free = (float) @disk_free_space(xs_data_dir());
if ($plan && $free > 0 && $free < $job['total'] + 64 * 1048576) {
    $end('failed', 'there is not enough room for the videos: they are ' . round($job['total'] / 1073741824, 1) . ' GB and '
        . round($free / 1073741824, 1) . ' GB is free on the drive Xsegon keeps its data on');
}

// ---- the videos themselves -----------------------------------------------------
$job['phase'] = 'fetching';
$save();
$want = [];
$done = 0;          // bytes of the videos that are in
$hevc = 0;
$bad  = [];
foreach ($plan as $key => $p) {
    if (is_file($p['dest'])) {
        $job['added']++;
        $done += $p['v']['size'];
        continue;
    }
    if (!is_dir(dirname($p['dest'])) && !@mkdir(dirname($p['dest']), 0777, true)) {
        $end('failed', 'the folder ' . dirname($p['dest']) . ' could not be made');
    }
    $want[$key] = ['url' => xs_av_file_url($p['v']['id'], $p['v']['path']), 'to' => $p['dest'] . '.part', 'lane' => $p['v']['id']];
}
// The versions sharing a fetch were counted as found: one that does not play a video once it is over joins $bad, with why.
$twinsLeft = static function (array $p, string $why) use (&$bad, $s, $byId, $consoles): void {
    foreach ($p['twins'] as $t) {
        $has = false;
        xs_vp_dest_now($s, $byId[(string) $t['id']], $consoles[art_key((string) $t['platform'])] ?? [], 'mp4', $said, $has);
        if (!$has) {
            $bad[] = ['why' => $why] + $t;
        }
    }
};
$whole = $fetch($want, 6, 3, static function ($key, bool $ok, string $why) use (&$job, &$done, &$hevc, &$bad, $plan, $s, $byId, $consoles, $twinsLeft): void {
    $p    = $plan[$key];
    $part = $p['dest'] . '.part';
    $dest = $p['dest'];
    if ($ok && $p['v']['md5'] !== '' && md5_file($part) !== $p['v']['md5']) {
        [$ok, $why] = [false, 'it did not arrive whole (its checksum is not the Archive\'s)'];
    }
    if ($ok && !xs_vp_is_video($part)) {
        [$ok, $why] = [false, 'it is not a video a browser can play'];
    }
    // Looked at again just before it is named: a video that came meanwhile stays, and so does another game's.
    if ($ok) {
        $now = xs_vp_dest_now($s, $byId[(string) $p['game']['id']], $consoles[art_key((string) $p['game']['platform'])] ?? [],
            strtolower(pathinfo($p['dest'], PATHINFO_EXTENSION)), $said, $has);
        if ($has) {
            @unlink($part);
            $job['added']++;
            $twinsLeft($p, 'a version of it got a video from elsewhere meanwhile, so another go is needed for this one');
            xs_log('ARCV', $p['game']['title'] . ' (' . $p['game']['platform'] . '): it has a video now, so this one was not kept');
            return;
        }
        if ($now === null) {
            [$ok, $why] = [false, (string) $said];
        } else {
            $dest = $now;
        }
    }
    if ($ok && !@rename($part, $dest)) {
        [$ok, $why] = [false, 'it could not be given its name in ' . dirname($dest)];
    }
    if (!$ok) {
        @unlink($part);
        $bad[] = $p['game'] + ['why' => 'its video could not be fetched: ' . $why];
        $twinsLeft($p, 'its video could not be fetched: ' . $why);
        xs_log('ARCV', $p['game']['title'] . ' (' . $p['game']['platform'] . '): ' . $p['v']['id'] . '/' . $p['v']['path'] . ' not fetched: ' . $why);
        return;
    }
    // Filed under its own file's name, a twin found by the shared title does not find it.
    $twinsLeft($p, 'a version of it got a video under that version\'s own name, so another go is needed for this one');
    $job['added']++;
    $done += $p['v']['size'];
    $hevc += $p['v']['hevc'] ? 1 : 0;
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
$job['none']  = $listNone(array_merge($bad, $none));
if (!$whole) {
    $end('stopped', 'stopped: ' . $n($job['added'], 'video was', 'videos were') . ' fetched before that');
}

// ---- the gaps, tried against World of Longplays' recordings --------------------
$still = [];        // the games neither road served, each with its why
$wol   = [];        // the games a recording may serve
foreach (array_merge($bad, $none) as $g) {
    if (xs_av_wol_for((string) $g['platform'])) {
        $wol[] = $g;
    } else {
        $still[] = $g;
    }
}
$cuts    = 0;
$gotToo  = 0;       // served by a twin version's file written in this run
$ff      = xs_av_ffmpeg();
$wolSaid = '';
$look    = static function () use ($save, $stopped): bool {
    $save(false);
    return !$stopped();
};
if ($wol && !$ff) {
    $wolSaid = ' World of Longplays could fill some of the gaps, but the video cutter (bin\\ffmpeg.exe) is not on this PC.';
    xs_log('ARCV', count($wol) . ' games could be tried on World of Longplays, but there is no ffmpeg.exe to cut with');
    $still = array_merge($still, $wol);
} elseif ($wol) {
    $job['phase'] = 'playthroughs';
    $save();
    $t2    = microtime(true);
    $items = [];
    $url   = $source['search'];
    for ($page = 0; $page < 6 && $url !== ''; $page++) {
        $to  = $tmp . DIRECTORY_SEPARATOR . 'wol-' . $page . '.json';
        $got = null;
        $sad = '';
        $on  = $fetch(['p' => ['url' => $url, 'to' => $to, 'lane' => 'wol']], 1, 1,
            static function ($key, bool $ok, string $why) use (&$got, &$sad, $to): void {
                $got = $ok ? (string) @file_get_contents($to) : null;
                $sad = $why;
                @unlink($to);
            }, $look);
        if (!$on) {
            $end('stopped', 'stopped: ' . $n($job['added'], 'video was', 'videos were') . ' fetched before that');
        }
        $doc = $got === null ? null : json_decode(xs_strip_bom($got), true);
        if (!is_array($doc) || !is_array($doc['items'] ?? null)) {
            $items   = null;
            $wolSaid = ' World of Longplays\' list would not come, so another go may find more.';
            xs_log('ARCV', 'the World of Longplays list would not come: ' . ($sad !== '' ? $sad : 'what came was not a list'));
            break;
        }
        $items  = array_merge($items, $doc['items']);
        $cursor = (string) ($doc['cursor'] ?? '');
        $url    = $cursor !== '' ? $source['search'] . '&cursor=' . rawurlencode($cursor) : '';
    }
    $plan2 = [];
    if ($items === null) {
        $still = array_merge($still, $wol);
    } else {
        $folders = [];
        foreach ($wol as $g) {
            foreach ((xs_vm_console((string) $g['platform'])['folders'] ?? []) as $f) {
                $folders[(string) $f] = true;
            }
        }
        $shelved = xs_av_wol_videos($items, array_keys($folders));
        foreach ($shelved as $folder => $vids) {
            xs_vm_shelf(XS_AV_WOL, (string) $folder, $vids);
        }
        xs_log('ARCV', 'read the World of Longplays list in ' . round(microtime(true) - $t2, 1) . 's: '
            . array_sum(array_map('count', $shelved)) . ' recordings for ' . count($shelved) . ' console folders');
        $wolNow = [];   // each console's videos by name as this matching began: nothing is saved until the cuts
        foreach ($wol as $g) {
            if ($stopped()) {
                $end('stopped', 'stopped: ' . $n($job['added'], 'video was', 'videos were') . ' fetched before that');
            }
            $m = xs_vm_match(XS_AV_WOL, $g);
            if ($m['video'] === null) {
                // The matcher's own reason, so a similar name it found is named.
                $said = (string) $m['why'];
                $g['why'] = rtrim((string) $g['why'], '.') . '; ' . (str_starts_with($said, 'no videos for this console')
                    ? 'World of Longplays has no recording of this console\'s games'
                    : 'World of Longplays: ' . str_replace(' in the folder', '', $said));
                $g['wolLooked'] = true;
                $still[] = $g;
                continue;
            }
            $full = $byId[$g['id']] ?? null;
            $has  = false;
            $said = 'its name has no letter or digit a video can be filed under';
            $pk   = art_key((string) $g['platform']);
            $dest = $full !== null ? xs_vp_dest_now($s, $full, $consoles[$pk] ?? [], 'mp4', $said, $has, $wolNow[$pk] ??= video_console_now($s, (string) $g['platform'])) : null;
            if ($has) {
                // A twin version's video landed in this run, and this game is found by the same name.
                $job['added']++;
                $gotToo++;
                continue;
            }
            if ($dest === null) {
                $still[] = ['why' => $said] + $g;
                continue;
            }
            $key = mb_strtolower($dest);
            if (isset($plan2[$key])) {
                $plan2[$key]['twins'][] = $g;       // a twin version is found by the same name: one cut serves both, or neither
                continue;
            }
            $plan2[$key] = ['game' => $g, 'twins' => [], 'v' => $m['video'], 'dest' => $dest, 'path' => '', 'who' => ''];
        }
    }

    // Each recording's own description says the smaller copy to cut from, and who recorded it.
    if ($plan2) {
        $want = [];
        $i    = 0;
        foreach ($plan2 as $key => $p) {
            $want[$key] = ['url' => str_replace('{id}', rawurlencode((string) $p['v']['id']), $source['meta']),
                           'to' => $tmp . DIRECTORY_SEPARATOR . 'meta-' . (++$i) . '.json', 'lane' => 'meta'];
        }
        $on = $fetch($want, 6, 6, static function ($key, bool $ok, string $sad) use (&$plan2, &$still, $want): void {
            $json = $ok ? (string) @file_get_contents($want[$key]['to']) : '';
            @unlink($want[$key]['to']);
            $why  = $sad;
            $file = $ok ? xs_av_wol_file($json, $why) : null;
            if ($file === null) {
                foreach (array_merge([$plan2[$key]['game']], $plan2[$key]['twins']) as $g) {
                    $g['why'] = 'its playthrough could not be used: ' . $why;
                    $still[] = $g;
                    xs_log('ARCV', $g['title'] . ' (' . $g['platform'] . '): ' . $plan2[$key]['v']['id'] . ': ' . $why);
                }
                unset($plan2[$key]);
                return;
            }
            $plan2[$key]['path'] = $file['path'];
            $plan2[$key]['who']  = $file['who'];
        }, $look);
        if (!$on) {
            $end('stopped', 'stopped: ' . $n($job['added'], 'video was', 'videos were') . ' fetched before that');
        }
    }

    // The cuts themselves, three at a time: ffmpeg reads the first 30 seconds and stops.
    if ($plan2) {
        $job['phase'] = 'cutting';
        $job['cuts']  = count($plan2);
        $job['cutAt'] = 0;
        $save();
        $free = (float) @disk_free_space(xs_data_dir());
        if ($free > 0 && $free < count($plan2) * 8 * 1048576 + 64 * 1048576) {
            $end('failed', 'there is not enough room for the cuts: they are about ' . round(count($plan2) * 8 / 1024, 1) . ' GB and '
                . round($free / 1073741824, 1) . ' GB is free on the drive Xsegon keeps its data on');
        }
        $queue = $plan2;
        $going = [];
        $fail  = static function (array $p, string $why) use (&$still): void {
            foreach (array_merge([$p['game']], $p['twins']) as $g) {
                $g['why'] = 'its playthrough could not be cut: ' . mb_substr($why, 0, 200);
                $still[] = $g;
                xs_log('ARCV', $g['title'] . ' (' . $g['platform'] . '): ' . $p['v']['id'] . ' not cut: ' . $g['why']);
            }
        };
        // An ending that comes mid-cut takes the cutters with it: none is left reading, and no half file stays.
        $drop  = static function () use (&$going): void {
            foreach ($going as $run) {
                proc_terminate($run['proc']);
                proc_close($run['proc']);
                @unlink($run['part']);
                @unlink($run['part'] . '.err');
            }
            $going = [];
        };
        while ($queue || $going) {
            foreach ($queue as $key => $p) {
                if (count($going) >= 3) {
                    break;
                }
                unset($queue[$key]);
                if (!is_dir(dirname($p['dest'])) && !@mkdir(dirname($p['dest']), 0777, true)) {
                    $drop();
                    $end('failed', 'the folder ' . dirname($p['dest']) . ' could not be made');
                }
                $part = $p['dest'] . '.part';
                @unlink($part);
                $proc = @proc_open(xs_av_cut_cmd(xs_av_file_url((string) $p['v']['id'], (string) $p['path']), $part),
                    [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $part . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
                if (!is_resource($proc)) {
                    $job['cutAt']++;
                    $fail($p, 'the cutter could not be started');
                    continue;
                }
                $going[$key] = ['proc' => $proc, 'part' => $part, 'p' => $p, 'from' => microtime(true)];
            }
            foreach ($going as $key => $run) {
                $st = proc_get_status($run['proc']);
                if ($st['running'] && microtime(true) - $run['from'] <= 240) {
                    continue;
                }
                if ($st['running']) {
                    proc_terminate($run['proc']);
                    proc_close($run['proc']);
                    unset($going[$key]);
                    $job['cutAt']++;
                    @unlink($run['part']);
                    @unlink($run['part'] . '.err');
                    $fail($run['p'], 'it took longer than four minutes');
                    continue;
                }
                proc_close($run['proc']);
                unset($going[$key]);
                $job['cutAt']++;
                $p     = $run['p'];
                $part  = $run['part'];
                $lines = preg_split('/\R/', trim((string) @file_get_contents($part . '.err'))) ?: [''];
                $said  = trim((string) end($lines));
                @unlink($part . '.err');
                clearstatcache(true, $part);
                $ok  = (int) $st['exitcode'] === 0 && is_file($part) && (int) filesize($part) > 4096 && xs_vp_is_video($part);
                $why = $said !== '' ? $said : 'ffmpeg ended with ' . (int) $st['exitcode'];
                $dest = $p['dest'];
                // Looked at again just before it is named: a video that came meanwhile stays, and so does another game's.
                if ($ok) {
                    $now = xs_vp_dest_now($s, $byId[(string) $p['game']['id']], $consoles[art_key((string) $p['game']['platform'])] ?? [], 'mp4', $whyNow, $hasNow);
                    if ($hasNow) {
                        @unlink($part);
                        // A twin counts only when it plays a video too; the others are asked for again.
                        $seen = 0;
                        foreach ($p['twins'] as $t) {
                            $tHas = false;
                            xs_vp_dest_now($s, $byId[(string) $t['id']], $consoles[art_key((string) $t['platform'])] ?? [], 'mp4', $tWhy, $tHas);
                            if ($tHas) {
                                $seen++;
                            } else {
                                $still[] = ['why' => 'a version of it got a video from elsewhere meanwhile, so another go is needed for this one'] + $t;
                            }
                        }
                        $job['added'] += 1 + $seen;
                        $gotToo += 1 + $seen;
                        xs_log('ARCV', $p['game']['title'] . ' (' . $p['game']['platform'] . '): it has a video now, so the cut was not kept');
                        continue;
                    }
                    if ($now === null) {
                        [$ok, $why] = [false, (string) $whyNow];
                    } elseif ($now !== $dest) {
                        // Filed under its own file's name: a twin found by the shared title does not find it, so it is asked for again.
                        foreach ($p['twins'] as $t) {
                            $still[] = ['why' => 'a version of it got a video under that version\'s own name, so another go is needed for this one'] + $t;
                        }
                        $p['twins'] = [];
                        $dest = $now;
                    }
                }
                if ($ok && !@rename($part, $dest)) {
                    [$ok, $why] = [false, 'it could not be given its name in ' . dirname($dest)];
                }
                if (!$ok) {
                    @unlink($part);
                    $fail($p, $why);
                    continue;
                }
                $cuts++;
                $job['added'] += 1 + count($p['twins']);
                $gotToo += count($p['twins']);
                clearstatcache(true, $dest);
                $done += (int) filesize($dest);
                xs_log('ARCV', $p['game']['title'] . ' (' . $p['game']['platform'] . '): the first 30 s of ' . $p['v']['id']
                    . ($p['who'] !== '' ? ', recorded by ' . $p['who'] : '') . ' (World of Longplays), ' . round((int) filesize($dest) / 1048576, 1) . ' MB');
            }
            $job['bytes'] = $done;
            $save(false);
            if ($stopped()) {
                $drop();
                $end('stopped', 'stopped: ' . $n($job['added'], 'video was', 'videos were') . ' fetched before that');
            }
            usleep(100000);
        }
    }
}

$job['bytes']   = $done;
$job['none']    = $listNone($still);
$job['hevc']    = $hevc;
$job['seconds'] = (int) round(microtime(true) - $t0);
$got  = $job['found'] - count($bad) + $cuts + $gotToo;
$left = count($still);
// Not found on every list for its console: left out of the next Start until Look again.
// A list that did not come, a failed fetch or cut, or no cutter proves nothing, so those are asked again.
$missedFor = static fn (string $p): bool => (bool) array_intersect_key(array_flip(array_column(xs_av_sets_for($p), 'id')), $missed);
$sure = array_values(array_filter($still, static fn ($g) => !empty($g['notFound']) && !$missedFor((string) $g['platform'])
    && (!xs_av_wol_for((string) $g['platform']) || !empty($g['wolLooked']))));
xs_av_remember_none($s, $library, $sure);
if ($sure) {
    xs_log('ARCV', count($sure) . ' of the ' . $left . ' with none kept as looked for with nothing found: the next Start leaves them out until Look again');
}
// What got none is said once in the mailbox, with the way on; a fetch that left none takes the old message away.
xs_av_tell($still);
$end('done', ($got === 0
    ? 'None of the ' . $n(count($games), 'game', 'games') . ' with no video has one on the online archives: nothing was fetched.'
    : $got . ' of ' . $n(count($games), 'game', 'games') . ' with no video got one from the online archives'
    . ' (' . round($done / 1048576) . ' MB in ' . $job['seconds'] . ' s'
    . ($cuts ? '; ' . $n($cuts, 'is', 'are') . ' the first 30 seconds of a World of Longplays playthrough' : '') . ').')
    . ($left ? ' ' . $left . ' got none: Get Media > Videos from online archives lists them.' : '')
    . ($hevc ? ' ' . $n($hevc, 'is', 'are') . ' H.265 video, which some PCs do not play.' : '') . $lists . $wolSaid);
