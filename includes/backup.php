<?php
/**
 * Backing up the things only you have: edits, pictures you set, marks, your own games,
 * play history, settings. Copies and caches in data\ are left out, as they can be rebuilt.
 *
 * The archive is a plain zip laid out like data\, so it can be put back by hand with no
 * Xsegon. The zip is Xsegon's own (includes\zipstore.php): this PHP has no zip extension.
 * Every archive is read back whole under a working name before it gets its .zip name.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/zipstore.php';

/** The parts a backup is made of, in the order they are shown. */
function xs_backup_parts(): array
{
    return [
        'art' => [
            'label' => 'Pictures you set',
            'help'  => 'Box art, logos, screenshots and backgrounds you replaced, and the ones you told Xsegon not to use.',
            'dirs'  => ['art'],
            'files' => ['art-hidden.json'],
        ],
        'platform-art' => [
            'label' => 'Console pictures',
            'help'  => 'The logos and photographs you dropped in for a console or a collection.',
            'dirs'  => ['platform-art'],
            'files' => [],
        ],
        'video-own' => [
            'label' => 'Videos you set',
            'help'  => 'A video you chose for one game yourself, filed by game id.',
            'dirs'  => ['video-own'],
            'files' => [],
        ],
        'edits' => [
            'label' => 'Text you edited',
            'help'  => 'Titles, developers, genres, descriptions: everything Edit Metadata saved, which database entry a game was matched to, the core and the cheats you chose for a game, the buttons and the keyboard keys you set for a console or a game, and your menu and quit choices for RetroArch.',
            'dirs'  => [],
            /* data\cheats\ and data\ra-remaps\ are left out: each launch writes
               them again from cheats.json and pad-remaps.json. */
            'files' => ['overrides.json', 'cores.json', 'emu-choice.json', 'hack-choice.json', 'cheats.json', 'cheats-used.json', 'pad-remaps.json', 'player-remaps.json', 'game-remaps.json', 'pad-keys.json', 'ra-hotkeys.json', 'game-hotkeys.json'],
        ],
        'marks' => [
            'label' => 'Favourites, your ratings, tags, hidden and deleted games',
            'help'  => 'Which games are favourites, the stars you gave games yourself, the tags you put on games, which ones you took off every view, which ones you took out of the library altogether, the games you starred as wanted, and the page each manual was left on, with its bookmarks.',
            'dirs'  => [],
            // fix-marks.json: the "needs fix" tag you put on or took off (includes\needsfix.php).
            // manual-places.json: the page each manual was left on, and its bookmarks (api\manual-place.php).
            'files' => ['favourites.json', 'my-ratings.json', 'notes.json', 'hack-of.json', 'accompanied.json', 'tags.json', 'fix-marks.json', 'hidden.json', 'deleted.json', 'wanted.json', 'manual-places.json'],
        ],
        'own' => [
            'label' => 'Games of your own',
            'help'  => 'The games you added yourself (programs and web games), and the ones the scanner found on your disk that you accepted.',
            'dirs'  => [],
            'files' => ['local-games.json', 'scanned-games.json'],
        ],
        'history' => [
            'label' => 'Play history',
            'help'  => 'Every session recorded: what was played, when, and for how long.',
            'dirs'  => [],
            'files' => ['sessions.jsonl', 'launch-log.jsonl', 'history-seeded.json'],
        ],
        'settings' => [
            'label' => 'Settings',
            'help'  => 'Your settings.json, including the paths this Xsegon reads from, the emulator table: where each emulator is and which core runs which console, the sounds you chose yourself, and sound packs of your own.',
            // sounds-own: Settings > Sound > Your own sounds (includes\ownsounds.php); sounds: packs put in by hand (includes\sounds.php)
            'dirs'  => ['sounds-own', 'sounds'],
            'files' => ['settings.json', 'emulators.json'],
        ],
    ];
}

