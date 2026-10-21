<?php
/**
 * Xsegon - one game's pictures, video or manual from every place, side by side: the compare in the
 * Media tab of a game's details (js\mediacompare.js, roadmap BM).
 *
 *     data\mediachoice\<ticket>\job.json     what each place has, as the places answer (bin\mediachoice.php)
 *     data\mediachoice\<ticket>\ss.json      ScreenScraper's part (bin\screenscraper.ps1, its look)
 *     data\mediachoice\<ticket>\prep-*.json  a video or manual being brought down to be seen and used
 *     data\mediachoice\<ticket>\before.json  what each kind was before a press, for Put back the one before
 *
 * Every place is asked when a compare opens and nothing is kept for the next one. A ticket's folder
 * is deleted when its compare closes, and one a closed page left behind once nothing has asked it for
 * twelve hours. ScreenScraper's logins never leave
 * bin\screenscraper.ps1: its addresses are written here with them taken out.
 */
declare(strict_types=1);

require_once __DIR__ . '/import.php';
require_once __DIR__ . '/video.php';
require_once __DIR__ . '/extras.php';
require_once __DIR__ . '/gamesdb.php';
require_once __DIR__ . '/libretro.php';
require_once __DIR__ . '/steam.php';
require_once __DIR__ . '/steamvid.php';
require_once __DIR__ . '/archivevid.php';
require_once __DIR__ . '/archivedoc.php';
require_once __DIR__ . '/arcadevid.php';
require_once __DIR__ . '/videomatch.php';
require_once __DIR__ . '/curlmany.php';
require_once __DIR__ . '/screenscraper.php';

const XS_MC_PLACES = ['ss' => 'ScreenScraper', 'gamesdb' => 'Games Database', 'libretro' => 'libretro', 'steam' => 'Steam',
                      'archive' => 'Internet Archive', 'arcadedb' => 'Arcade Database'];
/** ScreenScraper's names for each kind, the better first. */
const XS_MC_SS_TYPES = ['box' => ['box-2D'], 'box3d' => ['box-3D'], 'logo' => ['wheel-hd', 'wheel'], 'shot' => ['ss'],
                        'fanart' => ['fanart'], 'video' => ['video-normalized', 'video'], 'manual' => ['manuel']];
/** ScreenScraper's regions in words, and the order they are shown in after the game's own. */
const XS_MC_REGIONS = ['us' => 'USA', 'wor' => 'World', 'eu' => 'Europe', 'uk' => 'UK', 'au' => 'Australia', 'ca' => 'Canada',
                       'ss' => "ScreenScraper's own", 'jp' => 'Japan', 'fr' => 'France', 'de' => 'Germany', 'sp' => 'Spain',
                       'it' => 'Italy', 'nl' => 'Netherlands', 'se' => 'Sweden', 'br' => 'Brazil', 'kr' => 'Korea', 'cn' => 'China'];
/** At most this many of one kind from one place: a compare is for choosing, not for every scan ever made. */
const XS_MC_MAX = 12;

function xs_mc_group(string $kind): string
{
    return $kind === 'video' ? 'videos' : ($kind === 'manual' ? 'manuals' : 'pictures');
}

/** Every kind a compare is for: the picture slots, the video and the manual. */
function xs_mc_kinds(): array
{
    return array_merge(array_keys(xs_own_art_kinds()), ['video', 'manual']);
}

/** The game's file name, as the matchers want it. */
function xs_mc_file(array $g): string
{
    return basename(str_replace('\\', '/', (string) ($g['romPath'] ?? '')));
}

/**
 * The places that can have this kind for this game: [place => ''], or [place => why it cannot be asked
 * now] for one listed with a note (ScreenScraper with no login). Only places that fit are listed at all.
 */
function xs_mc_fits(array $g, string $kind): array
{
    $platform = (string) ($g['platform'] ?? '');
    $steam    = (string) ($g['steam']['id'] ?? '');
    $ss       = xs_ss_system($platform) > 0;
    $out      = [];
    if ($kind === 'video') {
        if ($ss) { $out['ss'] = ''; }
        if (xs_av_sets_for($platform)) { $out['archive'] = ''; }
        if (xs_ad_is_arcade($platform) && xs_ad_name(xs_mc_file($g)) !== null) { $out['arcadedb'] = ''; }
        if ($steam !== '') { $out['steam'] = ''; }
    } elseif ($kind === 'manual') {
        if (xs_ma_sets_for($platform)) { $out['archive'] = ''; }
        if ($ss) { $out['ss'] = ''; }
    } else {
        if ($ss) { $out['ss'] = ''; }
        if (xs_gamesdb_ready()) { $out['gamesdb'] = ''; }
        if ($kind !== 'box3d' && xs_lr_system($platform) !== null) { $out['libretro'] = ''; }
        if ($steam !== '' && $kind !== 'box3d') { $out['steam'] = ''; }
    }
    if (isset($out['ss']) && !xs_ss_ready(xs_ss_account_in_use())) {
        $out['ss'] = 'needs a free ScreenScraper account: Get Media > ScreenScraper videos';
    }
    return $out;
}

/** The places for a kind in the person's order: [['key', 'name', 'on', 'note']]. */
function xs_mc_places(array $s, array $g, string $kind): array
{
    $group = xs_mc_group($kind);
    // library.look: each group's places in the person's order, and the ones turned off as "group:place".
    $look  = (array) ($s['library']['look'] ?? []);
    $order = array_values(array_filter((array) ($look[$group] ?? []), 'is_string'));
    $off   = array_values(array_filter((array) ($look['off'] ?? []), 'is_string'));
    $fits  = xs_mc_fits($g, $kind);
    $keys  = array_keys($fits);
    $at    = static fn (string $k): int => ($i = array_search($k, $order, true)) === false ? 99 : (int) $i;
    usort($keys, static fn ($a, $b) => $at($a) <=> $at($b));
    return array_map(static fn ($k) => ['key' => $k, 'name' => XS_MC_PLACES[$k], 'on' => !in_array($group . ':' . $k, $off, true),
                                        'note' => $fits[$k]], $keys);
}

// ---- the ticket's folder -------------------------------------------------------

function xs_mc_root(): string
{
    return xs_data_path('mediachoice');
}

function xs_mc_ticket_ok(string $t): bool
{
    return preg_match('/^[a-f0-9]{16}$/D', $t) === 1;
}

function xs_mc_dir(string $t): string
{
    return xs_mc_root() . DIRECTORY_SEPARATOR . $t;
}

function xs_mc_path(string $t, string $file): string
{
    return xs_mc_dir($t) . DIRECTORY_SEPARATOR . $file;
}

/** A file of a ticket's folder by its own name only: letters, digits, dots, dashes. */
function xs_mc_file_ok(string $name): bool
{
    return preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/', $name) === 1 && !str_contains($name, '..');
}

/** Where the page sees a file of the ticket. */
function xs_mc_view(string $t, string $file): string
{
    return 'api/mediachoice.php?ticket=' . $t . '&file=' . rawurlencode($file);
}

function xs_mc_remove(string $t): bool
{
    if (!xs_mc_ticket_ok($t)) {
        return false;
    }
    $dir = xs_mc_dir($t);
    // Its notes first: a download still coming sees its prep file gone and stops (bin\mediachoice.php).
    $files = array_diff(@scandir($dir) ?: [], ['.', '..']);
    usort($files, static fn ($a, $b) => (int) !str_ends_with($a, '.json') <=> (int) !str_ends_with($b, '.json'));
    foreach ($files as $f) {
        @unlink($dir . DIRECTORY_SEPARATOR . $f);
    }
    return !is_dir($dir) || @rmdir($dir);
}

