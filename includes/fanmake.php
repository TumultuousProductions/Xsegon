<?php
/**
 * Xsegon - Make, on the Fan projects page: a project made from a game you own (roadmap AQ2).
 *
 *     data\fanmake-job.json   the make at work, as its worker (bin\fanmake.php) leaves it
 *     data\fanmake-stop       asks the worker to stop
 *     data\fan-made.json      { "<game id>": { "project", "version", "md5", "at" } }: what Make made
 *
 * Everything comes from the team's own place, named in the list. A patch: their list of
 * releases and the patch from their site, checked against the CRC32 their GitHub release
 * lists for it; the made copy goes in its console's Hacks folder and joins that console's
 * list, tied to the game. A PC version (roadmap AQ3): the Windows download of their GitHub
 * release, checked against what GitHub says of it, unpacked into the console's Ports folder
 * and given your game, then added to your Windows list. The game it is made from is read,
 * never changed.
 */
declare(strict_types=1);

require_once __DIR__ . '/fanprojects.php';

/** The most of a release's zip read to find its listing: the listing sits at the end. */
const XS_FM_TAIL = 262144;

function xs_fm_job_path(): string
{
    return xs_data_path('fanmake-job.json');
}

function xs_fm_stop_path(): string
{
    return xs_data_path('fanmake-stop');
}

function xs_fm_made_path(): string
{
    return xs_data_path('fan-made.json');
}

/** What Make has made, by the game id each joined the library as. */
function xs_fm_made(): array
{
    $a = xs_read_json(xs_fm_made_path(), []);
    return is_array($a) ? $a : [];
}