/** What a backup deliberately leaves out, and why, so the gap is a decision. */
function xs_backup_skipped(): array
{
    return [
        ['path' => 'media',          'why' => 'the picture copy in data\media. Bulk media, left out so a backup stays small enough to make often'],
        ['path' => 'videos',         'why' => 'snaps scraped straight into Xsegon. Bulk media, left out so a backup stays small enough to make often'],
        ['path' => 'thumbs',         'why' => 'built from the pictures: Build thumbs makes them again'],
        ['path' => 'videos-steam',   'why' => 'Steam trailers: Get Media > Steam trailers fetches them again'],
        ['path' => 'steamvid-none.json', 'why' => 'the Steam games a fetch found no trailer for, listed apart: without it they are simply back on the main list'],
        ['path' => 'videos-screenscraper', 'why' => 'snaps from ScreenScraper: Get Media > ScreenScraper videos fetches them again'],
        ['path' => 'screenscraper-none.json', 'why' => 'the games a ScreenScraper fetch found no video for, listed apart: without it they are simply back on the main list'],
        ['path' => 'archivevid-none.json', 'why' => 'the games the online archives had no video for, left out of the next fetch: without it they are simply looked for again'],
        ['path' => 'documents',      'why' => 'manuals and maps fetched for your games, often over a gigabyte: they can be fetched again'],
        ['path' => 'extras',         'why' => 'box sides, cartridges and discs fetched for your games: they can be fetched again'],
        ['path' => 'screenscraper.json', 'why' => 'your ScreenScraper logins: passwords are never put in an archive, type them in again'],
        ['path' => 'screenscraper-shared.dat', 'why' => "Xsegon's own ScreenScraper developer ID, sealed to this computer: fetched again at the next check"],
        ['path' => 'achievements.json', 'why' => 'your RetroAchievements key, sealed to this computer: paste it again from the site'],
        ['path' => 'achievements',   'why' => "RetroAchievements' lists, answers and badge pictures: fetched again when a game's tab opens"],
        ['path' => 'emulators',      'why' => 'the RetroArch Xsegon downloaded for you, and its cores: Settings > Emulators gets them again'],
        ['path' => 'sounds-staged',  'why' => 'a sound you chose, for the moment it is being checked'],
        ['path' => 'gamesdb.sqlite', 'why' => "a copy of the Games Database: made again from the packed copy"],
        ['path' => 'gamesdb.sqlite.from', 'why' => 'its note of which copy it is'],
        ['path' => 'gamesdb-update', 'why' => 'a fetched Games Database: fetched again when it is missing'],
        ['path' => 'library.json',   'why' => 'the imported library: an import writes it again'],
        ['path' => 'log',            'why' => 'diagnostics, a few days at a time'],
        ['path' => 'reports',        'why' => 'diagnostics reports, which are made from everything else and thrown away after they are sent'],
        ['path' => 'browser-profile', 'why' => "the app window's own browser profile"],
        ['path' => 'library-seen.json', 'why' => 'what the library looked like last startup, for the what-changed check: it makes itself again on the next one'],
        ['path' => 'messages.json',  'why' => 'the mailbox: news about changes that have already happened'],
        ['path' => 'trouble-said.json', 'why' => 'which errors the mailbox has been told of already: kept again as they happen'],
    ];
}

/** Where the archives are kept. Settings > Paths can move it. */
function xs_backup_dir(?array $s = null): string
{
    $s   = $s ?? xs_settings();
    $set = trim((string) ($s['paths']['backupDir'] ?? ''));
    if ($set !== '') {
        return rtrim(str_replace('/', DIRECTORY_SEPARATOR, $set), DIRECTORY_SEPARATOR);
    }
    return xs_data_path('backups');
}

/** Every file under a folder of data\, as paths relative to data\. */
function xs_backup_walk(string $rel): array
{
    $root = xs_data_path($rel);
    $data = realpath(xs_data_dir());
    if (!is_dir($root) || $data === false) {
        return [];
    }
    $out = [];
    $it  = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::LEAVES_ONLY
    );
    foreach ($it as $file) {
        // Not a restore's leftover working copy, nor a file still on its way in
        // (a download's .part, a save half written as .tmp).
        $name = $file->getFilename();
        if (!$file->isFile() || str_ends_with($name, '.restoring') || str_ends_with($name, '.part') || str_ends_with($name, '.tmp')) {
            continue;
        }
        $full = $file->getPathname();
        // One whose real place is outside data\ (behind a link) is not kept: a restore refuses it.
        $real = realpath($full);
        if ($real === false || !xs_inside($real, $data)) {
            continue;
        }
        $out[] = $rel . '/' . str_replace(DIRECTORY_SEPARATOR, '/', substr($full, strlen($root) + 1));
    }
    sort($out);
    return $out;
}

/**
 * What each part holds now: files relative to data\, with sizes. An empty part is
 * still listed: "you have no edits yet" is an answer, a missing row is not.
 */
function xs_backup_survey(): array
{
    $parts = [];
    foreach (xs_backup_parts() as $key => $def) {
        $files = [];
        foreach ($def['dirs'] as $dir) {
            foreach (xs_backup_walk($dir) as $rel) {
                $files[] = $rel;
            }
        }
        foreach ($def['files'] as $name) {
            if (is_file(xs_data_path($name))) {
                $files[] = $name;
            }
        }
        $bytes = 0;
        foreach ($files as $rel) {
            $bytes += (int) @filesize(xs_data_path(str_replace('/', DIRECTORY_SEPARATOR, $rel)));
        }
        $parts[$key] = [
            'key'   => $key,
            'label' => $def['label'],
            'help'  => $def['help'],
            'files' => $files,
            'count' => count($files),
            'bytes' => $bytes,
        ];
    }
    return $parts;
}

