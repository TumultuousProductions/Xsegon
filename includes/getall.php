<?php
/**
 * Xsegon - Get Media > Get Everything (roadmap BL2): one press that fetches what the games
 * lack from every source, each as its own job with its own corner bar.
 *
 *     data\getall-job.json    the parts the press started, and the ScreenScraper pass
 *
 * The free sources start together at the press: Get Pictures, Steam trailers, Videos from online
 * archives (the Arcade Database first for arcade games) and Manuals from online archives. With a
 * ScreenScraper account each kind may come from ScreenScraper too (library.getPictures, getVideos,
 * getManuals): one pass for every kind, a game's video, manual and cover in one answer. When it fills
 * what the free sources leave, bin\getall.php starts it once they are through, so the day's allowance
 * goes on the rest; with nothing to wait for it starts at the press.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/fill.php';
require_once __DIR__ . '/steamvid.php';
require_once __DIR__ . '/archivevid.php';
require_once __DIR__ . '/archivedoc.php';
require_once __DIR__ . '/screenscraper.php';

/** free-ss: the free sources, then ScreenScraper for the rest; free; ss: ScreenScraper alone. */
const XS_GA_WAYS = ['free-ss', 'free', 'ss'];
/** Each kind and the setting that says where it comes from. */
const XS_GA_KINDS = ['pictures' => 'getPictures', 'videos' => 'getVideos', 'manuals' => 'getManuals'];

function xs_ga_job_path(): string
{
    return xs_data_path('getall-job.json');
}

/** Touched by Stop: the wait ends and ScreenScraper is not asked. */
function xs_ga_stop_path(): string
{
    return xs_data_path('getall-stop');
}

/** Whether a ScreenScraper member login is stored: the choices are offered only then. */
function xs_ga_account(): bool
{
    $a = xs_ss_account();
    return $a['user'] !== '' && $a['password'] !== '';
}

/** Where each kind comes from: the person's choice with an account, the free sources without one. */
function xs_ga_ways(array $s): array
{
    $acc = xs_ga_account();
    $out = [];
    foreach (XS_GA_KINDS as $kind => $key) {
        $way = (string) ($s['library'][$key] ?? 'free-ss');
        $out[$kind] = !$acc ? 'free' : (in_array($way, XS_GA_WAYS, true) ? $way : 'free-ss');
    }
    return $out;
}

/** Whether a part's own job is at work now. */
function xs_ga_running(string $key): bool
{
    return match ($key) {
        'fill'          => xs_fill_running(),
        'steamvid'      => (xs_steamvid_job()['state'] ?? '') === 'running',
        'archivevid'    => (xs_av_job()['state'] ?? '') === 'running',
        'archivedoc'    => (xs_ma_job()['state'] ?? '') === 'running',
        'screenscraper' => (xs_ss_job()['state'] ?? '') === 'running',
        default         => false,
    };
}

/** Why a part's own job stopped, or '' when it ended well. */
function xs_ga_fault(string $key): string
{
    $job = match ($key) {
        'fill'          => xs_fill_job(),
        'steamvid'      => xs_steamvid_job(),
        'archivevid'    => xs_av_job(),
        'archivedoc'    => xs_ma_job(),
        'screenscraper' => xs_ss_job(),
        default         => null,
    };
    return ($job['state'] ?? '') === 'failed' ? (string) ($job['error'] ?? 'no reason written') : '';
}

/** "a", "a and b", "a, b and c". */
function xs_ga_list(array $words): string
{
    $last = array_pop($words);
    return $words ? implode(', ', $words) . ' and ' . $last : (string) $last;
}

/** A part as the job keeps it: its state is started, running (at work before the press), skipped or failed. */
function xs_ga_part(string $key, string $kind, string $label, string $state, string $said = ''): array
{
    return ['key' => $key, 'kind' => $kind, 'label' => $label, 'state' => $state, 'said' => $said];
}

