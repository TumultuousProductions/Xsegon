<?php
/**
 * Xsegon - videos for the games that have none, from the Internet Archive (Pictures & Videos > Videos from online archives).
 *
 * Xsegon ships only the list of the Archive's video sets (includes\archivevid\sets.json); each
 * set's file list is asked for at a press, matched (includes\videomatch.php) and not kept.
 * A video is filed as data\videos\<Console>\<Title>. Gaps are tried against World of Longplays
 * (longplays.org): ffmpeg cuts the first 30 seconds, so the whole recording is never fetched.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/videopack.php';

/** The name the Archive's sets go by in the matcher, where a real folder of videos would be. */
const XS_AV_ROOT = 'archive.org';

/** The same for World of Longplays' recordings, and their collection on the Archive. */
const XS_AV_WOL = 'longplays.org';
const XS_AV_WOL_SET = 'worldoflongplays';

/** The console folders World of Longplays holds recordings for: those with 5 or more. */
const XS_AV_WOL_FOLDERS = ['nes', 'snes', 'n64', 'gamecube', 'wii', 'wiiu', 'gb', 'gbc', 'gba', 'ds', '3ds', 'fds', 'virtualboy',
    'psx', 'ps2', 'ps3', 'psp', 'switch', 'genesis', 'mastersystem', 'gamegear', 'sg-1000', 'saturn', 'dreamcast',
    'xbox', 'xbox360', 'atari2600', 'lynx', 'coleco', 'wonderswan', 'wonderswancolor', 'ngpc', 'msx', 'arcade', 'pcengine', 'pcenginecd', 'pcfx'];

function xs_av_job_path(): string
{
    return xs_data_path('archivevid-job.json');
}

function xs_av_stop_path(): string
{
    return xs_data_path('archivevid-stop');
}