/**
 * The play logs are merged, not replaced: restoring over them would lose every session
 * since. One JSON object a line: the archive's lines, then lines here it lacks, in LF.
 */
function xs_backup_merges(string $rel): bool
{
    return str_ends_with(strtolower($rel), '.jsonl');
}

function xs_backup_merge(string $dest, string $fromArchive): string
{
    $now = is_file($dest) ? (string) @file_get_contents($dest) : '';
    if (trim($now) === '') {
        return $fromArchive;
    }
    $lines = preg_split('/\r?\n/', $fromArchive) ?: [];
    $seen  = [];
    $out   = [];
    foreach ($lines as $l) {
        if (trim($l) === '') {
            continue;
        }
        $seen[$l] = true;
        $out[] = $l;
    }
    foreach (preg_split('/\r?\n/', $now) ?: [] as $l) {
        if (trim($l) === '' || isset($seen[$l])) {
            continue;
        }
        $out[] = $l;
    }
    return implode("\n", $out) . "\n";
}

/** Which part a path inside an archive belongs to, or null if it belongs to none. */
function xs_backup_part_of(string $rel): ?string
{
    foreach (xs_backup_parts() as $key => $def) {
        foreach ($def['dirs'] as $dir) {
            if (str_starts_with($rel, $dir . '/')) {
                return $key;
            }
        }
        if (in_array($rel, $def['files'], true)) {
            return $key;
        }
    }
    return null;
}

/* ---------------------------------------------------------------- the zip */

/** A file of this size or more goes in as it lies, a piece at a time, and is not packed. */
const XS_ZIP_WHOLE_MOST = 32 * 1048576;

/** Thrown with this code: a fault of the disk's or of Xsegon's own, which the page shows with where to send the details. */
const XS_BACKUP_FAULT = 1;

/** One file into an archive being written: 'ok', 'skip' (it would not read) or 'full' (the archive would not write). */
function xs_zip_put(array &$zip, string $name, string $from): string
{
    $size = @filesize($from);
    // A picture or a video is packed already, and a big file is never held whole: straight from the disk.
    if ($size === false || $size >= XS_ZIP_WHOLE_MOST || preg_match('/\.(png|jpe?g|webp|gif|mp4|m4v|webm|zip)$/i', $name)) {
        return xs_zs_put_file($zip, $name, $from);
    }
    $data = @file_get_contents($from);
    if ($data === false) {
        return 'skip';
    }
    return xs_zs_put_bytes($zip, $name, $data, (int) @filemtime($from) ?: time(), true) ? 'ok' : 'full';
}

/**
 * Write an archive. $files maps a name inside the zip to a file on disk; $extra maps a
 * name to a string (the manifest). 'entries' is what went in, for xs_zip_proof().
 */
function xs_zip_write(string $path, array $files, array $extra = [], string $step = ''): array
{
    // $step: what the window waiting on this is told it is, file by file (xs_step); '' says nothing.
    $why = null;
    $zip = xs_zs_begin($path, $why);
    if ($zip === null) {
        throw new RuntimeException('could not write ' . $path . ($why ? '. ' . $why : ''), XS_BACKUP_FAULT);
    }
    // A zip cut short by a full disk is never left: a backup that lies is worse than none.
    $refused = static function () use (&$zip, $path): void {
        if (is_resource($zip['fh'])) {
            fclose($zip['fh']);
        }
        @unlink($path);
        throw new RuntimeException('the disk refused mid-write (full?): ' . basename($path) . ' was thrown away, not left half made', XS_BACKUP_FAULT);
    };
    foreach ($extra as $name => $data) {
        if (!xs_zs_put_bytes($zip, (string) $name, (string) $data, null, true)) {
            $refused();
        }
    }
    // A file that vanished mid-backup is not a failure. One that is there and
    // would not read is tried three times more, then named.
    $missed = [];
    $at = 0;
    foreach ($files as $name => $from) {
        @set_time_limit(120);
        if ($step !== '') {
            xs_step($step, $at++, count($files));
        }
        $how = xs_zip_put($zip, (string) $name, (string) $from);
        for ($try = 1; $how === 'skip' && $try <= 3 && is_file($from); $try++) {
            usleep(60000);
            $how = xs_zip_put($zip, (string) $name, (string) $from);
        }
        if ($how === 'full') {
            $refused();
        }
        if ($how === 'skip' && is_file($from)) {
            $missed[] = (string) $name;
        }
    }
    if (!xs_zs_end($zip)) {
        $refused();
    }
    return ['files' => count($zip['entries']), 'bytes' => (int) @filesize($path), 'missed' => $missed,
            'large' => $zip['big'], 'entries' => $zip['entries']];
}