/** A compare still in use: every read and press marks it, so the sweep leaves it. A file of its own: job.json's age tells a dead worker. */
function xs_mc_touch(string $t): void
{
    @touch(xs_mc_path($t, 'seen.json'));
}

/** The folders a closed page left behind, once nothing has asked them for twelve hours: nothing is kept for another day. */
function xs_mc_sweep(): void
{
    foreach (@scandir(xs_mc_root()) ?: [] as $t) {
        if (!xs_mc_ticket_ok($t)) {
            continue;
        }
        $newest = 0;
        // Not . and ..: the folder above changes whenever any compare opens or closes.
        foreach (array_diff(@scandir(xs_mc_dir($t)) ?: [], ['.', '..']) as $f) {
            $newest = max($newest, (int) @filemtime(xs_mc_path($t, $f)));
        }
        if ($newest < time() - 43200 && !xs_mc_remove($t)) {
            xs_log('CMPR', 'an old compare\'s folder could not all be removed (ticket ' . $t . '): tried again next time');
        }
    }
}

// ---- asking ---------------------------------------------------------------------

/**
 * Ask every place that is on, for one game and one kind; with $only, that place alone, and for
 * 'all' kinds when $kind is 'all' (Everything one place has). $kind 'find' is Find any: every place
 * that is on, for the kinds in $find. ['ticket', 'places'], or null with $why.
 */
function xs_mc_start(array $s, array $g, string $kind, string $only, ?string &$why = null, array $find = []): ?array
{
    $why = null;
    xs_mc_sweep();
    $kinds = $kind === 'all' ? xs_mc_kinds() : ($kind === 'find' ? $find : [$kind]);
    // Several kinds at once want the first of each, not every one to choose from.
    $several = $kind === 'all' || $kind === 'find';
    $places = [];
    foreach ($kinds as $k) {
        foreach (xs_mc_places($s, $g, $k) as $p) {
            if ($only !== '' ? $p['key'] === $only : $p['on']) {
                $places[$p['key']] = $places[$p['key']] ?? $p + ['kinds' => []];
                $places[$p['key']]['kinds'][] = $k;
            }
        }
    }
    $ticket = bin2hex(random_bytes(8));
    if (!@mkdir(xs_mc_dir($ticket), 0777, true)) {
        $why = 'the folder data\mediachoice could not be made (' . xs_file_error_reason() . ')';
        xs_log('CMPR', $g['title'] . ': no compare: ' . $why);
        return null;
    }
    // A start that fails part way leaves nothing behind, and says why in the log.
    $failed = static function (string $said) use ($ticket, $g): void {
        xs_log('CMPR', $g['title'] . ': no compare: ' . $said);
        xs_mc_remove($ticket);
    };
    $ask = [];
    foreach ($places as $key => $p) {
        $ask[$key] = ['state' => $p['note'] !== '' ? 'account' : 'waiting', 'why' => $p['note'], 'kinds' => $p['kinds'], 'items' => []];
    }
    // ScreenScraper first, so the job file is written once before its worker reads it.
    if (($ask['ss']['state'] ?? '') === 'waiting' && !xs_mc_ss_start($ticket, $g, $ask['ss']['kinds'], $several, $ssWhy)) {
        $ask['ss'] = ['state' => 'failed', 'why' => (string) $ssWhy, 'kinds' => $ask['ss']['kinds'], 'items' => []];
        xs_log('CMPR', $g['title'] . ': ScreenScraper not asked: ' . $ssWhy);
    }
    $others = array_filter($ask, static fn ($p, $k) => $k !== 'ss' && $p['state'] === 'waiting', ARRAY_FILTER_USE_BOTH);
    $job = ['state' => $others ? 'running' : 'done', 'started' => time(), 'id' => (string) $g['id'], 'kind' => $kind, 'one' => $only !== '', 'places' => $ask];
    if (!xs_write_json(xs_mc_path($ticket, 'job.json'), $job, $wrote)) {
        $why = (string) $wrote;
        $failed($why);
        return null;
    }
    if ($others && !xs_spawn_worker('mediachoice.php', [$ticket, 'look'])) {
        $why = 'the places could not be asked: the worker would not start';
        $failed($why);
        return null;
    }
    $what = $kind === 'all' ? 'everything ' . implode(', ', array_keys($ask)) . ' has'
          : ($kind === 'find' ? 'find any ' . implode(', ', $kinds) : $kind) . ' from ' . (implode(', ', array_keys($ask)) ?: 'nowhere');
    xs_log('CMPR', $g['title'] . ': ' . $what . ' (ticket ' . $ticket . ')');
    // 'fits': every place that fits, the ones turned off too, for Look in to list. Each place's kinds,
    // so Find any waits on a place only for what it was asked.
    return ['ticket' => $ticket, 'places' => array_values($places), 'fits' => $several ? [] : xs_mc_places($s, $g, $kind)];
}

/** ScreenScraper's look at one game, by bin\screenscraper.ps1: the pictures of the kinds asked come down with it. */
function xs_mc_ss_start(string $ticket, array $g, array $kinds, bool $one, ?string &$why = null): bool
{
    $use = xs_ss_account_in_use(false, $devWhy);
    if (!xs_ss_ready($use)) {
        $why = $devWhy ?? 'no ScreenScraper login is stored';
        return false;
    }
    $types = [];
    foreach ($kinds as $k) {
        if ($k !== 'video' && $k !== 'manual') {
            $types = array_merge($types, XS_MC_SS_TYPES[$k]);
        }
    }
    $src  = xs_ss_sources();
    $plan = ['state' => 'running', 'started' => time(), 'look' => true, 'dir' => xs_mc_dir($ticket), 'docs' => '', 'boxes' => '',
             'art' => '', 'search' => $src['search'], 'rom' => $src['rom'], 'pause' => $src['pause'],
             'lookTypes' => $types, 'lookMax' => $one ? 1 : XS_MC_MAX,
             'games' => [['id' => (string) $g['id'], 'title' => (string) $g['title'], 'platform' => (string) $g['platform'],
                          'system' => xs_ss_system((string) $g['platform']), 'rom' => xs_ss_rom_name((string) ($g['romPath'] ?? '')),
                          'state' => 'waiting', 'video' => in_array('video', $kinds, true), 'manual' => in_array('manual', $kinds, true),
                          'box' => $types !== []]]];
    return xs_mc_ss_go(xs_mc_path($ticket, 'ss.json'), $plan, $why);
}

/**
 * Whether ScreenScraper is being asked now, by a compare or by Get Media: a free account answers one
 * at a time, so a look or a download waits its turn ('queued') and xs_mc_read starts it.
 */
function xs_mc_ss_busy(): bool
{
    $job = xs_read_json(xs_ss_job_path(), null);
    if (is_array($job) && ($job['state'] ?? '') === 'running' && xs_job_dead($job, xs_ss_job_path()) === null) {
        return true;
    }
    return xs_ss_compare_busy();
}

