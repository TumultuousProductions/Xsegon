<?php
/**
 * Xsegon - video snaps from ScreenScraper (screenscraper.fr), asked by the
 * game's title and console for the games that have no video.
 *
 * Their API wants a member account and a developer ID on every call. Neither
 * is Xsegon's to ship, so each person types their own:
 *
 *     data\screenscraper.json           the four words, on this computer only
 *
 * Kept apart from settings.json on purpose: that file goes into a problem
 * report and a backup whole, and this one goes into neither. The page is told
 * the names and whether a password is stored, never the passwords.
 *
 * Each snap is saved as data\videos-screenscraper\<game id>.mp4 and found
 * after every other video source, so it only fills a gap. Left out of backups.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/video.php';

function xs_ss_dir(): string
{
    return xs_data_path('videos-screenscraper');
}

function xs_ss_job_path(): string
{
    return xs_data_path('screenscraper-job.json');
}

function xs_ss_account_path(): string
{
    return xs_data_path('screenscraper.json');
}

/** The snap saved for this game, or null. */
function xs_ss_for(string $id): ?string
{
    static $index = null;
    if ($index === null) {
        $index = [];
        foreach (@scandir(xs_ss_dir()) ?: [] as $f) {
            if (strtolower(pathinfo($f, PATHINFO_EXTENSION)) === 'mp4') {
                $index[pathinfo($f, PATHINFO_FILENAME)] = xs_ss_dir() . DIRECTORY_SEPARATOR . $f;
            }
        }
    }
    return $index[$id] ?? null;
}

/**
 * ScreenScraper's number for a console, by the name Xsegon files it under
 * (the numbers as in Skyscraper's screenscraper_platforms.json). Compared on
 * letters and digits alone, so "Sony PlayStation" finds "Sony Playstation".
 */
function xs_ss_systems(): array
{
    static $map = null;
    if ($map !== null) {
        return $map;
    }
    $names = [
        '3DO Interactive Multiplayer' => 29, 'Amstrad CPC' => 65, 'Arcade' => 75, 'MAME' => 75,
        'Atari 2600' => 26, 'Atari 5200' => 40, 'Atari 7800' => 41, 'Atari Jaguar' => 27,
        'Atari Jaguar CD' => 171, 'Atari Lynx' => 28, 'Atari ST' => 42,
        'Bandai WonderSwan' => 45, 'WonderSwan' => 45, 'Bandai WonderSwan Color' => 46, 'WonderSwan Color' => 46,
        'ColecoVision' => 48, 'Commodore 64' => 66, 'Commodore Amiga' => 64, 'Commodore Amiga CD32' => 130,
        'GCE Vectrex' => 102, 'Magnavox Odyssey 2' => 104, 'Mattel Intellivision' => 115,
        'Microsoft MSX' => 113, 'Microsoft MSX2' => 116, 'Microsoft Xbox' => 32, 'Microsoft Xbox 360' => 33,
        'MS-DOS' => 135, 'Windows' => 138, 'Steam' => 138,
        'NEC TurboGrafx-16' => 31, 'NEC TurboGrafx-CD' => 114, 'PC Engine SuperGrafx' => 105, 'NEC PC-FX' => 72,
        'Nintendo 3DS' => 17, 'Nintendo 64' => 14, 'Nintendo 64DD' => 122, 'Nintendo DS' => 15,
        'Nintendo Entertainment System' => 3, 'Nintendo Famicom Disk System' => 106,
        'Nintendo Game Boy' => 9, 'Nintendo Game Boy Advance' => 12, 'Nintendo Game Boy Color' => 10,
        'Nintendo GameCube' => 13, 'Nintendo Pokemon Mini' => 211, 'Nintendo Satellaview' => 107,
        'Nintendo Switch' => 225, 'Nintendo Virtual Boy' => 11, 'Nintendo Wii' => 16,
        'Nintendo Wii U' => 18, 'Wii U' => 18, 'Philips CD-i' => 133, 'ScummVM' => 123,
        'Sammy Atomiswave' => 53, 'Sega 32X' => 19, 'Sega CD' => 20, 'Sega Dreamcast' => 23,
        'Sega Game Gear' => 21, 'Sega Genesis' => 1, 'Sega Mega Drive' => 1, 'Sega Master System' => 2,
        'Sega Model 2' => 54, 'Sega Model 3' => 55, 'Sega Naomi' => 56, 'Sega Pico' => 250,
        'Sega Saturn' => 22, 'Sega SG-1000' => 109, 'Sharp X68000' => 79, 'Sinclair ZX Spectrum' => 76,
        'SNK Neo Geo AES' => 142, 'SNK Neo Geo MVS' => 68, 'SNK Neo Geo CD' => 70,
        'SNK Neo Geo Pocket' => 25, 'SNK Neo Geo Pocket Color' => 82,
        'Sony Playstation' => 57, 'Sony Playstation 2' => 58, 'Sony Playstation 3' => 59,
        'Sony Playstation 4' => 60, 'Sony Playstation Vita' => 62, 'Sony PSP' => 61, 'Sony PSP Minis' => 172,
        'Super Nintendo Entertainment System' => 4,
    ];
    $map = [];
    foreach ($names as $name => $id) {
        $map[art_key($name)] = $id;
    }
    return $map;
}