/** The make as its worker left it, or null; a worker that is gone is said. */
function xs_fm_job(): ?array
{
    $job = xs_read_json(xs_fm_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_fm_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/** Where an address is fetched from: in a test copy, the test's own stand-in under data\fan-fixtures\remote. */
function xs_fm_source(string $url): string
{
    if (!xs_test_copy()) {
        return $url;
    }
    $u = parse_url($url);
    $path = xs_data_path('fan-fixtures' . DIRECTORY_SEPARATOR . 'remote' . DIRECTORY_SEPARATOR . (string) ($u['host'] ?? '')
        . str_replace('/', DIRECTORY_SEPARATOR, rawurldecode((string) ($u['path'] ?? ''))));
    return 'file:///' . str_replace([' ', '\\'], ['%20', '/'], $path);
}

/**
 * One small thing fetched with Windows' own curl.exe into memory, or null with $why. $range:
 * the bytes "from-to" only. Nothing comes for 30 seconds, or a minute in all, and it is given up.
 */
function xs_fm_fetch(string $url, ?string &$why = null, string $range = '', array $headers = []): ?string
{
    $why = null;
    $curl = xs_curl_exe();
    if ($curl === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on)';
        return null;
    }
    $tmp = xs_data_path('fanmake-' . substr(sha1($url . '|' . $range . '|' . microtime()), 0, 10) . '.part');
    $cmd = [$curl, '-L', '--fail', '--silent', '--show-error', '--connect-timeout', '30', '--max-time', '60', '-A', 'Xsegon'];
    foreach ($headers as $h) {
        array_push($cmd, '-H', $h);
    }
    if ($range !== '') {
        array_push($cmd, '-r', $range);
    }
    array_push($cmd, '-o', $tmp, xs_fm_source($url));
    $proc = @proc_open($cmd, [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $tmp . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        $why = 'curl.exe could not be started';
        return null;
    }
    $code = proc_close($proc);
    $said = trim((string) @file_get_contents($tmp . '.err'));
    $got = @file_get_contents($tmp);
    @unlink($tmp);
    @unlink($tmp . '.err');
    if ($code !== 0 || $got === false) {
        $why = $said !== '' ? mb_substr((string) preg_replace('/\s+/', ' ', $said), 0, 200) : 'curl ended with ' . $code;
        return null;
    }
    return $got;
}

/**
 * The CRC32 a GitHub release's zip lists for the file named $name, read from the zip's
 * last bytes alone; null with $why. $repo is the project's GitHub address.
 */
function xs_fm_github_crc(string $repo, string $tag, string $name, ?string &$why = null): ?string
{
    if (!preg_match('#^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)#', $repo, $m)) {
        $why = 'the list names no GitHub project to check the patch against';
        return null;
    }
    $raw = xs_fm_fetch('https://api.github.com/repos/' . $m[1] . '/' . $m[2] . '/releases/tags/' . rawurlencode($tag), $w,
        '', ['Accept: application/vnd.github+json']);
    $rel = $raw === null ? null : json_decode($raw, true);
    if (!is_array($rel)) {
        $why = 'GitHub did not answer about release ' . $tag . ($w !== null ? ': ' . $w : '');
        return null;
    }
    $zip = null;
    foreach ((array) ($rel['assets'] ?? []) as $a) {
        if (is_array($a) && str_ends_with(strtolower((string) ($a['name'] ?? '')), '.zip') && (int) ($a['size'] ?? 0) > 22) {
            $zip = $a;
            break;
        }
    }
    $url = (string) ($zip['browser_download_url'] ?? '');
    if ($zip === null || !str_starts_with($url, 'https://github.com/')) {
        $why = 'release ' . $tag . ' on GitHub has no zip to check the patch against';
        return null;
    }
    $size = (int) $zip['size'];
    $from = max(0, $size - XS_FM_TAIL);
    $tail = xs_fm_fetch($url, $w, $from . '-' . ($size - 1));
    if ($tail === null || strlen($tail) !== $size - $from) {
        $why = 'the end of release ' . $tag . '\'s zip did not come' . ($w !== null ? ': ' . $w : '');
        return null;
    }
    // The zip's last record says where its listing starts; each entry of it carries its file's CRC32.
    $end = strrpos($tail, "PK\x05\x06");
    if ($end === false || $end + 22 > strlen($tail)) {
        $why = 'release ' . $tag . '\'s zip does not end as a zip does';
        return null;
    }
    $at = unpack('V', $tail, $end + 16)[1] - $from;
    $count = unpack('v', $tail, $end + 10)[1];
    for ($i = 0; $i < $count && $at >= 0 && $at + 46 <= $end; $i++) {
        if (substr($tail, $at, 4) !== "PK\x01\x02") {
            break;
        }
        $e = unpack('Vcrc/x4/x4/vname/vextra/vnote', $tail, $at + 16);
        $file = substr($tail, $at + 46, $e['name']);
        if (strcasecmp(basename(str_replace('\\', '/', $file)), $name) === 0) {
            return sprintf('%08x', $e['crc']);
        }
        $at += 46 + $e['name'] + $e['extra'] + $e['note'];
    }
    $why = 'release ' . $tag . '\'s zip does not list ' . $name . ($at < 0 ? ' in its last ' . (XS_FM_TAIL >> 10) . ' KB' : '');
    return null;
}

/**
 * The folder a made copy goes in, beside the console's games: its Hacks folder for a patched
 * copy, its Ports folder for a PC version (a test copy keeps its own under its data folder).
 */
function xs_fm_dest(string $platform, string $baseRom, string $kind = 'Hacks'): string
{
    require_once __DIR__ . '/unpack.php';
    if (xs_test_copy()) {
        return xs_data_path('fan-made' . DIRECTORY_SEPARATOR . preg_replace('/[^A-Za-z0-9 ]+/', '', $platform) . DIRECTORY_SEPARATOR . $kind);
    }
    $home = xs_unpack_folder_for($platform, $baseRom);
    $dir = $home['there'] ? (string) $home['dir'] : dirname($baseRom);
    // A folder the person made by hand is used as it is named: Hack or Hacks, Port or Ports.
    $like = $kind === 'Hacks' ? '/^hacks?$/i' : '/^ports?$/i';
    foreach (@scandir($dir) ?: [] as $n) {
        if (preg_match($like, (string) $n) && is_dir($dir . DIRECTORY_SEPARATOR . $n)) {
            return $dir . DIRECTORY_SEPARATOR . $n;
        }
    }
    return $dir . DIRECTORY_SEPARATOR . $kind;
}

/**
 * The release Make takes from a project's GitHub: the latest, or the tag the recipe names,
 * and the one file of it whose name the recipe's pattern fits. Null with $why.
 */
function xs_fm_release(string $repo, string $tag, string $asset, ?string &$why = null): ?array
{
    $why = null;
    if (!preg_match('#^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/?$#', $repo, $m)) {
        $why = 'the list names no GitHub project to take it from';
        return null;
    }
    $raw = xs_fm_fetch('https://api.github.com/repos/' . $m[1] . '/' . $m[2] . '/releases/' . ($tag === '' ? 'latest' : 'tags/' . rawurlencode($tag)),
        $w, '', ['Accept: application/vnd.github+json']);
    $rel = $raw === null ? null : json_decode($raw, true);
    if (!is_array($rel) || !is_array($rel['assets'] ?? null)) {
        // GitHub answers 60 questions an hour from one PC without a login, then 403 until the hour is up.
        $why = 'GitHub did not answer about ' . $m[2] . '\'s ' . ($tag === '' ? 'latest release' : 'release ' . $tag)
            . ($w !== null && str_contains($w, '403') ? ': it takes 60 questions an hour from one PC, so try again within the hour'
               : ($w !== null ? ': ' . $w : ''));
        return null;
    }
    $own = 'https://github.com/' . $m[1] . '/' . $m[2] . '/releases/download/';
    foreach ($rel['assets'] as $a) {
        $name = (string) ($a['name'] ?? '');
        $url = (string) ($a['browser_download_url'] ?? '');
        if (is_array($a) && @preg_match('#' . $asset . '#i', $name) === 1 && strncasecmp($url, $own, strlen($own)) === 0 && (int) ($a['size'] ?? 0) > 0) {
            $sum = (string) ($a['digest'] ?? '');
            return ['tag' => (string) ($rel['tag_name'] ?? $tag), 'title' => trim((string) ($rel['name'] ?? '')),
                    'day' => substr((string) ($a['updated_at'] ?? $rel['published_at'] ?? ''), 0, 10),
                    'file' => $name, 'size' => (int) $a['size'], 'url' => $url,
                    'sha256' => preg_match('/^sha256:([0-9a-f]{64})$/', $sum, $s) ? $s[1] : null];
        }
    }
    $why = $m[2] . '\'s ' . ($tag === '' ? 'latest release' : 'release ' . $tag) . ' on GitHub ('
        . (string) ($rel['tag_name'] ?? '?') . ') has no Windows download Xsegon knows';
    return null;
}

/** A file's size as its server says before it is fetched, or null when it does not say. */
function xs_fm_head_size(string $url): ?int
{
    $tmp = xs_data_path('fanmake-' . substr(sha1($url . microtime()), 0, 10) . '.head');
    $proc = @proc_open([xs_curl_exe(), '-L', '--silent', '--head', '--max-time', '20', '-A', 'Xsegon', '-o', $tmp, xs_fm_source($url)],
        [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', 'NUL', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        return null;
    }
    proc_close($proc);
    $said = (string) @file_get_contents($tmp);
    @unlink($tmp);
    return preg_match_all('/^content-length:\s*(\d+)/mi', $said, $mm) ? (int) end($mm[1]) : null;
}

/** Whether an address is the team's own: https, on its website, its GitHub, or a server of theirs the list names. */
function xs_fm_own_url(array $p, string $url): bool
{
    if (!xs_fan_url_ok($url)) {
        return false;
    }
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    $own = array_filter(array_merge([strtolower((string) parse_url((string) ($p['page'] ?? ''), PHP_URL_HOST)), isset($p['repo']) ? 'github.com' : ''],
                                    array_map('strtolower', (array) ($p['make']['hosts'] ?? []))));
    foreach ($own as $h) {
        if ($host === $h || str_ends_with($host, '.' . $h)) {
            return true;
        }
    }
    return false;
}

/**
 * The source a build is made from: a branch of the team's GitHub at its newest commit, as the
 * zip GitHub makes of that commit. GitHub gives neither its size nor a checksum. Null with $why.
 */
function xs_fm_source_zip(string $repo, string $branch, ?string &$why = null): ?array
{
    $why = null;
    if (!preg_match('#^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/?$#', $repo, $m) || !preg_match('/^[A-Za-z0-9._-]{1,60}$/', $branch)) {
        $why = 'the list names no GitHub project to build it from';
        return null;
    }
    $raw = xs_fm_fetch('https://api.github.com/repos/' . $m[1] . '/' . $m[2] . '/commits/' . $branch, $w, '', ['Accept: application/vnd.github+json']);
    $c = $raw === null ? null : json_decode($raw, true);
    $sha = (string) ($c['sha'] ?? '');
    if (!preg_match('/^[0-9a-f]{40}$/', $sha)) {
        $why = 'GitHub did not answer about ' . $m[2] . '\'s ' . $branch
            . ($w !== null && str_contains($w, '403') ? ': it takes 60 questions an hour from one PC, so try again within the hour' : ($w !== null ? ': ' . $w : ''));
        return null;
    }
    return ['tag' => substr($sha, 0, 7), 'title' => '', 'day' => substr((string) ($c['commit']['committer']['date'] ?? ''), 0, 10),
            'file' => $m[2] . '-' . substr($sha, 0, 7) . '.zip', 'size' => null, 'url' => 'https://github.com/' . $m[1] . '/' . $m[2] . '/archive/' . $sha . '.zip',
            'sha256' => null];
}

/**
 * A build's compile line run in its folder, as the team's own build file runs it: the first word
 * a compiler unpacked there, "*" in the others the files it names. Ten minutes at most. False with
 * $why, the compiler's last words.
 */
function xs_fm_compile(string $dir, array $cmd, ?string &$why = null): bool
{
    $why = null;
    $tool = $dir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) array_shift($cmd));
    if (!is_file($tool)) {
        $why = basename($tool) . ' is not in the tools it downloaded';
        return false;
    }
    $args = [];
    foreach ($cmd as $a) {
        $a = (string) $a;
        if (str_contains($a, '*')) {
            $hits = glob($dir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $a)) ?: [];
            sort($hits);
            if (!$hits) {
                $why = 'its source has no ' . $a;
                return false;
            }
            foreach ($hits as $h) {
                $args[] = substr($h, strlen($dir) + 1);
            }
        } else {
            $args[] = $a;
        }
    }
    // A test copy's stand-in compiler is a PHP script.
    $line = xs_test_copy() && preg_match('/\.php$/i', $tool) ? array_merge([xs_php_exe(), $tool], $args) : array_merge([$tool], $args);
    $said = $dir . DIRECTORY_SEPARATOR . 'xsegon-build.txt';
    @unlink($said);
    $p = @proc_open($line, [0 => ['file', 'NUL', 'r'], 1 => ['file', $said, 'a'], 2 => ['file', $said, 'a']], $pipes, $dir, null, ['bypass_shell' => true]);
    if (!is_resource($p)) {
        $why = basename($tool) . ' could not be started';
        return false;
    }
    $until = time() + 600;
    while (($st = proc_get_status($p))['running'] && time() < $until) {
        usleep(200000);
    }
    if ($st['running']) {
        proc_terminate($p);
    }
    proc_close($p);
    $text = trim((string) @file_get_contents($said));
    @unlink($said);
    if ($st['running'] || (int) $st['exitcode'] !== 0) {
        $last = array_slice(array_filter(preg_split('/\r?\n/', $text)), -2);
        $why = $st['running'] ? 'it took over ten minutes' : (basename($tool) . ' ended with ' . (int) $st['exitcode'] . ($last ? ': ' . mb_substr(implode(' ', $last), 0, 300) : ''));
        return false;
    }
    return true;
}