/** ScreenScraper's fetcher on one job file (a look, or one download): started now, or queued while it is busy. */
function xs_mc_ss_go(string $path, array $plan, ?string &$why = null): bool
{
    $why  = null;
    $busy = xs_mc_ss_busy();
    $plan['state']   = $busy ? 'queued' : 'running';
    $plan['started'] = time();
    if (!xs_write_json($path, $plan, $why)) {
        return false;
    }
    if ($busy) {
        xs_log('CMPR', basename($path) . ' waits its turn: ScreenScraper is answering another');
        return true;
    }
    $use    = xs_ss_account_in_use(false, $devWhy);
    $script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'screenscraper.ps1';
    if (!xs_ss_ready($use) || !xs_spawn_ps(xs_ps_call($script, ['Job' => $path, 'Account' => xs_ss_account_path(),
                                                                'Shared' => $use['shared'] ? xs_ss_shared_path() : null]))) {
        $why = xs_ss_ready($use) ? 'ScreenScraper could not be asked: its fetcher would not start' : ($devWhy ?? 'no ScreenScraper login is stored');
        @unlink($path);
        return false;
    }
    return true;
}

/** The next of a ticket's ScreenScraper jobs that waited its turn, started once ScreenScraper is free: its look first. */
function xs_mc_ss_next(string $ticket): void
{
    $waiting = array_merge([xs_mc_path($ticket, 'ss.json')], xs_glob(xs_mc_dir($ticket), 'prep-*.json'));
    foreach ($waiting as $f) {
        $j = is_file($f) ? xs_read_json($f, null) : null;
        if (!is_array($j) || ($j['state'] ?? '') !== 'queued') {
            continue;
        }
        if (xs_mc_ss_busy()) {
            return;
        }
        if (!xs_mc_ss_go($f, $j, $why)) {
            xs_write_json($f, ['state' => 'failed', 'why' => (string) $why, 'ended' => time()] + $j);
            xs_log('CMPR', basename($f) . ' of ticket ' . $ticket . ' could not start after waiting: ' . $why);
        }
        return;
    }
}

/** A remote file the page can show: a test's file:/// stand-in is copied into the ticket, as a page cannot read one. */
function xs_mc_viewable(string $ticket, string $url, string $name): string
{
    if (!str_starts_with($url, 'file:///')) {
        return $url;
    }
    $got = xs_lr_get($url);
    return $got !== null && @file_put_contents(xs_mc_path($ticket, $name), $got) !== false ? xs_mc_view($ticket, $name) : '';
}

/** The region in brackets in a file or libretro name: "Super Mario 64 (USA).png" is USA. */
function xs_mc_region_of(string $name): string
{
    return preg_match('/\(([^)]*)\)/', $name, $m) ? $m[1] : '';
}

/**
 * One place asked, by the worker: ['state' => done | none | failed, 'why', 'items' => [item]]. An item:
 * ref (the place's own name for it), kind, label (its region or name), sub (what else is known), view (an
 * address the page shows), src (where it is fetched from, server side only), size in bytes when known.
 */
function xs_mc_ask(string $ticket, array $g, string $place, array $kinds): array
{
    $items = [];
    $none  = static fn (string $why): array => ['state' => 'none', 'why' => $why, 'items' => []];
    $fail  = static fn (string $why): array => ['state' => 'failed', 'why' => $why, 'items' => []];
    $platform = (string) $g['platform'];
    $n = 0;
    if ($place === 'gamesdb') {
        $dbId = (int) ($g['dbId'] ?? 0);
        if ($dbId <= 0) {
            return $none('this game is not matched to the Games Database yet: Wrong game? Search... finds it') + ['search' => true];
        }
        $r = xs_gamesdb(['images', (string) $dbId]);
        if (empty($r['ok'])) {
            return $fail('the Games Database could not be read: ' . ($r['error'] ?? 'no answer'));
        }
        foreach ($kinds as $k) {
            foreach (array_slice((array) ($r['slots'][$k] ?? []), 0, XS_MC_MAX) as $it) {
                $url = xs_gamesdb_picture_url((string) $it['file']);
                $items[] = ['ref' => 'gamesdb:' . $k . ':' . $it['file'], 'kind' => $k, 'label' => (string) (($it['region'] ?? '') ?: 'any region'),
                            'sub' => (string) ($it['type'] ?? ''), 'view' => xs_mc_viewable($ticket, $url, 'db-' . (++$n) . '.' . pathinfo((string) $it['file'], PATHINFO_EXTENSION)),
                            'src' => $url, 'file' => (string) $it['file']];
            }
        }
        return $items ? ['state' => 'done', 'why' => '', 'items' => $items] : $none('the Games Database has none for this game');
    }
    if ($place === 'libretro') {
        $sys = xs_lr_system($platform);
        $idx = $sys === null ? null : xs_lr_index($sys, $why);
        if ($idx === null) {
            return $fail("libretro's lists could not be read: " . ($why ?? 'this console is not on them'));
        }
        $all  = xs_lr_names($idx);
        $name = (string) ($g['lrName'] ?? '');
        if ($name === '') {
            $name = (string) (xs_lr_match($g, xs_lr_tables($all))['name'] ?? '');
        }
        if ($name === '') {
            return $none("this game is not on libretro's lists");
        }
        // The other releases of the same game, for their other covers: the same title in every region.
        $names = array_values(array_unique(array_merge([$name], xs_lr_search($all, xs_lr_display($name), 6))));
        $names = array_values(array_filter($names, static fn ($x) => strcasecmp(xs_lr_display($x), xs_lr_display($name)) === 0));
        foreach ($kinds as $k) {
            $folder = XS_LR_KINDS[$k] ?? null;
            foreach ($folder === null ? [] : $names as $nm) {
                if (!in_array($nm, (array) ($idx['kinds'][$folder] ?? []), true)) {
                    continue;
                }
                $url = xs_lr_base('thumbs') . '/' . rawurlencode($sys) . '/' . $folder . '/' . rawurlencode($nm . '.png');
                $items[] = ['ref' => 'libretro:' . $k . ':' . $nm, 'kind' => $k, 'label' => xs_mc_region_of($nm) ?: 'any region',
                            'sub' => $k === 'fanart' ? 'the title screen' : $nm, 'view' => xs_mc_viewable($ticket, $url, 'lr-' . (++$n) . '.png'), 'src' => $url];
            }
        }
        return $items ? ['state' => 'done', 'why' => '', 'items' => $items] : $none("libretro has none for " . $name);
    }
    if ($place === 'steam' && in_array('video', $kinds, true) && count($kinds) > 1) {
        // Its pictures are on this PC and its trailers in its store: each asked, the answers put together.
        $pics = xs_mc_ask($ticket, $g, 'steam', array_values(array_diff($kinds, ['video'])));
        $vids = xs_mc_ask($ticket, $g, 'steam', ['video']);
        $items = array_merge($pics['items'], $vids['items']);
        $why   = implode('; ', array_filter([$pics['why'], $vids['why']]));
        if ($items) {
            return ['state' => 'done', 'why' => $why, 'items' => $items];
        }
        return in_array('failed', [$pics['state'], $vids['state']], true) ? $fail($why) : $none($why);
    }
    if ($place === 'steam' && !in_array('video', $kinds, true)) {
        $root = xs_steam_root();
        $pics = $root === '' ? [] : xs_steam_pictures($root, (string) $g['steam']['id']);
        foreach ($kinds as $k) {
            if (!isset($pics[$k])) {
                continue;
            }
            $name = 'steam-' . $k . '.' . strtolower(pathinfo($pics[$k], PATHINFO_EXTENSION));
            if (@copy($pics[$k], xs_mc_path($ticket, $name))) {
                $items[] = ['ref' => 'steam:' . $k, 'kind' => $k, 'label' => $k === 'shot' ? 'your newest screenshot' : 'from your Steam library',
                            'sub' => basename($pics[$k]), 'view' => xs_mc_view($ticket, $name), 'local' => $name, 'size' => (int) filesize($pics[$k])];
            }
        }
        return $items ? ['state' => 'done', 'why' => '', 'items' => $items]
                      : $none($root === '' ? 'Steam is not on this PC' : 'Steam keeps none for this game on this PC');
    }
    if ($place === 'steam') {
        $appid = (string) $g['steam']['id'];
        $src   = xs_steamvid_sources();
        $raw   = xs_lr_get(str_replace('{appid}', rawurlencode($appid), $src['api']), $why, 20);
        $info  = $raw === null ? null : (json_decode(xs_strip_bom($raw), true)[$appid] ?? null);
        if (!is_array($info)) {
            return $fail('Steam did not answer about this game' . ($raw === null ? ': ' . $why : ''));
        }
        $movies = (array) ($info['data']['movies'] ?? []);
        usort($movies, static fn ($a, $b) => (int) !empty($b['highlight']) <=> (int) !empty($a['highlight']));
        foreach (array_slice($movies, 0, XS_MC_MAX) as $m) {
            $url = is_string($m['mp4']['max'] ?? null) ? $m['mp4']['max'] : str_replace('{movie}', rawurlencode((string) ($m['id'] ?? '')), $src['cdn']);
            $items[] = ['ref' => 'steam:video:' . ($m['id'] ?? $n), 'kind' => 'video', 'label' => (string) ($m['name'] ?? 'trailer'),
                        'sub' => !empty($m['highlight']) ? "Steam's own pick" : 'trailer', 'view' => xs_mc_viewable($ticket, $url, 'steam-' . (++$n) . '.mp4'), 'src' => $url];
        }
        return $items ? ['state' => 'done', 'why' => '', 'items' => $items] : $none('Steam has no trailer for this game');
    }
    if ($place === 'arcadedb') {
        $name = (string) xs_ad_name(xs_mc_file($g));
        $src  = xs_ad_source();
        foreach ([$name, ''] as $try) {
            $raw = xs_lr_get(str_replace('{name}', rawurlencode($try === '' ? $name : $try), $src['ask']), $why, 20);
            $a   = $raw === null ? null : xs_ad_answer($raw);
            if ($a === null) {
                return $fail('the Arcade Database did not answer' . ($raw === null ? ': ' . $why : ''));
            }
            if ($a['video'] !== '') {
                $items[] = ['ref' => 'arcadedb:' . $name, 'kind' => 'video', 'label' => $name, 'sub' => 'a short play',
                            'view' => xs_mc_viewable($ticket, $a['video'], 'adb.mp4'), 'src' => $a['video']];
                break;
            }
            if ($a['parent'] === '' || $a['parent'] === $name) {
                break;
            }
            $name = $a['parent'];      // a clone's video is its parent game's
        }
        return $items ? ['state' => 'done', 'why' => '', 'items' => $items] : $none('the Arcade Database has no video for ' . xs_mc_file($g));
    }
    if ($place === 'archive') {
        // Its videos and its manuals are sets of their own: each kind asked, the answers put together.
        $parts = [];
        foreach (array_intersect(['video', 'manual'], $kinds) as $k) {
            $parts[$k] = xs_mc_ask_archive($ticket, $g, $k);
        }
        $items = array_merge([], ...array_values(array_column($parts, 'items')));
        $why   = implode('; ', array_filter(array_column($parts, 'why')));
        if ($items) {
            return ['state' => 'done', 'why' => $why, 'items' => $items];
        }
        return in_array('failed', array_column($parts, 'state'), true) ? $fail($why) : $none($why);
    }
    return $fail('no such place: ' . $place);
}

