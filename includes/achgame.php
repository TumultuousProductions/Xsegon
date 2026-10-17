<?php
/**
 * Xsegon - one game's RetroAchievements (roadmap AX, phase 4): which of the
 * site's games its file is, what was earned, and the badges' pictures. Asked
 * only when a game's Achievements tab opens.
 *
 *   data\achievements\files.json       each game's checksum, kept while its file's size and date hold
 *   data\achievements\list-<n>.json    a console's games and their checksums, asked again after a week
 *   data\achievements\game-<id>.json   the last answer for one game, for the offline road
 *   data\achievements\badges\          the badges' pictures, in colour and grey
 */
declare(strict_types=1);

require_once __DIR__ . '/achievements.php';
require_once __DIR__ . '/achconsoles.php';
require_once __DIR__ . '/filecheck.php';
require_once __DIR__ . '/import.php';

const XS_ACHG_LIST_DAYS = 7;

/** Xsegon's folder for these, made when first wanted. */
function xs_achg_path(string $name): string
{
    $dir = xs_data_path('achievements');
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    return $dir . DIRECTORY_SEPARATOR . $name;
}

/**
 * The site's checksum of a game's file: an MD5 with the header rules File
 * check already knows (iNES, a copier's header, the N64's byte order), arcade
 * by the file's name. Kept by file, size and date. null with $why.
 */
function xs_achg_md5(array $g, ?string &$why = null): ?string
{
    $why = null;
    $platform = (string) ($g['platform'] ?? '');
    $rom = xs_rom_real_path((string) ($g['romPath'] ?? ''), xs_settings());
    if ($rom === '' || !is_file($rom)) {
        $why = 'its file is not there';
        return null;
    }
    $all  = (array) xs_read_json(xs_achg_path('files.json'), []);
    $id   = (string) $g['id'];
    $size = (int) @filesize($rom);
    $time = (int) @filemtime($rom);
    $had  = $all[$id] ?? null;
    if (is_array($had) && ($had['rom'] ?? '') === $rom && ($had['size'] ?? -1) === $size && ($had['mtime'] ?? -1) === $time) {
        return (string) $had['md5'];
    }
    if ((XS_ACH_FILES[$platform] ?? 0) === 27) {
        $md5 = md5(pathinfo($rom, PATHINFO_FILENAME));          // the site knows an arcade game by its set's name
    } else {
        $read = xs_fc_read($platform, $rom, $rw, 'md5');
        if ($read === null || $read['patch']) {
            $why = $read === null ? 'its file could not be read (' . (string) $rw . ')' : 'its file is a patch, not a game';
            return null;
        }
        $md5 = $read['fix'] !== null && $read['alt'] !== null ? $read['alt'] : $read['sha1'];
    }
    $all[$id] = ['rom' => $rom, 'size' => $size, 'mtime' => $time, 'md5' => $md5];
    xs_write_json(xs_achg_path('files.json'), $all);
    return $md5;
}

/**
 * A console's games on the site: [checksum => [id, title]] and 'titles' (id =>
 * title), kept a week. With no answer the copy kept before is used however old.
 */
function xs_achg_list(int $console, string $key, ?string &$why = null): ?array
{
    $why  = null;
    $path = xs_achg_path('list-' . $console . '.json');
    $kept = xs_read_json($path, null);
    if (is_array($kept) && time() - (int) ($kept['at'] ?? 0) < XS_ACHG_LIST_DAYS * 86400) {
        return $kept;
    }
    $r = xs_ach_ask('GetGameList', ['i' => $console, 'h' => 1, 'f' => 1], $key);
    if (!$r['ok'] || !is_array($r['data'])) {
        $why = (string) $r['error'];
        return is_array($kept) ? $kept : null;
    }
    $list = ['at' => time(), 'sums' => [], 'titles' => []];
    foreach ($r['data'] as $row) {
        $gid = (int) ($row['ID'] ?? 0);
        $list['titles'][$gid] = (string) ($row['Title'] ?? '');
        foreach ((array) ($row['Hashes'] ?? []) as $h) {
            $list['sums'][strtolower((string) $h)] = $gid;
        }
    }
    xs_write_json($path, $list);
    xs_log('ACH', 'console ' . $console . ': ' . count($list['titles']) . ' games with achievements, ' . count($list['sums']) . ' checksums');
    return $list;
}

