<?php
/**
 * Xsegon - video snaps from ScreenScraper (screenscraper.fr), asked by the
 * game's title and console for the games that have no video.
 *
 * Their API wants a member account and a developer ID on every call. The
 * member account is each person's own, typed in:
 *
 *     data\screenscraper.json           the logins typed, on this computer only
 *     data\screenscraper-shared.dat     Xsegon's own developer ID, sealed to this computer
 *
 * Xsegon's own developer ID comes from Xsegon's website on a press, never in
 * the public code; one the person types is used instead. The sealing stops a
 * casual look only: ScreenScraper puts the developer password in every address it answers with.
 * The website counts each Fetch, and past its daily limit it answers "off": no fetch is made then.
 *
 * Kept apart from settings.json on purpose: that file goes into a problem
 * report and a backup whole, and these go into neither. The page is told
 * the names and whether a password is stored, never the passwords.
 *
 * Each snap is saved as data\videos-screenscraper\<game id>.mp4 and found
 * after every other video source, so it only fills a gap. Left out of backups.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/video.php';
require_once __DIR__ . '/overrides.php';   // a fetched cover is stored as a replaced picture
require_once __DIR__ . '/extras.php';      // xs_docs_dir
require_once __DIR__ . '/versions.php';    // xs_version_key

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

function xs_ss_shared_path(): string
{
    return xs_data_path('screenscraper-shared.dat');
}

/** The games a fetch found no video for: {"from": that fetch's start, "games": {id: {at, why}}}. */
function xs_ss_none_path(): string
{
    return xs_data_path('screenscraper-none.json');
}