/** The Internet Archive's sets for the game's console, their lists read now, and every file that matches the game. */
function xs_mc_ask_archive(string $ticket, array $g, string $kind): array
{
    $platform = (string) $g['platform'];
    $sets     = $kind === 'manual' ? xs_ma_sets_for($platform) : xs_av_sets_for($platform);
    $root     = $kind === 'manual' ? XS_MA_ROOT : XS_AV_ROOT;
    $source   = xs_av_source();
    $want     = [];
    $byId     = [];
    foreach ($sets as $i => $set) {
        $byId[$set['id']] = $set;
        $want[$set['id']] = ['url' => str_replace('{id}', rawurlencode((string) $set['id']), $source['list']),
                             'to' => xs_mc_path($ticket, 'list-' . $i . '.json'), 'lane' => 'lists'];
    }
    $shelves = [];
    $missed  = [];
    xs_curl_many($want, 4, 4, static function ($id, bool $ok, string $why) use (&$shelves, &$missed, $want, $byId, $kind): void {
        $json  = $ok ? (string) @file_get_contents($want[$id]['to']) : '';
        $files = $ok ? ($kind === 'manual' ? xs_ma_manuals($byId[$id], $json) : xs_av_videos($byId[$id], $json)) : null;
        @unlink($want[$id]['to']);
        if ($files === null) {
            $missed[$id] = $ok ? 'what came was not a list of files' : $why;
            return;
        }
        $folder = (string) $byId[$id]['folder'];
        $shelves[$folder] = array_merge($shelves[$folder] ?? [], $files);
    }, static fn (): bool => true);
    if ($sets && count($missed) === count($sets)) {
        return ['state' => 'failed', 'why' => 'the Internet Archive could not be reached: ' . reset($missed), 'items' => []];
    }
    foreach ($shelves as $folder => $files) {
        xs_vm_shelf($root, (string) $folder, $files);
    }
    $m = xs_vm_match($root, ['title' => (string) $g['title'], 'platform' => $platform, 'file' => xs_mc_file($g)]);
    if ($m['video'] === null) {
        $said = $kind === 'manual' ? xs_ma_words((string) $m['why']) : (string) $m['why'];
        return ['state' => 'none', 'why' => 'the Internet Archive has none by this name' . ($said !== '' ? ': ' . $said : ''), 'items' => []];
    }
    $items = [];
    $n = 0;
    foreach (array_slice($m['all'] ?? [$m['video']], 0, XS_MC_MAX) as $v) {
        $url = xs_av_file_url((string) $v['id'], (string) $v['path']);
        $ext = strtolower(pathinfo((string) $v['name'], PATHINFO_EXTENSION));
        $items[] = ['ref' => 'archive:' . $v['id'] . '/' . $v['path'], 'kind' => $kind,
                    'label' => (string) (xs_mc_region_of((string) $v['name']) ?: mb_substr(pathinfo((string) $v['name'], PATHINFO_FILENAME), 0, 40)),
                    'sub' => (string) $v['name'], 'size' => (int) ($v['size'] ?? 0), 'md5' => (string) ($v['md5'] ?? ''), 'src' => $url,
                    'view' => $kind === 'video' ? xs_mc_viewable($ticket, $url, 'ia-' . (++$n) . '.' . $ext) : ''];
    }
    return ['state' => 'done', 'why' => '', 'items' => $items];
}

