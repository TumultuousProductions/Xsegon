<?php
/**
 * Xsegon - the jobs at work in the background, in one answer for the corner
 * bars (js\jobbars.js).
 *
 * Each job keeps its own file and worker; this only reads them, so one read
 * serves every bar on a server that answers one request at a time. Get
 * Pictures, the Runs check and a setup download have bars of their own.
 * Make on the Fan projects page is one of these (includes\fanmake.php).
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** How long an ended job is still told of, so a page that was not looking says its ending once. */
const XS_JOBS_KEPT = 120;

/** The files the jobs here keep, by the key of each. */
function xs_jobs_files(): array
{
    return [
        'steamvid'      => xs_data_path('steamvid-job.json'),
        'screenscraper' => xs_data_path('screenscraper-job.json'),
        'emumove'       => xs_data_path('emumove-job.json'),
        'unpack'        => xs_data_path('unpack-job.json'),
        'videopack'     => xs_data_path('videopack-job.json'),
        'archivevid'    => xs_data_path('archivevid-job.json'),
        'arcadevid'     => xs_data_path('arcadevid-job.json'),
        'cheatlists'    => xs_data_path('cheatlists-job.json'),
        'texpacks'      => xs_data_path('texpacks-job.json'),
        'fanmake'       => xs_data_path('fanmake-job.json'),
    ];
}

/** A thumbnail build's file, one a kind of picture: api\thumbs.php starts it and bin\thumbs.ps1 keeps it. */
function xs_thumbs_job_path(string $kind): string
{
    return xs_data_path('thumbs-job-' . $kind . '.json');
}

/** A build that says running and was written in the last minute and a half: the builder writes every second it works. */
function xs_thumbs_job_alive($j, string $path): bool
{
    return is_array($j) && ($j['state'] ?? '') === 'running' && time() - (int) @filemtime($path) < 90;
}

/**
 * Whether any job is at work or has just ended, from the files alone: the
 * status look asks every few seconds and loads nothing else for it.
 */
function xs_jobs_any(): bool
{
    foreach (xs_glob(xs_data_dir(), 'thumbs-job-*.json') as $path) {
        if (time() - (int) @filemtime($path) < XS_JOBS_KEPT) {
            return true;
        }
    }
    foreach (xs_jobs_files() as $path) {
        if (!is_file($path)) {
            continue;
        }
        $age = time() - (int) @filemtime($path);
        if ($age < XS_JOBS_KEPT) {
            return true;
        }
        if ($age < 1800) {
            $j = xs_read_json($path, null);
            if (is_array($j) && (($j['state'] ?? '') === 'running' || ($j['running'] ?? false) === true)) {
                return true;
            }
        }
    }
    return false;
}

/** One job as the corner shows it. $frac is 0 to 1, or null while there is nothing to measure. */
function xs_jobs_row(string $key, string $name, string $state, int $started, string $line, ?float $frac, bool $stop, string $said): array
{
    return ['key' => $key, 'name' => $name, 'state' => $state, 'started' => $started, 'line' => $line,
            'frac' => $frac === null ? null : max(0.0, min(1.0, $frac)), 'stop' => $stop && $state === 'running', 'said' => $said];
}

function xs_jobs_size(int $bytes): string
{
    return $bytes >= 1073741824 ? round($bytes / 1073741824, 1) . ' GB' : round($bytes / 1048576) . ' MB';
}