/** The job as its worker left it, or null; a worker that is gone is said. */
function xs_av_job(): ?array
{
    $job = xs_read_json(xs_av_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_av_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/**
 * Where the worker asks. XSEGON_ARCHIVE points a test at stand-ins, honoured
 * only on a test copy, so nothing real is fetched in a test.
 */
function xs_av_source(): array
{
    $test = getenv('XSEGON_ARCHIVE');
    $base = is_string($test) && $test !== '' && xs_test_copy() ? rtrim($test, '/') : 'https://archive.org';
    $real = $base === 'https://archive.org';
    return ['list' => $base . '/metadata/{id}/files', 'file' => $base . '/download/{id}/{path}',
            // The stand-in is files on disk, where an address cannot carry a question mark.
            'search' => $real ? $base . '/services/search/v1/scrape?q=collection%3A' . XS_AV_WOL_SET . '&fields=identifier,title&count=10000'
                              : $base . '/scrape.json',
            'meta' => $base . '/metadata/{id}', 'real' => $real];
}

/** The sets Xsegon knows of. A test copy reads its own list from its data. */
function xs_av_sets(): array
{
    static $sets = null;
    if ($sets === null) {
        $own  = xs_data_path('archivevid-sets.json');
        $doc  = xs_read_json(xs_test_copy() && is_file($own) ? $own
              : XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'archivevid' . DIRECTORY_SEPARATOR . 'sets.json', null);
        $sets = [];
        foreach (is_array($doc['sets'] ?? null) ? $doc['sets'] : [] as $set) {
            if (!is_array($set) || !is_string($set['id'] ?? null) || !is_string($set['folder'] ?? null)) {
                continue;
            }
            $sets[] = $set;
        }
    }
    return $sets;
}

/** The sets that hold a console's videos, the console's best folder first. */
function xs_av_sets_for(string $platform): array
{
    $c = xs_vm_console($platform);
    if ($c === null) {
        return [];
    }
    $out = [];
    foreach ($c['folders'] as $folder) {
        foreach (xs_av_sets() as $set) {
            if ($set['folder'] === $folder) {
                $out[] = $set;
            }
        }
    }
    return $out;
}

/**
 * ffmpeg as the command's first words, or []. The release carries bin\ffmpeg.exe;
 * a checkout looks on PATH. A test's stand-in (XSEGON_FFMPEG, a .php) runs under PHP.
 */
function xs_av_ffmpeg(): array
{
    $test = getenv('XSEGON_FFMPEG');
    if (is_string($test) && $test !== '' && xs_test_copy()) {
        return str_ends_with(strtolower($test), '.php') ? [xs_php_exe(), $test] : [$test];
    }
    $tries = [XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'ffmpeg.exe'];
    foreach (explode(';', (string) getenv('PATH')) as $dir) {
        if (trim($dir) !== '') {
            $tries[] = rtrim($dir, '\\/') . DIRECTORY_SEPARATOR . 'ffmpeg.exe';
        }
    }
    $tries[] = 'C:\\ffmpeg\\bin\\ffmpeg.exe';
    foreach ($tries as $exe) {
        if (is_file($exe)) {
            return [$exe];
        }
    }
    return [];
}

/** The cut: the first $seconds of the recording at $url written to $to, no re-encoding, nothing else fetched. */
function xs_av_cut_cmd(string $url, string $to, int $seconds = 30): array
{
    return array_merge(xs_av_ffmpeg(), ['-v', 'error', '-nostdin', '-y', '-ss', '0', '-t', (string) $seconds,
        '-rw_timeout', '20000000', '-i', $url, '-c', 'copy', '-f', 'mp4', $to]);
}

/** Whether World of Longplays holds recordings for a console. */
function xs_av_wol_for(string $platform): bool
{
    $c = xs_vm_console($platform);
    return $c !== null && array_intersect($c['folders'], XS_AV_WOL_FOLDERS) !== [];
}

/**
 * A recording's title read apart: ['folder', 'name'], or null. In
 * "Saturn Longplay [203] Panzer Dragoon Saga" the console comes before "Longplay".
 */
function xs_av_wol_title(string $title): ?array
{
    if (!preg_match('/^(.{1,40}?)\s+Longplay\b[\s:._-]*(?:\[[^\]]*\]\s*)?(.+)$/u', trim($title), $m)) {
        return null;
    }
    $c = xs_vm_console($m[1]);
    $name = trim($m[2]);
    if ($c === null || $name === '') {
        return null;
    }
    // A bare region word at the end ("Burning Rangers US") becomes the bracketed mark the matcher reads.
    if (preg_match('/^(.*\S)\s+(US|USA|EU|EUR|JP|JPN|PAL|NTSC)$/i', $name, $r)) {
        $name = $r[1] . ' (' . strtoupper($r[2]) . ')';
    }
    return ['folder' => $c['folders'][0], 'name' => $name];
}

/**
 * The collection's items as videos for the matcher, a console folder each. Only
 * disc 1 is kept: a snap cut from a later disc opens mid-story.
 */
function xs_av_wol_videos(array $items, array $folders): array
{
    $want = array_flip($folders);
    $out  = [];
    foreach ($items as $it) {
        $id    = is_array($it) ? (string) ($it['identifier'] ?? '') : '';
        $title = is_array($it) ? (string) ($it['title'] ?? '') : '';
        $said  = $id === '' ? null : xs_av_wol_title($title);
        if ($said === null || !isset($want[$said['folder']])) {
            continue;
        }
        if (preg_match('/\(\s*dis[ck]\s*0*([0-9]+)[^)]*\)/iu', $said['name'], $d) && (int) $d[1] > 1) {
            continue;
        }
        $out[$said['folder']][] = ['abs' => '', 'rel' => $said['folder'] . '/longplays/' . $said['name'] . '.mp4', 'set' => 'longplays',
                                   'name' => $said['name'] . '.mp4', 'size' => 0, 'hevc' => false, 'id' => $id, 'path' => '', 'md5' => ''];
    }
    return $out;
}

/**
 * The file of a recording to cut from: the Archive's smaller H.264 copy, which a
 * browser plays and whose index sits at the front. ['path', 'who'], or null with $why.
 */
function xs_av_wol_file(string $json, ?string &$why = null): ?array
{
    $why = null;
    $doc = json_decode(xs_strip_bom($json), true);
    if (!is_array($doc) || !is_array($doc['files'] ?? null)) {
        $why = 'what came was not a recording\'s description';
        return null;
    }
    $who = is_array($doc['metadata'] ?? null) ? ($doc['metadata']['creator'] ?? '') : '';
    $who = trim(is_array($who) ? implode(', ', array_map('strval', $who)) : (string) $who);
    // Smaller copies go by the item's age: .ia.mp4, then "h.264" .mp4, then "512Kb MPEG4".
    // An .mp4 original may have none, and only its first seconds are read anyway.
    $best = null;
    foreach ($doc['files'] as $f) {
        $path = is_array($f) ? (string) ($f['name'] ?? '') : '';
        $src  = is_array($f) ? (string) ($f['source'] ?? '') : '';
        if ($path === '' || str_contains($path, '..')) {
            continue;
        }
        $low  = strtolower($path);
        $fmt  = strtolower((string) ($f['format'] ?? ''));
        $rank = $src === 'derivative'
              ? (str_ends_with($low, '.ia.mp4') || $fmt === 'h.264 ia' ? 1
              : ($fmt === 'h.264' && str_ends_with($low, '.mp4') ? 2
              : (str_ends_with($low, '.mp4') && str_contains($fmt, 'mpeg4') ? 3 : 0)))
              : ($src === 'original' && str_ends_with($low, '.mp4')
                 && (str_contains($fmt, 'mpeg4') || str_contains($fmt, 'h.264')) ? 4 : 0);
        if ($rank > 0 && ($best === null || $rank < $best[0])) {
            $best = [$rank, $path];
        }
    }
    if ($best !== null) {
        return ['path' => $best[1], 'who' => $who];
    }
    $why = 'the recording has no smaller copy to cut from';
    return null;
}

/** The games the online archives were asked for and had nothing for: id => ['at', 'why', 'title', 'platform']. */
function xs_av_looked_path(): string
{
    return xs_data_path('archivevid-none.json');
}

function xs_av_looked(): array
{
    $rows = xs_read_json(xs_av_looked_path(), []);
    return is_array($rows) ? $rows : [];
}

/** These games, without the ones looked for before with nothing found: a fetch leaves those out until Look again. */
function xs_av_unlooked(array $games): array
{
    $looked = xs_av_looked();
    return $looked ? array_values(array_filter($games, static fn ($g) => !isset($looked[(string) $g['id']]))) : $games;
}

/**
 * Keeps that these games were looked for and nothing was found. A game that
 * has a video now, or is gone, is let go from the list at the same time.
 */
function xs_av_remember_none(array $s, array $library, array $games): void
{
    $still  = array_flip(array_column(xs_vp_need($s, $library), 'id'));
    $looked = array_intersect_key(xs_av_looked(), $still);
    foreach ($games as $g) {
        $id = (string) ($g['id'] ?? '');
        if ($id !== '' && isset($still[$id])) {
            $looked[$id] = ['at' => time(), 'why' => (string) ($g['why'] ?? ''), 'title' => (string) $g['title'], 'platform' => (string) $g['platform']];
        }
    }
    if ($looked || is_file(xs_av_looked_path())) {
        xs_write_json(xs_av_looked_path(), $looked);
    }
}

/** The games looked for before with nothing found that still have no video, for the window: [title, platform, why, at]. */
function xs_av_looked_list(array $s, array $library): array
{
    $looked = xs_av_looked();
    $rows = [];
    foreach ($looked ? xs_vp_need($s, $library) : [] as $g) {
        $r = $looked[(string) $g['id']] ?? null;
        if (is_array($r)) {
            $rows[] = ['title' => (string) $g['title'], 'platform' => (string) $g['platform'], 'why' => (string) ($r['why'] ?? ''), 'at' => (int) ($r['at'] ?? 0)];
        }
    }
    return $rows;
}

/**
 * Games with no video not already looked for in vain, by console, most first:
 * [['platform', 'need', 'sets', 'videos' => in the Archive's sets, 'wol' => World of Longplays can fill gaps]].
 */
function xs_av_need(array $s, array $library): array
{
    $by = [];
    foreach (xs_av_unlooked(xs_vp_need($s, $library)) as $g) {
        $by[$g['platform']] = ($by[$g['platform']] ?? 0) + 1;
    }
    $rows = [];
    foreach ($by as $platform => $need) {
        $sets   = xs_av_sets_for((string) $platform);
        $rows[] = ['platform' => (string) $platform, 'need' => $need, 'sets' => count($sets),
                   'videos' => (int) array_sum(array_map(static fn ($x) => (int) ($x['videos'] ?? 0), $sets)),
                   'wol' => xs_av_wol_for((string) $platform)];
    }
    usort($rows, static fn ($a, $b) => [$b['sets'] > 0 || $b['wol'], $b['need']] <=> [$a['sets'] > 0 || $a['wol'], $a['need']] ?: strcasecmp($a['platform'], $b['platform']));
    return $rows;
}

/** Fetch the videos for the games of these consoles that have none. */
function xs_av_start(array $platforms, ?string &$why = null): bool
{
    $why = null;
    if ((xs_av_job()['state'] ?? '') === 'running') {
        $why = 'videos are being fetched from the Internet Archive already: that has to finish first';
        return false;
    }
    if (xs_curl_exe() === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on), and that is what fetches the videos';
        return false;
    }
    $platforms = array_values(array_unique(array_filter(array_map(static fn ($p) => mb_substr(trim((string) $p), 0, 120), $platforms),
        static fn ($p) => $p !== '' && (xs_av_sets_for($p) || xs_av_wol_for($p)))));
    if (!$platforms) {
        $why = 'select a console the online archives have videos for first';
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'platforms' => $platforms, 'sets' => 0, 'setsAt' => 0,
            'games' => 0, 'at' => 0, 'found' => 0, 'added' => 0, 'bytes' => 0, 'total' => 0, 'said' => ''];
    @unlink(xs_av_stop_path());
    if (!xs_write_json(xs_av_job_path(), $job, $why)) {
        return false;
    }
    // Arcade games go to the Arcade Database first; its worker starts this one when it is through.
    require_once __DIR__ . '/arcadevid.php';
    if (xs_ad_first($platforms)) {
        xs_log('ARCV', 'asked to fetch videos for ' . count($platforms) . ' consoles, the arcade games from the Arcade Database first: ' . implode(', ', $platforms));
        return true;
    }
    if (!xs_spawn_worker('archivevid.php')) {
        $why = 'it could not be started';
        xs_write_json(xs_av_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    xs_log('ARCV', 'asked to fetch videos from the Internet Archive for ' . count($platforms) . ' consoles: ' . implode(', ', $platforms));
    return true;
}

/** A set's list of files as the Archive gave it, as videos for the matcher's shelf. Null when it is no such list. */
function xs_av_videos(array $set, string $json): ?array
{
    $doc  = json_decode(xs_strip_bom($json), true);
    $list = is_array($doc) ? ($doc['result'] ?? $doc['files'] ?? null) : null;
    if (!is_array($list)) {
        return null;
    }
    $out = [];
    foreach ($list as $f) {
        $path = is_array($f) ? (string) ($f['name'] ?? '') : '';
        // The set's own files only: the Archive adds re-made copies of some, marked as its own.
        if ($path === '' || str_contains($path, '..') || (($f['source'] ?? 'original') !== 'original')
            || !in_array(strtolower(pathinfo($path, PATHINFO_EXTENSION)), ['mp4', 'm4v', 'webm'], true)) {
            continue;
        }
        $out[] = ['abs' => '', 'rel' => $set['folder'] . '/' . $set['whose'] . '/' . basename($path), 'set' => (string) $set['whose'],
                  'name' => basename($path), 'size' => (int) ($f['size'] ?? 0), 'hevc' => !empty($set['hevc']),
                  'id' => (string) $set['id'], 'path' => $path, 'md5' => strtolower((string) ($f['md5'] ?? ''))];
    }
    return $out;
}

/** The address of one file of a set. */
function xs_av_file_url(string $id, string $path): string
{
    return str_replace(['{id}', '{path}'], [rawurlencode($id), implode('/', array_map('rawurlencode', explode('/', $path)))], xs_av_source()['file']);
}

/**
 * One message for the games a fetch left with no video, pointing to ScreenScraper videos. It
 * replaces the last fetch's message; with no game left there is none.
 */
function xs_av_tell(array $none): void
{
    require_once __DIR__ . '/news.php';
    $was  = xs_messages();
    $kept = array_values(array_filter($was, static fn (array $m): bool => (string) ($m['key'] ?? '') !== 'archivevid:none'));
    if (!$none) {
        if (count($kept) !== count($was)) {
            xs_write_json(xs_messages_path(), $kept);
        }
        return;
    }
    $noSet = [];
    $some  = [];
    foreach ($none as $g) {
        $p = (string) ($g['platform'] ?? '?');
        if (str_starts_with((string) ($g['why'] ?? ''), 'no videos for this console')) {
            $noSet[$p] = ($noSet[$p] ?? 0) + 1;
        } else {
            $some[$p] = ($some[$p] ?? 0) + 1;
        }
    }
    arsort($noSet);
    arsort($some);
    $names = static function (array $by): string {
        $said = array_map(static fn ($p, $n) => $p . ' (' . $n . ')', array_keys($by), $by);
        $more = count($said) - 6;
        $said = array_slice($said, 0, 6);
        if ($more > 0) {
            $said[] = $more . ' more ' . ($more === 1 ? 'console' : 'consoles');
        }
        $last = array_pop($said);
        return $said ? implode(', ', $said) . ' and ' . $last : (string) $last;
    };
    $n = count($none);
    array_unshift($kept, [
        'id'       => 'msg-' . bin2hex(random_bytes(6)),
        'at'       => date('c'),
        'kind'     => 'novideo',
        'key'      => 'archivevid:none',
        'title'    => $n === 1 ? '1 game got no video' : $n . ' games got no video',
        'body'     => 'These videos come from the Internet Archive (archive.org): sets of game videos, and the first 30 seconds of a World of Longplays recording where a set leaves a gap. It does not have one for every game.'
                    . ($noSet ? ' It has none at all for ' . $names($noSet) . '.' : '')
                    . ($some ? ' It has none Xsegon is sure of for some games on ' . $names($some) . '.' : '')
                    . ' ScreenScraper has short videos of many more: Pictures & Videos > ScreenScraper videos fetches them with a free ScreenScraper account, quick to make, with no phone number asked.',
        'n'        => $n,
        'opens'    => ['screenscraper', 'archivevid'],     // the page turns each into a button (js/news.js)
        'read'     => false,
    ]);
    xs_write_json(xs_messages_path(), array_slice($kept, 0, XS_MESSAGES_KEPT));
    xs_log('ARCV', 'a message says ' . $n . ' games got no video: no set for ' . ($noSet ? $names($noSet) : 'none of them')
        . '; not found on ' . ($some ? $names($some) : 'none of them'));
}