function xs_ss_none(): array
{
    $none = xs_read_json(xs_ss_none_path(), []);
    return is_array($none) && is_array($none['games'] ?? null) ? $none['games'] : [];
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

/**
 * The logins a question goes out with: the person's own developer ID when both
 * its boxes are filled, else Xsegon's own ('shared' true). $pull and $press as xs_ss_shared.
 */
function xs_ss_account_in_use(bool $pull = false, ?string &$why = null, string $press = 'check'): array
{
    $why = null;
    $a   = xs_ss_account();
    $a['shared'] = false;
    if ($a['devid'] !== '' && $a['devpassword'] !== '') {
        return $a;
    }
    // The site is asked only when there is a member login to go with what it gives.
    $dev = xs_ss_shared($pull && $a['user'] !== '' && $a['password'] !== '', $why, $press);
    return $dev === null ? $a : array_merge($a, $dev, ['shared' => true]);
}

/** What the page may know: the names, whether each password is stored, and whether Xsegon's own developer ID is in use. */
function xs_ss_account_public(): array
{
    $a   = xs_ss_account();
    $use = xs_ss_account_in_use();
    return [
        'devid'       => $a['devid'],
        'user'        => $a['user'],
        'devpassword' => $a['devpassword'] !== '',
        'password'    => $a['password'] !== '',
        'shared'      => $use['shared'],
        'ready'       => xs_ss_ready($use),
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

// ---- Xsegon's own developer ID ----------------------------------------------

/**
 * Where the website serves it, saying which press asks (fetch, check or save):
 * the site counts only a fetch. Tests point it at a stand-in (XSEGON_SS_SHARED), honoured only beside XSEGON_DATA.
 */
function xs_ss_shared_url(string $press = 'check'): string
{
    $test = getenv('XSEGON_SS_SHARED');
    $url  = is_string($test) && $test !== '' && getenv('XSEGON_DATA') ? $test : 'https://tumultuousproductions.site/xsegon/ss.php';
    return $url . (str_contains($url, '?') ? '&' : '?') . 'press=' . rawurlencode($press);
}

/** The website copy's key. bin\screenscraper.ps1 builds the same one. */
function xs_ss_site_key(): string
{
    return hash('sha256', hex2bin('f63807d197f8ad93' . 'bab30783da0dd9f8' . 'c1b59077910be438' . '6732257fcc4def84') . 'xs-ss-1', true);
}

/** The kept copy's key: the website's with this computer and Windows user, so a copied data folder does not open it. */
function xs_ss_pc_key(): string
{
    // ASCII only: PHP and PowerShell may read a name with other letters in different encodings.
    $ascii = static fn (string $name): string => (string) preg_replace('/[^\x20-\x7E]/', '', (string) getenv($name));
    return hash('sha256', xs_ss_site_key() . '|' . $ascii('COMPUTERNAME') . '|' . $ascii('USERNAME'), true);
}

/** AES-256-CBC under an HMAC, as base64 of the IV, the text and the HMAC. */
function xs_ss_seal(string $plain, string $key): string
{
    $iv = random_bytes(16);
    $ct = (string) openssl_encrypt($plain, 'aes-256-cbc', hash('sha256', 'enc|' . $key, true), OPENSSL_RAW_DATA, $iv);
    return base64_encode($iv . $ct . hash_hmac('sha256', $iv . $ct, hash('sha256', 'mac|' . $key, true), true));
}

/** The text sealed with this key, or null when another key sealed it or it was changed since. */
function xs_ss_unseal(string $sealed, string $key): ?string
{
    $all = base64_decode(trim($sealed), true);
    if ($all === false || strlen($all) < 64) {
        return null;
    }
    $body = substr($all, 0, -32);
    if (!hash_equals(hash_hmac('sha256', $body, hash('sha256', 'mac|' . $key, true), true), substr($all, -32))) {
        return null;
    }
    $plain = openssl_decrypt(substr($body, 16), 'aes-256-cbc', hash('sha256', 'enc|' . $key, true), OPENSSL_RAW_DATA, substr($body, 0, 16));
    return $plain === false ? null : $plain;
}

/** A developer ID read back from sealed text: devid, devpassword, softname; null when it is not one. */
function xs_ss_dev_read(?string $plain): ?array
{
    $d = $plain === null ? null : json_decode($plain, true);
    if (!is_array($d) || !is_string($d['devid'] ?? null) || !is_string($d['devpassword'] ?? null)
        || trim($d['devid']) === '' || $d['devpassword'] === '') {
        return null;
    }
    $soft = is_string($d['softname'] ?? null) && trim($d['softname']) !== '' ? trim($d['softname']) : 'Xsegon';
    return ['devid' => trim($d['devid']), 'devpassword' => $d['devpassword'], 'softname' => $soft];
}

/** The file the website serves for this developer ID. Only the maker writes one. */
function xs_ss_site_file(array $dev): string
{
    $plain = (string) json_encode(['devid' => $dev['devid'], 'devpassword' => $dev['devpassword'], 'softname' => $dev['softname'] ?? 'Xsegon']);
    return json_encode(['v' => 1, 'sealed' => xs_ss_seal($plain, xs_ss_site_key())]) . "\n";
}

/**
 * Xsegon's own developer ID, or null with $why. $pull asks the website first
 * and keeps what comes, sealed to this computer; without it, or when the
 * website gives none, the kept copy is used. $press is the button that asks;
 * past the website's daily limit of fetches it answers "off", and then nothing is used.
 */
function xs_ss_shared(bool $pull = false, ?string &$why = null, string $press = 'check'): ?array
{
    $why  = null;
    $path = xs_ss_shared_path();
    $kept = xs_read_json($path, null);
    $have = is_array($kept) && is_string($kept['sealed'] ?? null) ? xs_ss_dev_read(xs_ss_unseal($kept['sealed'], xs_ss_pc_key())) : null;
    if ($pull) {
        $got  = xs_ss_fetch(xs_ss_shared_url($press), 10);
        $site = $got !== null && $got['status'] === 200 ? json_decode(xs_strip_bom($got['body']), true) : null;
        if (is_array($site) && ($site['off'] ?? false) === true) {
            $why = 'ScreenScraper videos are paused for today; the other video sources still work';
            xs_log('SSCR', "Xsegon's own developer ID: the website says fetches are paused for today (its daily limit is reached)");
            return null;
        }
        $new  = is_array($site) && is_string($site['sealed'] ?? null) ? xs_ss_dev_read(xs_ss_unseal($site['sealed'], xs_ss_site_key())) : null;
        if ($new !== null) {
            if ($new !== $have) {
                // The fetcher opens the kept copy itself, so one that cannot be kept is a failure.
                if (!xs_write_json($path, ['v' => 1, 'sealed' => xs_ss_seal((string) json_encode($new), xs_ss_pc_key())], $wrote)) {
                    $why = (string) $wrote;
                    xs_log('SSCR', "Xsegon's own developer ID came, and could not be kept: " . $why);
                    return null;
                }
                xs_log('SSCR', "Xsegon's own developer ID fetched from the website" . ($have !== null ? ' (a new one)' : ''));
            }
            return $new;
        }
        $said = $got === null ? 'no answer' : ($got['status'] !== 200 ? 'it answered ' . $got['status'] : 'its answer did not open');
        xs_log('SSCR', "Xsegon's own developer ID: the website gave none (" . $said . ')'
            . ($have !== null ? '; the kept copy is used' : (is_file($path) ? '; the kept copy does not open on this computer' : '; none is kept')));
    }
    if ($have === null) {
        $why = "Xsegon's own developer ID could not be fetched from tumultuousproductions.site (it may be down, or this computer offline), "
             . 'and none is kept here yet; try again later';
    }
    return $have;
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

/** One GET: ['status' => n, 'body' => text], or null when nothing answered. */
function xs_ss_fetch(string $url, int $timeout): ?array
{
    $ctx = stream_context_create(['http' => ['timeout' => $timeout, 'user_agent' => 'Xsegon', 'ignore_errors' => true],
                                  'ssl'  => ['verify_peer' => true]]);
    // Only extend a limit that exists: the fetch worker runs with none, and
    // re-arming one here would give it a wall clock.
    if ((int) ini_get('max_execution_time') > 0) {
        set_time_limit($timeout + 20);
    }
    // The status is read from the last response's headers, so an earlier
    // request's must not be standing there (the fast lane check makes one).
    if (function_exists('http_clear_last_response_headers')) {
        http_clear_last_response_headers();
    }
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return null;
    }
    $status = 200;
    $heads  = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : [];
    foreach ($heads as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
            $status = (int) $m[1];
        }
    }
    return ['status' => $status, 'body' => $raw];
}

/**
 * Ask ScreenScraper who this is. ['ok' => true, 'today' => n, 'max' => n,
 * 'threads' => n] or ['ok' => false, 'error' => a sentence naming which login was refused].
 * $devWhy is why there is no developer ID, from xs_ss_account_in_use.
 */
function xs_ss_check(array $a, ?string $devWhy = null): array
{
    if (!xs_ss_ready($a)) {
        return ['ok' => false, 'error' => $a['user'] === '' || $a['password'] === ''
            ? 'fill in the member name and password first' : ($devWhy ?? 'fill in the developer ID and its password')];
    }
    $got = xs_ss_fetch(str_replace('{auth}', xs_ss_auth($a), xs_ss_sources()['user']), 20);
    if ($got === null) {
        return ['ok' => false, 'error' => 'could not reach ScreenScraper; it may be down, or this computer offline'];
    }
    $raw = $got['body'];
    if ($got['status'] !== 200) {
        return ['ok' => false, 'error' => xs_ss_refusal($got['status'], $raw, !empty($a['shared']))];
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
function xs_ss_refusal(int $status, string $body, bool $shared = false): string
{
    $lower = strtolower($body);
    return match (true) {
        $status === 403 && (str_contains($lower, 'veloppeur') || str_contains($lower, 'developer'))
            => 'ScreenScraper refused ' . ($shared ? "Xsegon's own developer ID" : 'the developer ID') . ' and its password',
        $status === 403 => 'ScreenScraper refused the member name and password',
        $status === 430, $status === 431 => "today's ScreenScraper quota is used up; it starts again tomorrow",
        $status === 401, $status === 423 => 'ScreenScraper is closed to free accounts right now (it does that when it is busy); try again later',
        $status === 426 => 'ScreenScraper says ' . ($shared ? "Xsegon's own developer ID" : 'this developer ID') . ' may not be used any more',
        $status === 429 => 'ScreenScraper says too many requests; try again in a minute',
        default => 'ScreenScraper answered ' . $status . ': ' . xs_ss_words($body),
    };
}

// ---- the list and the job --------------------------------------------------

/**
 * Keeps, once per ended fetch, the games ScreenScraper does not have or has
 * no video of, so the list shows them apart. One saved since is let go; a failed ask changes nothing.
 */
function xs_ss_keep_none(array $job): void
{
    $file    = xs_read_json(xs_ss_none_path(), []);
    $started = (int) ($job['started'] ?? 0);
    if (is_array($file) && isset($file['from']) && (int) $file['from'] === $started) {
        return;
    }
    $games = xs_ss_none();
    $kept  = 0;
    foreach ($job['games'] ?? [] as $g) {
        $id    = (string) ($g['id'] ?? '');
        $state = (string) ($g['state'] ?? '');
        if ($id !== '' && ($state === 'none' || $state === 'novideo')) {
            $games[$id] = ['at' => (int) ($job['ended'] ?? time()), 'why' => $state];
            $kept++;
        } elseif ($id !== '' && $state === 'done') {
            unset($games[$id]);
        }
    }
    if (!$games && !is_file(xs_ss_none_path())) {
        return;
    }
    xs_write_json(xs_ss_none_path(), ['from' => $started, 'games' => $games]);
    if ($kept) {
        xs_log('SSCR', $kept . ' with no video kept apart, ' . count($games) . ' in all');
    }
}

/**
 * Every game with no video, and every game whose video is a snap fetched
 * here before (so a running fetch shows what it saved). A game with any
 * other video is not listed: it is not this screen's to touch. One a fetch
 * found no video for says so in 'tried', and when in 'triedAt'.
 */
function xs_ss_games(array $s, array $library): array
{
    $rows = [];
    $none = xs_ss_none();
    foreach ($library['games'] ?? [] as $g) {
        $id    = (string) $g['id'];
        $video = video_for_game($s, $g);
        $saved = $video !== null && xs_ss_for($id) === $video;
        if ($video !== null && !$saved) {
            continue;
        }
        $tried = $video === null ? ($none[$id] ?? null) : null;
        $rows[] = [
            'id'       => $id,
            'title'    => (string) $g['title'],
            'platform' => (string) $g['platform'],
            'system'   => xs_ss_system((string) $g['platform']),
            'rom'      => xs_ss_rom_name((string) ($g['romPath'] ?? '')),
            'has'      => $saved,
            'tried'    => is_array($tried) ? (string) ($tried['why'] ?? 'none') : '',
            'triedAt'  => is_array($tried) ? (int) ($tried['at'] ?? 0) : 0,
        ];
    }
    usort($rows, static fn ($a, $b) => strcasecmp($a['platform'], $b['platform']) ?: strcasecmp($a['title'], $b['title']));
    return $rows;
}

/**
 * The games ScreenScraper may fetch a manual for: no manual yet, a card each as the list rolls versions
 * (includes\archivedoc.php), on a console ScreenScraper knows, and that the Internet Archive's free sets
 * cannot serve first: its console has no set there, or the Archive was asked and had none. So the sets
 * go first and the day's allowance is kept for the rest. Without $archiveFirst (ScreenScraper only, in
 * Get everything missing) every card with no manual. 'key' is the card, for a video row to join.
 */
function xs_ss_manual_games(array $library, bool $archiveFirst = true): array
{
    require_once __DIR__ . '/archivedoc.php';
    $looked = xs_ma_looked();
    $rows   = [];
    foreach (xs_ma_need($library) as $c) {
        $system = xs_ss_system($c['platform']);
        if ($system <= 0 || ($archiveFirst && xs_ma_sets_for($c['platform']) && !isset($looked[$c['id']]))) {
            continue;
        }
        $rows[] = ['id' => $c['id'], 'title' => $c['title'], 'platform' => $c['platform'], 'system' => $system,
                   'rom' => xs_ss_rom_name((string) ($c['files'][0] ?? '')), 'key' => xs_version_key($c)];
    }
    return $rows;
}

/** The covers a fetch brings, each the game's <id>.<ext> until it is stored as its box (xs_ss_keep_boxes). */
function xs_ss_boxes_dir(): string
{
    return xs_data_path('screenscraper-boxes');
}

/**
 * The games with no cover on a console ScreenScraper knows: none in the library, the media copy or
 * data\art, and not left empty on purpose (Use no picture).
 */
function xs_ss_box_games(array $library): array
{
    $hidden = xs_art_hidden();
    $rows   = [];
    foreach ($library['games'] ?? [] as $g) {
        $id     = (string) ($g['id'] ?? '');
        $system = xs_ss_system((string) ($g['platform'] ?? ''));
        if (!xs_game_id_ok($id) || $system <= 0 || ($g['art']['box'] ?? null) !== null || in_array('box', (array) ($hidden[$id] ?? []), true)) {
            continue;
        }
        $rows[] = ['id' => $id, 'title' => (string) $g['title'], 'platform' => (string) $g['platform'], 'system' => $system,
                   'rom' => xs_ss_rom_name((string) ($g['romPath'] ?? ''))];
    }
    return $rows;
}

/**
 * A fetch's games, one entry a game. Its video when it is one of $ids (null: every game with no video
 * no fetch found none for before; []: no videos); its card's manual with $manuals ($archiveFirst as
 * xs_ss_manual_games); its cover with $boxes. 'video', 'manual' and 'box' say what each is asked for,
 * 'docid' the card a manual is kept under.
 */
function xs_ss_plan_games(array $s, array $library, ?array $ids, bool $manuals, bool $archiveFirst = true, bool $boxes = false): array
{
    $want = $ids === null ? null : array_flip(array_map('strval', $ids));
    $pick = $want === [] ? [] : array_values(array_filter(xs_ss_games($s, $library),
        static fn ($r) => !$r['has'] && $r['system'] > 0 && ($want === null ? $r['tried'] === '' : isset($want[$r['id']]))));
    // A game asked for its video brings its card's manual in the same answer; the rest are asked for the manual alone.
    $cards = [];
    foreach ($manuals ? xs_ss_manual_games($library, $archiveFirst) : [] as $m) {
        $cards[$m['key']] = $m;
    }
    $games = [];
    $entry = static fn (array $r, bool $video, bool $manual, string $docid, bool $box): array =>
        ['id' => $r['id'], 'title' => $r['title'], 'platform' => $r['platform'], 'system' => $r['system'], 'rom' => $r['rom'],
         'state' => 'waiting', 'video' => $video, 'manual' => $manual, 'docid' => $docid, 'box' => $box];
    foreach ($pick as $r) {
        $card = $cards[xs_version_key($r)] ?? null;
        unset($cards[xs_version_key($r)]);
        $games[$r['id']] = $entry($r, true, $card !== null, (string) ($card['id'] ?? $r['id']), false);
    }
    foreach ($cards as $m) {
        $games[$m['id']] = $entry($m, false, true, (string) $m['id'], false);
    }
    // A cover comes in the answer a game is asked about anyway, or is asked for alone.
    foreach ($boxes ? xs_ss_box_games($library) : [] as $c) {
        if (isset($games[$c['id']])) {
            $games[$c['id']]['box'] = true;
        } else {
            $games[$c['id']] = $entry($c, false, false, $c['id'], true);
        }
    }
    return array_values($games);
}

/** The job file bin\screenscraper.ps1 works from. */
function xs_ss_plan(array $games, bool $manuals, bool $boxes = false): array
{
    $src = xs_ss_sources();
    return [
        'state'   => 'running',
        'started' => time(),
        'dir'     => xs_ss_dir(),
        'docs'    => xs_docs_dir(),
        'manuals' => $manuals,
        'boxes'   => $boxes ? xs_ss_boxes_dir() : '',
        'art'     => xs_own_art_dir(),
        'search'  => $src['search'],
        'rom'     => $src['rom'],
        'pause'   => $src['pause'],
        'games'   => $games,
    ];
}

/**
 * Write the job and start the fetcher with these logins (xs_ss_account_in_use). False with $why.
 * The fetcher opens the kept copy of Xsegon's own developer ID itself; it is never on a command line.
 */
function xs_ss_start(array $plan, array $use, ?string &$why = null): bool
{
    $why = null;
    if (!xs_write_json(xs_ss_job_path(), $plan, $why)) {
        return false;
    }
    $script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'screenscraper.ps1';
    $args   = ['Job' => xs_ss_job_path(), 'Account' => xs_ss_account_path(), 'Shared' => $use['shared'] ? xs_ss_shared_path() : null];
    if (!xs_spawn_ps(xs_ps_call($script, $args))) {
        $why = 'the snap fetcher could not be started';
        return false;
    }
    $games = $plan['games'];
    $n     = static fn (string $k): int => count(array_filter($games, static fn ($g) => !empty($g[$k])));
    xs_log('SSCR', 'fetch asked for ' . $n('video') . ' snaps' . ($plan['manuals'] ? ' and ' . $n('manual') . ' manuals' : '')
        . ($plan['boxes'] !== '' ? ' and ' . $n('box') . ' covers' : ''));
    return true;
}

/**
 * The covers an ended fetch brought, each stored as its game's box (xs_own_art_store), once. One that
 * got a cover or Use no picture meanwhile keeps it; the fetched file goes either way.
 */
function xs_ss_keep_boxes(array &$job): void
{
    if (($job['boxes'] ?? '') === '' || !empty($job['boxesKept'])) {
        return;
    }
    $kept = $had = $bad = 0;
    foreach ($job['games'] as &$g) {
        if (($g['bstate'] ?? '') !== 'got') {
            continue;
        }
        $id   = (string) $g['id'];
        $file = xs_ss_boxes_dir() . DIRECTORY_SEPARATOR . basename((string) ($g['bfile'] ?? ''));
        $bytes = is_file($file) ? (string) @file_get_contents($file) : '';
        if (xs_glob(xs_own_art_dir(), $id . '-box.*') || in_array('box', (array) (xs_art_hidden()[$id] ?? []), true)) {
            $g['bstate'] = 'had';
            $had++;
        } elseif ($bytes !== '' && xs_own_art_store($id, 'box', $bytes, false, $why) !== null) {
            $g['bstate'] = 'done';
            $kept++;
        } else {
            $g['bstate'] = 'failed';
            $g['bwhy']   = $bytes === '' ? 'the fetched cover was gone' : (string) $why;
            $bad++;
        }
        @unlink($file);
    }
    unset($g);
    $job['boxesKept'] = true;
    xs_write_json(xs_ss_job_path(), $job);
    xs_log('SSCR', 'covers: ' . $kept . ' stored as boxes' . ($had ? ', ' . $had . ' had one meanwhile' : '') . ($bad ? ', ' . $bad . ' could not be stored' : ''));
}

/** The job as the page sees it. It never holds a login or an address. */
function xs_ss_job(): ?array
{
    // Settled: a read at the moment the fetcher saves would let the window lose its fetch.
    $job = xs_read_json_settled(xs_ss_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    // A worker that died would leave "running" for ever. One alive is at work however long a large fetch takes.
    if (($dead = xs_job_dead($job, xs_ss_job_path())) !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped part way (' . $dead . '); start it again and it carries on where it stopped';
        xs_write_json(xs_ss_job_path(), $job);
        xs_log('SSCR', 'the snap fetch stopped: ' . $dead . '; marked failed');
    }
    $count = array_count_values(array_map(static fn ($g) => (string) ($g['state'] ?? ''), $job['games'] ?? []));
    $tally = ($count['done'] ?? 0) . ' saved, ' . ($count['none'] ?? 0) . ' not on ScreenScraper, '
           . ($count['novideo'] ?? 0) . ' there with no video, ' . ($count['failed'] ?? 0) . ' failed';
    // Manuals, where the fetch asked for them: each game's own word beside its video's (bin\screenscraper.ps1).
    if (!empty($job['manuals'])) {
        $m = array_count_values(array_filter(array_map(static fn ($g) => (string) ($g['mstate'] ?? ''), $job['games'] ?? [])));
        $tally .= '; manuals: ' . ($m['done'] ?? 0) . ' saved, ' . ($m['none'] ?? 0) . ' not on ScreenScraper, ' . ($m['nomanual'] ?? 0) . ' there with no manual, '
                . ($m['other'] ?? 0) . ' only in another language, ' . ($m['failed'] ?? 0) . ' failed';
    }
    // Covers, where Get everything missing asked for them: stored as each game's box once the fetch has ended.
    if (in_array($job['state'] ?? '', ['done', 'failed'], true)) {
        xs_ss_keep_boxes($job);
    }
    if (($job['boxes'] ?? '') !== '') {
        $c = array_count_values(array_filter(array_map(static fn ($g) => (string) ($g['bstate'] ?? ''), $job['games'] ?? [])));
        $tally .= '; covers: ' . (($c['done'] ?? 0) + ($c['got'] ?? 0)) . ' saved, ' . ($c['none'] ?? 0) . ' not on ScreenScraper, ' . ($c['nobox'] ?? 0) . ' there with no cover, '
                . ($c['failed'] ?? 0) . ' failed';
    }
    if (($job['state'] ?? '') === 'failed' && empty($job['failLogged'])) {
        $job['failLogged'] = true;
        xs_write_json(xs_ss_job_path(), $job);
        xs_log('SSCR', 'snaps stopped: ' . ($job['error'] ?? '(no reason written)') . ' (' . $tally . ', ' . ($count['waiting'] ?? 0) . ' not reached)');
    }
    if (($job['state'] ?? '') === 'done' && empty($job['logged'])) {
        $job['logged'] = true;
        xs_write_json(xs_ss_job_path(), $job);
        // How the games were found: by name, file, title as a file name, one word (bin\screenscraper.ps1).
        $by = array_count_values(array_filter(array_map(static fn ($g) => (string) ($g['by'] ?? ''), $job['games'] ?? [])));
        xs_log('SSCR', 'snaps: ' . $tally . ($by ? '; found by ' . implode(', ', array_map(static fn ($k, $n) => $k . ' ' . $n, array_keys($by), $by)) : ''));
    }
    if (in_array($job['state'] ?? '', ['done', 'failed'], true)) {
        xs_ss_keep_none($job);
    }
    return $job;
}
