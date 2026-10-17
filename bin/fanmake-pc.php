<?php
/**
 * Xsegon - Make for a PC version, read in by bin\fanmake.php with its job and its words.
 *
 * The team's Windows release from their own GitHub, checked against what GitHub says of it,
 * looked at by Windows Defender and unpacked beside the console's games (Ports\<name>); then
 * your game put where the port reads it (never changed where it is), and the port added to
 * your Windows list with the team's credit and links in its notes.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/unpack.php';

$DS = DIRECTORY_SEPARATOR;
$game = (array) $m['game'];
$rom = (string) $job['rom'];
$fail = static function (string $words) use ($end, $name): void {
    $end($words === 'stopped' ? 'stopped' : 'failed', $words === 'stopped' ? 'stopped: ' . $name . ' was not set up' : $name . ' was not set up: ' . $words);
};

// ---- the release on the team's GitHub and its Windows download, or the source a build is made from ----
$job['phase'] = 'asking';
$save();
$tag = (string) ($m['tag'] ?? '');
$build = ($m['how'] ?? '') === 'build';
$rel = $build ? xs_fm_source_zip((string) ($m['repo'] ?? $p['repo']), (string) $m['branch'], $w)
     : xs_fm_release((string) ($m['repo'] ?? $p['repo']), $tag, (string) $m['asset'], $w);
if ($rel === null) {
    $fail((string) $w);
}
// A tag rebuilt in place ("ci-dev-build") is known by the day of its build; a build from source by its commit.
$version = $build ? 'build ' . $rel['tag'] : ($tag !== '' ? 'build ' . $rel['day'] : $rel['tag']);
$job['version'] = $version;
xs_log('FAN', 'make ' . $name . ': GitHub has ' . $rel['tag'] . ' (' . $rel['day'] . '): ' . $rel['file']
    . ($rel['size'] !== null ? ', ' . round($rel['size'] / 1048576, 1) . ' MB' : '') . ', '
    . ($rel['sha256'] !== null ? 'sha256 ' . substr($rel['sha256'], 0, 12) : 'no checksum given'));

// ---- your game, read before anything is downloaded ----------------------------------------
$job['phase'] = 'reading';
$save();
$bytes = null;
$discs = null;
$xfiles = null;
if (isset($game['discs'])) {
    $need = [];
    foreach ((array) $p['base']['match'] as $mm) {
        if (isset($mm['discs'])) {
            $need = array_values((array) $mm['discs']);
            break;
        }
    }
    $mine = array_values(array_filter(xs_library()['games'] ?? [], static fn($g) => empty($g['hidden']) && ($g['platform'] ?? '') === $job['platform']));
    $discs = xs_fm_disc_sources($mine, xs_fan_words((string) ($p['base']['db']['title'] ?? $p['base']['title'])), $need, $w);
    if ($discs === null) {
        $fail('your ' . $job['baseTitle'] . '\'s ' . $w);
    }
    $room = (int) array_sum(array_column($discs, 'bytes'));
    xs_log('FAN', 'make ' . $name . ': ' . count($discs) . ' discs found, ' . implode(', ', array_map(static fn($d) => isset($d['pbp']) ? basename($d['pbp']) . ' disc ' . $d['disc']['id'] : basename($d['files'][0]), $discs)));
} elseif (isset($game['xiso'])) {
    // An Xbox disc's files, written out once beside the port, which reads them from a folder and not from the image.
    require_once __DIR__ . '/../includes/xiso.php';
    $xfiles = xs_xiso_list($rom, $w);
    if ($xfiles === null) {
        $fail('your ' . $job['baseTitle'] . '\'s ' . $w);
    }
    $room = (int) array_sum(array_column($xfiles, 'size'));
    xs_log('FAN', 'make ' . $name . ': ' . count($xfiles) . ' files on your disc, ' . round($room / 1048576) . ' MB, to be written into ' . $game['xiso']);
} elseif (isset($game['ini']) || !empty($game['args'])) {
    // A port with an emulator of its own, or one told its disc when it starts, reads your disc where it is: nothing is copied.
    $room = 0;
} else {
    $bytes = xs_fm_game_bytes($rom, (string) ($game['format'] ?? ''), $w);
    if ($bytes === null) {
        $fail('your ' . $job['baseTitle'] . '\'s ' . $w);
    }
    if (!xs_fm_game_is($bytes, $game)) {
        $fail('your ' . $job['baseTitle'] . ' is not a copy it takes (its MD5 is ' . md5($bytes) . ')');
    }
    $room = strlen($bytes);
}
if ($stopped()) {
    $fail('stopped');
}

// ---- where it goes, and room for it -------------------------------------------------------
$dir = xs_fm_dest((string) $job['platform'], $rom, 'Ports');
if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
    $fail('the folder ' . $dir . ' could not be made (' . xs_file_error_reason() . ')');
}
$free = (float) @disk_free_space($dir);
$want = (int) ($rel['size'] ?? 50 << 20) * 4 + $room;    // the download and what it unpacks to, with room to spare, and your game
if ($free > 0 && $free < $want) {
    $fail('there is not enough room on ' . $dir . ': it needs about ' . round($want / 1048576) . ' MB');
}
$out = $dir . $DS . $m['folder'];
for ($n = 2; file_exists($out) && $n < 100; $n++) {
    $out = $dir . $DS . $m['folder'] . ' (' . $n . ')';
}
$tmp = $out . '.part';
$dl = $part . '.' . strtolower(pathinfo($rel['file'], PATHINFO_EXTENSION));
register_shutdown_function(static function () use ($dl, $tmp): void {
    @unlink($dl);
    @unlink($dl . '.err');
    if (is_dir($tmp)) {
        xs_unpack_remove($tmp);           // half a folder is never left behind
    }
});

// ---- each download checked against what GitHub says of it, looked at by Windows Defender, and unpacked ----
// A release is one download; a build is the team's source and the tools their build guide names.
$downloads = [['url' => $rel['url'], 'file' => $rel['file'], 'size' => $rel['size'], 'sha256' => $rel['sha256'], 'into' => '', 'open' => true]];
foreach ($build ? (array) $m['tools'] : [] as $tool) {
    $downloads[] = ['url' => (string) $tool['url'], 'file' => basename((string) parse_url((string) $tool['url'], PHP_URL_PATH)),
                    'size' => (int) $tool['size'], 'sha256' => null, 'into' => (string) $tool['into'], 'open' => false];
}
foreach ($downloads as $d) {
    $job['phase'] = 'fetching';
    $job['file'] = $d['file'];
    $job['bytes'] = 0;
    $job['total'] = (int) $d['size'];
    $save();
    if (!xs_fm_download($d['url'], $dl, static function (int $b) use (&$job, $save): void { $job['bytes'] = $b; $save(false); }, $stopped, $w)) {
        $fail((string) $w);
    }
    clearstatcache(true, $dl);
    if ($d['size'] !== null && (int) filesize($dl) !== $d['size']) {
        $fail('the download of ' . $d['file'] . ' came to ' . number_format((int) filesize($dl)) . ' bytes, and GitHub says ' . number_format($d['size']) . ', so it was not used');
    }
    if ($d['sha256'] !== null && hash_file('sha256', $dl) !== $d['sha256']) {
        $fail($d['file'] . ' is not the file GitHub lists (its sha256 differs), so it was not used');
    }
    xs_log('FAN', 'make ' . $name . ': fetched ' . $d['file'] . ' in ' . round(microtime(true) - $t0, 1) . 's, '
        . ($d['sha256'] !== null ? 'its sha256 as GitHub lists' : ($d['size'] !== null ? 'its size as GitHub lists' : 'GitHub gives no size for it')
           . ' (no checksum given; each file in it is checked as it unpacks)'));

    $job['phase'] = 'checking';
    $save();
    $said = xs_unpack_defender_scan($dl, $what, static fn(): bool => !$stopped());
    if ($said === 'stopped') {
        $fail('stopped');
    }
    if ($said === 'found') {
        $fail('Windows Defender found ' . $what . ' in ' . $d['file'] . ' from GitHub, so it was not unpacked and nothing was kept');
    }
    xs_log('FAN', 'make ' . $name . ': Windows Defender ' . ($said === 'clean' ? 'found nothing in ' . $d['file'] : 'is not here or would not say'));

    $job['phase'] = 'unpacking';
    $save();
    if (!xs_fm_unpack($dl, $tmp . ($d['into'] !== '' ? $DS . str_replace('/', $DS, $d['into']) : ''), $w, $d['open'])) {
        $fail($d['file'] . ': ' . $w);
    }
    @unlink($dl);
}

// ---- a build: the team's own compile line, run in its folder ----------------------------
if ($build) {
    $job['phase'] = 'building';
    $save();
    if (!xs_fm_compile($tmp, (array) $m['compile'], $w)) {
        $fail('it could not be built: ' . $w);
    }
    foreach ((array) ($m['copy'] ?? []) as [$from, $to]) {
        if (!@copy($tmp . $DS . str_replace('/', $DS, (string) $from), $tmp . $DS . str_replace('/', $DS, (string) $to))) {
            $fail($from . ' could not be put beside what it runs (' . xs_file_error_reason() . ')');
        }
    }
    xs_log('FAN', 'make ' . $name . ': built ' . $m['run'] . ' in ' . round(microtime(true) - $t0, 1) . 's from the start');
}
$run = $tmp . $DS . str_replace('/', $DS, (string) $m['run']);
foreach (array_merge([(string) $m['run']], (array) ($m['need'] ?? [])) as $f) {
    if (!is_file($tmp . $DS . str_replace('/', $DS, $f))) {
        $fail('the download has no ' . $f . ' in it: the team may have changed how it is packed');
    }
}

// ---- your game, where the port reads it --------------------------------------------------
$job['phase'] = 'placing';
$job['bytes'] = 0;
$job['total'] = $room;
$save();
if ($discs !== null) {
    $to = $tmp . $DS . str_replace('/', $DS, (string) $game['discs']);
    if (!is_dir($to) && !@mkdir($to, 0777, true) && !is_dir($to)) {
        $fail('the folder ' . $to . ' could not be made (' . xs_file_error_reason() . ')');
    }
    $wrote = xs_fm_disc_write($discs, $to, (string) ($game['name'] ?? $job['baseTitle']),
        static function (int $b) use (&$job, $save, $stopped): bool { $job['bytes'] = $b; $save(false); return !$stopped(); }, $w, !empty($game['rename']));
    if ($wrote === null) {
        $fail((string) $w);
    }
    $placed = count($discs) === 1 ? 'your disc into ' . $game['discs'] . ' as ' . implode(' and ', $wrote) : count($discs) . ' discs into ' . $game['discs'];
} elseif (isset($game['ini'])) {
    if (!xs_fm_ini_set($tmp . $DS . str_replace('/', $DS, (string) $game['ini']), (string) $game['section'], (string) $game['key'], $rom, $w)) {
        $fail((string) $w);
    }
    $placed = $game['ini'] . ' pointed at your ' . $job['baseTitle'] . ' (' . $rom . ')';
} elseif (!empty($game['args'])) {
    $placed = 'started with your ' . $job['baseTitle'] . ' where it is (' . $rom . ')';
} elseif ($xfiles !== null) {
    $wrote = xs_xiso_write($rom, $xfiles, $tmp . $DS . str_replace('/', $DS, (string) $game['xiso']),
        static function (int $b) use (&$job, $save, $stopped): bool { $job['bytes'] = $b; $save(false); return !$stopped(); }, $w);
    if ($wrote === null) {
        $fail((string) $w);
    }
    $placed = count($xfiles) . ' files of your disc into ' . $game['xiso'] . ', ' . round($wrote / 1048576) . ' MB';
} else {
    $to = $tmp . $DS . xs_fm_game_to((string) $game['to'], (string) ($job['release'] ?? ''), (string) $job['baseTitle']);
    if (!is_dir(dirname($to)) && !@mkdir(dirname($to), 0777, true) && !is_dir(dirname($to))) {
        $fail('the folder ' . dirname($to) . ' could not be made (' . xs_file_error_reason() . ')');
    }
    if (@file_put_contents($to, $bytes) !== strlen($bytes)) {
        $fail('your game could not be put in its folder (' . xs_file_error_reason() . ')');
    }
    $placed = 'your game as ' . substr($to, strlen($tmp) + 1);
}
unset($bytes);
// The empty files a port reads as a switch, such as portable.txt: it keeps its settings and saves in its own folder.
foreach ((array) ($m['write'] ?? []) as $f) {
    if (!is_file($tmp . $DS . $f) && @file_put_contents($tmp . $DS . $f, '') === false) {
        $fail($f . ' could not be written in its folder (' . xs_file_error_reason() . ')');
    }
}
if (!@rename($tmp, $out)) {
    $fail('the folder could not be named ' . basename($out) . ' (' . xs_file_error_reason() . ')');
}
xs_log('FAN', 'make ' . $name . ': unpacked into ' . $out . ', ' . $placed);

// ---- into your Windows list, the team's credit with it ------------------------------------
$job['phase'] = 'adding';
$save();
$list = (string) ($m['list'] ?? 'Windows');
$exe = $out . $DS . str_replace('/', $DS, (string) $m['run']);
$links = array_filter([$p['page'] ?? null, $p['repo'] ?? null, $p['community'] ?? null]);
// A credit the team's licence asks a launcher to show goes first, in its own words.
$notes = (isset($m['credit']) ? (string) $m['credit'] . "\n\n" : '') . $name . ' is made by ' . $p['team']
    . (is_string($p['basedon'] ?? null) && trim($p['basedon']) !== '' ? ', based on ' . trim($p['basedon']) : '') . ":\n" . implode("\n", $links) . "\n\n"
    . 'Set up by Xsegon\'s Fan projects from your ' . $job['baseTitle'] . ', ' . $rel['tag'] . ($tag !== '' ? ' of ' . $rel['day'] : '')
    . ' downloaded from the team\'s GitHub.' . (isset($m['first']) ? ' ' . $m['first'] : '');
// "{folder}" in its words is where it was put, for a file it is told to open; "{disc}" is your disc where it is.
$took = $ask('/api/local.php', ['set' => ['title' => (string) ($m['title'] ?? $name), 'platform' => $list, 'run' => $exe,
                                          'args' => str_replace(['{folder}', '{disc}'], [$out, $rom], (string) ($m['args'] ?? '')), 'developer' => (string) $p['team'], 'notes' => $notes]]);
$id = (string) ($took['game']['id'] ?? '');
if ($id !== '') {
    $kept = xs_fm_made();
    $kept[$id] = ['project' => (string) $p['id'], 'version' => $version, 'folder' => $out, 'at' => time()];
    xs_write_json(xs_fm_made_path(), $kept);
} else {
    xs_log('FAN', 'make ' . $name . ': not added to the ' . $list . ' list: ' . (string) ($took['error'] ?? 'Xsegon did not answer'));
}
$job['made'] = ['id' => $id !== '' ? $id : null, 'file' => $exe, 'version' => $version];
$job['seconds'] = (int) round(microtime(true) - $t0);
$end('done', $name . ' ' . $version . ' is set up from your ' . $job['baseTitle'] . ': ' . $out
    . ($id !== '' ? ', in your ' . $list . ' list' : ', but it is not in your library yet: add ' . basename($exe) . ' there as a game of your own')
    . (isset($m['first']) ? '. ' . $m['first'] : ''));
