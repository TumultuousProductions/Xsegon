<?php
/**
 * Xsegon - reading LaunchBox.
 *
 * READ ONLY. Nothing in this file opens a LaunchBox path for writing, and
 * nothing ever should: LaunchBox rewrites its own XML and would eat it.
 *
 *   - Emulators.xml holds <Emulator> blocks (the program) and
 *     <EmulatorPlatform> blocks (emulator id + platform + command line). A
 *     game names only the emulator id, so the platform picks the core.
 *   - ApplicationPath is relative to the LaunchBox root.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

function lb_data_dir(string $root): string
{
    return xs_norm_path($root) . DIRECTORY_SEPARATOR . 'Data';
}

/**
 * The files that were there but could not be read as XML this request:
 * 'add' remembers one, 'take' hands the list over and clears it. A mangled
 * file must not read as "no games there", or an import drops that console.
 */
function lb_bad_xml(string $action = 'list', string $file = ''): array
{
    static $bad = [];
    if ($action === 'add' && $file !== '') {
        $bad[] = $file;
    }
    if ($action === 'take') {
        $take = $bad;
        $bad = [];
        return $take;
    }
    return $bad;
}

/** One of LaunchBox's XML files, or false, with the damage said and kept. */
function lb_xml_load(string $file): SimpleXMLElement|false
{
    libxml_use_internal_errors(true);
    libxml_clear_errors();
    $xml = simplexml_load_file($file);
    if ($xml === false) {
        $err = libxml_get_last_error();
        xs_log('LB', basename($file) . ' exists but cannot be read as XML'
            . ($err !== false ? ': ' . trim($err->message) . ' (line ' . $err->line . ')' : ''));
        lb_bad_xml('add', $file);
    }
    libxml_clear_errors();
    return $xml;
}

/** Every platform LaunchBox knows, in its own order. */
function lb_platforms(string $root): array
{
    $file = lb_data_dir($root) . DIRECTORY_SEPARATOR . 'Platforms.xml';
    if (!is_file($file)) {
        return [];
    }
    $xml = lb_xml_load($file);
    if ($xml === false) {
        return [];
    }
    $out = [];
    foreach ($xml->Platform as $p) {
        $name = trim((string) $p->Name);
        if ($name !== '') {
            $out[] = $name;
        }
    }
    return $out;
}

/**
 * Emulator definitions plus the per-platform command lines.
 * Returns ['byId' => [id => ['title','path','commandLine','noQuotes']],
 *          'byPlatform' => [platformLower => [id => commandLine]]]
 */
function lb_emulators(string $root): array
{
    $file = lb_data_dir($root) . DIRECTORY_SEPARATOR . 'Emulators.xml';
    $out = ['byId' => [], 'byPlatform' => []];
    if (!is_file($file)) {
        return $out;
    }
    $xml = lb_xml_load($file);
    if ($xml === false) {
        return $out;
    }

    foreach ($xml->Emulator as $e) {
        $id = trim((string) $e->ID);
        if ($id === '') {
            continue;                        // an <Emulator> tag inside an EmulatorPlatform
        }
        $out['byId'][$id] = [
            'title'       => trim((string) $e->Title),
            'path'        => trim((string) $e->ApplicationPath),
            'commandLine' => trim((string) $e->CommandLine),
            'noQuotes'    => strtolower(trim((string) $e->NoQuotes)) === 'true',
        ];
    }

    foreach ($xml->EmulatorPlatform as $ep) {
        $id       = trim((string) $ep->Emulator);
        $platform = strtolower(trim((string) $ep->Platform));
        if ($id === '' || $platform === '') {
            continue;
        }
        $out['byPlatform'][$platform][$id] = [
            'commandLine' => trim((string) $ep->CommandLine),
            // A game with no <Emulator> plays on the platform's default.
            'default'     =>strtolower(trim((string) $ep->Default)) === 'true',
        ];
    }

    return $out;
}

