<?php
/**
 * Xsegon - free homebrew: games fans made for consoles, listed with the people who made them.
 *
 *     includes\homebrew\games.json   the list, shipped with Xsegon
 *     data\homebrew-got.json         { "<list id>": { "game", "version", "from", "at" } }: what Get brought in
 *     data\homebrew-job.json         the Get at work, as its worker (bin\homebrew.php) leaves it
 *     data\homebrew-stop             asks the worker to stop
 *
 * Xsegon hosts none of it. A game comes from its team's own release, else from the public
 * folder of the jam it was entered in, at the person's press, checked against what the list
 * or GitHub says of it, and joins its console's list. ares comes the same way, from its makers.
 */
declare(strict_types=1);

require_once __DIR__ . '/emuset.php';
require_once __DIR__ . '/emuadd.php';
require_once __DIR__ . '/fanmake.php';

const XS_HB_ARES_REPO  = 'https://github.com/ares-emulator/ares';
const XS_HB_ARES_ASSET = '^ares-windows-x64\.zip$';
const XS_HB_ARES_ARGS  = '--system "Nintendo 64" --fullscreen';

function xs_hb_job_path(): string
{
    return xs_data_path('homebrew-job.json');
}

function xs_hb_stop_path(): string
{
    return xs_data_path('homebrew-stop');
}

function xs_hb_got_path(): string
{
    return xs_data_path('homebrew-got.json');
}

/** What Get brought in, by list id. */
function xs_hb_got(): array
{
    $a = xs_read_json(xs_hb_got_path(), []);
    return is_array($a) ? $a : [];
}

/** The list as it stands in its file; a test copy may hand its own in data\homebrew.json. */
function xs_hb_doc(): array
{
    static $doc = null;
    if ($doc === null) {
        $own = xs_data_path('homebrew.json');
        $doc = xs_read_json(xs_test_copy() && is_file($own) ? $own
            : XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'homebrew' . DIRECTORY_SEPARATOR . 'games.json', []);
        $doc = is_array($doc) ? $doc : [];
    }
    return $doc;
}

/** Whether an entry can be shown and fetched: named, credited, and with one good place for its file. */
function xs_hb_good(array $g): bool
{
    foreach (['name', 'console', 'about', 'team', 'licence', 'jam'] as $k) {
        if (!is_string($g[$k] ?? null) || trim($g[$k]) === '') {
            return false;
        }
    }
    $f = is_array($g['file'] ?? null) ? $g['file'] : [];
    $drive = is_array($f['drive'] ?? null) && preg_match('/^[A-Za-z0-9_-]{20,}$/', (string) ($f['drive']['id'] ?? ''))
        && (int) ($f['drive']['size'] ?? 0) > 0 && preg_match('/^[0-9a-f]{40}$/', (string) ($f['drive']['sha1'] ?? ''));
    return preg_match('/^[a-z0-9-]{1,40}$/', (string) ($g['id'] ?? '')) === 1
        && isset(xs_hb_doc()['jams'][$g['jam']])
        && (!isset($g['page']) || xs_fan_url_ok((string) $g['page']))
        && (!isset($g['repo']) || xs_fan_url_ok((string) $g['repo']))
        && (isset($g['page']) || isset($g['repo']))
        && ($drive || (is_string($f['release'] ?? null) && isset($g['repo'])));
}

/** The list, entries that hold up, by id. */
function xs_hb_list(): array
{
    $out = [];
    foreach ((array) (xs_hb_doc()['games'] ?? []) as $g) {
        if (is_array($g) && xs_hb_good($g)) {
            $out[(string) $g['id']] = $g;
        } else {
            xs_log('HBRW', 'a list entry left out: ' . (is_array($g) ? (string) ($g['id'] ?? '?') : '?'));
        }
    }
    return $out;
}

/** A listed game's pictures and video by kind, its makers' first, each with who it comes from: [kind => [['url', 'by']]]. */
function xs_hb_art(array $g): array
{
    $sites = (array) (xs_hb_doc()['pictures'] ?? []);
    $out = [];
    foreach ((array) ($g['art'] ?? []) as $kind => $urls) {
        foreach ((array) $urls as $url) {
            // itch.io writes its picture addresses with %2B and %2F.
            if (is_string($url) && xs_fan_url_ok(str_replace('%', '', $url))) {
                $out[(string) $kind][] = ['url' => $url, 'by' => (string) ($sites[parse_url($url, PHP_URL_HOST)] ?? 'its makers')];
            }
        }
    }
    return $out;
}

/** The listed game a library game is, or null: the same console, and its title or file name starts with the listed name, punctuation aside. */
function xs_hb_match(array $game): ?array
{
    $plain = static fn (string $s): string => (string) preg_replace('/[^a-z0-9]+/', '', strtolower($s));
    $title = $plain((string) ($game['title'] ?? ''));
    $file = $plain(pathinfo((string) ($game['romPath'] ?? ''), PATHINFO_FILENAME));
    foreach (xs_hb_list() as $g) {
        $name = $plain((string) $g['name']);
        if ($g['console'] === ($game['platform'] ?? '') && strlen($name) >= 6 && (str_starts_with($title, $name) || str_starts_with($file, $name))) {
            return $g;
        }
    }
    return null;
}

