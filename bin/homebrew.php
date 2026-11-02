<?php
/**
 * Xsegon - the worker that fetches a homebrew game (includes\homebrew.php), run in the background.
 *
 *   php bin\homebrew.php --server=http://127.0.0.1:8099
 *
 * The plan is in data\homebrew-job.json. When the game plays in ares and this PC has none, ares
 * comes first, from its makers' latest release, checked against what GitHub says of it, looked
 * at by Windows Defender and offered for the console without taking it over. Then the game: the
 * team's latest release, else the copy entered in the jam, checked, written to the console's
 * HomeBrew folder and taken in by the main server as Scan for Games takes a game in, with its
 * team as its developer so the credit stays with it.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/homebrew.php';
require_once __DIR__ . '/../includes/unpack.php';
require_once __DIR__ . '/../includes/video.php';

set_time_limit(0);
$server = '';
foreach ($argv as $a) {
    if (str_starts_with($a, '--server=')) {
        $server = rtrim(substr($a, 9), '/');
    }
}

$job = xs_read_json(xs_hb_job_path(), null);
if (!is_array($job) || ($job['state'] ?? '') !== 'running' || !empty($job['pid'])) {
    fwrite(STDERR, "nothing waiting in data\\homebrew-job.json\n");
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
    xs_write_json(xs_hb_job_path(), $job);
};
$save();

$part = xs_data_path('homebrew.download');
register_shutdown_function(static function () use (&$job, $save, $part): void {
    @unlink($part);
    @unlink($part . '.err');
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
    @unlink(xs_hb_stop_path());
    xs_log('HBRW', 'get ' . $name . ': ' . $state . ': ' . $words);
    exit(0);
};
$stopped = static fn (): bool => is_file(xs_hb_stop_path());
$ask = static function (string $path, array $body) use ($server): ?array {
    if ($server === '') {
        return null;
    }
    $opts = ['timeout' => 120, 'ignore_errors' => true, 'method' => 'POST', 'header' => "Content-Type: application/json\r\n", 'content' => json_encode($body)];
    $got = @file_get_contents($server . $path, false, stream_context_create(['http' => $opts]));
    $val = $got === false ? null : json_decode($got, true);
    return is_array($val) ? $val : null;
};
// One download to the part file, its bar kept up to date; false with $why.
$fetch = static function (string $url, string $file, int $size, ?string &$why) use (&$job, $save, $part, $stopped): bool {
    $job['phase'] = 'fetching';
    $job['file'] = $file;
    $job['bytes'] = 0;
    $job['total'] = $size;
    $save();
    return xs_fm_download($url, $part, static function (int $n) use (&$job, $save): void {
        $job['bytes'] = $n;
        $save(false);
    }, $stopped, $why);
};

$g = xs_hb_list()[(string) $job['game']] ?? null;
if ($g === null) {
    $end('failed', $name . ' is no longer on the list');
}
$console = (string) $g['console'];

// ---- ares, when the game plays in it and this PC has none --------------------------------
if (!empty($job['ares'])) {
    $job['phase'] = 'asking-ares';
    $save();
    $rel = xs_fm_release(XS_HB_ARES_REPO, '', XS_HB_ARES_ASSET, $why);
    if ($rel === null) {
        $end('failed', 'ares could not be fetched: ' . $why);
    }
    if (!$fetch((string) $rel['url'], (string) $rel['file'], (int) $rel['size'], $why)) {
        if ($why === 'stopped') {
            $end('failed', 'stopped: nothing was kept');
        }
        $end('failed', 'ares ' . $why);
    }
    $sum = strtolower((string) ($rel['sha256'] ?? ''));
    if ((int) filesize($part) !== (int) $rel['size'] || ($sum !== '' && hash_file('sha256', $part) !== $sum)) {
        $end('failed', 'ares came from GitHub with other contents than GitHub lists, so it was not used');
    }
    $job['phase'] = 'checking';
    $save();
    $zip = $part . '.zip';
    @rename($part, $zip);
    $said = xs_unpack_defender_scan($zip, $what, static fn (): bool => !$stopped());
    if ($said === 'stopped') {
        @unlink($zip);
        $end('failed', 'stopped: nothing was kept');
    }
    if ($said === 'found') {
        @unlink($zip);
        $end('failed', 'Windows Defender found ' . $what . ' in ' . $rel['file'] . ' from GitHub, so it was not unpacked and nothing was kept');
    }
    xs_log('HBRW', 'ares: Windows Defender ' . ($said === 'clean' ? 'found nothing' : 'is not here or was not asked') . ' in ' . $rel['file']);
    $job['phase'] = 'unpacking';
    $save();
    $dir = xs_data_path('emulators' . DIRECTORY_SEPARATOR . 'ares');
    if ((!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) || !xs_fm_unpack($zip, $dir, $why)) {
        @unlink($zip);
        $end('failed', 'ares could not be unpacked into ' . $dir . ': ' . (string) $why);
    }
    @unlink($zip);
    $exe = $dir . DIRECTORY_SEPARATOR . 'ares.exe';
    if (!is_file($exe)) {
        $end('failed', 'ares\' download has no ares.exe where it should be: ' . $dir);
    }
    $table = xs_emulators();
    unset($table['mine']);
    $key = xs_emu_key($exe);
    $table['programs'][$key] = ['name' => 'ares', 'exe' => $exe, 'args' => XS_HB_ARES_ARGS, 'noQuotes' => false];
    xs_hb_ares_offer($table, $console, $key);
    if (!xs_emulators_write($table, $why)) {
        $end('failed', 'ares is on the PC but could not go in the emulator table: ' . (string) $why);
    }
    xs_log('HBRW', 'ares ' . $rel['tag'] . ' set up in ' . $dir);
}

// ---- the game: the team's latest release, else the copy entered in the jam ----------------
$file = is_array($g['file'] ?? null) ? $g['file'] : [];
$version = '';
$got = false;
$whyNot = '';
if (is_string($file['release'] ?? null)) {
    $job['phase'] = 'asking';
    $save();
    $rel = xs_fm_release((string) $g['repo'], '', $file['release'], $why);
    if ($rel === null) {
        $whyNot = (string) $why;
    } elseif (!$fetch((string) $rel['url'], (string) $rel['file'], (int) $rel['size'], $why)) {
        if ($why === 'stopped') {
            $end('failed', 'stopped: nothing was kept');
        }
        $whyNot = (string) $why;
    } elseif ((int) filesize($part) !== (int) $rel['size'] || (($rel['sha256'] ?? '') !== '' && hash_file('sha256', $part) !== strtolower((string) $rel['sha256']))) {
        $whyNot = 'it came from GitHub with other contents than GitHub lists';
    } else {
        $got = true;
        $version = (string) $rel['tag'];
    }
    if (!$got) {
        xs_log('HBRW', 'get ' . $name . ': the team\'s release did not come: ' . $whyNot);
    }
}
if (!$got && is_array($file['drive'] ?? null)) {
    $d = $file['drive'];
    if (!$fetch('https://drive.google.com/uc?export=download&id=' . $d['id'], $name, (int) $d['size'], $why)) {
        if ($why === 'stopped') {
            $end('failed', 'stopped: nothing was kept');
        }
        $whyNot = (string) $why;
    } elseif ((int) filesize($part) !== (int) $d['size'] || sha1_file($part) !== strtolower((string) $d['sha1'])) {
        // Google can answer with a page of its own in place of the file.
        $whyNot = 'the jam\'s folder sent something other than the file the list names';
    } else {
        $got = true;
        $version = 'jam copy';
    }
}
if (!$got) {
    $end('failed', $name . ' did not come: ' . ($whyNot !== '' ? $whyNot : 'nothing names a place for it') . '. Its own page has it: the buttons beside the game open it');
}

$fh = @fopen($part, 'rb');
$head = $fh ? (string) fread($fh, 4) : '';
if ($fh) {
    fclose($fh);
}
$ending = $console === 'Nintendo 64' ? xs_hb_n64_ending($head) : null;
if ($ending === null) {
    $end('failed', 'what came for ' . $name . ' is no ' . $console . ' game, so it was not kept');
}

// ---- into the console's HomeBrew folder ---------------------------------------------------
$job['phase'] = 'writing';
$save();
$dir = xs_hb_dest($console);
if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
    $end('failed', 'the folder ' . $dir . ' could not be made (' . xs_file_error_reason() . ')');
}
$size = (int) filesize($part);
$free = (float) @disk_free_space($dir);
if ($free > 0 && $free < $size * 1.1) {
    $end('failed', 'there is not enough room on ' . $dir . ': ' . $name . ' needs ' . round($size / 1048576) . ' MB');
}
$stem = trim((string) preg_replace('/[<>:"\/\\\\|?*\x00-\x1F]+/', ' ', $name));
$out = $dir . DIRECTORY_SEPARATOR . $stem . '.' . $ending;
for ($n = 2; is_file($out) && $n < 100; $n++) {
    $out = $dir . DIRECTORY_SEPARATOR . $stem . ' (' . $n . ').' . $ending;
}
if (!@copy($part, $out)) {
    $end('failed', $name . ' could not be written to ' . $dir . ' (' . xs_file_error_reason() . ')');
}
@unlink($part);
xs_log('HBRW', 'get ' . $name . ' ' . $version . ': wrote ' . $out);

// ---- into the library, its makers named on it ---------------------------------------------
$job['phase'] = 'adding';
$save();
$id = xs_fm_scan_id($console, $out);
// What Get brought, for the page and the next Get; kept also when the library did not take it in, so it is not fetched twice.
$remember = static function () use ($g, $id, $version, $out): void {
    $kept = xs_hb_got();
    $kept[(string) $g['id']] = ['game' => $id, 'version' => $version, 'file' => $out, 'at' => time()];
    xs_write_json(xs_hb_got_path(), $kept);
};
$took = $ask('/api/scan.php', ['action' => 'accept', 'games' => [['id' => $id, 'title' => $name, 'platform' => $console, 'rom' => $out]]]);
$in = ($took['ok'] ?? false) && ((int) ($took['added'] ?? 0) > 0 || ($took['skipped'][0]['why'] ?? '') === 'already accepted before');
if (!$in) {
    $remember();
    $job['made'] = ['id' => null, 'file' => $out, 'version' => $version];
    $end('done', $name . ' is at ' . $out . ', but it is not in your library yet ('
        . (string) ($took['error'] ?? ($took['skipped'][0]['why'] ?? 'Xsegon did not answer')) . '): Scan for Games will find it');
}
// The first of each kind that comes; a picture that does not come costs the game nothing.
$picsBy = [];
foreach (xs_hb_art($g) as $kind => $list) {
    foreach ($list as $it) {
        if ($kind === 'video') {
            if ($fetch((string) $it['url'], (string) $name, 0, $why) && video_own_store($id, $part, $why) !== null) {
                $picsBy[$it['by']] = true;
                break;
            }
        } elseif (isset(xs_own_art_kinds()[$kind])) {
            $bytes = xs_fm_fetch((string) $it['url'], $why);
            if ($bytes !== null && xs_own_art_store($id, $kind, $bytes, true, $why) !== null) {
                $picsBy[$it['by']] = true;
                break;
            }
        }
        xs_log('HBRW', 'get ' . $name . ': ' . $kind . ' did not come from ' . (string) parse_url((string) $it['url'], PHP_URL_HOST) . ': ' . (string) $why);
    }
}
$job['phase'] = 'adding';
$save();
$jam = (array) (xs_hb_doc()['jams'][$g['jam']] ?? []);
$credit = (string) $g['about'] . "\n\nMade by " . $g['team'] . ' for ' . (string) ($jam['name'] ?? 'a jam')
    . (($g['basedon'] ?? '') !== '' ? ', with ' . $g['basedon'] : '') . '. Licence: ' . $g['licence'] . '.'
    . (($g['page'] ?? '') !== '' ? "\n" . $g['page'] : '') . (($g['repo'] ?? '') !== '' ? "\n" . $g['repo'] : '')
    . ($picsBy ? "\nPictures from " . implode(', ', array_keys($picsBy)) . '.' : '');
$said = $ask('/api/edit.php', ['id' => $id, 'set' => ['developer' => mb_substr((string) $g['team'], 0, 200), 'notes' => $credit]]);
if (!($said['ok'] ?? false)) {
    xs_log('HBRW', 'get ' . $name . ': its makers not written on it: ' . (string) ($said['error'] ?? 'no answer'));
}
$aresKey = ($g['emulator'] ?? '') === 'ares' ? xs_hb_ares_key(xs_emulators()) : null;
if ($aresKey !== null) {
    $table = xs_emulators();
    unset($table['mine']);
    xs_hb_ares_offer($table, $console, $aresKey);
    if (!xs_emulators_write($table, $why) || !xs_emuset_set($id, $aresKey, $why)) {
        xs_log('HBRW', 'get ' . $name . ': ares not set for it: ' . (string) $why);
    }
}
$remember();
$job['made'] = ['id' => $id, 'file' => $out, 'version' => $version];
$end('done', $name . ' is in your ' . $console . ' list' . ($version !== '' ? ' (' . $version . ')' : '') . ': ' . $out);