/** A title as two names of one game compare: letters and digits only. */
function xs_achg_plain(string $title): string
{
    return (string) preg_replace('/[^a-z0-9]+/', '', strtolower((string) preg_replace('/\s*[\(\[].*$/', '', $title)));
}

/**
 * Everything the tab shows for one game: 'state' is setup (RetroArch not
 * signed in, or no key), later (a console not matched yet), unread, noset,
 * error, or ok with the set and its achievements. Past setup, 'who' is the
 * name RetroArch is signed in with, shown beside the way to sign in or out.
 */
function xs_achg_game(array $g): array
{
    $ra  = xs_ach_ra_state();
    $key = xs_ach_key();
    if ($ra['step'] !== 'ready' || $key === null) {
        return ['state' => 'setup', 'ra' => $ra, 'key' => $key !== null];
    }
    return ['who' => (string) $ra['name']] + xs_achg_find($g, $ra, $key);
}

/** Which set the game's file opens on the site, and what was earned in it. */
function xs_achg_find(array $g, array $ra, string $key): array
{
    $platform = (string) ($g['platform'] ?? '');
    $console  = XS_ACH_FILES[$platform] ?? null;
    if ($console === null) {
        return ['state' => 'later', 'why' => 'RetroAchievements has sets for ' . $platform . ', and Xsegon does not work out which one a ' . $platform . ' file is yet'];
    }
    $md5 = xs_achg_md5($g, $why);
    if ($md5 === null) {
        return ['state' => 'unread', 'why' => (string) $why];
    }
    $list = xs_achg_list($console, $key, $lw);
    if ($list === null) {
        return ['state' => 'error', 'why' => $lw ?? 'the list of games could not be had'];
    }
    $setId = $list['sums'][$md5] ?? null;
    if ($setId === null) {
        $plain = xs_achg_plain((string) ($g['title'] ?? ''));
        $alike = [];
        foreach ($list['titles'] as $tid => $t) {
            if ($plain !== '' && xs_achg_plain($t) === $plain) {
                $alike[] = $t;
            }
        }
        return ['state' => 'noset', 'md5' => $md5, 'alike' => $alike];
    }
    $r = xs_ach_ask('GetGameInfoAndUserProgress', ['g' => $setId, 'u' => $ra['name'], 'a' => 1], $key);
    $path = xs_achg_path('game-' . (int) $setId . '.json');
    $kept = null;
    if ($r['ok'] && is_array($r['data'])) {
        $info = $r['data'];
        xs_write_json($path, ['at' => time(), 'info' => $info]);
    } else {
        $kept = xs_read_json($path, null);
        if (!is_array($kept)) {
            return ['state' => 'error', 'why' => (string) $r['error']];
        }
        $info = $kept['info'];
    }
    return ['state' => 'ok', 'hardcore' => $ra['hardcore'], 'md5' => $md5,
            'asOf' => $kept !== null ? date('c', (int) $kept['at']) : null, 'why' => $kept !== null ? (string) $r['error'] : null]
         + xs_achg_shape($info, $list);
}

