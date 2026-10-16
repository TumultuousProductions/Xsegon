<?php
/**
 * Xsegon - the worker that makes a fan project (includes\fanmake.php), run in the background.
 *
 *   php bin\fanmake.php --server=http://127.0.0.1:8099
 *
 * The plan is in data\fanmake-job.json. The team's list names the latest release and its
 * patch; the patch is fetched from their site and checked against the CRC32 their GitHub
 * release lists; your game is read (never changed), the copy made and checked, written to
 * the console's Hacks folder, and taken in by the main server as Scan for Games takes a
 * game in, tied to the game it is made from. A PC version goes its own way: bin\fanmake-pc.php.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/fanmake.php';
require_once __DIR__ . '/../includes/vcdiff.php';

set_time_limit(0);
ini_set('memory_limit', '1024M');
$server = '';
foreach ($argv as $a) {
    if (str_starts_with($a, '--server=')) {
        $server = rtrim(substr($a, 9), '/');
    }
}

$job = xs_read_json(xs_fm_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\fanmake-job.json\n");
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
    xs_write_json(xs_fm_job_path(), $job);
};
$save();

$part = xs_data_path('fanmake.download');
register_shutdown_function(static function () use (&$job, $save, $part): void {
    @unlink($part);
    @unlink($part . '.err');
    @unlink($part . '.head');
    if (($job['state'] ?? '') === 'running') {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped on a fault: the log has it';
        $save();
    }
});
$name = (string) $job['name'];
$end = static function (string $state, string $words) use (&$job, $save, $name): void {
    $job['state'] = $state;
    $job['phase'] = 'end';
    $job[$state === 'done' ? 'said' : 'error'] = $words;
    $save();
    @unlink(xs_fm_stop_path());
    xs_log('FAN', 'make ' . $name . ': ' . $state . ': ' . $words);
    exit(0);
};
$stopped = static fn (): bool => is_file(xs_fm_stop_path());
$ask = static function (string $path, array $body) use ($server): ?array {
    if ($server === '') {
        return null;
    }
    $opts = ['timeout' => 120, 'ignore_errors' => true, 'method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => json_encode($body)];
    $got = @file_get_contents($server . $path, false, stream_context_create(['http' => $opts]));
    $val = $got === false ? null : json_decode($got, true);
    return is_array($val) ? $val : null;
};

$p = xs_fan_list()[(string) $job['project']] ?? null;
if ($p === null || !xs_fan_makes($p)) {
    $end('failed', 'Xsegon no longer knows how to make ' . $name);
}
$m = $p['make'];
$t0 = microtime(true);
if (in_array($m['how'] ?? 'patch', ['release', 'build'], true)) {
    require __DIR__ . '/fanmake-pc.php';
    exit(0);
}
if (($m['how'] ?? '') === 'pack') {
    require __DIR__ . '/fanmake-pack.php';
    exit(0);
}

// ---- the team's list: its latest release, and which patch of it to take ----------------
$job['phase'] = 'asking';
$save();
$raw = xs_fm_fetch((string) $m['list'], $w);
$list = $raw === null ? null : json_decode($raw, true);
if (!is_array($list)) {
    $end('failed', $name . '\'s list of releases could not be read from ' . parse_url((string) $m['list'], PHP_URL_HOST) . ' (is the internet there?)'
        . ($w !== null ? ': ' . $w : ''));
}
$rel = null;
foreach ($list as $r) {
    if (is_array($r) && is_string($r['files'][$m['take']] ?? null) && is_string($r['version'] ?? null)) {
        $rel = $r;
        break;
    }
}
$file = (string) ($rel['files'][$m['take']] ?? '');
$version = trim((string) ($rel['version'] ?? ''));
if ($rel === null || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}\.xdelta$/', $file) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9._ -]{0,30}$/', $version)) {
    $end('failed', $name . '\'s list of releases names no patch Xsegon can take');
}
$tag = basename((string) ($rel['original_url'] ?? $version));
$job['version'] = $version;
xs_log('FAN', 'make ' . $name . ': the latest release is ' . $version . ', its patch ' . $file);

// ---- what the patch must be: the CRC32 the team's GitHub release lists for it ----------
$crc = xs_fm_github_crc((string) $p['repo'], $tag, $file, $w);
if ($crc === null) {
    $end('failed', 'the patch could not be checked, so it was not fetched: ' . $w);
}
if ($stopped()) {
    $end('stopped', 'stopped: ' . $name . ' was not made');
}

// ---- the patch, from the team's own site ------------------------------------------------
$url = (string) $m['from'] . rawurlencode($file);
$curl = xs_curl_exe();
$quiet = [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', 'NUL', 'w']];
$proc = @proc_open([$curl, '-L', '--silent', '--head', '--max-time', '20', '-A', 'Xsegon', '-o', $part . '.head', xs_fm_source($url)], $quiet, $pipes, null, null, ['bypass_shell' => true]);
if (is_resource($proc)) {
    proc_close($proc);
    if (preg_match_all('/^content-length:\s*(\d+)/mi', (string) @file_get_contents($part . '.head'), $mm)) {
        $job['total'] = (int) end($mm[1]);
    }
    @unlink($part . '.head');
}
$job['phase'] = 'fetching';
$save();
@unlink($part);
$proc = @proc_open([$curl, '-L', '--fail', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20',
                    '--speed-limit', '1024', '--speed-time', '60', '-A', 'Xsegon', '-o', $part, xs_fm_source($url)],
    [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $part . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
if (!is_resource($proc)) {
    $end('failed', 'curl.exe could not be started');
}
while (true) {
    $st = proc_get_status($proc);
    clearstatcache(true, $part);
    $job['bytes'] = (int) @filesize($part);
    $save(false);
    if (!$st['running']) {
        break;
    }
    if ($stopped()) {
        proc_terminate($proc);
        proc_close($proc);
        $end('stopped', 'stopped: ' . $name . ' was not made');
    }
    usleep(100000);
}
proc_close($proc);
$said = trim((string) @file_get_contents($part . '.err'));
@unlink($part . '.err');
clearstatcache(true, $part);
if ((int) $st['exitcode'] !== 0 || !is_file($part) || (int) filesize($part) === 0) {
    $end('failed', $name . '\'s patch could not be fetched from ' . parse_url($url, PHP_URL_HOST) . ' (is the internet there?): '
        . ($said !== '' ? mb_substr((string) preg_replace('/\s+/', ' ', $said), 0, 200) : 'curl ended with ' . (int) $st['exitcode']));
}
$patch = (string) file_get_contents($part);
@unlink($part);
$job['bytes'] = strlen($patch);
$tFetch = microtime(true);
if (hash('crc32b', $patch) !== $crc) {
    $end('failed', 'the patch from ' . parse_url($url, PHP_URL_HOST) . ' is not the one ' . $name . '\'s GitHub release lists (CRC32 '
        . hash('crc32b', $patch) . ', not ' . $crc . '), so nothing was made');
}
xs_log('FAN', 'make ' . $name . ': fetched ' . $file . ', ' . round(strlen($patch) / 1048576, 1) . ' MB in ' . round($tFetch - $t0, 1)
    . 's, CRC32 ' . $crc . ' as its GitHub release lists');

// ---- your game, read as the patch wants it ---------------------------------------------
$job['phase'] = 'reading';
$save();
$rom = (string) $job['rom'];
$src = '';
$about = [];
if (!xs_fc_feed($rom, static function (string $b) use (&$src): void { $src .= $b; }, $about, $rw) || $src === '') {
    $end('failed', 'your ' . $job['baseTitle'] . '\'s file could not be read' . ($rw !== null ? ': ' . $rw : ''));
}
if (($m['base']['format'] ?? '') === 'z64') {
    // A .v64 or .n64 holds the same game in another byte order: the patch was made on the .z64's.
    $magic = bin2hex(substr($src, 0, 4));
    if ($magic === '37804012') {
        $src = implode('', array_map('strrev', str_split($src, 2)));
    } elseif ($magic === '40123780') {
        $src = implode('', array_map('strrev', str_split($src, 4)));
    }
}
$want = strtolower((string) ($m['base']['md5'] ?? ''));
if ($want !== '' && md5($src) !== $want) {
    $end('failed', 'your ' . $job['baseTitle'] . ' is not the copy ' . $name . ' is made from (its MD5 is ' . md5($src) . ', the team names ' . $want . ')');
}

// ---- the copy, made and checked -----------------------------------------------------------
$job['phase'] = 'making';
$job['at'] = 0;
$job['of'] = strlen($patch);
$save();
$t1 = microtime(true);
$made = xs_vcdiff_apply($src, $patch, $why, static function (int $at, int $of) use (&$job, $save): void {
    $job['at'] = $at;
    $save(false);
}, $checked);
unset($patch);
if ($made === null) {
    $end('failed', $name . ' could not be made from your ' . $job['baseTitle'] . ': ' . $why);
}
$known = array_search($version, (array) ($p['yours']['ids'] ?? []), true);
$id64 = ($m['base']['format'] ?? '') === 'z64' && strlen($made) >= 24 ? strtoupper(bin2hex(substr($made, 16, 4)) . '-' . bin2hex(substr($made, 20, 4))) : null;
if ($known !== false && $id64 !== null && $id64 !== $known) {
    $end('failed', 'the copy did not come out as ' . $name . ' ' . $version . ' (its header says ' . $id64 . ', the list ' . $known . '), so it was not kept');
}
$md5 = md5($made);
xs_log('FAN', 'make ' . $name . ': made ' . number_format(strlen($made)) . ' bytes in ' . round((microtime(true) - $t1) * 1000) . 'ms from ' . $rom
    . ', ' . $checked['windows'] . ' windows (' . $checked['summed'] . ' with their own checksum), MD5 ' . $md5
    . ($known !== false ? ', header ' . $id64 . ' as the list says for ' . $version : ''));
if ($stopped()) {
    $end('stopped', 'stopped: ' . $name . ' was not made');
}

// ---- into the console's Hacks folder ----------------------------------------------------
$job['phase'] = 'writing';
$save();
$dir = xs_fm_dest((string) $job['platform'], $rom);
if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
    $end('failed', 'the folder ' . $dir . ' could not be made (' . xs_file_error_reason() . ')');
}
$free = (float) @disk_free_space($dir);
if ($free > 0 && $free < strlen($made) * 1.1) {
    $end('failed', 'there is not enough room on ' . $dir . ': ' . $name . ' needs ' . round(strlen($made) / 1048576) . ' MB');
}
$stem = trim((string) preg_replace('/[<>:"\/\\\\|?*\x00-\x1F]+/', ' ', $name . ' ' . $version));
$ending = (string) ($m['ending'] ?? ($m['base']['format'] ?? 'bin'));
$out = $dir . DIRECTORY_SEPARATOR . $stem . '.' . $ending;
for ($n = 2; is_file($out) && $n < 100; $n++) {
    $out = $dir . DIRECTORY_SEPARATOR . $stem . ' (' . $n . ').' . $ending;
}
if (@file_put_contents($out . '.part', $made) !== strlen($made) || !@rename($out . '.part', $out)) {
    @unlink($out . '.part');
    $end('failed', $name . ' could not be written to ' . $dir . ' (' . xs_file_error_reason() . ')');
}
$size = strlen($made);
unset($made, $src);
xs_log('FAN', 'make ' . $name . ': wrote ' . $out);

// ---- into the library, tied to the game it is made from -----------------------------------
$job['phase'] = 'adding';
$save();
$platform = (string) $job['platform'];
$id = xs_fm_scan_id($platform, $out);
$title = $name . ' ' . $version;
$took = $ask('/api/scan.php', ['action' => 'accept', 'games' => [['id' => $id, 'title' => $title, 'platform' => $platform, 'rom' => $out]]]);
$in = ($took['ok'] ?? false) && ((int) ($took['added'] ?? 0) > 0 || ($took['skipped'][0]['why'] ?? '') === 'already accepted before');
$note = '';
if (!$in) {
    $note = ', but it is not in your library yet (' . (string) ($took['error'] ?? ($took['skipped'][0]['why'] ?? 'Xsegon did not answer')) . '): Scan for Games will offer it';
} else {
    $tie = $ask('/api/hacks.php', ['id' => $id, 'hackOf' => (string) $job['base']]);
    if (!($tie['ok'] ?? false)) {
        xs_log('FAN', 'make ' . $name . ': not tied to ' . $job['baseTitle'] . ': ' . (string) ($tie['error'] ?? 'no answer'));
    }
    $kept = xs_fm_made();
    $kept[$id] = ['project' => (string) $p['id'], 'version' => $version, 'md5' => $md5, 'at' => time()];
    xs_write_json(xs_fm_made_path(), $kept);
}
$job['made'] = ['id' => $in ? $id : null, 'file' => $out, 'version' => $version, 'bytes' => $size];
$job['seconds'] = (int) round(microtime(true) - $t0);
$end('done', $title . ' is made from your ' . $job['baseTitle'] . ': ' . $out . ($in ? ', in your ' . $platform . ' list' : $note));