// ---- reading what has come --------------------------------------------------------

/** ScreenScraper's part as places and items: from bin\screenscraper.ps1's look, its addresses without the logins. */
function xs_mc_ss_part(string $ticket, array $kinds): ?array
{
    $j = xs_read_json_settled(xs_mc_path($ticket, 'ss.json'), null);
    if (!is_array($j)) {
        return null;
    }
    if (($dead = xs_job_dead($j, xs_mc_path($ticket, 'ss.json'))) !== null) {
        return ['state' => 'failed', 'why' => 'ScreenScraper stopped part way (' . $dead . ')', 'items' => []];
    }
    if (($j['state'] ?? '') === 'queued') {
        return ['state' => 'asking', 'why' => 'waiting its turn: ScreenScraper answers one at a time', 'items' => []];
    }
    $g     = $j['games'][0] ?? [];
    $state = (string) ($g['state'] ?? 'waiting');
    if (($j['state'] ?? '') === 'failed') {
        return ['state' => 'failed', 'why' => (string) (($j['error'] ?? '') ?: ($j['why'] ?? '') ?: 'ScreenScraper stopped'), 'items' => []];
    }
    if (in_array($state, ['none', 'failed'], true)) {
        return ['state' => $state, 'why' => $state === 'none' ? 'ScreenScraper does not know this game by its name or file' : 'ScreenScraper could not be asked', 'items' => []];
    }
    $rank  = array_flip(array_merge((array) ($g['own'] ?? []), array_keys(XS_MC_REGIONS)));
    $items = [];
    foreach ((array) ($g['medias'] ?? []) as $i => $m) {
        foreach ($kinds as $k) {
            $at = array_search((string) ($m['type'] ?? ''), XS_MC_SS_TYPES[$k], true);
            if ($at === false) {
                continue;
            }
            $file = (string) ($m['file'] ?? '');
            $region = (string) ($m['region'] ?? '');
            $items[] = ['ref' => 'ss:' . $i, 'kind' => $k, 'label' => XS_MC_REGIONS[$region] ?? ($region !== '' ? $region : 'any region'),
                        'sub' => (string) $m['type'], 'size' => (int) ($m['size'] ?? 0), 'md5' => (string) ($m['md5'] ?? ''),
                        'view' => $file !== '' ? xs_mc_view($ticket, $file) : '', 'local' => $file, 'src' => (string) ($m['url'] ?? ''),
                        'order' => [$at, $rank[$region] ?? 99, $i]];
        }
    }
    usort($items, static fn ($a, $b) => $a['order'] <=> $b['order']);
    // A picture is shown once it has come down; one still coming is left until it has, the rest dropped at the end.
    $done  = $state === 'done' && ($j['state'] ?? '') !== 'running';
    $items = array_values(array_filter($items, static fn ($it) => in_array($it['kind'], ['video', 'manual'], true) || $it['view'] !== ''));
    $items = array_map(static fn ($it) => array_diff_key($it, ['order' => 1]), array_slice($items, 0, XS_MC_MAX * max(1, count($kinds))));
    return ['state' => $done ? ($items ? 'done' : 'none') : 'asking', 'why' => $done && !$items ? 'ScreenScraper has none of these for this game' : '',
            'items' => $items, 'used' => (int) ($j['used'] ?? 0), 'allowed' => (int) ($j['allowed'] ?? 0)];
}

/** Everything a ticket has: the job with ScreenScraper's part and each file being brought down. Null when there is no such ticket. */
function xs_mc_read(string $ticket): ?array
{
    $job = xs_read_json_settled(xs_mc_path($ticket, 'job.json'), null);
    if (!is_array($job)) {
        return null;
    }
    xs_mc_ss_next($ticket);
    if (isset($job['places']['ss']) && in_array($job['places']['ss']['state'], ['waiting', 'asking'], true)) {
        $job['places']['ss'] = (xs_mc_ss_part($ticket, $job['places']['ss']['kinds']) ?? $job['places']['ss']) + ['kinds' => $job['places']['ss']['kinds']];
        xs_mc_told($ticket, xs_mc_path($ticket, 'ss.json'), $job['places']['ss']['state'] === 'asking' ? ''
            : 'ScreenScraper ' . ($job['places']['ss']['state'] === 'done' ? 'has ' . count($job['places']['ss']['items']) : $job['places']['ss']['state'] . ', ' . $job['places']['ss']['why']));
    }
    if (($dead = xs_job_dead($job, xs_mc_path($ticket, 'job.json'))) !== null) {
        foreach ($job['places'] as $k => $p) {
            if ($k !== 'ss' && in_array($p['state'], ['waiting', 'asking'], true)) {
                $job['places'][$k] = ['state' => 'failed', 'why' => 'the asking stopped part way (' . $dead . ')', 'items' => []] + $p;
            }
        }
    }
    $job['prep'] = [];
    foreach (xs_glob(xs_mc_dir($ticket), 'prep-*.json') as $f) {
        $p = xs_read_json_settled($f, null);
        if (is_array($p) && isset($p['ref'])) {
            if (($dead = xs_job_dead($p, $f)) !== null) {
                $p['state'] = 'failed';
                $p['why']   = 'it stopped part way (' . $dead . ')';
            }
            // ScreenScraper's downloads end in its own fetcher, which writes no log: said here, once.
            if (!empty($p['fetch'])) {
                xs_mc_told($ticket, $f, in_array($p['state'], ['done', 'failed'], true)
                    ? 'brought down ' . $p['ref'] . ' from ScreenScraper: ' . ($p['state'] === 'done' ? round((int) ($p['size'] ?? 0) / 1048576, 1) . ' MB' : 'failed, ' . ($p['why'] ?? ''))
                    : '');
            }
            $job['prep'][$p['ref']] = $p;
        }
    }
    return $job;
}

/** A line in the log once a job of a ticket has ended ($said not ''), said once: marked beside its file, never in it, as its worker may still write it. */
function xs_mc_told(string $ticket, string $file, string $said): void
{
    $mark = dirname($file) . DIRECTORY_SEPARATOR . 'told-' . basename($file);
    if ($said === '' || !is_file($file) || is_file($mark)) {
        return;
    }
    if (@touch($mark)) {
        xs_log('CMPR', $said . ' (ticket ' . $ticket . ')');
    }
}

/** What the page may know of a ticket: no source address, no path on the disk. */
function xs_mc_public(string $ticket, array $job): array
{
    $places = [];
    foreach ($job['places'] as $key => $p) {
        $places[$key] = ['state' => $p['state'], 'why' => (string) ($p['why'] ?? ''), 'search' => !empty($p['search']), 'kinds' => array_values((array) ($p['kinds'] ?? [])),
            'items' => array_map(static fn ($it) => array_intersect_key($it, array_flip(['ref', 'kind', 'label', 'sub', 'view', 'size'])), (array) ($p['items'] ?? []))];
    }
    $prep = [];
    foreach ($job['prep'] as $ref => $p) {
        // One waiting its turn reads as coming: the page shows the wait the same way.
        $queued = ($p['state'] ?? '') === 'queued';
        $prep[$ref] = ['state' => $queued ? 'running' : (string) $p['state'], 'why' => $queued ? 'waiting its turn: ScreenScraper answers one at a time' : (string) ($p['why'] ?? ''),
                       'got' => (int) ($p['got'] ?? 0), 'size' => (int) ($p['size'] ?? 0),
                       'view' => ($p['state'] ?? '') === 'done' ? xs_mc_view($ticket, (string) $p['to']) : '', 'pages' => (int) ($p['pages'] ?? 0)];
    }
    $busy = array_filter($places, static fn ($p) => in_array($p['state'], ['waiting', 'asking'], true));
    return ['ticket' => $ticket, 'kind' => $job['kind'], 'places' => $places, 'prep' => $prep, 'done' => !$busy];
}

