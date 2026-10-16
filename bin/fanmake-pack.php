<?php
/**
 * Xsegon - Make for a disc mod played through Dolphin's Riivolution, read in by bin\fanmake.php
 * with its job and its words (Retro Rewind).
 *
 * The team's own server names its full pack and the updates after it, as their installer reads
 * them: the full pack is fetched, looked at by Windows Defender and its mod folders unpacked
 * beside the console's games (Mods\<name>), each newer update put on in turn with the files it
 * takes away removed, and a Dolphin start file written that boots your disc, where it is, with
 * the pack. It joins the console's list, tied to the game.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/unpack.php';

$DS = DIRECTORY_SEPARATOR;
$rom = (string) $job['rom'];
$fail = static function (string $words) use ($end, $name): void {
    $end($words === 'stopped' ? 'stopped' : 'failed', $words === 'stopped' ? 'stopped: ' . $name . ' was not set up' : $name . ' was not set up: ' . $words);
};
$own = static fn(string $url): bool => xs_fm_own_url($p, $url);
$take = array_values((array) $m['take']);

// ---- the team's own word on what to fetch ---------------------------------------------------
$job['phase'] = 'asking';
$save();
$text = xs_fm_fetch((string) $m['install'], $w);
$full = trim((string) strtok((string) $text, "\r\n"));
if ($text === null || !$own($full)) {
    $fail($text === null ? 'the team\'s server did not say where its pack is (is the internet there?): ' . $w : 'the team\'s server named a pack somewhere other than its own');
}
$updates = [];
$text = xs_fm_fetch((string) $m['updates'], $w);
foreach (preg_split('/\r?\n/', (string) $text) as $line) {
    // "6.13.1 https://.../6.13.1.zip /6.13.1.zip Assets": a version and where it is.
    if (preg_match('/^\s*(\d+\.\d+\.\d+)\s+(\S+)/', $line, $u) && $own($u[2])) {
        $updates[$u[1]] = $u[2];
    }
}
uksort($updates, 'version_compare');
$deletes = [];
$text2 = xs_fm_fetch((string) $m['deletes'], $w2);
foreach (preg_split('/\r?\n/', (string) $text2) as $line) {
    if (preg_match('#^\s*(\d+\.\d+\.\d+)\s+(/\S.*?)\s*$#', $line, $d) && !str_contains($d[2], '..')) {
        $deletes[] = [$d[1], $d[2]];
    }
}
if ($text === null || !$updates || $text2 === null) {
    $fail('the team\'s server did not give its list of updates (is the internet there?)' . (($w ?? $w2) !== null ? ': ' . ($w ?? $w2) : ''));
}
$latest = (string) array_key_last($updates);
xs_log('FAN', 'make ' . $name . ': the team\'s pack is ' . $full . ', its latest update ' . $latest . ', ' . count($deletes) . ' files named to take away over time');

// ---- where it goes, and room for it -----------------------------------------------------------
$head = xs_fm_head_size($full);
$dir = xs_fm_dest((string) $job['platform'], $rom, 'Mods');
if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
    $fail('the folder ' . $dir . ' could not be made (' . xs_file_error_reason() . ')');
}
$free = (float) @disk_free_space($dir);
if ($head !== null && $free > 0 && $free < $head * 1.5) {
    $fail('there is not enough room on ' . $dir . ': it needs about ' . round($head * 1.5 / 1073741824, 1) . ' GB');
}
$out = $dir . $DS . $m['folder'];
for ($n = 2; file_exists($out) && $n < 100; $n++) {
    $out = $dir . $DS . $m['folder'] . ' (' . $n . ')';
}
$tmp = $out . '.part';
$dl = $part . '.zip';
register_shutdown_function(static function () use ($dl, $tmp): void {
    @unlink($dl);
    @unlink($dl . '.err');
    if (is_dir($tmp)) {
        xs_unpack_remove($tmp);           // half a folder is never left behind
    }
});

// One zip of the team's: fetched with a bar, its size as the server says, looked at by Windows Defender, its mod folders unpacked over $tmp.
$one = static function (string $url, ?int $size) use (&$job, $save, $stopped, $fail, $dl, $tmp, $take, $name, $t0): void {
    $job['phase'] = 'fetching';
    $job['file'] = basename((string) parse_url($url, PHP_URL_PATH));
    $job['bytes'] = 0;
    $job['total'] = (int) $size;
    $save();
    if (!xs_fm_download($url, $dl, static function (int $b) use (&$job, $save): void { $job['bytes'] = $b; $save(false); }, $stopped, $w)) {
        $fail((string) $w);
    }
    clearstatcache(true, $dl);
    if ($size !== null && (int) filesize($dl) !== $size) {
        $fail($job['file'] . ' came to ' . number_format((int) filesize($dl)) . ' bytes, and the team\'s server says ' . number_format($size) . ', so it was not used');
    }
    $job['phase'] = 'checking';
    $save();
    $said = xs_unpack_defender_scan($dl, $what, static fn(): bool => !$stopped());
    if ($said === 'stopped') {
        $fail('stopped');
    }
    if ($said === 'found') {
        $fail('Windows Defender found ' . $what . ' in ' . $job['file'] . ', so it was not unpacked and nothing was kept');
    }
    $job['phase'] = 'unpacking';
    $save();
    if (!xs_fm_unpack($dl, $tmp, $w, false, $take)) {
        $fail($job['file'] . ': ' . $w);
    }
    @unlink($dl);
    xs_log('FAN', 'make ' . $name . ': ' . $job['file'] . ' fetched and unpacked, ' . round(microtime(true) - $t0) . 's from the start; Windows Defender '
        . ($said === 'clean' ? 'found nothing in it' : 'is not here or would not say'));
};

// ---- the full pack, then each update after it -------------------------------------------------
$one($full, $head);
$verFile = $tmp . $DS . str_replace('/', $DS, (string) $m['version']);
$now = trim((string) @file_get_contents($verFile));
if (!preg_match('/^\d+\.\d+\.\d+$/', $now)) {
    $fail('the pack does not say its version in ' . $m['version'] . ': the team may have changed how it is packed');
}
foreach ($updates as $v => $url) {
    if (version_compare((string) $v, $now) <= 0) {
        continue;
    }
    // What the team takes away by this version goes first, as their installer does.
    foreach ($deletes as [$dv, $path]) {
        if (version_compare($dv, $now) > 0 && version_compare($dv, (string) $v) <= 0) {
            $f = $tmp . str_replace('/', $DS, $path);
            if (is_file($f)) {
                @unlink($f);
            }
        }
    }
    $job['phase'] = 'updating';
    $job['version'] = (string) $v;
    $save();
    $one($url, xs_fm_head_size($url));
    @file_put_contents($verFile, (string) $v);
    $now = (string) $v;
}
$version = $now;
$job['version'] = $version;
foreach ([(string) $m['xml']] as $f) {
    if (!is_file($tmp . $DS . str_replace('/', $DS, $f))) {
        $fail('the pack has no ' . $f . ' in it: the team may have changed how it is packed');
    }
}

// ---- Dolphin's start file: your disc where it is, with the pack ------------------------------
$job['phase'] = 'placing';
$save();
$start = $m['folder'] . '.json';
$desc = ['base-file' => $rom, 'display-name' => $name . ' ' . $version, 'type' => 'dolphin-game-mod-descriptor', 'version' => 1,
         'riivolution' => ['patches' => [['xml' => $out . $DS . str_replace('/', $DS, (string) $m['xml']), 'root' => $out,
                                          'options' => array_values((array) ($m['options'] ?? []))]]]];
if (!xs_write_json($tmp . $DS . $start, $desc, $w)) {
    $fail((string) $w);
}
if (!@rename($tmp, $out)) {
    $fail('the folder could not be named ' . basename($out) . ' (' . xs_file_error_reason() . ')');
}
xs_log('FAN', 'make ' . $name . ': ' . $version . ' unpacked into ' . $out . ', its start file ' . $start . ' boots ' . $rom);

// ---- into the console's list, tied to the game ------------------------------------------------
$job['phase'] = 'adding';
$save();
$platform = (string) $job['platform'];
$file = $out . $DS . $start;
$id = xs_fm_scan_id($platform, $file);
$title = $name . ' ' . $version;
$took = $ask('/api/scan.php', ['action' => 'accept', 'games' => [['id' => $id, 'title' => $title, 'platform' => $platform, 'rom' => $file]]]);
$in = ($took['ok'] ?? false) && ((int) ($took['added'] ?? 0) > 0 || ($took['skipped'][0]['why'] ?? '') === 'already accepted before');
if ($in) {
    $tie = $ask('/api/hacks.php', ['id' => $id, 'hackOf' => (string) $job['base']]);
    if (!($tie['ok'] ?? false)) {
        xs_log('FAN', 'make ' . $name . ': not tied to ' . $job['baseTitle'] . ': ' . (string) ($tie['error'] ?? 'no answer'));
    }
    $kept = xs_fm_made();
    $kept[$id] = ['project' => (string) $p['id'], 'version' => $version, 'folder' => $out, 'at' => time()];
    xs_write_json(xs_fm_made_path(), $kept);
}
$job['made'] = ['id' => $in ? $id : null, 'file' => $file, 'version' => $version];
$job['seconds'] = (int) round(microtime(true) - $t0);
$end('done', $title . ' is set up from your ' . $job['baseTitle'] . ': ' . $out
    . ($in ? ', in your ' . $platform . ' list' : ', but it is not in your library yet (' . (string) ($took['error'] ?? 'Xsegon did not answer') . ')')
    . (isset($m['first']) ? '. ' . $m['first'] : ''));