/**
 * Every free source for the kinds that use one, each started unless it is at work already or has
 * nothing to do. $dry starts nothing.
 */
function xs_ga_free(array $s, array $lib, array $ways, bool $dry): array
{
    $parts = [];
    $go = static function (string $key, string $kind, string $label, bool $busy, string $none, callable $start) use (&$parts, $dry): void {
        if ($busy) {
            $parts[] = xs_ga_part($key, $kind, $label, 'running', 'at work already');
        } elseif ($none !== '') {
            $parts[] = xs_ga_part($key, $kind, $label, 'skipped', $none);
        } elseif ($dry || $start($why)) {
            $parts[] = xs_ga_part($key, $kind, $label, 'started');
        } else {
            $parts[] = xs_ga_part($key, $kind, $label, 'failed', (string) $why);
        }
    };
    if ($ways['pictures'] !== 'ss') {
        // Get Pictures looks up the scanned games; it is started when one of them has no cover.
        $bare = array_filter(xs_fill_scope($lib['games'] ?? []), static fn ($g) => ($g['art']['box'] ?? null) === null);
        $go('fill', 'pictures', 'Get Pictures', xs_fill_running(), $bare ? '' : 'every game it looks up has a cover',
            static fn (&$why) => xs_fill_start(['mode' => 'all', 'picks' => [], 'only' => [], 'pictures_wanted' => true, 'complete' => false, 'dry' => false], $why));
    }
    if ($ways['videos'] !== 'ss') {
        $plan = xs_steamvid_plan($s, $lib, null);
        $go('steamvid', 'videos', 'Steam trailers', (xs_steamvid_job()['state'] ?? '') === 'running', $plan ? '' : 'every Steam game has a video, or Steam had no trailer when asked before',
            static fn (&$why) => xs_steamvid_start($plan, $why));
        $consoles = array_column(array_filter(xs_av_need($s, $lib), static fn ($r) => $r['sets'] > 0 || $r['wol']), 'platform');
        $go('archivevid', 'videos', 'Videos from online archives', (xs_av_job()['state'] ?? '') === 'running',
            $consoles ? '' : 'no game without a video is left that they could have, or each was looked for before',
            static fn (&$why) => xs_av_start($consoles, $why));
    }
    if ($ways['manuals'] !== 'ss') {
        $consoles = array_column(array_filter(xs_ma_consoles($lib), static fn ($r) => $r['sets'] > 0), 'platform');
        $go('archivedoc', 'manuals', 'Manuals from online archives', (xs_ma_job()['state'] ?? '') === 'running',
            $consoles ? '' : 'no game without a manual is left that they could have, or each was looked for before',
            static fn (&$why) => xs_ma_start($consoles, $why));
    }
    return $parts;
}

/**
 * The ScreenScraper pass for what is still missing, the library read as it is now:
 * ['state' => started | skipped | failed, 'said', 'games' => how many it asks about]. $stopped, when
 * given, is asked right before ScreenScraper is: true leaves it unasked.
 */
function xs_ga_ss(array $s, array $lib, array $kinds, array $ways, bool $dry = false, ?callable $stopped = null): array
{
    $games = xs_ss_plan_games($s, $lib, $kinds['video'] ? null : [], $kinds['manual'], $ways['manuals'] !== 'ss', $kinds['box']);
    if (!$games) {
        return ['state' => 'skipped', 'said' => 'nothing was left for it to look for', 'games' => 0];
    }
    if ($dry) {
        return ['state' => 'started', 'said' => '', 'games' => count($games)];
    }
    $fail = static fn (string $why): array => ['state' => 'failed', 'said' => $why, 'games' => count($games)];
    if ((xs_ss_job()['state'] ?? '') === 'running') {
        return $fail('ScreenScraper videos was fetching already');
    }
    // A pass counts toward the website's daily limit as a Fetch does.
    $use = xs_ss_account_in_use(true, $devWhy, 'fetch');
    if ($use['user'] === '' || $use['password'] === '') {
        return $fail('the ScreenScraper logins are not filled in');
    }
    if (!xs_ss_ready($use)) {
        return $fail((string) $devWhy);
    }
    if ($stopped !== null && $stopped()) {
        return $fail('stopped before ScreenScraper was asked');
    }
    if (!xs_ss_start(xs_ss_plan($games, $kinds['manual'], $kinds['box']), $use, $why)) {
        return $fail((string) $why);
    }
    return ['state' => 'started', 'said' => '', 'games' => count($games)];
}

