<?php
/**
 * Xsegon - manuals for the games that have none, from the Internet Archive (Get Media > Manuals from online archives).
 *
 * Xsegon ships only the list of the Archive's manual sets (includes\archivedoc\sets.json); each set's
 * file list is asked for at a press, matched by name (includes\videomatch.php) and not kept. A manual
 * is kept as data\documents\<game id>\Manual.pdf, where the game's Documents and the booklet reader find it.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/extras.php';
require_once __DIR__ . '/videomatch.php';
require_once __DIR__ . '/archivevid.php';
require_once __DIR__ . '/versions.php';

/** The name the Archive's manual sets go by in the matcher, apart from its video sets. */
const XS_MA_ROOT = 'archive.org/manuals';

/** The regions whose manuals are in English. A manual of the game's own region is taken too, whatever its language. */
const XS_MA_ENGLISH = ['usa', 'world', 'europe', 'australia'];

function xs_ma_job_path(): string
{
    return xs_data_path('archivedoc-job.json');
}

function xs_ma_stop_path(): string
{
    return xs_data_path('archivedoc-stop');
}

/** The job as its worker left it, or null; a worker that is gone is said. */
function xs_ma_job(): ?array
{
    $job = xs_read_json(xs_ma_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_ma_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/** The sets Xsegon knows of. A test copy reads its own list from its data. */
function xs_ma_sets(): array
{
    static $sets = null;
    if ($sets === null) {
        $own  = xs_data_path('archivedoc-sets.json');
        $doc  = xs_read_json(xs_test_copy() && is_file($own) ? $own
              : XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'archivedoc' . DIRECTORY_SEPARATOR . 'sets.json', null);
        $sets = [];
        foreach (is_array($doc['sets'] ?? null) ? $doc['sets'] : [] as $set) {
            if (is_array($set) && is_string($set['id'] ?? null) && is_string($set['folder'] ?? null)) {
                $sets[] = $set;
            }
        }
    }
    return $sets;
}

/** The sets that hold a console's manuals, the console's best folder first. */
function xs_ma_sets_for(string $platform): array
{
    $c = xs_vm_console($platform);
    $out = [];
    foreach ($c === null ? [] : $c['folders'] as $folder) {
        foreach (xs_ma_sets() as $set) {
            if ($set['folder'] === $folder) {
                $out[] = $set;
            }
        }
    }
    return $out;
}

/** Whether a game has a manual already: a document of its own whose name starts with "Manual". */
function xs_ma_has(string $id): bool
{
    foreach (xs_docs_for($id) as $d) {
        if (stripos((string) $d['label'], 'manual') === 0) {
            return true;
        }
    }
    return false;
}

/** Where a fetched manual is kept. */
function xs_ma_place(string $id): string
{
    return xs_docs_dir() . DIRECTORY_SEPARATOR . $id . DIRECTORY_SEPARATOR . 'Manual.pdf';
}

/**
 * The games with no manual, a card each as the list rolls versions into one, since a card shows
 * the first version's manual that has one: ['id' => its first version, 'ids', 'title', 'platform', 'files'].
 */
function xs_ma_need(array $library): array
{
    $have  = xs_docs_have();
    $cards = [];
    foreach ($library['games'] ?? [] as $g) {
        $id = (string) ($g['id'] ?? '');
        if (!xs_game_id_ok($id)) {
            continue;
        }
        $k = xs_version_key($g);
        $cards[$k] ??= ['id' => $id, 'ids' => [], 'title' => (string) $g['title'], 'platform' => (string) $g['platform'], 'files' => [], 'has' => false];
        $cards[$k]['ids'][] = $id;
        $file = basename(str_replace('\\', '/', (string) ($g['romPath'] ?? '')));
        if ($file !== '') {
            $cards[$k]['files'][] = $file;
        }
        if (!$cards[$k]['has'] && isset($have[$id]) && xs_ma_has($id)) {
            $cards[$k]['has'] = true;
        }
    }
    $rows = [];
    foreach ($cards as $c) {
        if (!$c['has']) {
            unset($c['has']);
            $rows[] = $c;
        }
    }
    usort($rows, static fn ($a, $b) => strcasecmp($a['platform'], $b['platform']) ?: strcasecmp($a['title'], $b['title']));
    return $rows;
}

/** The games looked for with nothing found: card id => ['at', 'why', 'title', 'platform']. */
function xs_ma_looked_path(): string
{
    return xs_data_path('archivedoc-none.json');
}

function xs_ma_looked(): array
{
    $rows = xs_read_json(xs_ma_looked_path(), []);
    return is_array($rows) ? $rows : [];
}

/** These games, without the ones looked for before with nothing found: a fetch leaves those out until Look again. */
function xs_ma_unlooked(array $cards): array
{
    $looked = xs_ma_looked();
    return $looked ? array_values(array_filter($cards, static fn ($c) => !isset($looked[(string) $c['id']]))) : $cards;
}

/** Keeps that these games were looked for and nothing was found; one that has a manual now, or is gone, is let go. */
function xs_ma_remember_none(array $library, array $cards): void
{
    $still  = array_flip(array_column(xs_ma_need($library), 'id'));
    $looked = array_intersect_key(xs_ma_looked(), $still);
    foreach ($cards as $c) {
        $id = (string) ($c['id'] ?? '');
        if ($id !== '' && isset($still[$id])) {
            $looked[$id] = ['at' => time(), 'why' => (string) ($c['why'] ?? ''), 'title' => (string) $c['title'], 'platform' => (string) $c['platform']];
        }
    }
    if ($looked || is_file(xs_ma_looked_path())) {
        xs_write_json(xs_ma_looked_path(), $looked);
    }
}

/** The games looked for before with nothing found that still have no manual, for the window. */
function xs_ma_looked_list(array $library): array
{
    $looked = xs_ma_looked();
    $rows = [];
    foreach ($looked ? xs_ma_need($library) : [] as $c) {
        $r = $looked[(string) $c['id']] ?? null;
        if (is_array($r)) {
            $rows[] = ['title' => $c['title'], 'platform' => $c['platform'], 'why' => (string) ($r['why'] ?? ''), 'at' => (int) ($r['at'] ?? 0)];
        }
    }
    return $rows;
}

/**
 * Games with no manual not already looked for in vain, by console, the ones the Archive has
 * sets for first, then most first: [['platform', 'need', 'sets', 'manuals' => in those sets]].
 */
function xs_ma_consoles(array $library): array
{
    $by = [];
    foreach (xs_ma_unlooked(xs_ma_need($library)) as $c) {
        $by[$c['platform']] = ($by[$c['platform']] ?? 0) + 1;
    }
    $rows = [];
    foreach ($by as $platform => $need) {
        $sets   = xs_ma_sets_for((string) $platform);
        $rows[] = ['platform' => (string) $platform, 'need' => $need, 'sets' => count($sets),
                   'manuals' => (int) array_sum(array_map(static fn ($x) => (int) ($x['manuals'] ?? 0), $sets))];
    }
    usort($rows, static fn ($a, $b) => [$b['sets'] > 0, $b['need']] <=> [$a['sets'] > 0, $a['need']] ?: strcasecmp($a['platform'], $b['platform']));
    return $rows;
}

/** Fetch the manuals for the games of these consoles that have none. */
function xs_ma_start(array $platforms, ?string &$why = null): bool
{
    $why = null;
    if ((xs_ma_job()['state'] ?? '') === 'running') {
        $why = 'manuals are being fetched from the Internet Archive already: that has to finish first';
        return false;
    }
    if (xs_curl_exe() === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on), and that is what fetches the manuals';
        return false;
    }
    $platforms = array_values(array_unique(array_filter(array_map(static fn ($p) => mb_substr(trim((string) $p), 0, 120), $platforms),
        static fn ($p) => $p !== '' && xs_ma_sets_for($p))));
    if (!$platforms) {
        $why = 'select a console the online archives have manuals for first';
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'platforms' => $platforms, 'sets' => 0, 'setsAt' => 0,
            'games' => 0, 'at' => 0, 'found' => 0, 'added' => 0, 'bytes' => 0, 'total' => 0, 'said' => ''];
    @unlink(xs_ma_stop_path());
    if (!xs_write_json(xs_ma_job_path(), $job, $why)) {
        return false;
    }
    if (!xs_spawn_worker('archivedoc.php')) {
        $why = 'it could not be started';
        xs_write_json(xs_ma_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    xs_log('MANU', 'asked to fetch manuals from the Internet Archive for ' . count($platforms) . ' consoles: ' . implode(', ', $platforms));
    return true;
}

/** A set's list of files as the Archive gave it, its manuals as the matcher's shelf. Null when it is no such list. */
function xs_ma_manuals(array $set, string $json): ?array
{
    $doc  = json_decode(xs_strip_bom($json), true);
    $list = is_array($doc) ? ($doc['result'] ?? $doc['files'] ?? null) : null;
    if (!is_array($list)) {
        return null;
    }
    $out = [];
    foreach ($list as $f) {
        $path = is_array($f) ? (string) ($f['name'] ?? '') : '';
        // The set's own PDFs only: the Archive adds a searchable copy of each, "_text.pdf", as its own.
        if ($path === '' || str_contains($path, '..') || (($f['source'] ?? 'original') !== 'original')
            || strtolower(pathinfo($path, PATHINFO_EXTENSION)) !== 'pdf' || preg_match('/_text\.pdf$/i', $path)) {
            continue;
        }
        $out[] = ['abs' => '', 'rel' => $set['folder'] . '/' . $set['id'] . '/' . basename($path), 'set' => (string) $set['id'],
                  'name' => basename($path), 'size' => (int) ($f['size'] ?? 0), 'hevc' => false,
                  'id' => (string) $set['id'], 'path' => $path, 'md5' => strtolower((string) ($f['md5'] ?? ''))];
    }
    return $out;
}

/** The matcher's words, which speak of videos, said of manuals and of the Archive. */
function xs_ma_words(string $why): string
{
    return str_replace(['no videos for this console in the folder', ' videos for ', 'only a video with a similar name', ' in the folder'],
                       ['no manuals for this console on the Internet Archive', ' manuals for ', 'only a manual with a similar name', ' on the Internet Archive'], $why);
}

/**
 * Whether a manual can be read: in English (a USA, World, Europe or Australia release, or a name
 * that says no region), or of the game's own region. Its regions are named when it cannot.
 */
function xs_ma_language_ok(array $manual, string $gameFile, ?string &$regions = null): bool
{
    $has = (array) ($manual['marks']['regions'] ?? []);
    $regions = implode(', ', array_map('ucfirst', $has));
    if (!$has || array_intersect($has, XS_MA_ENGLISH)) {
        return true;
    }
    $own = $gameFile === '' ? [] : xs_vm_marks(pathinfo($gameFile, PATHINFO_FILENAME))['regions'];
    return (bool) array_intersect($has, $own);
}

/**
 * One message for the games a fetch left with no manual. It replaces the last fetch's message;
 * with no game left there is none.
 */
function xs_ma_tell(array $none): void
{
    require_once __DIR__ . '/news.php';
    $was  = xs_messages();
    $kept = array_values(array_filter($was, static fn (array $m): bool => (string) ($m['key'] ?? '') !== 'archivedoc:none'));
    if (!$none) {
        if (count($kept) !== count($was)) {
            xs_write_json(xs_messages_path(), $kept);
        }
        return;
    }
    $by = [];
    foreach ($none as $g) {
        $p = (string) ($g['platform'] ?? '?');
        $by[$p] = ($by[$p] ?? 0) + 1;
    }
    arsort($by);
    $said = array_map(static fn ($p, $n) => $p . ' (' . $n . ')', array_keys($by), $by);
    $more = count($said) - 6;
    $said = array_slice($said, 0, 6);
    if ($more > 0) {
        $said[] = $more . ' more ' . ($more === 1 ? 'console' : 'consoles');
    }
    $last  = array_pop($said);
    $named = $said ? implode(', ', $said) . ' and ' . $last : (string) $last;
    $n = count($none);
    array_unshift($kept, [
        'id'    => 'msg-' . bin2hex(random_bytes(6)),
        'at'    => date('c'),
        'kind'  => 'nomanual',
        'key'   => 'archivedoc:none',
        'title' => $n === 1 ? '1 game got no manual' : $n . ' games got no manual',
        'body'  => 'These manuals come from the Internet Archive (archive.org): sets of game manuals, a console each, mostly the North American releases. '
                 . 'It does not have one for every game, and a manual Xsegon is not sure is the game\'s is left out. None came for games on ' . $named . '. '
                 . 'ScreenScraper has manuals of many more: Get Media > ScreenScraper videos fetches them, with Manuals too selected, using a free ScreenScraper account.',
        'n'     => $n,
        'opens' => ['screenscraper', 'archivedoc'],     // the page turns each into a button (js/news.js)
        'read'  => false,
    ]);
    xs_write_json(xs_messages_path(), array_slice($kept, 0, XS_MESSAGES_KEPT));
    xs_log('MANU', 'a message says ' . $n . ' games got no manual: ' . $named);
}