/**
 * One download to $to through Windows' curl.exe, $bytes(so far) told every tenth of a second;
 * $stopped() ends it. False with $why ('stopped' for a stop).
 */
function xs_fm_download(string $url, string $to, callable $bytes, callable $stopped, ?string &$why = null): bool
{
    $why = null;
    @unlink($to);
    $proc = @proc_open([xs_curl_exe(), '-L', '--fail', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20',
                        '--speed-limit', '1024', '--speed-time', '60', '-A', 'Xsegon', '-o', $to, xs_fm_source($url)],
        [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $to . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        $why = 'curl.exe could not be started';
        return false;
    }
    while (true) {
        $st = proc_get_status($proc);
        clearstatcache(true, $to);
        $bytes((int) @filesize($to));
        if (!$st['running']) {
            break;
        }
        if ($stopped()) {
            proc_terminate($proc);
            proc_close($proc);
            @unlink($to);
            @unlink($to . '.err');
            $why = 'stopped';
            return false;
        }
        usleep(100000);
    }
    proc_close($proc);
    $said = trim((string) @file_get_contents($to . '.err'));
    @unlink($to . '.err');
    clearstatcache(true, $to);
    if ((int) $st['exitcode'] !== 0 || !is_file($to) || (int) filesize($to) === 0) {
        @unlink($to);
        $why = 'it could not be downloaded from ' . parse_url($url, PHP_URL_HOST) . ' (is the internet there?): '
            . ($said !== '' ? mb_substr((string) preg_replace('/\s+/', ' ', $said), 0, 200) : 'curl ended with ' . (int) $st['exitcode']);
        return false;
    }
    return true;
}

/**
 * A downloaded .zip or .7z unpacked into $dir: nothing that would land outside it or hides its
 * name. A folder holding everything is opened up, so the program stands at the top, unless
 * $open is false (a tool whose folder is named in the build). $only: the paths taken, the rest
 * left in the archive. False with $why.
 */
function xs_fm_unpack(string $archive, string $dir, ?string &$why = null, bool $open = true, array $only = []): bool
{
    require_once __DIR__ . '/unpack.php';
    $why = null;
    $entries = xs_unpack_entries($archive, $why);
    if ($entries === null) {
        return false;
    }
    $odd = xs_unpack_odd($entries);
    if ($odd['outside'] || $odd['disguised']) {
        $why = 'the download holds files that would be written outside its folder, or whose names hide characters, so it was not unpacked';
        return false;
    }
    // Only the folders this archive holds are asked for: tar fails on one it does not.
    if ($only) {
        $names = array_column($entries, 'name');
        $only = array_values(array_filter($only, static fn($o) => (bool) array_filter($names, static fn($n) => $n === $o || str_starts_with($n, $o . '/'))));
        if (!$only) {
            $why = 'it holds none of what is taken from it';
            return false;
        }
    }
    if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
        $why = 'the folder ' . $dir . ' could not be made (' . xs_file_error_reason() . ')';
        return false;
    }
    $says = $dir . '.said';
    $is7z = (bool) preg_match('/\.7z$/i', $archive);
    // -m: the files keep today's date; an exFAT drive refuses some of a zip's, and tar then calls it a failure.
    $cmd = $is7z && xs_unpack_7zr() !== '' ? array_merge([xs_unpack_7zr(), 'x', '-y', '-o' . $dir, '--', $archive], $only)
         : array_merge([xs_unpack_tar(), '-xmf', $archive, '-C', $dir], $only);
    $run = xs_unpack_run($cmd, false, $says);
    $code = $run === null ? -1 : proc_close($run[0]);
    $said = xs_unpack_said($says);
    if ($code !== 0) {
        $why = 'it could not be unpacked' . ($said !== '' ? ': ' . $said : ($run === null ? ': ' . ($is7z ? '7zr' : 'tar') . ' could not be started' : ''));
        return false;
    }
    $top = array_values(array_diff((array) @scandir($dir), ['.', '..']));
    if ($open && count($top) === 1 && is_dir($dir . DIRECTORY_SEPARATOR . $top[0])) {
        $inner = $dir . DIRECTORY_SEPARATOR . $top[0];
        foreach (array_diff((array) @scandir($inner), ['.', '..']) as $n) {
            if (!@rename($inner . DIRECTORY_SEPARATOR . $n, $dir . DIRECTORY_SEPARATOR . $n)) {
                $why = $n . ' could not be moved up out of ' . $top[0] . ' (' . xs_file_error_reason() . ')';
                return false;
            }
        }
        @rmdir($inner);
    }
    return true;
}