/** 0 when ScreenScraper has no such console, or Xsegon does not know its number. */
function xs_ss_system(string $platform): int
{
    return xs_ss_systems()[art_key($platform)] ?? 0;
}

/**
 * A file name that says nothing about which game it is: a PS3 game is
 * EBOOT.BIN, an Xbox one default.xbe. Asking ScreenScraper for one of those
 * by name would answer with whichever game it filed that name under first.
 */
function xs_ss_rom_name(string $romPath): string
{
    $file = basename(str_replace('\\', '/', $romPath));
    $stem = strtolower(pathinfo($file, PATHINFO_FILENAME));
    if ($file === '' || in_array($stem, ['eboot', 'default', 'boot', 'game', 'disc', 'launch', 'index', 'start'], true)) {
        return '';
    }
    return $file;
}

// ---- the account -----------------------------------------------------------

/** The four words as stored: devid, devpassword, user, password. */
function xs_ss_account(): array
{
    $a = xs_read_json(xs_ss_account_path(), []);
    $a = is_array($a) ? $a : [];
    $out = [];
    foreach (['devid', 'devpassword', 'user', 'password'] as $k) {
        $out[$k] = is_string($a[$k] ?? null) ? $a[$k] : '';
    }
    // The name the developer ID was registered under, when not "Xsegon": set by hand in the file.
    $out['softname'] = is_string($a['softname'] ?? null) && trim($a['softname']) !== '' ? trim($a['softname']) : 'Xsegon';
    return $out;
}

function xs_ss_ready(array $a): bool
{
    return $a['devid'] !== '' && $a['devpassword'] !== '' && $a['user'] !== '' && $a['password'] !== '';
}

/** What the page may know: the names, and whether each password is stored. */
function xs_ss_account_public(): array
{
    $a = xs_ss_account();
    return [
        'devid'       => $a['devid'],
        'user'        => $a['user'],
        'devpassword' => $a['devpassword'] !== '',
        'password'    => $a['password'] !== '',
        'ready'       => xs_ss_ready($a),
    ];
}

/**
 * Save what was typed. A password box left empty keeps the stored password,
 * since the page is never handed one to send back; a name box left empty
 * clears that name.
 */
function xs_ss_account_save(array $in, ?string &$why = null): bool
{
    $a = xs_ss_account();
    foreach (['devid', 'user'] as $k) {
        if (array_key_exists($k, $in)) {
            $a[$k] = mb_substr(trim((string) $in[$k]), 0, 100);
        }
    }
    foreach (['devpassword', 'password'] as $k) {
        if (is_string($in[$k] ?? null) && $in[$k] !== '') {
            $a[$k] = mb_substr($in[$k], 0, 200);
        }
    }
    $keep = ['devid' => $a['devid'], 'devpassword' => $a['devpassword'], 'user' => $a['user'], 'password' => $a['password']];
    if ($a['softname'] !== 'Xsegon') {
        $keep['softname'] = $a['softname'];
    }
    return xs_write_json(xs_ss_account_path(), $keep, $why);
}