/**
 * What a press of Start begins: every free source at once, and the ScreenScraper pass now, or by
 * bin\getall.php once the free sources it follows are through. The job, or null with $why (at
 * work already, or nothing to fetch). $dry: what would start, nothing started or written.
 */
function xs_ga_start(array $s, array $lib, ?string &$why = null, bool $dry = false): ?array
{
    $why = null;
    if ((xs_ga_job()['state'] ?? '') === 'running') {
        $why = 'Get everything missing is at work already: the bars in the corner show how far it is';
        return null;
    }
    $ways  = xs_ga_ways($s);
    $parts = xs_ga_free($s, $lib, $ways, $dry);
    $kinds = ['box' => $ways['pictures'] !== 'free', 'video' => $ways['videos'] !== 'free', 'manual' => $ways['manuals'] !== 'free'];
    $ss    = null;
    if (array_filter($kinds)) {
        // It waits for the free parts of the kinds it follows, and for a fetch of its own at work already.
        $wait = array_values(array_map(static fn ($p) => $p['key'], array_filter($parts,
            static fn ($p) => $ways[$p['kind']] === 'free-ss' && in_array($p['state'], ['started', 'running'], true))));
        if ((xs_ss_job()['state'] ?? '') === 'running') {
            $wait[] = 'screenscraper';
        }
        $ss = ['key' => 'screenscraper', 'label' => 'ScreenScraper', 'kinds' => $kinds, 'waitOn' => $wait]
            + ($wait ? ['state' => 'waiting', 'said' => '', 'games' => 0] : xs_ga_ss($s, $lib, $kinds, $ways, $dry));
    }
    $busy = array_filter($parts, static fn ($p) => in_array($p['state'], ['started', 'running'], true));
    if (!$busy && !in_array($ss['state'] ?? '', ['started', 'waiting'], true)) {
        $said = array_map(static fn ($p) => $p['label'] . ': ' . $p['said'], array_merge($parts, $ss ? [$ss] : []));
        $why  = 'nothing to fetch. ' . implode('; ', $said);
        return null;
    }
    $job = ['state' => 'running', 'started' => time(), 'ways' => $ways, 'parts' => $parts, 'ss' => $ss];
    if ($dry) {
        return $job;
    }
    @unlink(xs_ga_stop_path());
    if (!xs_write_json(xs_ga_job_path(), $job, $why)) {
        return null;
    }
    if (($ss['state'] ?? '') === 'waiting' && !xs_spawn_worker('getall.php')) {
        $job['ss'] = ['state' => 'failed', 'said' => 'the wait for the free sources could not be started'] + $ss;
        xs_write_json(xs_ga_job_path(), $job);
    }
    $words = static fn (array $ps, string $state): array => array_map(static fn ($p) => $p['label'], array_filter($ps, static fn ($p) => $p['state'] === $state));
    xs_log('GALL', 'started ' . (xs_ga_list($words($parts, 'started')) ?: 'no free source')
        . (($w = $words($parts, 'running')) ? '; at work already: ' . xs_ga_list($w) : '')
        . (($w = $words($parts, 'skipped')) ? '; nothing to do for ' . xs_ga_list($w) : '')
        . (($w = $words($parts, 'failed')) ? '; could not start ' . xs_ga_list($w) : '')
        . ($ss === null ? '; no ScreenScraper' : '; ScreenScraper for ' . xs_ga_list(array_keys(array_filter(['covers' => $kinds['box'], 'videos' => $kinds['video'], 'manuals' => $kinds['manual']]))) . ': '
            . ($job['ss']['state'] === 'waiting' ? 'after ' . implode(', ', $ss['waitOn']) : $job['ss']['state'] . ($job['ss']['said'] !== '' ? ' (' . $job['ss']['said'] . ')' : ''))));
    return $job;
}