/**
 * An archive just written, read back whole: every file listed and out again as the
 * bytes that went in. How many were read; throws with the file and what is wrong.
 */
function xs_zip_proof(string $path, array $entries, string $step = ''): int
{
    $why   = null;
    $total = count($entries);
    $n = xs_zs_check($path, $entries, static function (int $at) use ($step, $total): void {
        @set_time_limit(120);
        if ($step !== '') {
            xs_step($step, $at, $total);
        }
    }, $why);
    if ($n === null) {
        throw new RuntimeException((string) $why, XS_BACKUP_FAULT);
    }
    return $n;
}

/** An archive's own list: name, size, packed, method, at and crc of each file inside. Throws in words when it is no zip. */
function xs_zip_read(string $path): array
{
    if (!is_file($path) || (int) @filesize($path) < 22) {
        throw new RuntimeException('cannot read that archive');
    }
    $items = xs_zs_list($path);
    if ($items === null) {
        throw new RuntimeException('that file is not a zip');
    }
    return array_values($items);
}

/** One small entry's contents, checked against the sum the archive carries. */
function xs_zip_get(string $path, array $item): string
{
    $data = xs_zs_bytes($path, $item);
    if ($data === null) {
        throw new RuntimeException('damaged entry: ' . $item['name']);
    }
    return $data;
}

/* ------------------------------------------------------------- the backups */

/** Is this a name this code wrote? Nothing else in the folder is touched. */
function xs_backup_is_name(string $name): bool
{
    return (bool) preg_match('/^xsegon-(?:before-restore-)?\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.zip$/', $name);
}

/** The archives on hand, newest first, with what each one says it holds. */
function xs_backup_list(?array $s = null): array
{
    $dir = xs_backup_dir($s);
    if (!is_dir($dir)) {
        return [];
    }
    $out = [];
    foreach ((array) @scandir($dir) as $name) {
        if (!is_string($name) || !xs_backup_is_name($name)) {
            continue;
        }
        $full = $dir . DIRECTORY_SEPARATOR . $name;
        if (!is_file($full)) {
            continue;
        }
        $row = [
            'name'  => $name,
            'bytes' => (int) @filesize($full),
            'at'    => date('Y-m-d H:i', (int) @filemtime($full)),
            'stamp' => (int) @filemtime($full),
            'safety' => str_contains($name, 'before-restore'),
            'files' => null,
            'parts' => null,
            'bad'   => null,
        ];
        try {
            $items = xs_zip_read($full);
            $row['files'] = 0;
            $parts = [];
            foreach ($items as $it) {
                if ($it['name'] === 'manifest.json') {
                    continue;
                }
                $row['files']++;
                $part = xs_backup_part_of($it['name']);
                if ($part !== null) {
                    $parts[$part] = ($parts[$part] ?? 0) + 1;
                }
            }
            $row['parts'] = $parts;
        } catch (Throwable $e) {
            $row['bad'] = $e->getMessage();
            // In the log too, so a pasted log shows a bad backup.
            xs_log('BAK', $row['name'] . ' cannot be read: ' . $e->getMessage());
        }
        $out[] = $row;
    }
    // Newest first, then by name: file times are whole seconds and a restore's safety
    // copy can share one, so ties need a fixed order for "the first row" to hold.
    usort($out, static fn ($a, $b) => $b['stamp'] <=> $a['stamp'] ?: strcmp($b['name'], $a['name']));
    return $out;
}