/**
 * Your game's file as a project wants it: read from its .zip, .7z or plain file (never changed),
 * an N64 cartridge put in .z64 byte order, a SNES cartridge without a copier's 512-byte header.
 * Null with $why.
 */
function xs_fm_game_bytes(string $rom, string $format, ?string &$why = null): ?string
{
    $why = null;
    $src = '';
    $about = [];
    if (!xs_fc_feed($rom, static function (string $b) use (&$src): void { $src .= $b; }, $about, $rw) || $src === '') {
        $why = 'its file could not be read' . ($rw !== null ? ': ' . $rw : '');
        return null;
    }
    if ($format === 'z64') {
        // A .v64 or .n64 holds the same game in another byte order.
        $magic = bin2hex(substr($src, 0, 4));
        if ($magic === '37804012') {
            $src = implode('', array_map('strrev', str_split($src, 2)));
        } elseif ($magic === '40123780') {
            $src = implode('', array_map('strrev', str_split($src, 4)));
        }
    } elseif ($format === 'sfc' && strlen($src) % 1024 === 512) {
        $src = substr($src, 512);
    }
    return $src;
}

/**
 * Where each disc of a set is among your games, by disc ID: a disc of a .pbp, or a disc
 * image with its .cue. Only games carrying $words in their title are read. Null with $why
 * when one is missing or its file cannot be taken as it is (a .chd).
 */
