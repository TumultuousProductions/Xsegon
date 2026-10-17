<?php
/**
 * Xsegon - the Extensions page: programs Xsegon works with, fetched from their makers on a
 * person's press and never shipped (roadmap AU11, js\extensions.js).
 *
 *     includes\extensions\extensions.json   the list, shipped with Xsegon
 *     data\extensions.json                  a folder chosen for each, what Xsegon put there
 *     data\extensions-job.json              Set up or Get at work, as bin\extensions.php leaves it
 *
 * Flashpoint Archive is the one entry so far (includes\flashpoint.php). Xsegon never hosts a
 * file and never takes away a program it did not put there.
 */
declare(strict_types=1);

require_once __DIR__ . '/flashpoint.php';

/** An address the list may name: https, on a host of letters and dots. */
function xs_ext_url_ok(string $u): bool
{
    return (bool) preg_match('#^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[A-Za-z0-9._~%/+-]*)?$#', $u);
}

/** The shipped list, each entry checked; a test copy may hand its own in data\extensions-list.json. */
function xs_ext_list(): array
{
    static $list = null;
    if ($list !== null) {
        return $list;
    }
    $own = xs_data_path('extensions-list.json');
    $doc = xs_read_json(xs_test_copy() && is_file($own) ? $own
        : XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'extensions' . DIRECTORY_SEPARATOR . 'extensions.json', null);
    $list = [];
    foreach (is_array($doc['extensions'] ?? null) ? $doc['extensions'] : [] as $x) {
        if (!is_array($x) || !preg_match('/^[a-z0-9-]{1,40}$/', (string) ($x['id'] ?? '')) || !is_string($x['name'] ?? null)
            || !xs_ext_url_ok((string) ($x['page'] ?? ''))) {
            continue;
        }
        if (isset($x['repo']) && !(xs_ext_url_ok((string) $x['repo']) && str_starts_with((string) $x['repo'], 'https://github.com/'))) {
            unset($x['repo']);
        }
        // The makers' own download, named on their own page with its size and checksum, or no Get at all.
        $g = $x['get'] ?? null;
        if (!is_array($g) || !xs_ext_url_ok((string) ($g['url'] ?? '')) || !xs_ext_url_ok((string) ($g['listed'] ?? ''))
            || (int) ($g['size'] ?? 0) <= 0 || !preg_match('/^[0-9a-f]{64}$/', (string) ($g['sha256'] ?? ''))
            || !preg_match('/^[A-Za-z0-9 ._()-]{1,80}\.(7z|zip)$/', (string) ($g['file'] ?? ''))) {
            unset($x['get']);
        }
        // The helper's releases: each a GitHub release download of its own project, with its size and checksum.
        $h = $x['helper'] ?? null;
        if (is_array($h)) {
            $repo = (string) ($h['repo'] ?? '');
            $h['fits'] = array_values(array_filter((array) ($h['fits'] ?? []), static fn($f) => is_array($f)
                && preg_match('/^v[0-9.]{1,20}$/', (string) ($f['tag'] ?? '')) && preg_match('/^[A-Za-z0-9._-]{1,100}\.zip$/', (string) ($f['asset'] ?? ''))
                && (int) ($f['size'] ?? 0) > 0 && preg_match('/^[0-9a-f]{64}$/', (string) ($f['sha256'] ?? '')) && is_string($f['flashpoint'] ?? null)));
            if (!preg_match('#^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', $repo) || !$h['fits'] || !is_string($h['name'] ?? null)) {
                $h = null;
            }
        }
        $x['helper'] = $h;
        $list[$x['id']] = $x;
    }
    return $list;
}

/** Where a helper release is downloaded from: its project's own GitHub. */
function xs_ext_helper_url(array $helper, array $fit): string
{
    return $helper['repo'] . '/releases/download/' . $fit['tag'] . '/' . $fit['asset'];
}

/** An address of an entry's, by which: its website, its source, its download page, its helper's. Null when it has none. */
function xs_ext_url(string $id, string $which): ?string
{
    $x = xs_ext_list()[$id] ?? null;
    if ($x === null) {
        return null;
    }
    $u = ['page' => $x['page'] ?? null, 'repo' => $x['repo'] ?? null, 'listed' => $x['get']['listed'] ?? null,
          'helper' => $x['helper']['repo'] ?? null][$which] ?? null;
    return is_string($u) && xs_ext_url_ok($u) ? $u : null;
}

function xs_ext_job_path(): string
{
    return xs_data_path('extensions-job.json');
}

function xs_ext_stop_path(): string
{
    return xs_data_path('extensions-stop');
}