function xs_ss_account_forget(): bool
{
    $p = xs_ss_account_path();
    return !is_file($p) || @unlink($p);
}

// ---- where it asks ----------------------------------------------------------

/**
 * ScreenScraper's three questions, as addresses with the blanks left in:
 * {auth} the logins, {system} the console's number, {title} and {rom} the
 * game's name and file name. Tests point them at a stand-in (XSEGON_SS_API),
 * honoured only beside XSEGON_DATA, so nothing real is asked in a test.
 */
function xs_ss_sources(): array
{
    $api   = 'https://api.screenscraper.fr/api2/';
    // One question at a time with a breath between: a free account is
    // allowed one thread, and this is somebody else's free service.
    $pause = 1200;
    $test  = getenv('XSEGON_SS_API');
    if (is_string($test) && $test !== '' && getenv('XSEGON_DATA')) {
        $api   = rtrim($test, '/') . '/';
        $pause = 0;
    }
    return [
        'user'   => $api . 'ssuserInfos.php?{auth}&output=json',
        'search' => $api . 'jeuRecherche.php?{auth}&output=json&systemeid={system}&recherche={title}',
        'rom'    => $api . 'jeuInfos.php?{auth}&output=json&systemeid={system}&romtype=rom&romnom={rom}',
        'pause'  => $pause,
    ];
}

function xs_ss_auth(array $a): string
{
    return 'devid=' . rawurlencode($a['devid']) . '&devpassword=' . rawurlencode($a['devpassword'])
         . '&softname=' . rawurlencode($a['softname'])
         . '&ssid=' . rawurlencode($a['user']) . '&sspassword=' . rawurlencode($a['password']);
}

/**
 * Ask ScreenScraper who this is. ['ok' => true, 'today' => n, 'max' => n,
 * 'threads' => n] or ['ok' => false, 'error' => a sentence naming which login was refused].
 */
function xs_ss_check(array $a): array
{
    if (!xs_ss_ready($a)) {
        return ['ok' => false, 'error' => 'fill in all four boxes first'];
    }
    $url = str_replace('{auth}', xs_ss_auth($a), xs_ss_sources()['user']);
    $ctx = stream_context_create(['http' => ['timeout' => 20, 'user_agent' => 'Xsegon', 'ignore_errors' => true],
                                  'ssl'  => ['verify_peer' => true]]);
    // Only extend a limit that exists: the fetch worker runs with none, and
    // re-arming one here would give it a 40 second wall clock.
    if ((int) ini_get('max_execution_time') > 0) {
        set_time_limit(40);
    }
    // The status is read from the last response's headers, so an earlier
    // request's must not be standing there (the fast lane check makes one).
    if (function_exists('http_clear_last_response_headers')) {
        http_clear_last_response_headers();
    }
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return ['ok' => false, 'error' => 'could not reach ScreenScraper; it may be down, or this computer offline'];
    }
    $status = 200;
    $heads  = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : [];
    foreach ($heads as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
            $status = (int) $m[1];
        }
    }
    if ($status !== 200) {
        return ['ok' => false, 'error' => xs_ss_refusal($status, $raw)];
    }
    $json = json_decode(xs_strip_bom($raw), true);
    $u    = is_array($json) ? ($json['response']['ssuser'] ?? null) : null;
    if (!is_array($u)) {
        return ['ok' => false, 'error' => 'ScreenScraper answered, but not with an account: ' . xs_ss_words($raw)];
    }
    return [
        'ok'      => true,
        'name'    => (string) ($u['id'] ?? $a['user']),
        'today'   => (int) ($u['requeststoday'] ?? 0),
        'max'     => (int) ($u['maxrequestsperday'] ?? 0),
        'threads' => (int) ($u['maxthreads'] ?? 1),
    ];
}

