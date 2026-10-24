<?php
/**
 * Xsegon - gets a new version ready in the background (includes\update.php),
 * started by Update now, or by the daily look where new versions download by
 * themselves.
 *
 *   php bin\update.php
 *
 * The version and its three files' addresses are in data\update\fetch.json.
 * The signed list first (by the key this copy carries), then the zip, checked
 * against it, unpacked whole into data\update\next\, every file checked, and
 * the new copy started once on a spare port with an empty data folder of its
 * own. Only then is it ready, and the mailbox says so. Nothing of the copy in
 * use changes here; any failure leaves nothing behind.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/update.php';
require_once __DIR__ . '/../includes/news.php';

set_time_limit(0);

$t0   = microtime(true);
$job  = xs_read_json(xs_update_file('fetch.json'), []);
$ver  = is_array($job) ? (string) ($job['version'] ?? '') : '';
$urls = is_array($job) ? (array) ($job['urls'] ?? []) : [];
$next = xs_update_file('next');
$nphp = xs_update_file('next-php');
$in   = xs_update_file('incoming');
if (($job['state'] ?? '') !== 'running' || $ver === '' || !isset($urls['zip'], $urls['list'], $urls['sig'])) {
    fwrite(STDERR, "nothing waiting in data\\update\\fetch.json\n");
    exit(1);
}

$clear = static function () use ($next, $nphp, $in): void {
    foreach ([$in, $next, $nphp, xs_update_file('trial-data')] as $d) {
        xs_update_rmtree($d);
    }
    @unlink(xs_update_file('ready.json'));
};
$end = static function (string $state, string $line, string $why = '') use (&$job, $t0): never {
    $job['state'] = $state;
    $job['why']   = $why;
    $job['ended'] = date('c');
    xs_write_json(xs_update_file('fetch.json'), $job);
    xs_log('UPD', $line . ', in ' . (int) round((microtime(true) - $t0) * 1000) . 'ms');
    echo json_encode(['ok' => $state === 'done', 'why' => $why]), "\n";
    exit($state === 'done' ? 0 : 1);
};
$fail = static function (string $why) use ($clear, $end, $ver): never {
    $clear();
    $end('failed', 'getting ' . $ver . ' ready did not work: ' . $why . '. Nothing of this copy changed; its page has it to update by hand', $why);
};
// Each step, and the download's bytes at most twice a second, for the corner bar Update now shows (js\updaterow.js).
$lastTick = 0.0;
$step = static function (string $name, int $got = 0, int $size = 0) use (&$job, &$lastTick): void {
    if ($name === ($job['step'] ?? '') && $got < $size && microtime(true) - $lastTick < 0.5) {
        return;
    }
    $lastTick = microtime(true);
    $job = ['step' => $name, 'beat' => time()] + ($name === 'download' ? ['got' => $got, 'size' => $size] : []) + $job;
    xs_write_json(xs_update_file('fetch.json'), $job);
};

$cannot = xs_update_cannot();
if ($cannot !== null) {
    $fail('this copy cannot update itself (' . $cannot . ')');
}
$clear();
@mkdir($in, 0777, true);

// The list first, and its signature: nothing bigger comes down unless it is ours.
$step('list');
$listText = xs_update_get($urls['list'], null, 8 * 1048576, $why);
$sigText  = is_string($listText) ? xs_update_get($urls['sig'], null, 65536, $why) : false;
if (!is_string($listText) || !is_string($sigText)) {
    $fail('its file list did not come (' . $why . ')');
}
if (!xs_update_signed($listText, $sigText)) {
    $fail("its file list is not signed with Xsegon's key");
}
$list = json_decode($listText, true);
$bad  = xs_update_list_problem($list, $ver);
if ($bad !== null) {
    $fail($bad);
}

$zip = $in . DIRECTORY_SEPARATOR . 'update.zip';
$want = (int) $list['zip']['size'];
$step('download', 0, $want);
if (xs_update_get($urls['zip'], $zip, min(XS_UPDATE_MAX, $want), $why, static fn (int $got, int $size) => $step('download', $got, $size ?: $want)) !== true) {
    $fail('the update did not come (' . $why . ')');
}
if (filesize($zip) !== (int) $list['zip']['size'] || hash_file('sha256', $zip) !== $list['zip']['sha256']) {
    $fail('the update arrived damaged: its size or checksum is not the one on its signed list');
}
$step('check');
@mkdir($next, 0777, true);
$p = @proc_open([xs_update_tar(), '-xf', $zip, '-C', $next], [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', 'NUL', 'w']],
                $pipes, null, null, ['bypass_shell' => true]);
if (!is_resource($p) || proc_close($p) !== 0) {
    $fail("Windows' tar could not unpack it");
}
$bad = xs_update_tree_problem($next, $list['files']);
if ($bad !== null) {
    $fail('the unpacked copy is not the one on its list: ' . $bad);
}
file_put_contents($next . DIRECTORY_SEPARATOR . 'RELEASE.json', $listText);
file_put_contents($next . DIRECTORY_SEPARATOR . 'RELEASE.sig', $sigText);

// The PHP it runs on, when this copy's is another version and the person ticked it in the Update now
// window (never by itself), with Offer a newer PHP still on in Settings: checked against the signed list, unpacked into data\update\next-php with this
// copy's own php.ini, and the new copy is tried on it.
$php      = !empty($job['php']) && xs_update_php_offered() ? xs_update_php_wanted($list) : null;
$trialPhp = null;
if ($php !== null) {
    $phpZip = $in . DIRECTORY_SEPARATOR . 'php.zip';
    $step('download', 0, (int) $php['size']);
    if (xs_update_get(xs_update_php_url($urls, (string) $php['name']), $phpZip, XS_UPDATE_MAX, $why,
                      static fn (int $got, int $size) => $step('download', $got, $size ?: (int) $php['size'])) !== true) {
        $fail('its PHP ' . $php['version'] . ' did not come (' . $why . ')');
    }
    if (filesize($phpZip) !== (int) $php['size'] || hash_file('sha256', $phpZip) !== $php['sha256']) {
        $fail('its PHP arrived damaged: its size or checksum is not the one on its signed list');
    }
    $step('check');
    @mkdir($nphp, 0777, true);
    $p = @proc_open([xs_update_tar(), '-xf', $phpZip, '-C', $nphp], [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', 'NUL', 'w']],
                    $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($p) || proc_close($p) !== 0) {
        $fail("Windows' tar could not unpack its PHP");
    }
    $bad = xs_update_tree_problem($nphp, $php['files']);
    if ($bad !== null) {
        $fail('its PHP is not the one on its list: ' . $bad);
    }
    $ini = XS_ROOT . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'php' . DIRECTORY_SEPARATOR . 'php.ini';
    if (is_file($ini) && !@copy($ini, $nphp . DIRECTORY_SEPARATOR . 'php.ini')) {
        $fail("could not carry this copy's php.ini over to its PHP");
    }
    $trialPhp = $nphp . DIRECTORY_SEPARATOR . 'php.exe';
}
xs_update_rmtree($in);

$step('try');
$why = xs_update_trial($next, $ver, $trialPhp, $php['version'] ?? null);
if ($why !== null) {
    $fail('the new copy did not start when tried on its own: ' . $why);
}
// The switch runs from a copy outside the folders it moves.
if (!@copy(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'update-switch.php', xs_update_file('updater.php'))) {
    $fail('could not copy the updater into data\\update');
}
$have = xs_version()['version'];
xs_write_json(xs_update_file('ready.json'), ['version' => $ver, 'from' => $have, 'files' => count($list['files']),
    'zipBytes' => (int) $list['zip']['size'], 'php' => $php['version'] ?? null, 'phpFrom' => $php !== null ? xs_update_php_have() : null,
    'zone' => date_default_timezone_get(), 'at' => date('c')]);
$withPhp = $php !== null ? ', with PHP ' . $php['version'] . ' in place of ' . xs_update_php_have() : '';

// The message about this version becomes "ready", read or not as it was: said once. One deleted stays deleted; Settings still has Update now.
$was = null;
foreach (xs_messages() as $m) {
    if (($m['id'] ?? '') === XS_UPDATE_MSG) {
        $was = $m;
    }
}
if ($was === null) {
    $end('done', $ver . ' is ready: ' . count($list['files']) . ' files, ' . round((int) $list['zip']['size'] / 1048576, 1) . ' MB' . $withPhp . ', checked and tried; its message was deleted, so nothing is said');
}
xs_messages_add([
    'id'    => XS_UPDATE_MSG,
    'at'    => date('c'),
    'kind'  => 'info',
    'title' => 'Xsegon ' . $ver . ' is ready',
    'body'  => 'This is ' . $have . '. ' . $ver . ' has been downloaded' . ($php !== null ? ' with the newer PHP it runs on (' . $php['version'] . ')' : '')
             . ', checked against its signed list and tried once on its own; nothing of this copy '
             . 'has changed. Update now asks first, then takes a backup of your data, closes Xsegon, puts ' . $ver . ' in place and opens it again. Your games, settings '
             . 'and pictures stay as they are, and a file of Xsegon\'s you changed is kept aside and named. Settings > Window > New versions can go back to '
             . $have . ' afterwards, and stops these messages.',
    'items' => (array) ($was['items'] ?? []),
    'url'   => (string) ($was['url'] ?? ''),
    'opens' => ['updatenow', 'newversion'],
    'read'  => !empty($was['read']),
]);
$end('done', $ver . ' is ready: ' . count($list['files']) . ' files, ' . round((int) $list['zip']['size'] / 1048576, 1) . ' MB' . $withPhp . ', checked and tried; said in the mailbox');