/** Make one. $prefix marks the automatic copy taken before a restore; $toDir is the folder an export goes to. */
function xs_backup_make(string $prefix = '', ?string $toDir = null): array
{
    $s   = xs_settings();
    $dir = $toDir ?? xs_backup_dir($s);
    if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
        throw new RuntimeException('could not make the backup folder: ' . $dir);
    }

    $survey = xs_backup_survey();
    $files  = [];
    $parts  = [];
    foreach ($survey as $key => $part) {
        $parts[$key] = ['label' => $part['label'], 'count' => $part['count'], 'bytes' => $part['bytes']];
        foreach ($part['files'] as $rel) {
            $files[$rel] = xs_data_path(str_replace('/', DIRECTORY_SEPARATOR, $rel));
        }
    }

    $name = 'xsegon-' . ($prefix !== '' ? $prefix . '-' : '') . date('Y-m-d-Hi') . '.zip';
    $full = $dir . DIRECTORY_SEPARATOR . $name;
    for ($n = 2; is_file($full); $n++) {                 // two in the same minute
        $name = 'xsegon-' . ($prefix !== '' ? $prefix . '-' : '') . date('Y-m-d-Hi') . '-' . $n . '.zip';
        $full = $dir . DIRECTORY_SEPARATOR . $name;
    }

    // What a backup that was cut short left under its working name: never listed, and it can be gigabytes.
    foreach ((array) @scandir($dir) as $old) {
        if (is_string($old) && str_ends_with($old, '.zip.part') && xs_backup_is_name(substr($old, 0, -5))
            && time() - (int) @filemtime($dir . DIRECTORY_SEPARATOR . $old) > 600) {
            @unlink($dir . DIRECTORY_SEPARATOR . $old);
        }
    }
    // Said before minutes of writing, not after them.
    $need = (float) array_sum(array_column($parts, 'bytes'));
    $free = @disk_free_space($dir);
    if (is_float($free) && $free < $need) {
        $mb = static fn (float $b): string => number_format($b / 1048576) . ' MB';
        throw new RuntimeException('there is not room for it on that drive: ' . $mb($need) . ' to write, ' . $mb($free) . ' free in ' . $dir);
    }

    $manifest = [
        'made'    => date('c'),
        'xsegon'  => 'backup 1',
        'parts'   => $parts,
        'note'    => 'This zip is laid out like Xsegon\'s data folder. To restore by hand, copy its contents into data\\ with Xsegon closed.',
    ];
    $t0   = microtime(true);
    $safe = $prefix === 'before-restore';
    // Under a working name until it has been read back: a name ending .zip is only ever a whole, checked archive.
    $part = $full . '.part';
    $res  = xs_zip_write($part, $files, ['manifest.json' => json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)],
        $safe ? 'Keeping a copy of what is here first' : 'Backing up your files');
    try {
        $checked = xs_zip_proof($part, $res['entries'], $safe ? 'Checking that copy' : 'Checking the backup');
    } catch (Throwable $e) {
        @unlink($part);
        xs_log('BAK', $name . ' did not read back as it was written and was thrown away: ' . $e->getMessage());
        throw new RuntimeException('The backup was written but did not read back as it went in, so it was thrown away: '
            . $e->getMessage() . '. Nothing else was changed.', XS_BACKUP_FAULT);
    }
    $kept = false;
    error_clear_last();
    for ($try = 1; $try <= 3 && !$kept; $try++) {
        $kept = @rename($part, $full);
        if (!$kept && $try < 3) {
            usleep(60000);
        }
    }
    if (!$kept) {
        $why = xs_file_error_reason();
        @unlink($part);
        throw new RuntimeException('The backup was written and checked but could not be given its name, so it was thrown away. '
            . $why . ' Nothing else was changed.', XS_BACKUP_FAULT);
    }
    $ms = (int) round((microtime(true) - $t0) * 1000);
    xs_log('BAK', ($toDir !== null ? 'exported ' . $name . ' to ' . $dir : 'made ' . $name) . ' ' . $res['files'] . ' files ' . $res['bytes'] . ' bytes, '
        . $checked . ' read back' . ($res['large'] ? ', in the larger zip form' : '') . ', ' . $ms . ' ms'
        . ($res['missed'] ? ', WITHOUT ' . count($res['missed']) . ' that would not read: ' . implode(', ', array_slice($res['missed'], 0, 10)) : ''));

    return [
        'name'  => $name,
        'dir'   => $dir,
        'files' => $res['files'],
        'bytes' => $res['bytes'],
        'ms'    => $ms,
        'parts' => $parts,
        'missed' => $res['missed'],
        'checked' => $checked,
        'large'  => $res['large'],
    ];
}

/** Whether a backup of this much is written in the larger zip form: past 4 GB or 65,535 files. */
function xs_backup_large(int $files, int $bytes): bool
{
    return $bytes + 200 * $files >= 0xFFFFFFFF || $files + 1 > 0xFFFE;
}

/** Working copies a restore left when it was cut short (name.restoring), among what a backup holds: taken away. How many. */
function xs_backup_sweep(): int
{
    $left = [];
    foreach (xs_backup_parts() as $def) {
        foreach ($def['dirs'] as $dir) {
            $root = xs_data_path($dir);
            if (!is_dir($root)) {
                continue;
            }
            $it = new RecursiveIteratorIterator(
                new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::LEAVES_ONLY);
            foreach ($it as $file) {
                if ($file->isFile() && str_ends_with($file->getFilename(), '.restoring')) {
                    $left[] = $file->getPathname();
                }
            }
        }
        foreach ($def['files'] as $name) {
            $left[] = xs_data_path($name . '.restoring');
        }
    }
    $n = 0;
    foreach ($left as $path) {
        if (is_file($path) && @unlink($path)) {
            $n++;
        }
    }
    return $n;
}