/** Every job at work, and every one that ended in the last two minutes. */
function xs_jobs(): array
{
    $files = xs_jobs_files();
    $out   = [];
    $told  = static fn (string $path, string $state): bool
        => $state === 'running' || (is_file($path) && time() - (int) @filemtime($path) < XS_JOBS_KEPT);
    $n     = static fn (int $count, string $one, string $many): string => $count . ' ' . ($count === 1 ? $one : $many);

    // Steam trailers, and ScreenScraper's videos: a list of games, each waiting, at work or over.
    foreach ([['steamvid', 'steamvid.php', 'xs_steamvid_job', 'Steam trailers', 'trailer', 'trailers', 'Steam trailers saved', 'trailers stopped: '],
              ['screenscraper', 'screenscraper.php', 'xs_ss_job', 'ScreenScraper videos', 'video', 'videos', 'snaps saved from ScreenScraper', 'snaps stopped: ']] as $t) {
        if (!is_file($files[$t[0]])) {
            continue;
        }
        require_once __DIR__ . '/' . $t[1];
        $j = $t[2]();
        $state = (string) ($j['state'] ?? '');
        if (!is_array($j) || !$told($files[$t[0]], $state)) {
            continue;
        }
        $games = is_array($j['games'] ?? null) ? $j['games'] : [];
        $saved = count(array_filter($games, static fn ($g) => ($g['state'] ?? '') === 'done'));
        $over  = count(array_filter($games, static fn ($g) => !in_array($g['state'] ?? '', ['waiting', 'asking', 'fetching'], true)));
        $out[] = xs_jobs_row($t[0], $t[3], $state === 'running' ? 'running' : ($state === 'failed' ? 'failed' : 'done'),
            (int) ($j['started'] ?? 0),
            $over . ' of ' . $n(count($games), 'game', 'games') . ', ' . $n($saved, $t[4], $t[5]) . ' saved',
            $games ? $over / count($games) : 0.0, false,
            $state === 'failed' ? $t[7] . (string) ($j['error'] ?? '') : $saved . ' ' . $t[6]);
    }

    // Move out of LaunchBox: a copy measured in bytes.
    if (is_file($files['emumove'])) {
        require_once __DIR__ . '/emumove.php';
        $j = xs_emumove_job();
        $state = (string) ($j['state'] ?? '');
        if (is_array($j) && $told($files['emumove'], $state)) {
            $item  = (array) (($j['items'] ?? [])[(int) ($j['at'] ?? 0)] ?? []);
            $phase = (string) ($j['phase'] ?? '');
            $words = ['starting' => 'starting', 'measuring' => 'measuring the folders', 'copying' => 'copying', 'checking' => 'checking the copy',
                      'saves' => 'picking up the saves beside your games'][$phase] ?? 'working';
            $sized = in_array($phase, ['copying', 'checking'], true) && (int) ($j['total'] ?? 0) > 0;
            $out[] = xs_jobs_row('emumove', 'Move out of LaunchBox', $state === 'running' ? 'running' : ($state === 'done' ? 'done' : 'failed'),
                (int) ($j['started'] ?? 0),
                $sized ? $words . ' ' . (string) ($item['name'] ?? '') . ': ' . xs_jobs_size((int) ($j['bytes'] ?? 0)) . ' of ' . xs_jobs_size((int) $j['total']) : $words,
                $sized ? (int) ($j['bytes'] ?? 0) / (int) $j['total'] : null, true,
                (string) (($j['error'] ?? '') !== '' ? $j['error'] : (($j['said'] ?? '') !== '' ? $j['said'] : 'nothing was moved')));
        }
    }

    // Unpack and add: one archive in hand, the rest waiting their turn.
    if (is_file($files['unpack'])) {
        require_once __DIR__ . '/unpack.php';
        $st = xs_unpack_status();
        $state = (string) ($st['state'] ?? '');
        if ($told($files['unpack'], $state)) {
            $now   = is_array($st['now'] ?? null) ? $st['now'] : [];
            $phase = (string) ($now['phase'] ?? '');
            $ahead = count((array) ($st['waiting'] ?? []));
            $name  = basename((string) ($now['archive'] ?? ''));
            $measured = $phase === 'unpacking' && (int) ($now['total'] ?? 0) > 0;
            $line  = $measured ? $name . ': ' . xs_jobs_size((int) ($now['bytes'] ?? 0)) . ' of ' . xs_jobs_size((int) $now['total'])
                   : ($phase === 'looking' ? $name . ': reading its disc, to see which console it is for'
                   : ($phase === 'checking' ? $name . ': Windows Defender is checking it'
                   : ($phase === 'moving' ? $name . ': moving it to its console\'s folder'
                   : ($phase === 'adding' ? $name . ': adding it to the library' : ($name !== '' ? $name . ': starting' : 'starting')))));
            $out[] = xs_jobs_row('unpack', 'Unpacking', $state === 'running' ? 'running' : ($state === 'failed' ? 'failed' : 'done'),
                (int) (xs_unpack_job()['started'] ?? 0),
                $line . ($ahead ? ' (' . $ahead . ' waiting)' : ''),
                $measured ? (int) ($now['bytes'] ?? 0) / (int) $now['total'] : null, true,
                $state === 'failed' && ($st['error'] ?? '') !== '' ? (string) $st['error']
                    : xs_unpack_ending((array) ($st['results'] ?? [])));
        }
    }

    // A video package, made or imported: games matched by count, then videos copied by size.
    if (is_file($files['videopack'])) {
        require_once __DIR__ . '/videopack.php';
        $j = xs_vp_job();
        $state = (string) ($j['state'] ?? '');
        if (is_array($j) && $told($files['videopack'], $state)) {
            $make  = ($j['kind'] ?? '') === 'make';
            $phase = (string) ($j['phase'] ?? '');
            $sized = $phase === 'copying' && (int) ($j['total'] ?? 0) > 0;
            $line  = $sized ? ($make ? 'writing the package' : 'adding videos') . ': ' . xs_jobs_size((int) ($j['bytes'] ?? 0)) . ' of ' . xs_jobs_size((int) $j['total'])
                   : ($phase === 'matching' ? 'looking for videos: ' . (int) ($j['at'] ?? 0) . ' of ' . $n((int) ($j['games'] ?? 0), 'game', 'games')
                   : ($phase === 'reading' ? 'reading the ' . ($make ? 'list' : 'package') : 'starting'));
            $out[] = xs_jobs_row('videopack', $make ? 'Find videos' : 'Import videos', $state === 'running' ? 'running' : ($state === 'done' ? 'done' : 'failed'),
                (int) ($j['started'] ?? 0), $line,
                $sized ? (int) ($j['bytes'] ?? 0) / (int) $j['total']
                       : ($phase === 'matching' && (int) ($j['games'] ?? 0) > 0 ? (int) ($j['at'] ?? 0) / (int) $j['games'] : null), true,
                (string) (($j['error'] ?? '') !== '' ? $j['error'] : (($j['said'] ?? '') !== '' ? $j['said'] : 'nothing was done')));
        }
    }

    // Videos from the Internet Archive: its sets' lists by count, games matched by count, then videos fetched by size.
    if (is_file($files['archivevid'])) {
        require_once __DIR__ . '/archivevid.php';
        $j = xs_av_job();
        $state = (string) ($j['state'] ?? '');
        if (is_array($j) && $told($files['archivevid'], $state)) {
            $phase = (string) ($j['phase'] ?? '');
            $sized = $phase === 'fetching' && (int) ($j['total'] ?? 0) > 0;
            $line  = $sized ? 'fetching: ' . (int) ($j['added'] ?? 0) . ' of ' . $n((int) ($j['found'] ?? 0), 'video', 'videos') . ', '
                            . xs_jobs_size((int) ($j['bytes'] ?? 0)) . ' of ' . xs_jobs_size((int) $j['total'])
                   : ($phase === 'listing' ? 'asking the Archive what it has: ' . (int) ($j['setsAt'] ?? 0) . ' of ' . $n((int) ($j['sets'] ?? 0), 'set', 'sets')
                   : ($phase === 'matching' ? 'looking for videos: ' . (int) ($j['at'] ?? 0) . ' of ' . $n((int) ($j['games'] ?? 0), 'game', 'games')
                   : ($phase === 'playthroughs' ? 'asking World of Longplays what it has'
                   : ($phase === 'cutting' ? 'cutting playthroughs: ' . (int) ($j['cutAt'] ?? 0) . ' of ' . $n((int) ($j['cuts'] ?? 0), 'game', 'games') : 'starting'))));
            $frac  = $sized ? (int) ($j['bytes'] ?? 0) / (int) $j['total']
                   : ($phase === 'listing' && (int) ($j['sets'] ?? 0) > 0 ? (int) ($j['setsAt'] ?? 0) / (int) $j['sets']
                   : ($phase === 'matching' && (int) ($j['games'] ?? 0) > 0 ? (int) ($j['at'] ?? 0) / (int) $j['games']
                   : ($phase === 'cutting' && (int) ($j['cuts'] ?? 0) > 0 ? (int) ($j['cutAt'] ?? 0) / (int) $j['cuts'] : null)));
            $out[] = xs_jobs_row('archivevid', 'Videos from online archives', $state === 'running' ? 'running' : ($state === 'done' ? 'done' : 'failed'),
                (int) ($j['started'] ?? 0), $line, $frac, true,
                (string) (($j['error'] ?? '') !== '' ? $j['error'] : (($j['said'] ?? '') !== '' ? $j['said'] : 'nothing was fetched')));
        }
    }

    // Videos from the Arcade Database: a game at a time, asked about and then fetched, so by count.
    if (is_file($files['arcadevid'])) {
        require_once __DIR__ . '/arcadevid.php';
        $j = xs_ad_job();
        $state = (string) ($j['state'] ?? '');
        if (is_array($j) && $told($files['arcadevid'], $state)) {
            $phase = (string) ($j['phase'] ?? '');
            $games = (int) ($j['games'] ?? 0);
            $line  = $phase === 'fetching' ? (int) ($j['at'] ?? 0) . ' of ' . $n($games, 'game', 'games') . ', ' . $n((int) ($j['added'] ?? 0), 'video', 'videos') . ' in'
                                             . ((string) ($j['now'] ?? '') !== '' ? ': ' . $j['now'] : '')
                   : ($phase === 'asking' ? 'asking the Arcade Database whether it is there' : 'starting');
            $out[] = xs_jobs_row('arcadevid', 'Arcade Database videos', $state === 'running' ? 'running' : ($state === 'done' ? 'done' : 'failed'),
                (int) ($j['started'] ?? 0), $line, $phase === 'fetching' && $games > 0 ? (int) ($j['at'] ?? 0) / $games : null, true,
                (string) (($j['error'] ?? '') !== '' ? $j['error'] : (($j['said'] ?? '') !== '' ? $j['said'] : 'nothing was fetched')));
        }
    }

    // The cheat lists: one .zip fetched by size, then unpacked by count.
    if (is_file($files['cheatlists'])) {
        require_once __DIR__ . '/cheatlists.php';
        $j = xs_cl_job();
        $state = (string) ($j['state'] ?? '');
        if (is_array($j) && $told($files['cheatlists'], $state)) {
            $phase = (string) ($j['phase'] ?? '');
            $total = (int) ($j['total'] ?? 0);
            $mb    = static fn (int $bytes): string => round($bytes / 1048576, 1) . ' MB';
            $line  = $phase === 'unpacking' ? 'unpacking: ' . number_format((int) ($j['at'] ?? 0)) . ' of ' . number_format((int) ($j['files'] ?? 0)) . ' cheat files'
                   : ($phase === 'fetching' ? 'downloading: ' . $mb((int) ($j['bytes'] ?? 0)) . ($total ? ' of ' . $mb($total) : '') : 'starting');
            $frac  = $phase === 'unpacking' ? ((int) ($j['files'] ?? 0) > 0 ? (int) ($j['at'] ?? 0) / (int) $j['files'] : null)
                   : ($phase === 'fetching' && $total > 0 ? (int) ($j['bytes'] ?? 0) / $total : null);
            $out[] = xs_jobs_row('cheatlists', 'Cheat lists', $state === 'running' ? 'running' : ($state === 'done' ? 'done' : 'failed'),
                (int) ($j['started'] ?? 0), $line, $frac, true,
                (string) (($j['error'] ?? '') !== '' ? $j['error'] : (($j['said'] ?? '') !== '' ? $j['said'] : 'nothing was fetched')));
        }
    }

    // A game's texture pack: unpacked or copied by size, then put in place; taken away by count, with no Stop.
    if (is_file($files['texpacks'])) {
        require_once __DIR__ . '/texpacks.php';
        $j = xs_tp_job();
        $state = (string) ($j['state'] ?? '');
        if (is_array($j) && $told($files['texpacks'], $state)) {
            $phase = (string) ($j['phase'] ?? '');
            $total = (int) ($j['total'] ?? 0);
            $count = (int) ($j['files'] ?? 0);          // not $files: that is every job's file, read by the blocks after this one
            $sized = ($phase === 'unpacking' || $phase === 'copying' || $phase === 'fetching') && $total > 0;
            $line  = $sized ? ($phase === 'fetching' ? 'downloading' : $phase) . ': ' . xs_jobs_size((int) ($j['bytes'] ?? 0)) . ' of ' . xs_jobs_size($total)
                   : ($phase === 'fetching' ? 'downloading: ' . xs_jobs_size((int) ($j['bytes'] ?? 0))
                   : ($phase === 'removing' ? 'uninstalling: ' . number_format((int) ($j['at'] ?? 0)) . ' of ' . $n($count, 'file', 'files')
                   : ($phase === 'reading' ? 'reading what is in it' : ($phase === 'placing' || $phase === 'setting' || $phase === 'tidying' ? 'putting it in place' : 'starting'))));
            $frac  = $sized ? (int) ($j['bytes'] ?? 0) / $total : ($phase === 'removing' && $count > 0 ? (int) ($j['at'] ?? 0) / $count : null);
            $out[] = xs_jobs_row('texpacks', 'Texture pack for ' . (string) ($j['title'] ?? 'a game'), $state === 'running' ? 'running' : ($state === 'done' ? 'done' : 'failed'),
                (int) ($j['started'] ?? 0), $line, $frac, ($j['action'] ?? '') !== 'remove',
                (string) (($j['error'] ?? '') !== '' ? $j['error'] : (($j['said'] ?? '') !== '' ? $j['said'] : 'nothing was done')));
        }
    }

    // Make on the Fan projects page: the team's list asked, the patch fetched by size, the copy made by how much of the patch is read.
    if (is_file($files['fanmake'])) {
        require_once __DIR__ . '/fanmake.php';
        $j = xs_fm_job();
        $state = (string) ($j['state'] ?? '');
        if (is_array($j) && $told($files['fanmake'], $state)) {
            $phase = (string) ($j['phase'] ?? '');
            $total = (int) ($j['total'] ?? 0);
            $line  = $phase === 'fetching' ? 'downloading ' . (isset($j['file']) ? (string) $j['file'] : 'the patch') . ': '
                                             . xs_jobs_size((int) ($j['bytes'] ?? 0)) . ($total ? ' of ' . xs_jobs_size($total) : '')
                   : ($phase === 'asking' ? 'asking ' . $j['name'] . '\'s team for its latest release'
                   : ($phase === 'reading' ? 'reading your ' . (string) ($j['baseTitle'] ?? 'game')
                   : ($phase === 'making' ? 'making ' . trim($j['name'] . ' ' . (string) ($j['version'] ?? ''))
                   : ($phase === 'checking' ? 'Windows Defender is checking ' . (isset($j['file']) ? (string) $j['file'] : 'the download')
                   : ($phase === 'building' ? 'building it with the team\'s own build line'
                   : ($phase === 'updating' ? 'putting on update ' . (string) ($j['version'] ?? '')
                   : ($phase === 'unpacking' ? 'unpacking it beside your ' . (string) ($j['platform'] ?? '') . ' games'
                   : ($phase === 'placing' ? 'putting your ' . (string) ($j['baseTitle'] ?? 'game') . ' in its folder' . ($total ? ': ' . xs_jobs_size((int) ($j['bytes'] ?? 0)) . ' of ' . xs_jobs_size($total) : '')
                   : ($phase === 'writing' ? 'writing it to your games' : ($phase === 'adding' ? 'adding it to your library' : 'starting'))))))))));
            $frac  = ($phase === 'fetching' || $phase === 'placing') && $total > 0 ? (int) ($j['bytes'] ?? 0) / $total
                   : ($phase === 'making' && (int) ($j['of'] ?? 0) > 0 ? (int) ($j['at'] ?? 0) / (int) $j['of'] : null);
            $out[] = xs_jobs_row('fanmake', 'Make ' . (string) ($j['name'] ?? 'a fan project'), $state === 'running' ? 'running' : ($state === 'done' ? 'done' : 'failed'),
                (int) ($j['started'] ?? 0), $line, $frac, true,
                (string) (($j['error'] ?? '') !== '' ? $j['error'] : (($j['said'] ?? '') !== '' ? $j['said'] : 'nothing was made')));
        }
    }

    // Thumbnails: a builder for each kind of picture, told as one job. One that says running and has gone quiet died.
    $builds = [];
    foreach (xs_glob(xs_data_dir(), 'thumbs-job-*.json') as $path) {
        $j = xs_read_json($path, null);
        if (!is_array($j) || time() - (int) @filemtime($path) >= XS_JOBS_KEPT) {
            continue;
        }
        if (($j['state'] ?? '') === 'running' && !xs_thumbs_job_alive($j, $path)) {
            $j = ['state' => 'failed', 'error' => 'the builder stopped without a word'] + $j;
            xs_write_json($path, $j);                  // the file holds the ending now, so this is said once
            xs_log('THM', 'the ' . (string) ($j['kind'] ?? '?') . ' build went quiet at ' . (int) ($j['done'] ?? 0) . ' of '
                . (int) ($j['total'] ?? 0) . ' and is taken as stopped');
        }
        $builds[] = $j;
    }
    if ($builds) {
        $sum    = static fn (string $k): int => (int) array_sum(array_map(static fn ($b) => (int) ($b[$k] ?? 0), $builds));
        $states = array_column($builds, 'state');
        $state  = in_array('running', $states, true) ? 'running' : (in_array('failed', $states, true) ? 'failed' : 'done');
        $total  = $sum('total');
        $built  = $sum('built');
        $fail   = $sum('failed');
        $why    = implode('; ', array_unique(array_filter(array_map(static fn ($b) => ($b['state'] ?? '') === 'failed' ? (string) ($b['error'] ?? '') : '', $builds))));
        $out[] = xs_jobs_row('thumbs', 'Thumbnails', $state, (int) max(array_map(static fn ($b) => (int) ($b['started'] ?? 0), $builds)),
            $sum('done') . ' of ' . $n($total, 'picture', 'pictures'), $total ? $sum('done') / $total : null, false,
            $state === 'failed' ? 'The thumbnail build stopped: ' . ($why !== '' ? $why : 'no reason written')
                : 'Thumbnails are built: ' . $built . ' new, ' . max(0, $total - $built - $fail) . ' already there'
                  . ($fail ? ', ' . $n($fail, 'picture', 'pictures') . ' could not be read' : ''));
    }
    return $out;
}