function xs_fm_disc_sources(array $games, string $words, array $need, ?string &$why = null): ?array
{
    require_once __DIR__ . '/pbp.php';
    $why = null;
    $s = xs_settings();
    $found = [];
    $files = [];
    foreach ($games as $g) {
        if (str_contains(' ' . xs_fan_words((string) $g['title']) . ' ', ' ' . $words . ' ')) {
            $f = xs_rom_real_path((string) ($g['romPath'] ?? ''), $s);
            $e = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if ($e === 'm3u') {
                foreach (preg_split('/\r?\n/', (string) @file_get_contents($f, false, null, 0, 65536)) as $line) {
                    if (($line = trim($line)) !== '' && $line[0] !== '#') {
                        $files[] = preg_match('#^([A-Za-z]:)?[/\\\\]#', $line) ? $line : dirname($f) . DIRECTORY_SEPARATOR . $line;
                    }
                }
            } else {
                $files[] = $f;
            }
        }
    }
    foreach (array_unique($files) as $f) {
        $e = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if ($e === 'pbp') {
            foreach (xs_pbp_discs($f) ?? [] as $d) {
                if (in_array($d['id'], $need, true) && !isset($found[$d['id']])) {
                    $found[$d['id']] = ['pbp' => $f, 'disc' => $d, 'bytes' => $d['sectors'] * 2352];
                }
            }
        } elseif (in_array($e, ['cue', 'bin', 'img', 'iso'], true)) {
            $ids = xs_fan_ps_ids($f, $e, false);
            $id = $ids[0] ?? null;
            if ($id === null || !in_array($id, $need, true) || isset($found[$id])) {
                continue;
            }
            // A .cue comes with every file it names; a disc image alone with none.
            $with = [$f];
            if ($e === 'cue') {
                preg_match_all('/^\s*FILE\s+(?:"([^"]+)"|(\S+))/mi', (string) @file_get_contents($f, false, null, 0, 65536), $mm, PREG_SET_ORDER);
                foreach ($mm as $x) {
                    $with[] = dirname($f) . DIRECTORY_SEPARATOR . ($x[1] !== '' ? $x[1] : $x[2]);
                }
            }
            if (count(array_filter($with, 'is_file')) !== count($with)) {
                continue;
            }
            $found[$id] = ['files' => $with, 'bytes' => (int) array_sum(array_map('filesize', $with))];
        }
    }
    $missing = array_values(array_diff($need, array_keys($found)));
    if ($missing) {
        $why = 'disc' . (count($missing) > 1 ? 's ' : ' ') . implode(', ', $missing) . ' could not be found among your games as a .pbp, .cue, .bin or .iso';
        return null;
    }
    return array_map(static fn($id) => $found[$id], $need);
}