/** The ares in the emulator table with its file there, as its table key, or null. */
function xs_hb_ares_key(array $table): ?string
{
    foreach ($table['programs'] ?? [] as $k => $p) {
        $exe = (string) ($p['exe'] ?? '');
        if ($exe !== '' && xs_emu_base($exe) === 'ares' && is_file($exe)) {
            return (string) $k;
        }
    }
    return null;
}

/**
 * ares offered for one console without taking it over: its games keep what starts them, and a
 * game chooses ares through Set Emulator. On a console with nothing set up it is the one there is.
 */
function xs_hb_ares_offer(array &$table, string $console, string $key): void
{
    $pk = strtolower($console);
    $entry = $table['platforms'][$pk] ?? ['options' => []];
    foreach ($entry['options'] ?? [] as $o) {
        if (($o['program'] ?? '') === $key) {
            return;
        }
    }
    $entry['options'][] = ['program' => $key, 'emulator' => 'ares', 'emulatorId' => 'xsegon-' . $key, 'args' => XS_HB_ARES_ARGS,
                           'core' => null, 'load' => null, 'default' => empty($entry['options']), 'own' => true];
    $table['platforms'][$pk] = $entry;
}

/** Whether the bytes of a game's start are a Nintendo 64 ROM, as the ending that byte order goes by; null when not. */
function xs_hb_n64_ending(string $head): ?string
{
    $ends = ['80371240' => 'z64', '37804012' => 'v64', '40123780' => 'n64'];
    return $ends[bin2hex(substr($head, 0, 4))] ?? null;
}

/** The folder most of a console's games stand in, or null with none. A test copy only ever counts folders of its own. */
function xs_hb_games_folder(string $console): ?string
{
    $dirs = [];
    foreach (xs_library()['games'] ?? [] as $g) {
        $rom = (string) ($g['romPath'] ?? '');
        if (($g['platform'] ?? '') !== $console || !empty($g['local']) || $rom === '') {
            continue;
        }
        $dir = dirname(xs_rom_real_path($rom, xs_settings()));
        if (!xs_test_copy() || str_starts_with($dir, xs_data_path(''))) {
            $dirs[$dir] = ($dirs[$dir] ?? 0) + 1;
        }
    }
    arsort($dirs);
    return $dirs ? (string) array_key_first($dirs) : null;
}

/** The folder a console's homebrew goes in: one of the person's own beside the console's games, whatever else its name says, or a new HomeBrew there. */
function xs_hb_dest(string $console): string
{
    require_once __DIR__ . '/unpack.php';
    $dir = xs_hb_games_folder($console);
    if ($dir === null) {
        $root = xs_test_copy() ? '' : (xs_scan_roots()[0] ?? '');
        if ($root === '') {
            // Nobody has told Xsegon where games go yet: Xsegon's own folder holds them.
            return xs_data_path('homebrew-games' . DIRECTORY_SEPARATOR . preg_replace('/[^A-Za-z0-9 ]+/', '', $console) . DIRECTORY_SEPARATOR . 'HomeBrew');
        }
        $dir = (string) xs_unpack_folder_for($console, $root . DIRECTORY_SEPARATOR . 'x')['dir'];
    }
    if (preg_match('/^home ?brew/i', basename($dir))) {
        return $dir;
    }
    foreach (@scandir($dir) ?: [] as $n) {
        if (preg_match('/^home ?brew/i', (string) $n) && is_dir($dir . DIRECTORY_SEPARATOR . $n)) {
            return $dir . DIRECTORY_SEPARATOR . $n;
        }
    }
    return $dir . DIRECTORY_SEPARATOR . 'HomeBrew';
}

/** Every listed game and where it stands here: the credit as the list has it, and the copy that is yours. */
function xs_hb_states(array $games): array
{
    $byId = [];
    foreach ($games as $g) {
        $byId[(string) $g['id']] = $g;
    }
    $got = xs_hb_got();
    $jams = (array) (xs_hb_doc()['jams'] ?? []);
    $ares = xs_hb_ares_key(xs_emulators()) !== null;
    $out = [];
    foreach (xs_hb_list() as $id => $g) {
        $mine = null;
        $rec = is_array($got[$id] ?? null) ? $got[$id] : null;
        if ($rec !== null && isset($byId[(string) ($rec['game'] ?? '')])) {
            $lib = $byId[(string) $rec['game']];
            $mine = ['id' => (string) $lib['id'], 'title' => (string) $lib['title'], 'platform' => (string) $lib['platform'],
                     'local' => !empty($lib['local']), 'version' => (string) ($rec['version'] ?? '')];
        }
        $jam = (array) ($jams[$g['jam']] ?? []);
        $out[] = [
            'id' => (string) $id, 'name' => (string) $g['name'], 'console' => (string) $g['console'], 'about' => (string) $g['about'],
            'team' => (string) $g['team'], 'basedon' => (string) ($g['basedon'] ?? ''), 'licence' => (string) $g['licence'],
            'jam' => (string) ($jam['name'] ?? ''), 'theme' => (string) ($jam['theme'] ?? ''), 'place' => (int) ($g['place'] ?? 0),
            'page' => $g['page'] ?? null, 'repo' => $g['repo'] ?? null, 'community' => $jam['community'] ?? null, 'jamPage' => $jam['page'] ?? null,
            'tested' => (string) ($g['tested'] ?? ''), 'warn' => (string) ($g['warn'] ?? ''), 'notes' => (string) ($g['notes'] ?? ''),
            'pic' => (string) ($g['pic'] ?? ''), 'picsBy' => implode(', ', array_unique(array_column(array_merge(...array_values(xs_hb_art($g))), 'by'))),
            'emulator' => (string) ($g['emulator'] ?? ''),
            'needsAres' => ($g['emulator'] ?? '') === 'ares' && !$ares, 'mine' => $mine,
        ];
    }
    return $out;
}