/** One item of a ticket by its ref, with its place: [place, item] or null. */
function xs_mc_item(array $job, string $ref): ?array
{
    foreach ($job['places'] as $key => $p) {
        foreach ((array) ($p['items'] ?? []) as $it) {
            if ($it['ref'] === $ref) {
                return [$key, $it];
            }
        }
    }
    return null;
}

// ---- bringing a video or manual down ------------------------------------------------

/** The prep file of one item. */
function xs_mc_prep_path(string $ticket, string $ref): string
{
    return xs_mc_path($ticket, 'prep-' . substr(md5($ref), 0, 12) . '.json');
}

/**
 * Bring a video or manual down into the ticket, to be seen and used: ScreenScraper's through its fetcher
 * (the logins are only there), the rest by the worker. True when it is on its way or already here.
 */
function xs_mc_prepare(string $ticket, array $job, string $ref, ?string &$why = null): bool
{
    $why   = null;
    $found = xs_mc_item($job, $ref);
    if ($found === null) {
        $why = 'that choice is not in this compare any more; Look again';
        return false;
    }
    [$place, $it] = $found;
    $path = xs_mc_prep_path($ticket, $ref);
    $was  = $job['prep'][$ref] ?? null;
    if (is_array($was) && in_array($was['state'], ['running', 'queued', 'done'], true)) {
        return true;
    }
    $type = $it['kind'] === 'manual' ? 'pdf' : ($it['kind'] === 'video' ? 'video' : 'image');
    if ((string) ($it['src'] ?? '') === '') {
        $why = 'there is nothing to bring down: it is on this PC already';
        return false;
    }
    // The same limits as a file of your own (api\video-own.php, a document of your own), and room on the disk for it twice:
    // once in the compare, once where it is kept.
    $size = (int) ($it['size'] ?? 0);
    $cap  = ['video' => 400, 'pdf' => 200, 'image' => 40][$type] * 1048576;
    if ($size > $cap) {
        $why = 'it is ' . round($size / 1048576) . ' MB, more than Xsegon takes for ' . (['video' => 'a video', 'pdf' => 'a manual', 'image' => 'a picture'][$type])
             . ' (' . round($cap / 1048576) . ' MB)';
        return false;
    }
    $free = @disk_free_space(xs_mc_root());
    if ($free !== false && $free < max($size, 50 * 1048576) * 2) {
        $why = 'the disk has only ' . round($free / 1048576) . ' MB free, not enough to bring it down and keep it';
        return false;
    }
    // Asked again after a failure: its ending is said again, so the first one's mark goes.
    @unlink(dirname($path) . DIRECTORY_SEPARATOR . 'told-' . basename($path));
    $to   = 'got-' . substr(md5($ref), 0, 12) . '.' . ($type === 'pdf' ? 'pdf' : ($type === 'video' ? 'mp4' : 'img'));
    $prep = ['state' => 'running', 'started' => time(), 'ref' => $ref, 'place' => $place, 'type' => $type, 'url' => (string) $it['src'],
             'to' => $to, 'dir' => xs_mc_dir($ticket), 'size' => $size, 'md5' => (string) ($it['md5'] ?? ''), 'max' => $cap];
    if ($place === 'ss') {
        $prep['fetch'] = true;
        // The one host its fetcher may send the logins to besides screenscraper.fr: where the look asked (a test's stand-in).
        $prep['host'] = (string) parse_url((string) xs_ss_sources()['search'], PHP_URL_HOST);
        $ok = xs_mc_ss_go($path, $prep, $why);
    } else {
        $ok = xs_write_json($path, $prep, $why) && xs_spawn_worker('mediachoice.php', [$ticket, 'fetch', substr(md5($ref), 0, 12)]);
    }
    if (!$ok) {
        $why = $why ?? 'it could not be fetched: the fetcher would not start';
        @unlink($path);
        return false;
    }
    xs_log('CMPR', 'bringing down ' . $it['kind'] . ' ' . $ref . ' from ' . XS_MC_PLACES[$place] . ($it['size'] ?? 0 ? ' (' . round($it['size'] / 1048576, 1) . ' MB)' : ''));
    return true;
}

/** A file brought down is what it says it is: a video by its first bytes, a PDF by its mark, a picture by its header. */
function xs_mc_is(string $type, string $file): bool
{
    $head = (string) @file_get_contents($file, false, null, 0, 1024);
    return match ($type) {
        'video' => (strlen($head) >= 12 && substr($head, 4, 4) === 'ftyp') || substr($head, 0, 4) === "\x1A\x45\xDF\xA3",
        'pdf'   => str_contains($head, '%PDF-'),
        default => @getimagesize($file) !== false,
    };
}

// ---- using one, and putting back the one before ----------------------------------------

/** The game's own file of a picture kind, or null. */
function xs_mc_own_art(string $id, string $kind): ?string
{
    return xs_slot_file(xs_own_art_dir() . DIRECTORY_SEPARATOR . $id . '-' . $kind, ['png', 'jpg', 'jpeg', 'webp', 'gif']);
}

/**
 * What a kind is before a press, copied into the ticket for Put back the one before: the entry, or null
 * with $why when that copy failed, and then the press is refused, so nothing changes that could not be
 * put back. The entry is kept only once the press has worked (xs_mc_before_keep).
 */
function xs_mc_before(string $ticket, string $id, string $kind, string $doc, string $holder, ?string &$why = null): ?array
{
    $why = null;
    $b   = ['kind' => $kind, 'from' => null, 'own' => null];
    if ($kind === 'video') {
        $own = video_own($id);
    } elseif ($kind === 'manual') {
        $b['doc']    = $doc;
        $b['holder'] = $holder;
        $own = $doc !== '' ? xs_docs_dir() . DIRECTORY_SEPARATOR . $holder . DIRECTORY_SEPARATOR . $doc : null;
    } else {
        $own = xs_mc_own_art($id, $kind);
        $b['hidden'] = in_array($kind, (array) (xs_art_hidden()[$id] ?? []), true);
    }
    // Where it came from, only while that is still true of the file: put back, it says no more than it said before.
    $b['from'] = $kind === 'manual' ? null : xs_art_from_now($id, $kind, $own);
    if ($own !== null && is_file($own)) {
        // A name of its own each time: the one kept for the last press stays until this press has worked.
        $name = 'before-' . $kind . '-' . bin2hex(random_bytes(4)) . '.' . strtolower(pathinfo($own, PATHINFO_EXTENSION));
        if (!@copy($own, xs_mc_path($ticket, $name))) {
            $why = 'what it has now could not be kept to put back (' . xs_file_error_reason() . '), so nothing was changed';
            @unlink(xs_mc_path($ticket, $name));
            return null;
        }
        $b['own'] = $name;
    }
    return $b;
}