/**
 * The discs of a set written into $dir as "<name> (Disc N)": a .pbp's disc as a .bin and its
 * .cue, a disc image copied as it is, or with $rename a one-track image's .bin and .cue under
 * that name too. $tick(bytes so far) is told; it stops it by answering false. The names
 * written, or null with $why.
 */
function xs_fm_disc_write(array $sources, string $dir, string $name, callable $tick, ?string &$why = null, bool $rename = false): ?array
{
    require_once __DIR__ . '/pbp.php';
    $why = null;
    $done = 0;
    $wrote = [];
    foreach ($sources as $i => $src) {
        $stem = $name . (count($sources) > 1 ? ' (Disc ' . ($i + 1) . ')' : '');
        if (isset($src['pbp'])) {
            $bin = $dir . DIRECTORY_SEPARATOR . $stem . '.bin';
            $ok = xs_pbp_write($src['pbp'], $src['disc'], $bin, static fn(int $at, int $of) => $tick($done + (int) ($src['bytes'] * $at / max(1, $of))), $w);
            if (!$ok || @file_put_contents($dir . DIRECTORY_SEPARATOR . $stem . '.cue', xs_pbp_cue($src['disc'], $bin)) === false) {
                $why = 'disc ' . ($i + 1) . ' could not be written out of your .pbp: ' . ($w ?? xs_file_error_reason());
                return null;
            }
            $wrote[] = basename($bin);
        } else {
            // Copied under their own names, as a .cue names its files; renamed, a port's fixed name
            // ("ctr-u.bin") is given to the one .bin, and its .cue is made to name it.
            $renamed = $rename && count(array_filter($src['files'], static fn($f) => strtolower(pathinfo($f, PATHINFO_EXTENSION)) === 'bin')) === 1;
            foreach ($src['files'] as $f) {
                $end = strtolower(pathinfo($f, PATHINFO_EXTENSION));
                if ($renamed && $end === 'cue') {
                    $cue = (string) preg_replace('/^(\s*FILE\s+)(?:"[^"]+"|\S+)/mi', '${1}"' . $stem . '.bin"', (string) @file_get_contents($f, false, null, 0, 65536));
                    if (@file_put_contents($dir . DIRECTORY_SEPARATOR . $stem . '.cue', $cue) === false) {
                        $why = $stem . '.cue could not be written (' . xs_file_error_reason() . ')';
                        return null;
                    }
                    $wrote[] = $stem . '.cue';
                    continue;
                }
                $to = $dir . DIRECTORY_SEPARATOR . ($renamed && $end === 'bin' ? $stem . '.bin' : basename($f));
                $in = @fopen($f, 'rb');
                $out = $in === false ? false : @fopen($to, 'wb');
                if ($in === false || $out === false) {
                    $why = basename($f) . ' could not be copied (' . xs_file_error_reason() . ')';
                    return null;
                }
                while (!feof($in)) {
                    $b = (string) fread($in, 4194304);
                    if (fwrite($out, $b) !== strlen($b)) {
                        fclose($in);
                        fclose($out);
                        $why = basename($f) . ' could not be copied (' . xs_file_error_reason() . ')';
                        return null;
                    }
                    $done += strlen($b);
                    if ($tick($done) === false) {
                        fclose($in);
                        fclose($out);
                        $why = 'stopped';
                        return null;
                    }
                }
                fclose($in);
                fclose($out);
                $wrote[] = basename($to);
            }
            continue;
        }
        $done += $src['bytes'];
    }
    return $wrote;
}