/** Asks a job to stop, the way its own window does. False for one that cannot be stopped. */
function xs_jobs_stop(string $key): bool
{
    if ($key === 'emumove') {
        require_once __DIR__ . '/emumove.php';
        if ((xs_emumove_job()['state'] ?? '') === 'running') {
            @touch(xs_emumove_stop_path());
            xs_log('EMUM', 'asked to stop after the file in hand (the corner bar)');
        }
        return true;
    }
    if ($key === 'unpack') {
        require_once __DIR__ . '/unpack.php';
        @touch(xs_unpack_stop_path());
        xs_log('UNPK', 'told to stop (the corner bar)');
        return true;
    }
    if ($key === 'videopack') {
        require_once __DIR__ . '/videopack.php';
        if ((xs_vp_job()['state'] ?? '') === 'running') {
            @touch(xs_vp_stop_path());
            xs_log('VPK', 'asked to stop after the file in hand (the corner bar)');
        }
        return true;
    }
    if ($key === 'archivevid') {
        require_once __DIR__ . '/archivevid.php';
        if ((xs_av_job()['state'] ?? '') === 'running') {
            @touch(xs_av_stop_path());
            xs_log('ARCV', 'asked to stop, keeping the videos that have come (the corner bar)');
        }
        return true;
    }
    if ($key === 'arcadevid') {
        require_once __DIR__ . '/arcadevid.php';
        if ((xs_ad_job()['state'] ?? '') === 'running') {
            @touch(xs_ad_stop_path());
            xs_log('ARCD', 'asked to stop, keeping the videos that have come (the corner bar)');
        }
        return true;
    }
    if ($key === 'cheatlists') {
        require_once __DIR__ . '/cheatlists.php';
        if ((xs_cl_job()['state'] ?? '') === 'running') {
            @touch(xs_cl_stop_path());
            xs_log('CHTL', 'asked to stop (the corner bar)');
        }
        return true;
    }
    if ($key === 'fanmake') {
        require_once __DIR__ . '/fanmake.php';
        if ((xs_fm_job()['state'] ?? '') === 'running') {
            @touch(xs_fm_stop_path());
            xs_log('FAN', 'make asked to stop: nothing is kept (the corner bar)');
        }
        return true;
    }
    if ($key === 'texpacks') {
        require_once __DIR__ . '/texpacks.php';
        $j = xs_tp_job();
        if (($j['state'] ?? '') === 'running' && ($j['action'] ?? '') !== 'remove') {
            @touch(xs_tp_stop_path());
            xs_log('TPAK', 'asked to stop: nothing is put in place (the corner bar)');
        }
        return true;
    }
    return false;
}