/** The site's answer for one game, as the tab draws it. Its dates are UTC. */
function xs_achg_shape(array $info, array $list): array
{
    $utc = static fn ($d) => is_string($d) && $d !== '' ? str_replace(' ', 'T', $d) . 'Z' : null;
    $players = max(1, (int) ($info['NumDistinctPlayers'] ?? 0));
    $rows = [];
    foreach ((array) ($info['Achievements'] ?? []) as $a) {
        $hard = $utc($a['DateEarnedHardcore'] ?? null);
        $rows[] = ['id' => (int) ($a['ID'] ?? 0), 'title' => (string) ($a['Title'] ?? ''), 'desc' => (string) ($a['Description'] ?? ''),
                   'points' => (int) ($a['Points'] ?? 0), 'badge' => (string) ($a['BadgeName'] ?? ''),
                   'earned' => $hard ?? $utc($a['DateEarned'] ?? null), 'hard' => $hard !== null,
                   'share' => round(100 * (int) ($a['NumAwarded'] ?? 0) / $players, 1),
                   // The real answer says Type; the docs say type.
                   'kind' => (string) ($a['Type'] ?? $a['type'] ?? ''), 'order' => (int) ($a['DisplayOrder'] ?? 0)];
    }
    usort($rows, static fn ($x, $y) => [$x['order'], $x['id']] <=> [$y['order'], $y['id']]);
    $parent = isset($info['ParentGameID']) ? (int) $info['ParentGameID'] : 0;
    $earned = array_filter($rows, static fn ($a) => $a['earned'] !== null);
    return ['set' => ['id' => (int) ($info['ID'] ?? 0), 'title' => (string) ($info['Title'] ?? ''),
                      'console' => (string) ($info['ConsoleName'] ?? ''),
                      'parent' => $parent > 0 ? ['id' => $parent, 'title' => (string) ($list['titles'][$parent] ?? '')] : null],
            'total' => count($rows), 'earned' => count($earned),
            'points' => array_sum(array_column($rows, 'points')), 'pointsEarned' => array_sum(array_column($earned, 'points')),
            'achievements' => $rows];
}

/** Where RetroArch keeps the badges it has shown (thumbnails\cheevos\badges), or null. Never on a test copy. */
function xs_achg_ra_badges(): ?string
{
    if (xs_test_copy() || ($cfg = xs_ach_ra_cfg()) === null) {
        return null;
    }
    $thumbs = (string) (ra_cfg_keys($cfg, ['thumbnails_directory'])['thumbnails_directory'] ?? '');
    // ":\thumbnails" is RetroArch's own folder.
    $thumbs = $thumbs === '' ? dirname($cfg) . DIRECTORY_SEPARATOR . 'thumbnails'
            : (str_starts_with($thumbs, ':') ? dirname($cfg) . substr($thumbs, 1) : $thumbs);
    $dir = $thumbs . DIRECTORY_SEPARATOR . 'cheevos' . DIRECTORY_SEPARATOR . 'badges';
    return is_dir($dir) ? $dir : null;
}

/**
 * A badge's picture on disk, in colour or grey: Xsegon's copy, else
 * RetroArch's, else fetched from the site once and kept. null when none can be had.
 */
function xs_achg_badge(string $name, bool $grey): ?string
{
    if (preg_match('/^[A-Za-z0-9_-]{1,40}$/', $name) !== 1) {
        return null;
    }
    $file = $name . ($grey ? '_lock' : '') . '.png';
    $mine = xs_achg_path('badges');
    if (!is_dir($mine)) {
        @mkdir($mine, 0777, true);
    }
    $mine .= DIRECTORY_SEPARATOR . $file;
    if (is_file($mine)) {
        return $mine;
    }
    $ra = xs_achg_ra_badges();
    if ($ra !== null && is_file($ra . DIRECTORY_SEPARATOR . $file)) {
        return $ra . DIRECTORY_SEPARATOR . $file;
    }
    $api = xs_ach_api();
    if ($api === '') {
        return null;
    }
    $base = xs_test_copy() ? $api . 'Badge/' : 'https://media.retroachievements.org/Badge/';
    $got = xs_ss_fetch($base . $file, 10);
    if ($got === null || $got['status'] !== 200 || !str_starts_with((string) $got['body'], "\x89PNG")) {
        xs_log('ACH', 'badge ' . $file . ': ' . ($got === null ? 'no answer' : 'HTTP ' . $got['status']));
        return null;
    }
    return @file_put_contents($mine, $got['body']) !== false ? $mine : null;
}