/**
 * One setting of an .ini file set, the file made where there is none and every other line kept:
 * how a port with an emulator of its own is pointed at your game where it is. False with $why.
 */
function xs_fm_ini_set(string $file, string $section, string $key, string $value, ?string &$why = null): bool
{
    $why = null;
    $lines = is_file($file) ? preg_split('/\r?\n/', (string) file_get_contents($file)) : [];
    $out = [];
    $in = false;
    $done = false;
    foreach ($lines as $line) {
        if (preg_match('/^\s*\[(.+)\]\s*$/', $line, $m)) {
            if ($in && !$done) {
                $out[] = $key . ' = ' . $value;
                $done = true;
            }
            $in = strcasecmp(trim($m[1]), $section) === 0;
        } elseif ($in && preg_match('/^\s*' . preg_quote($key, '/') . '\s*=/i', $line)) {
            if (!$done) {
                $out[] = $key . ' = ' . $value;
                $done = true;
            }
            continue;
        }
        $out[] = $line;
    }
    if (!$done) {
        if (!$in) {
            $out[] = '[' . $section . ']';
        }
        $out[] = $key . ' = ' . $value;
    }
    $text = rtrim(implode("\r\n", $out)) . "\r\n";
    if ((!is_dir(dirname($file)) && !@mkdir(dirname($file), 0777, true)) || @file_put_contents($file, $text) !== strlen($text)) {
        $why = $file . ' could not be written (' . xs_file_error_reason() . ')';
        return false;
    }
    return true;
}