/** The press worked: $b is what Put back brings back, and $after what the press left, to see later that it is still so. */
function xs_mc_before_keep(string $ticket, array $b, string $after): void
{
    $all = xs_read_json(xs_mc_path($ticket, 'before.json'), []);
    $all = is_array($all) ? $all : [];
    $old = $all[$b['kind']]['own'] ?? null;
    if (is_string($old) && $old !== $b['own']) {
        @unlink(xs_mc_path($ticket, $old));
    }
    $all[$b['kind']] = $b + ['after' => $after];
    if (!xs_write_json(xs_mc_path($ticket, 'before.json'), $all, $why)) {
        xs_log('CMPR', 'Put back the one before will not have the ' . $b['kind'] . ': ' . $why);
    }
}

/** The press failed: the copy it made goes. */
function xs_mc_before_drop(string $ticket, array $b): void
{
    if (is_string($b['own'] ?? null)) {
        @unlink(xs_mc_path($ticket, $b['own']));
    }
}

/** A mark of the file a kind has now (name, size, time), '' when none: Put back undoes only what is still the press's own. */
function xs_mc_stamp(?string $file): string
{
    clearstatcache();
    return $file !== null && is_file($file) ? basename($file) . '|' . filesize($file) . '|' . filemtime($file) : '';
}

/** The file a press left for a kind: the game's own picture or video, or the manual it added or replaced. */
function xs_mc_left(string $id, string $kind, array $b): ?string
{
    if ($kind === 'video') {
        return video_own($id);
    }
    if ($kind === 'manual') {
        $name = (string) (($b['added'] ?? '') ?: ($b['doc'] ?? ''));
        return $name === '' ? null : xs_docs_dir() . DIRECTORY_SEPARATOR . $b['holder'] . DIRECTORY_SEPARATOR . $name;
    }
    return xs_mc_own_art($id, $kind);
}

/**
 * The bytes of a picture choice, from the ticket only: one still at its place is brought down first
 * (xs_mc_prepare), as a fetch here would hold the whole of Xsegon while it comes.
 */
function xs_mc_picture_bytes(string $ticket, array $job, array $it, ?string &$why): ?string
{
    $why = null;
    $local = (string) ($it['local'] ?? '');
    if ($local !== '' && is_file(xs_mc_path($ticket, $local))) {
        return (string) file_get_contents(xs_mc_path($ticket, $local));
    }
    $prep = $job['prep'][$it['ref']] ?? null;
    if (is_array($prep) && $prep['state'] === 'done' && is_file(xs_mc_path($ticket, $prep['to']))) {
        return (string) file_get_contents(xs_mc_path($ticket, $prep['to']));
    }
    if (str_starts_with((string) $it['view'], 'api/mediachoice.php') && preg_match('/&file=([^&]+)/', (string) $it['view'], $m)) {
        $f = xs_mc_path($ticket, rawurldecode($m[1]));
        if (is_file($f)) {
            return (string) file_get_contents($f);
        }
    }
    $why = 'it has not come down yet';
    return null;
}

/** Whether a documents folder has this name already, as Windows sees names: manual.pdf and Manual.pdf are one file. */
function xs_mc_name_taken(array $names, string $name): bool
{
    foreach ($names as $n) {
        if (strcasecmp((string) $n, $name) === 0) {
            return true;
        }
    }
    return false;
}

/** The game's document with these very bytes, by its name, or null: the same file is never kept twice. */
function xs_mc_same_doc(string $holder, string $file): ?string
{
    $size = (int) @filesize($file);
    $hash = null;
    foreach (xs_docs_for($holder) as $d) {
        if ((int) $d['bytes'] === $size
            && ($hash ??= md5_file($file)) === md5_file(xs_docs_dir() . DIRECTORY_SEPARATOR . $holder . DIRECTORY_SEPARATOR . $d['file'])) {
            return (string) $d['file'];
        }
    }
    return null;
}

/**
 * Use one: a picture as the game's own, a video as its own video, a manual in a document's place or
 * beside it ($how 'keep'). ['kind', 'what' => words for the log], or null with $why. A video or manual
 * must have come down first (xs_mc_prepare), and one the game has already is refused.
 */
function xs_mc_use(string $ticket, array $job, array $g, string $ref, string $how, string $doc, string $holder, ?string &$why = null): ?array
{
    $why   = null;
    $found = xs_mc_item($job, $ref);
    if ($found === null) {
        $why = 'that choice is not in this compare any more; Look again';
        return null;
    }
    [$place, $it] = $found;
    $id   = (string) $g['id'];
    $kind = (string) $it['kind'];
    // The same choice pressed again (a double press) changes nothing, so Put back still has the one before it.
    // A manual is answered below instead, naming the document it already is.
    $kept = xs_read_json(xs_mc_path($ticket, 'before.json'), []);
    $last = is_array($kept) && is_array($kept[$kind] ?? null) ? $kept[$kind] : [];
    if ($kind !== 'manual' && ($last['ref'] ?? '') === $ref && isset($last['after'])
        && xs_mc_stamp(xs_mc_left($id, $kind, $last + ['holder' => $holder])) === $last['after']) {
        $why = 'that one is in use already';
        return null;
    }
    if ($kind === 'video' || $kind === 'manual') {
        $prep = $job['prep'][$ref] ?? null;
        $file = is_array($prep) && $prep['state'] === 'done' ? xs_mc_path($ticket, (string) $prep['to']) : '';
        if ($file === '' || !is_file($file)) {
            $why = 'it has not come down yet';
            return null;
        }
        if ($kind === 'video') {
            $b = xs_mc_before($ticket, $id, 'video', '', $holder, $why);
            if ($b === null) {
                return null;
            }
            $tmp = video_own_dir() . DIRECTORY_SEPARATOR . '.choice-' . $id . '.part';
            if ((!is_dir(video_own_dir()) && !@mkdir(video_own_dir(), 0777, true)) || !@copy($file, $tmp)) {
                $why = 'the video could not be copied into data\video-own (' . xs_file_error_reason() . ')';
                @unlink($tmp);
                xs_mc_before_drop($ticket, $b);
                return null;
            }
            $final = video_own_store($id, $tmp, $why);
            if ($final === null) {
                xs_mc_before_drop($ticket, $b);
                return null;
            }
            xs_art_from_set($id, 'video', $place, (int) filemtime($final));
            xs_mc_before_keep($ticket, $b + ['ref' => $ref], xs_mc_stamp($final));
            return ['kind' => 'video', 'what' => 'video from ' . XS_MC_PLACES[$place] . ' (' . round(filesize($final) / 1048576, 1) . ' MB)'];
        }
        $same = xs_mc_same_doc($holder, $file);
        if ($same !== null) {
            $why = 'the game has this manual already, as ' . $same;
            return null;
        }
        $dir  = xs_docs_dir() . DIRECTORY_SEPARATOR . $holder;
        $docs = array_column(xs_docs_for($holder), 'file');
        $doc  = $how === 'keep' || !in_array($doc, $docs, true) ? '' : $doc;
        // A PDF never takes a picture's place: a map or a scanned page keeps its name, and the manual goes beside it.
        $beside = $doc !== '' && strtolower(pathinfo($doc, PATHINFO_EXTENSION)) !== 'pdf';
        $was    = $doc;
        if ($beside) {
            $doc = '';
        }
        $name = $doc !== '' ? $doc : 'Manual.pdf';
        if ($how === 'keep' || $beside || ($doc === '' && xs_mc_name_taken($docs, 'Manual.pdf'))) {
            $label = trim((string) preg_replace('/[^A-Za-z0-9 ,.-]+/', ' ', (string) $it['label']));
            $base  = 'Manual (' . (mb_substr($label, 0, 40) ?: 'another') . ')';
            $name  = $base . '.pdf';
            for ($n = 2; xs_mc_name_taken($docs, $name); $n++) {
                $name = $base . ' ' . $n . '.pdf';
            }
        }
        $b = xs_mc_before($ticket, $holder, 'manual', $doc, $holder, $why);
        if ($b === null) {
            return null;
        }
        $b['added'] = $doc === '' ? $name : '';
        if ((!is_dir($dir) && !@mkdir($dir, 0777, true)) || !@copy($file, $dir . DIRECTORY_SEPARATOR . $name . '.part')
            || !@rename($dir . DIRECTORY_SEPARATOR . $name . '.part', $dir . DIRECTORY_SEPARATOR . $name)) {
            $why = 'the manual could not be put in data\documents (' . xs_file_error_reason() . ')';
            @unlink($dir . DIRECTORY_SEPARATOR . $name . '.part');
            @rmdir($dir);       // made for this one and left empty: a game with an empty folder reads as having documents
            xs_mc_before_drop($ticket, $b);
            return null;
        }
        xs_mc_before_keep($ticket, $b + ['ref' => $ref], xs_mc_stamp($dir . DIRECTORY_SEPARATOR . $name));
        xs_changed_note([$holder], 'manual');
        return ['kind' => 'manual', 'doc' => $name, 'what' => 'manual ' . $name . ' from ' . XS_MC_PLACES[$place]
                . ($doc !== '' ? ' in its place' : ($beside ? ' beside ' . $was . ' (a picture keeps its place)' : ''))];
    }
    $bytes = xs_mc_picture_bytes($ticket, $job, $it, $why);
    if ($bytes === null) {
        return null;
    }
    $b = xs_mc_before($ticket, $id, $kind, '', $holder, $why);
    if ($b === null) {
        return null;
    }
    $got = xs_own_art_store($id, $kind, $bytes, true, $why);
    if ($got === null) {
        xs_mc_before_drop($ticket, $b);
        return null;
    }
    xs_art_from_set($id, $kind, $place, (int) $got['rev']);
    xs_mc_before_keep($ticket, $b + ['ref' => $ref], xs_mc_stamp(xs_mc_own_art($id, $kind)));
    return ['kind' => $kind, 'what' => $kind . ' from ' . XS_MC_PLACES[$place] . ' ' . $it['label'] . ' (' . $got['width'] . 'x' . $got['height'] . ')'];
}