/**
 * One file out of a backup to its working name beside its place, a piece at
 * a time: [done, 'write' or 'read' for which side failed, why in words].
 */
function xs_backup_stage(string $zip, array $it, string $tmp): array
{
    error_clear_last();
    $out = @fopen($tmp, 'wb');
    if ($out === false) {
        return [false, 'write', xs_file_error_reason()];
    }
    $short = false;
    $why   = null;
    $ok = xs_zs_read($zip, $it, static function (string $buf) use ($out, &$short): bool {
        $short = fwrite($out, $buf) !== strlen($buf);
        return !$short;
    }, $why);
    fclose($out);
    if ($short) {
        return [false, 'write', 'The disk would not take it (is it full?).'];
    }
    return [$ok, 'read', (string) $why];
}

/** The same archive, written to a folder you chose: a stick, another drive. */
function xs_backup_export(string $dir): array
{
    $dir = xs_norm_path(trim($dir));
    if ($dir === '') {
        throw new RuntimeException('no folder was chosen');
    }
    if (!is_dir($dir)) {
        throw new RuntimeException('that folder is not there: ' . $dir);
    }
    return xs_backup_make('', $dir);
}

/**
 * Take an archive in from a stick or another PC: only copied into the backup folder
 * under a known name and its made date, so Restore stays the one way back.
 */
function xs_backup_import(string $file): array
{
    $file = xs_norm_path(trim($file));
    if ($file === '' || !is_file($file)) {
        throw new RuntimeException('that file is not there: ' . $file);
    }
    $held     = 0;
    $manifest = null;
    foreach (xs_zip_read($file) as $it) {
        if ($it['name'] === 'manifest.json') {
            $manifest = json_decode(xs_zip_get($file, $it), true);
        } elseif (xs_backup_part_of($it['name']) !== null) {
            $held++;
        }
    }
    // A zip made by hand has no manifest and is welcome; a stranger is not.
    if ($held === 0) {
        throw new RuntimeException('that zip is not an Xsegon backup: nothing in it is a file Xsegon keeps');
    }
    $dir = xs_backup_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
        throw new RuntimeException('could not make the backup folder: ' . $dir);
    }
    $made = strtotime((string) (is_array($manifest) ? ($manifest['made'] ?? '') : '')) ?: ((int) @filemtime($file) ?: time());
    $name = basename($file);
    if (!xs_backup_is_name($name)) {
        $name = 'xsegon-' . date('Y-m-d-Hi', $made) . '.zip';
    }
    preg_match('/^(.+?-\d{4})(?:-\d+)?\.zip$/', $name, $m);
    $same = static fn (string $a): bool => filesize($a) === filesize($file) && hash_file('crc32b', $a) === hash_file('crc32b', $file);
    $full = $dir . DIRECTORY_SEPARATOR . $name;
    for ($n = 2; is_file($full) && !$same($full); $n++) {      // that name is another backup's
        $name = $m[1] . '-' . $n . '.zip';
        $full = $dir . DIRECTORY_SEPARATOR . $name;
    }
    $already = is_file($full);
    if (!$already) {
        @set_time_limit(900);                    // gigabytes, on a stick: one copy with no step to push the time at
        error_clear_last();
        if (!@copy($file, $full) || filesize($full) !== filesize($file)) {
            $why = xs_file_error_reason();
            @unlink($full);
            throw new RuntimeException('could not copy it into the backup folder. ' . $why);
        }
        // Listed by the day it was made, so an old one never reads as the newest.
        @touch($full, $made);
        xs_log('BAK', 'imported ' . $name . ' from ' . $file . ', ' . $held . ' files');
    }
    return ['name' => $name, 'already' => $already, 'at' => date('Y-m-d H:i', $made), 'files' => $held];
}