/** The first line of an answer that was not JSON, short and with no markup. */
function xs_ss_words(string $raw): string
{
    return mb_substr(trim((string) preg_replace('/\s+/', ' ', strip_tags($raw))), 0, 120);
}

/** A refusal in the person's words. bin\screenscraper.ps1 says the same ones. */
function xs_ss_refusal(int $status, string $body): string
{
    $lower = strtolower($body);
    return match (true) {
        $status === 403 && (str_contains($lower, 'veloppeur') || str_contains($lower, 'developer'))
            => 'ScreenScraper refused the developer ID and its password',
        $status === 403 => 'ScreenScraper refused the member name and password',
        $status === 430, $status === 431 => "today's ScreenScraper quota is used up; it starts again tomorrow",
        $status === 401, $status === 423 => 'ScreenScraper is closed to free accounts right now (it does that when it is busy); try again later',
        $status === 426 => 'ScreenScraper says this developer ID may not be used any more',
        $status === 429 => 'ScreenScraper says too many requests; try again in a minute',
        default => 'ScreenScraper answered ' . $status . ': ' . xs_ss_words($body),
    };
}

// ---- the list and the job --------------------------------------------------

/**
 * Every game with no video, and every game whose video is a snap fetched
 * here before (so a finished run still shows what it did). A game with any
 * other video is not listed: it is not this screen's to touch.
 */
function xs_ss_games(array $s, array $library): array
{
    $rows = [];
    foreach ($library['games'] ?? [] as $g) {
        $id    = (string) $g['id'];
        $video = video_for_game($s, $g);
        $saved = $video !== null && xs_ss_for($id) === $video;
        if ($video !== null && !$saved) {
            continue;
        }
        $rows[] = [
            'id'       => $id,
            'title'    => (string) $g['title'],
            'platform' => (string) $g['platform'],
            'system'   => xs_ss_system((string) $g['platform']),
            'rom'      => xs_ss_rom_name((string) ($g['romPath'] ?? '')),
            'has'      => $saved,
        ];
    }
    usort($rows, static fn ($a, $b) => strcasecmp($a['platform'], $b['platform']) ?: strcasecmp($a['title'], $b['title']));
    return $rows;
}

/** The job as the page sees it. It never holds a login or an address. */
function xs_ss_job(): ?array
{
    $job = xs_read_json(xs_ss_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    // A worker that died would leave "running" for ever; a whole library of snaps is well inside six hours.
    if (($dead = xs_job_dead($job, xs_ss_job_path())) !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped part way (' . $dead . '); start it again and it carries on where it stopped';
        xs_write_json(xs_ss_job_path(), $job);
        xs_log('SSCR', 'the snap fetch stopped: ' . $dead . '; marked failed');
    }
    if (($job['state'] ?? '') === 'running' && time() - (int) ($job['started'] ?? 0) > 21600) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped answering; start it again and it carries on where it stopped';
        xs_write_json(xs_ss_job_path(), $job);
        xs_log('SSCR', 'the snap fetch stopped answering (started ' . date('H:i', (int) ($job['started'] ?? 0)) . '); marked failed');
    }
    $count = array_count_values(array_map(static fn ($g) => (string) ($g['state'] ?? ''), $job['games'] ?? []));
    $tally = ($count['done'] ?? 0) . ' saved, ' . ($count['none'] ?? 0) . ' not on ScreenScraper, '
           . ($count['novideo'] ?? 0) . ' there with no video, ' . ($count['failed'] ?? 0) . ' failed';
    if (($job['state'] ?? '') === 'failed' && empty($job['failLogged'])) {
        $job['failLogged'] = true;
        xs_write_json(xs_ss_job_path(), $job);
        xs_log('SSCR', 'snaps stopped: ' . ($job['error'] ?? '(no reason written)') . ' (' . $tally . ', ' . ($count['waiting'] ?? 0) . ' not reached)');
    }
    if (($job['state'] ?? '') === 'done' && empty($job['logged'])) {
        $job['logged'] = true;
        xs_write_json(xs_ss_job_path(), $job);
        xs_log('SSCR', 'snaps: ' . $tally);
    }
    return $job;
}