/** Put back what a kind was before the last press in this compare. Words for the log, or null with $why. */
function xs_mc_back(string $ticket, array $g, string $kind, string $holder, ?string &$why = null): ?string
{
    $why = null;
    $all = xs_read_json(xs_mc_path($ticket, 'before.json'), []);
    $b   = is_array($all) ? ($all[$kind] ?? null) : null;
    if (!is_array($b)) {
        $why = 'there is nothing to put back: nothing was changed in this compare';
        return null;
    }
    $id     = (string) $g['id'];
    $own    = is_string($b['own'] ?? null) ? xs_mc_path($ticket, $b['own']) : null;
    $holder = (string) ($b['holder'] ?? $holder);       // the folder the press itself wrote in
    // Only what this compare's press left is put back: a change made since (Change Pictures, Get Media,
    // another window) is the person's newer choice, and is kept.
    if (isset($b['after']) && xs_mc_stamp(xs_mc_left($id, $kind, $b + ['holder' => $holder])) !== $b['after']) {
        $why = 'it has changed since this compare used it (in another window, Change Pictures or Get Media), so it was left as it is';
        return null;
    }
    // Every file is gone before it counts as gone: one held open by another program is said, not passed over.
    $gone = static function (string $file) use (&$why): bool {
        if (!is_file($file) || @unlink($file)) {
            return true;
        }
        $why = basename($file) . ' could not be taken away (' . xs_file_error_reason() . ')';
        return false;
    };
    if ($kind === 'manual') {
        $dir = xs_docs_dir() . DIRECTORY_SEPARATOR . $holder;
        if (($b['added'] ?? '') !== '' && !$gone($dir . DIRECTORY_SEPARATOR . $b['added'])) {
            return null;
        }
        if ($own !== null && ($b['doc'] ?? '') !== '') {
            $part = $dir . DIRECTORY_SEPARATOR . $b['doc'] . '.part';
            if (!@copy($own, $part) || !@rename($part, $dir . DIRECTORY_SEPARATOR . $b['doc'])) {
                @unlink($part);
                $why = 'the manual before could not be put back (' . xs_file_error_reason() . ')';
                return null;
            }
        }
        @rmdir($dir);           // only when empty: a game whose one manual was taken back has no documents again
        xs_changed_note([$holder], 'manual');
    } elseif ($kind === 'video') {
        if ($own !== null) {
            // Copied first and then put in place, so a failed copy leaves the video as it was.
            $tmp = video_own_dir() . DIRECTORY_SEPARATOR . '.back-' . $id . '.part';
            if (!@copy($own, $tmp)) {
                @unlink($tmp);
                $why = 'the video before could not be put back (' . xs_file_error_reason() . ')';
                return null;
            }
            if (($final = video_own_store($id, $tmp, $why)) === null) {
                return null;
            }
        } else {
            foreach (array_keys(video_types()) as $e) {
                if (!$gone(video_own_dir() . DIRECTORY_SEPARATOR . $id . '.' . $e)) {
                    return null;
                }
            }
        }
        xs_changed_note([$id], 'video');
    } else {
        if ($own !== null) {
            $got = xs_own_art_store($id, $kind, (string) file_get_contents($own), false, $why);
            if ($got === null) {
                return null;
            }
            $final = xs_mc_own_art($id, $kind);
        } else {
            foreach (['png', 'jpg', 'jpeg', 'webp', 'gif'] as $e) {
                if (!$gone(xs_own_art_dir() . DIRECTORY_SEPARATOR . $id . '-' . $kind . '.' . $e)) {
                    return null;
                }
            }
        }
        foreach (['.jpg', '.png'] as $e) {
            @unlink(xs_data_path('thumbs' . DIRECTORY_SEPARATOR . $kind . DIRECTORY_SEPARATOR . $id . $e));
        }
        if (!empty($b['hidden'])) {
            $hidden = xs_art_hidden();
            $hidden[$id] = array_values(array_unique(array_merge((array) ($hidden[$id] ?? []), [$kind])));
            xs_write_json(xs_data_path('art-hidden.json'), $hidden);
        }
        xs_changed_note([$id], $kind);
    }
    // The words of where it came from go back with it, for the file it is now.
    xs_art_from_drop($id, [$kind]);
    if (is_array($b['from'] ?? null) && isset($final) && $final !== null) {
        xs_art_from_set($id, $kind, (string) $b['from']['from'], (int) filemtime($final), (string) ($b['from']['game'] ?? ''));
    }
    unset($all[$kind]);
    xs_write_json(xs_mc_path($ticket, 'before.json'), $all ?: new stdClass());
    if ($own !== null) {
        @unlink($own);
    }
    return $kind . ' put back as it was' . ($own === null ? ' (the original)' : '');
}