/** What is in one, and what restoring it would land on. */
function xs_backup_inspect(string $name): array
{
    $dir  = xs_backup_dir();
    $full = $dir . DIRECTORY_SEPARATOR . $name;
    if (!xs_backup_is_name($name) || !is_file($full)) {
        throw new RuntimeException('no such backup');
    }
    $items    = xs_zip_read($full);
    $manifest = null;
    $parts    = [];
    $stray    = [];
    foreach ($items as $n => $it) {
        @set_time_limit(120);
        xs_step('Reading the backup', $n, count($items));
        if ($it['name'] === 'manifest.json') {
            $manifest = json_decode(xs_zip_get($full, $it), true);
            continue;
        }
        $key = xs_backup_part_of($it['name']);
        if ($key === null) {
            $stray[] = $it['name'];
            continue;
        }
        $onDisk = xs_data_path(str_replace('/', DIRECTORY_SEPARATOR, $it['name']));
        $here   = is_file($onDisk);
        // The file here summed a piece at a time, never held whole.
        $same   = $here && (int) filesize($onDisk) === $it['size'] && (int) hexdec((string) @hash_file('crc32b', $onDisk)) === $it['crc'];
        $parts[$key] = $parts[$key] ?? [
            'key' => $key, 'label' => xs_backup_parts()[$key]['label'],
            'count' => 0, 'bytes' => 0, 'replace' => 0, 'add' => 0, 'same' => 0, 'merge' => 0,
        ];
        $parts[$key]['count']++;
        $parts[$key]['bytes'] += $it['size'];
        if (!$here)                              { $parts[$key]['add']++; }
        elseif ($same)                           { $parts[$key]['same']++; }
        elseif (xs_backup_merges($it['name']))   { $parts[$key]['merge']++; }
        else                                     { $parts[$key]['replace']++; }
    }
    // The order the parts are listed in, not the order they came out of the zip.
    $ordered = [];
    foreach (array_keys(xs_backup_parts()) as $key) {
        if (isset($parts[$key])) {
            $ordered[] = $parts[$key];
        }
    }
    return [
        'name'     => $name,
        'bytes'    => (int) filesize($full),
        'at'       => date('Y-m-d H:i', (int) filemtime($full)),
        'manifest' => $manifest,
        'parts'    => $ordered,
        'stray'    => $stray,
    ];
}

/**
 * Put back the parts asked for. A copy of what is here is taken first, so restoring
 * the wrong backup can itself be undone.
 */
function xs_backup_restore(string $name, array $want): array
{
    $dir  = xs_backup_dir();
    $full = $dir . DIRECTORY_SEPARATOR . $name;
    if (!xs_backup_is_name($name) || !is_file($full)) {
        throw new RuntimeException('no such backup');
    }
    $known = array_keys(xs_backup_parts());
    $want  = array_values(array_intersect($want, $known));
    if (!$want) {
        throw new RuntimeException('nothing chosen to restore');
    }

    $swept = xs_backup_sweep();
    if ($swept) {
        xs_log('BAK', 'took away ' . $swept . ' working copies a restore before this one left');
    }
    try {
        $safety = xs_backup_make('before-restore');
    } catch (Throwable $e) {
        throw new RuntimeException('Nothing was restored: the copy of what is here now, which is taken first, was not made. ' . $e->getMessage(), (int) $e->getCode());
    }
    $items  = xs_zip_read($full);
    $done   = ['written' => 0, 'merged' => 0, 'bytes' => 0, 'parts' => []];

    /* All or nothing, as near as files allow: every file is written beside its place
       as name.restoring and moved in only when all are on the disk, so a restore cut
       short (full disk, held file, damaged archive) leaves every file as it was. */
    $staged = [];
    $undo = static function () use (&$staged): void {
        foreach ($staged as [$tmp]) {
            @unlink($tmp);
        }
    };
    $at = 0;
    try {
    foreach ($items as $it) {
        @set_time_limit(120);
        xs_step('Putting your files back', $at++, count($items));
        if ($it['name'] === 'manifest.json') {
            continue;
        }
        $key = xs_backup_part_of($it['name']);
        if ($key === null || !in_array($key, $want, true)) {
            continue;
        }
        // On top of the part check: the destination must land inside data\, whatever the archive says.
        $rel  = str_replace('/', DIRECTORY_SEPARATOR, $it['name']);
        $dest = xs_data_path($rel);
        $root = realpath(xs_data_dir());
        $up   = dirname($dest);
        // Checked before any folder is made: a name with ".." in it could
        // otherwise make folders outside data\ before it was refused.
        if ($root === false || preg_match('#(^|[\\\\/])\.\.([\\\\/]|$)#', $it['name'])) {
            throw new RuntimeException('refused a path outside data: ' . $it['name']);
        }
        if (!is_dir($up) && !@mkdir($up, 0777, true) && !is_dir($up)) {
            throw new RuntimeException('could not make ' . $up, XS_BACKUP_FAULT);
        }
        $upReal = realpath($up);
        if ($upReal === false || ($upReal !== $root && !xs_inside($upReal, $root))) {
            throw new RuntimeException('refused a path outside data: ' . $it['name']);
        }
        $tmp = $dest . '.restoring';
        $staged[] = [$tmp, $dest, $rel];
        if (xs_backup_merges($it['name'])) {
            $data = xs_backup_merge($dest, xs_zip_get($full, $it));
            $done['merged'] = ($done['merged'] ?? 0) + 1;
            error_clear_last();
            $ok   = @file_put_contents($tmp, $data) === strlen($data);
            $said = [$ok, 'write', $ok ? '' : xs_file_error_reason()];
            $size = strlen($data);
        } else {
            // Straight from the archive onto the disk, a piece at a time, and checked against its sum on the way.
            $said = xs_backup_stage($full, $it, $tmp);
            $size = $it['size'];
        }
        if (!$said[0]) {
            throw new RuntimeException(($said[1] === 'write' ? 'could not write ' . $rel . '. ' . $said[2]
                : 'could not read ' . $rel . ' out of the backup: it ' . $said[2] . '.')
                . ' Nothing was restored: every file is as it was.', XS_BACKUP_FAULT);
        }
        $done['written']++;
        $done['bytes'] += $size;
        $done['parts'][$key] = ($done['parts'][$key] ?? 0) + 1;
    }
    } catch (Throwable $e) {
        $undo();
        throw $e;
    }
    foreach ($staged as $i => [$tmp, $dest, $rel]) {
        @set_time_limit(120);
        $moved = false;
        for ($try = 1; $try <= 3 && !$moved; $try++) {
            $moved = @rename($tmp, $dest);
            if (!$moved && $try < 3) {
                usleep(60000);
            }
        }
        if (!$moved) {
            $staged = array_slice($staged, $i);
            $undo();
            xs_log('BAK', 'restore of ' . $name . ' stopped at ' . $rel . ' after ' . $i . ' of ' . $done['written'] . ' files; the safety backup is ' . $safety['name']);
            throw new RuntimeException('could not put ' . $rel . ' in place (something else is holding it). '
                . $i . ' of ' . $done['written'] . ' files were restored before it. To go back to how things were, restore '
                . $safety['name'] . '.', XS_BACKUP_FAULT);
        }
    }
    xs_log('BAK', 'restored ' . $name . ' ' . $done['written'] . ' files (' . implode(', ', $want) . ')');
    $done['from']   = $name;
    $done['safety'] = $safety['name'];
    return $done;
}