/** Set up or Get as its worker left it, or null; a worker that is gone is said. */
function xs_ext_job(): ?array
{
    $job = xs_read_json(xs_ext_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_ext_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/**
 * Where Flashpoint stands on this PC, for its tile and panel. 'section': here (found), ready
 * (not found, and Get can fetch it). 'next' is the panel's first button: get, open (Flashpoint
 * has no game list yet: its own first start makes it), setup (the helper is not beside it),
 * bring (no game of it in your library yet), list (its games are here), or none (a Flashpoint
 * this Xsegon does not know how to start).
 */
function xs_ext_flashpoint(array $x): array
{
    $root = xs_fp_root();
    $helper = is_array($x['helper'] ?? null) ? $x['helper'] : ['fits' => []];
    $st = ['section' => $root !== '' ? 'here' : 'ready', 'folder' => $root, 'version' => null, 'games' => null,
           'playlists' => [], 'mine' => 0, 'helperHere' => null, 'fit' => null, 'next' => isset($x['get']) ? 'get' : 'none',
           'chosen' => (string) (xs_ext_state()['flashpoint']['folder'] ?? ''), 'put' => (array) (xs_ext_state()['flashpoint']['put'] ?? [])];
    if ($root === '') {
        return $st;
    }
    require_once __DIR__ . '/local.php';
    $v = xs_fp_version($root);
    $st['version'] = $v;
    $st['games'] = xs_fp_count($root);
    $here = xs_fp_here(xs_local_read());
    $st['mine'] = count($here);
    foreach (xs_fp_playlists($root) as $p) {
        $st['playlists'][] = ['file' => $p['file'], 'title' => $p['title'], 'count' => $p['count'], 'favourites' => $p['favourites'],
                              'here' => count(array_filter($p['ids'], static fn($i) => isset($here[$i])))];
    }
    $fit = xs_fp_fit($helper, $v['number']);
    $st['fit'] = $fit === null ? null : ['tag' => $fit['tag'], 'flashpoint' => $fit['flashpoint'], 'size' => (int) $fit['size']];
    $st['helperHere'] = xs_fp_helper_here($root, $helper);
    $st['next'] = !$st['games'] ? 'open'
        : (!$st['helperHere']['there'] ? ($fit === null ? 'none' : 'setup')
        : ($st['mine'] ? 'list' : 'bring'));
    return $st;
}

/** Every entry and where it stands, in the list's order. */
function xs_ext_states(): array
{
    $out = [];
    foreach (xs_ext_list() as $id => $x) {
        $st = $id === 'flashpoint' ? xs_ext_flashpoint($x) : ['section' => isset($x['get']) ? 'ready' : 'needs', 'next' => isset($x['get']) ? 'get' : 'none'];
        $get = $x['get'] ?? null;
        $out[] = ['id' => $id, 'name' => $x['name'], 'kind' => (string) ($x['kind'] ?? ''), 'adds' => (string) ($x['adds'] ?? ''),
                  'by' => (string) ($x['by'] ?? ''), 'licence' => (string) ($x['licence'] ?? ''), 'size' => (string) ($x['size'] ?? ''),
                  'page' => $x['page'], 'repo' => $x['repo'] ?? null,
                  'get' => $get === null ? null : ['version' => (string) ($get['version'] ?? ''), 'file' => $get['file'], 'size' => (int) $get['size'],
                                                   'listed' => $get['listed']],
                  'helper' => $x['helper'] === null ? null : ['name' => $x['helper']['name'], 'by' => (string) ($x['helper']['by'] ?? ''),
                                                             'licence' => (string) ($x['helper']['licence'] ?? ''), 'repo' => $x['helper']['repo']]]
               + $st;
    }
    return $out;
}

/**
 * Start Set up (the helper fetched and put beside the program) or Get (the program fetched and
 * unpacked into $into), in the background. False with $why when it cannot be.
 */
function xs_ext_start(string $id, string $action, string $into, ?string &$why = null): bool
{
    $why = null;
    $x = xs_ext_list()[$id] ?? null;
    if ($x === null || $id !== 'flashpoint') {
        $why = 'Xsegon knows no such program';
        return false;
    }
    if ((xs_ext_job()['state'] ?? '') === 'running') {
        $why = (string) (xs_ext_job()['name'] ?? 'something') . ' is at work already: that has to finish first';
        return false;
    }
    if (xs_curl_exe() === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on), and that is what downloads it';
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'id' => $id, 'action' => $action,
            'bytes' => 0, 'total' => 0, 'said' => ''];
    if ($action === 'setup') {
        $root = xs_fp_root();
        $fit = $root === '' ? null : xs_fp_fit((array) ($x['helper'] ?? []), xs_fp_version($root)['number']);
        if ($root === '' || $fit === null) {
            $why = $root === '' ? 'Flashpoint was not found on this PC' : 'no release of ' . (string) ($x['helper']['name'] ?? 'its helper') . ' is known for this Flashpoint';
            return false;
        }
        if (is_file($root . DIRECTORY_SEPARATOR . XS_FP_HELPER)) {
            $why = XS_FP_HELPER . ' is beside Flashpoint already: it is set up';
            return false;
        }
        $job += ['name' => 'Set up ' . $x['name'], 'root' => $root, 'tag' => $fit['tag'], 'url' => xs_ext_helper_url($x['helper'], $fit),
                 'file' => $fit['asset'], 'size' => (int) $fit['size'], 'sha256' => $fit['sha256'], 'helper' => (string) $x['helper']['name']];
    } elseif ($action === 'get') {
        $g = $x['get'] ?? null;
        $into = xs_norm_path($into);
        if (!is_array($g)) {
            $why = 'Xsegon has no download of ' . $x['name'] . ' to fetch';
            return false;
        }
        if ($into === '' || !preg_match('#^[A-Za-z]:\\\\#', $into . '\\') || !is_dir($into)) {
            $why = 'choose the folder it goes in first';
            return false;
        }
        $to = $into . DIRECTORY_SEPARATOR . 'Flashpoint';
        if (file_exists($to) && array_diff((array) @scandir($to), ['.', '..'])) {
            $why = $to . ' is there already and is not empty: choose another folder';
            return false;
        }
        $job += ['name' => 'Get ' . $x['name'], 'to' => $to, 'url' => $g['url'], 'file' => $g['file'], 'size' => (int) $g['size'],
                 'sha256' => $g['sha256'], 'version' => (string) ($g['version'] ?? '')];
    } else {
        $why = 'no such step';
        return false;
    }
    @unlink(xs_ext_stop_path());
    if (!xs_write_json(xs_ext_job_path(), $job, $why)) {
        return false;
    }
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'display_startup_errors=0', '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'extensions.php'];
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        $why = 'the worker that fetches it could not be started';
        xs_write_json(xs_ext_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    pclose($h);
    xs_log('EXTN', $job['name'] . ' asked: ' . $job['url']);
    return true;
}