/** One of a listed game's places, never an address from the request. */
function xs_hb_url(string $id, string $which): ?string
{
    $g = xs_hb_list()[$id] ?? null;
    if ($g === null) {
        return null;
    }
    $jam = (array) (xs_hb_doc()['jams'][$g['jam']] ?? []);
    $url = in_array($which, ['page', 'repo'], true) ? ($g[$which] ?? null)
         : ($which === 'community' ? ($jam['community'] ?? null) : ($which === 'jam' ? ($jam['page'] ?? null) : null));
    return is_string($url) && xs_fan_url_ok($url) ? $url : null;
}

/** The Get as its worker left it, or null; a worker that is gone is said. */
function xs_hb_job(): ?array
{
    $job = xs_read_json(xs_hb_job_path(), null);
    if (!is_array($job)) {
        return null;
    }
    $dead = xs_job_dead($job, xs_hb_job_path());
    if ($dead !== null) {
        $job['state'] = 'failed';
        $job['error'] = 'it stopped before it finished: ' . $dead;
    }
    return $job;
}

/**
 * Start getting game $id, in the background. $ares: the person said yes to fetching ares too.
 * False with $why when it cannot be.
 */
function xs_hb_start(string $id, bool $ares, ?string &$why = null): bool
{
    $why = null;
    $g = xs_hb_list()[$id] ?? null;
    if ($g === null) {
        $why = 'that game is not on the list';
        return false;
    }
    if ((xs_hb_job()['state'] ?? '') === 'running') {
        $why = (string) (xs_hb_job()['name'] ?? 'a game') . ' is on its way already: that has to finish first';
        return false;
    }
    $had = (string) (xs_hb_got()[$id]['game'] ?? '');
    if ($had !== '' && in_array($had, array_column(xs_library()['games'] ?? [], 'id'), true)) {
        $why = $g['name'] . ' is in your library already';
        return false;
    }
    // A hidden game is out of xs_library(), so it is asked for apart: a second Get would only make a second copy.
    if ($had !== '' && isset(xs_hidden_games()[$had])) {
        $why = $g['name'] . ' is in your library, hidden from Xsegon: Settings > Library shows it again';
        return false;
    }
    // Fetched before but not taken into the library: the same.
    $file = (string) (xs_hb_got()[$id]['file'] ?? '');
    if ($file !== '' && is_file($file)) {
        $why = $g['name'] . ' is at ' . $file . ' already, not in your library yet: Scan for Games brings it in';
        return false;
    }
    if (xs_curl_exe() === '') {
        $why = 'Windows\' own curl.exe is not on this PC (it comes with Windows 10 from 2018 on), and that is what downloads it';
        return false;
    }
    $needs = ($g['emulator'] ?? '') === 'ares' && xs_hb_ares_key(xs_emulators()) === null;
    if ($needs && !$ares) {
        $why = $g['name'] . ' plays in ares, which is not on this PC yet';
        return false;
    }
    $job = ['state' => 'running', 'phase' => 'starting', 'started' => time(), 'game' => $id, 'name' => (string) $g['name'],
            'console' => (string) $g['console'], 'ares' => $needs, 'bytes' => 0, 'total' => 0, 'said' => ''];
    @unlink(xs_hb_stop_path());
    if (!xs_write_json(xs_hb_job_path(), $job, $why)) {
        return false;
    }
    $cmd = [xs_php_exe(), '-d', 'display_errors=0', '-d', 'display_startup_errors=0', '-d', 'date.timezone=' . date_default_timezone_get(),
            XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'homebrew.php', '--server=http://127.0.0.1:' . (int) ($_SERVER['SERVER_PORT'] ?? 0)];
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        $why = 'the worker that fetches it could not be started';
        xs_write_json(xs_hb_job_path(), ['state' => 'failed', 'error' => $why] + $job);
        return false;
    }
    pclose($h);
    xs_log('HBRW', 'get ' . $g['name'] . ' asked' . ($needs ? ', with ares' : ''));
    return true;
}