/**
 * The job as the corner sees it. It is at work while the pass waits or any part is; the first read
 * after that writes its ending, once.
 */
function xs_ga_job(): ?array
{
    $job = xs_read_json_settled(xs_ga_job_path(), null);
    if (!is_array($job) || ($job['state'] ?? '') !== 'running') {
        return is_array($job) ? $job : null;
    }
    if (($job['ss']['state'] ?? '') === 'waiting' && ($dead = xs_job_dead($job, xs_ga_job_path())) !== null) {
        $job['ss']['state'] = 'failed';
        $job['ss']['said']  = 'the wait for the free sources stopped (' . $dead . '), so ScreenScraper was not asked';
    }
    $all  = array_merge($job['parts'] ?? [], $job['ss'] ? [$job['ss']] : []);
    $busy = ($job['ss']['state'] ?? '') === 'waiting';
    foreach ($all as $p) {
        if (in_array($p['state'], ['started', 'running'], true) && xs_ga_running($p['key'])) {
            $busy = true;
        }
    }
    if ($busy) {
        return $job;
    }
    // Each part's own bar says what came; this says which ran, and why one stopped.
    $through = $faults = [];
    foreach ($all as $p) {
        if (!in_array($p['state'], ['started', 'running'], true)) {
            if ($p['state'] === 'failed') {
                $faults[] = $p['label'] . ' did not start: ' . $p['said'];
            }
            continue;
        }
        $fault = xs_ga_fault($p['key']);
        if ($fault !== '') {
            $faults[] = $p['label'] . ' stopped: ' . $fault;
        } else {
            $through[] = $p['label'];
        }
    }
    $job['state'] = 'done';
    $job['ended'] = time();
    $job['said']  = !empty($job['stopped']) ? 'Stopped: what came is kept'
        : ($through ? xs_ga_list($through) . (count($through) === 1 ? ' is' : ' are') . ' through, and each bar says what came' : 'Nothing was fetched')
        . ($faults ? '. ' . implode('. ', $faults) : '');
    xs_write_json(xs_ga_job_path(), $job);
    xs_log('GALL', 'ended: ' . $job['said']);
    return $job;
}

/** Stop: the wait, and every part whose window can stop it (Steam trailers and ScreenScraper run to their end). */
function xs_ga_stop(): void
{
    $job = xs_read_json(xs_ga_job_path(), null);
    if (!is_array($job) || ($job['state'] ?? '') !== 'running') {
        return;
    }
    @touch(xs_ga_stop_path());
    require_once __DIR__ . '/jobs.php';
    foreach ($job['parts'] ?? [] as $p) {
        // Only what this press started: a part at work before it, or one it skipped (maybe started by hand since), is left alone.
        if (($p['state'] ?? '') !== 'started') {
            continue;
        }
        if ($p['key'] === 'fill' && xs_fill_running()) {
            @touch(xs_fill_stop_path());
        } elseif (in_array($p['key'], ['archivevid', 'archivedoc'], true)) {
            xs_jobs_stop($p['key']);
        }
    }
    $job['stopped'] = true;
    if (($job['ss']['state'] ?? '') === 'waiting') {
        $job['ss']['state'] = 'failed';
        $job['ss']['said']  = 'stopped before ScreenScraper was asked';
    }
    xs_write_json(xs_ga_job_path(), $job);
    xs_log('GALL', 'asked to stop (the corner bar): what has come is kept');
}