/** One platform's games. Reads only "<Platform>.xml" -- never the .bak siblings. */
function lb_games(string $root, string $platform): array
{
    $file = lb_data_dir($root) . DIRECTORY_SEPARATOR . 'Platforms'
          . DIRECTORY_SEPARATOR . $platform . '.xml';
    if (!is_file($file)) {
        return [];
    }
    $xml = lb_xml_load($file);
    if ($xml === false) {
        return [];
    }

    $games = [];
    foreach ($xml->Game as $g) {
        $title = trim((string) $g->Title);
        if ($title === '') {
            continue;
        }
        $games[] = [
            'id'          => trim((string) $g->ID),
            'title'       => $title,
            'sortTitle'   => trim((string) $g->SortTitle) ?: $title,
            'platform'    => trim((string) $g->Platform) ?: $platform,
            'romPath'     => trim((string) $g->ApplicationPath),
            'emulatorId'  => trim((string) $g->Emulator),
            'developer'   => trim((string) $g->Developer),
            'publisher'   => trim((string) $g->Publisher),
            'genre'       => trim((string) $g->Genre),
            'region'      => trim((string) $g->Region),
            'playMode'    => trim((string) $g->PlayMode),
            'released'    => trim((string) $g->ReleaseDate),
            'notes'       => trim((string) $g->Notes),
            'rating'      => (float) ((string) $g->CommunityStarRating ?: 0),
            'stars'       => (float) ((string) $g->StarRatingFloat ?: 0),
            'favourite'   => strtolower(trim((string) $g->Favorite)) === 'true',
            'hidden'      => strtolower(trim((string) $g->Hide)) === 'true',
            'broken'      => strtolower(trim((string) $g->Broken)) === 'true',
            'missingVideo'=> strtolower(trim((string) $g->MissingVideo)) === 'true',
            'playCount'   => (int) ((string) $g->PlayCount ?: 0),
            'playTime'    => (int) ((string) $g->PlayTime ?: 0),   // seconds
            'wikipedia'   => trim((string) $g->WikipediaURL),
            // The game's Games Database number, which its pictures and metadata are filed under.
            'dbId'        => (int) ((string) $g->DatabaseID ?: 0),
            // What the Recently added collection sorts and cuts by.
            'added'       => trim((string) $g->DateAdded),
            // What the Two players collection is made of; 0 where LaunchBox has no number, and playMode is the fallback.
            'players'     =>(int) ((string) $g->MaxPlayers ?: 0),
        ];
    }
    return $games;
}

/**
 * Turn a game into something runnable.
 * Returns ['exe','args','kind'] or ['error' => why].
 */
function lb_launch_command(string $root, array $game, array $emulators): array
{
    $rom = xs_resolve($root, $game['romPath']);
    if ($game['romPath'] === '') {
        return ['error' => 'no ROM path in LaunchBox'];
    }

    $platformKey = strtolower($game['platform']);
    $id = $game['emulatorId'];
    $usedDefault = false;

    // No emulator on the game? Use the platform's default, which is what
    // LaunchBox itself does -- a blank <Emulator> is normal, not broken.
    if ($id === '' || !isset($emulators['byId'][$id])) {
        $id = lb_default_emulator($emulators, $platformKey);
        $usedDefault = true;
    }
    if ($id === null || !isset($emulators['byId'][$id])) {
        return ['error' => 'no emulator assigned, and no default for this platform'];
    }
    $emu = $emulators['byId'][$id];

    $exe = xs_resolve($root, $emu['path']);
    if ($exe === '') {
        return ['error' => 'emulator has no application path'];
    }

    // The per-platform command line holds the core; a standalone emulator has only its own.
    $args = $emulators['byPlatform'][$platformKey][$id]['commandLine'] ?? '';
    if ($args === '') {
        $args = $emu['commandLine'];
    }

    $quoted = $emu['noQuotes'] ? $rom : '"' . $rom . '"';
    $full   = trim($args . ' ' . $quoted);

    return [
        'exe'  => $exe,
        'args' => $full,
        'rom'  => $rom,
        'kind' => str_contains(strtolower($args), '-l ') ? 'retroarch' : 'emulator',
        'via'  => $emu['title'] . ($usedDefault ? ' (platform default)' : ''),
    ];
}

/** The emulator marked Default for a platform, if there is one. */
function lb_default_emulator(array $emulators, string $platformKey): ?string
{
    foreach ($emulators['byPlatform'][$platformKey] ?? [] as $id => $info) {
        if (!empty($info['default'])) {
            return $id;
        }
    }
    // No explicit default: if the platform has exactly one emulator, it is
    // unambiguous and guessing it is safe. More than one and we refuse.
    $candidates = array_keys($emulators['byPlatform'][$platformKey] ?? []);
    return count($candidates) === 1 ? $candidates[0] : null;
}

/* ------------------------------------------------------------------ cores */
/*
 * A RetroArch core is named in the command line as -L "cores\x_libretro.dll".
 * The emulator and the platform together name the core, so it is read per
 * platform, not per game.
 */

/** The -L value in a command line, exactly as LaunchBox wrote it, or null. */
function lb_core_load(string $args): ?string
{
    if (preg_match('/-L\s+"([^"]*)"/i', $args, $m)) {
        return $m[1] !== '' ? $m[1] : null;
    }
    if (preg_match('/-L\s+(\S+)/i', $args, $m)) {
        return $m[1];
    }
    return null;
}

/**
 * The short name of a core file: "cores\swanstation_libretro.dll" becomes
 * "swanstation". The folder is dropped, relative or absolute.
 */
function lb_core_name(string $load): string
{
    $base = basename(str_replace('\\', '/', $load));
    return preg_replace('/_libretro\.dll$/i', '', $base) ?: $base;
}

/**
 * Put a different core into a command line, changing NOTHING else: a line
 * can carry other options (a --set-shader), which a rebuilt line would lose.
 */
function lb_swap_core(string $args, string $load): string
{
    $done = preg_replace_callback(
        '/(-L\s+)("[^"]*"|\S+)/i',
        static fn(array $m): string => $m[1] . '"' . $load . '"',
        $args,
        1,
        $count
    );
    return ($done !== null && $count === 1) ? $done : $args;
}