/** Throw one away. Only ever a file this code wrote, in the backup folder. */
function xs_backup_remove(string $name): void
{
    $full = xs_backup_dir() . DIRECTORY_SEPARATOR . $name;
    if (!xs_backup_is_name($name) || !is_file($full)) {
        throw new RuntimeException('no such backup');
    }
    if (!@unlink($full)) {
        throw new RuntimeException('could not delete ' . $name);
    }
    xs_log('BAK', 'deleted ' . $name);
}

/** The health answer: what is precious, what is held, and how old it is. */
function xs_backup_health(): array
{
    $s      = xs_settings();
    $dir    = xs_backup_dir($s);
    $list   = xs_backup_list($s);
    $survey = xs_backup_survey();

    $files = 0;
    $bytes = 0;
    foreach ($survey as $p) {
        $files += $p['count'];
        $bytes += $p['bytes'];
    }
    // The parts, without the file lists: the page wants the shape, not the names.
    $parts = [];
    foreach ($survey as $p) {
        unset($p['files']);
        $parts[] = $p;
    }
    /* Sizing what is left out walks gigabytes of copies, and this server answers one
       request at a time, so the sizes are kept for ten minutes (backup-skip.json, throwaway). */
    $cachePath = xs_data_path('backup-skip.json');
    $cache     = xs_read_json($cachePath, null);
    if (is_array($cache) && is_array($cache['skipped'] ?? null)
        && time() - (int) ($cache['at'] ?? 0) < 600) {
        $skipped = $cache['skipped'];
    } else {
        $skipped = [];
        foreach (xs_backup_skipped() as $row) {
            $path = xs_data_path($row['path']);
            $size = 0;
            if (is_dir($path)) {
                foreach (xs_backup_walk($row['path']) as $rel) {
                    $size += (int) @filesize(xs_data_path(str_replace('/', DIRECTORY_SEPARATOR, $rel)));
                }
            } elseif (is_file($path)) {
                $size = (int) @filesize($path);
            }
            $row['bytes'] = $size;
            $skipped[] = $row;
        }
        xs_write_json($cachePath, ['at' => time(), 'skipped' => $skipped]);
    }

    $newest = $list[0] ?? null;
    // A backup inside the folder it backs up is said, not quietly made.
    $inData = strcasecmp(rtrim($dir, '\\/'), rtrim(xs_data_dir(), '\\/')) === 0 || xs_inside($dir, xs_data_dir());

    return [
        'dir'      => $dir,
        'inData'   => $inData,
        'free'     => (int) @disk_free_space(is_dir($dir) ? $dir : XS_ROOT),
        'parts'    => $parts,
        'files'    => $files,
        'bytes'    => $bytes,
        'large'    => xs_backup_large($files, $bytes),
        'skipped'  => $skipped,
        'backups'  => $list,
        'newest'   => $newest,
        'ageHours' => $newest ? (int) floor((time() - $newest['stamp']) / 3600) : null,
    ];
}