/** Where in a port's folder your game goes: the recipe's path, "{release}" in it read as your copy's release name. */
function xs_fm_game_to(string $to, string $release, string $title): string
{
    $name = trim((string) preg_replace('/[<>:"\/\\\\|?*\x00-\x1F]+/', ' ', $release !== '' ? $release : $title));
    return str_replace(['{release}', '/'], [$name !== '' ? $name : 'game', DIRECTORY_SEPARATOR], $to);
}

/** Whether a game's bytes are one of the copies a recipe names, by MD5 or SHA-1 (one or a list); true when it names none. */
function xs_fm_game_is(string $bytes, array $base): bool
{
    $md5 = array_map('strtolower', (array) ($base['md5'] ?? []));
    $sha1 = array_map('strtolower', (array) ($base['sha1'] ?? []));
    if (!$md5 && !$sha1) {
        return true;
    }
    return ($md5 && in_array(md5($bytes), $md5, true)) || ($sha1 && in_array(sha1($bytes), $sha1, true));
}

/** The library id a scan gives a file: its console and its file's name, as includes\scan.php makes it. */
function xs_fm_scan_id(string $platform, string $file): string
{
    return 'xs-scan-' . substr(sha1(strtolower($platform) . '|' . strtolower(basename($file))), 0, 12);
}

/**
 * Start making project $id, in the background. False with $why when it cannot be: the
 * project has no recipe, your game does not fit, or a make is at work already.
 */
function xs_fm_start(string $id, ?string &$why = null): bool
{
    $why = null;
    $p = xs_fan_list()[$id] ?? null;
    if ($p === null || !xs_fan_makes($p)) {
        $why = 'Xsegon cannot make that project yet';
        return false;
    }
    if ((xs_fm_job()['state'] ?? '') === 'running') {
        $why = (string) (xs_fm_job()['name'] ?? 'a project') . ' is being made already: that has to finish first';
        return false;
    }
    if (xs_curl_exe() === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on), and that is what downloads it';
        return false;
    }
    $games = array_values(array_filter(xs_library()['games'] ?? [], static fn($g) => empty($g['hidden'])));
    $state = null;
    foreach (xs_fan_states($games) as $st) {
        if ($st['id'] === $id) {
            $state = $st;
        }
    }
    $base = $state['base'] ?? [];
    $why = $state === null ? 'Xsegon cannot make that project yet' : xs_fan_why($state);
    if ($why !== null) {
        return false;
    }
    $game = null;
    foreach ($games as $g) {
        if ((string) $g['id'] === (string) $base['gameId']) {
            $game = $g;
        }
    }
    $rom = $game === null ? '' : xs_rom_real_path((string) ($game['romPath'] ?? ''), xs_settings());
    if ($rom === '' || xs_drive_stuck($rom) !== null || !is_file($rom)) {
        $why = 'your ' . (string) ($base['yourTitle'] ?? 'game') . '\'s file is not there: ' . ($rom !== '' ? $rom : 'it has none');
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'project' => $id, 'name' => (string) $p['name'],
            'base' => (string) $game['id'], 'baseTitle' => (string) $game['title'], 'platform' => (string) $game['platform'], 'rom' => $rom,
            'release' => (string) ($base['release'] ?? ''), 'check' => ($base['state'] ?? '') === 'unchecked',
            'bytes' => 0, 'total' => 0, 'at' => 0, 'of' => 0, 'said' => ''];
    @unlink(xs_fm_stop_path());
    if (!xs_write_json(xs_fm_job_path(), $job, $why)) {
        return false;
    }
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'display_startup_errors=0', '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'fanmake.php', '--server=http://127.0.0.1:' . (int) ($_SERVER['SERVER_PORT'] ?? 0)];
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        $why = 'the worker that makes it could not be started';
        xs_write_json(xs_fm_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    pclose($h);
    xs_log('FAN', 'make ' . $p['name'] . ' from ' . $game['title'] . ' (' . $rom . ') asked' . ($job['check'] ? ', its file not checked yet: checked first' : ''));
    return true;
}
