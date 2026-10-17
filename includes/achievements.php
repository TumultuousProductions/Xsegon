<?php
/**
 * Xsegon - RetroAchievements (roadmap AX). RetroArch earns them, signed in
 * through its own Settings > Achievements; Xsegon reads.
 *
 *   data\achievements.json   the person's site key, sealed to this computer,
 *                            and the last answer about their account
 *
 * RetroArch's password and token are only ever looked at for being there:
 * neither is returned, logged or kept by Xsegon.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/retroarch.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/emuadd.php';
require_once __DIR__ . '/screenscraper.php';   // the sealing: xs_ss_seal, xs_ss_unseal, xs_ss_pc_key

function xs_ach_path(): string
{
    return xs_data_path('achievements.json');
}

/** The settings file of the RetroArch the emulator table starts, or null. */
function xs_ach_ra_cfg(): ?string
{
    $table = xs_emulators();
    foreach ($table['programs'] ?? [] as $key => $p) {
        $exe = (string) ($p['exe'] ?? '');
        if ($exe !== '' && xs_emu_is_retroarch($table, (string) $key) && ($cfg = ra_config_path($exe)) !== null) {
            return $cfg;
        }
    }
    return null;
}

/**
 * What RetroArch's own sign-in says. 'step' is what the person does next:
 * none (no RetroArch settings found), signin (no name, or neither password
 * nor token), finish (a password but no token yet: one game in RetroArch by
 * itself swaps it), off (signed in, achievements switched off), ready.
 * A test copy reads data\fixtures\ra-cheevos.json instead, and with none is
 * not signed in: its library starts the person's real RetroArch, whose sign-in
 * must not change what the other groups' starts answer.
 */
function xs_ach_ra_state(?string $cfg = null): array
{
    if (xs_test_copy()) {
        $k = (array) xs_read_json(xs_data_path('fixtures' . DIRECTORY_SEPARATOR . 'ra-cheevos.json'), []);
        $there = true;
    } else {
        $cfg = $cfg ?? xs_ach_ra_cfg();
        $k = ra_cfg_keys($cfg, ['cheevos_enable', 'cheevos_username', 'cheevos_hardcore_mode_enable', 'cheevos_password', 'cheevos_token']);
        $there = $cfg !== null;
    }
    $name     = trim((string) ($k['cheevos_username'] ?? ''));
    $password = (string) ($k['cheevos_password'] ?? '') !== '';
    $token    = (string) ($k['cheevos_token'] ?? '') !== '';
    $on       = ($k['cheevos_enable'] ?? 'false') === 'true';
    // RetroArch's own default is on, so a file without the line plays hardcore.
    $hardcore = ($k['cheevos_hardcore_mode_enable'] ?? 'true') !== 'false';
    unset($k);
    $step = !$there ? 'none'
          : ($name === '' || (!$token && !$password) ? 'signin'
          : (!$token ? 'finish' : (!$on ? 'off' : 'ready')));
    return ['there' => $there, 'on' => $on, 'name' => $name, 'hardcore' => $hardcore,
            'password' => $password, 'token' => $token, 'step' => $step,
            // What a start meets: RetroArch signs in and refuses saves and cheats.
            'hardcoreOn' => $on && $name !== '' && ($token || $password) && $hardcore];
}

/** The key the site's own sealing uses here: ScreenScraper's computer key, turned for this file. */
function xs_ach_pc_key(): string
{
    return hash('sha256', xs_ss_pc_key() . '|retroachievements', true);
}

/** The person's site key, or null when none is kept or it was sealed on another computer. */
function xs_ach_key(): ?string
{
    $sealed = (string) (xs_read_json(xs_ach_path(), [])['key'] ?? '');
    return $sealed === '' ? null : xs_ss_unseal($sealed, xs_ach_pc_key());
}

/** A key as the site gives them: letters and digits only, so it can never break an address. */
function xs_ach_key_valid(string $key): bool
{
    return preg_match('/^[A-Za-z0-9]{16,64}$/', $key) === 1;
}

/** Keep (or with null, drop) the key and the last account answer. */
function xs_ach_keep(?string $key, ?array $user, ?string &$why = null): bool
{
    $d = [];
    if ($key !== null) {
        $d['key'] = xs_ss_seal($key, xs_ach_pc_key());
    }
    if ($user !== null) {
        $d['user'] = $user;
    }
    if (!$d) {
        return !is_file(xs_ach_path()) || @unlink(xs_ach_path());
    }
    return xs_write_json(xs_ach_path(), $d, $why);
}

/**
 * Where the site's API is. A test copy asks only the stand-in its
 * data\fixtures\ra-api.txt names (tests\t-achievements.js serves it), and
 * with none asks nothing: '' reads as no answer.
 */
function xs_ach_api(): string
{
    if (!xs_test_copy()) {
        return 'https://retroachievements.org/API/';
    }
    $fx = xs_data_path('fixtures' . DIRECTORY_SEPARATOR . 'ra-api.txt');
    $test = is_file($fx) ? trim((string) file_get_contents($fx)) : '';
    return $test !== '' ? rtrim($test, '/') . '/' : '';
}

/**
 * One question to the site: ['ok', 'status', 'data', 'error']. The address
 * carries the key, so neither is ever logged: only what was asked, the
 * answer's status and how long it took.
 */
function xs_ach_ask(string $what, array $params, string $key): array
{
    $t0  = microtime(true);
    $api = xs_ach_api();
    $got = $api === '' ? null : xs_ss_fetch($api . 'API_' . $what . '.php?' . http_build_query($params + ['y' => $key]), 12);
    $ms  = (int) round((microtime(true) - $t0) * 1000);
    $status = $got['status'] ?? 0;
    xs_log('ACH', 'asked ' . $what . ': ' . ($got === null ? 'no answer' : 'HTTP ' . $status) . ' in ' . $ms . ' ms');
    $data = $got === null ? null : json_decode((string) $got['body'], true);
    $error = $got === null ? 'RetroAchievements did not answer (is the internet on?)'
           : ($status === 401 ? 'RetroAchievements did not take that key: copy it again from the site (your name, Settings, Keys)'
           : ($status === 404 ? 'RetroAchievements has no member called ' . (string) ($params['u'] ?? '') . ' (the name RetroArch is signed in with)'
           : ($status === 429 ? 'RetroAchievements asked Xsegon to slow down: try again in a minute'
           : ($status !== 200 ? 'RetroAchievements answered with a fault (' . $status . ')'
           : (!is_array($data) ? 'RetroAchievements answered with something Xsegon cannot read' : null)))));
    return ['ok' => $error === null, 'status' => $status, 'data' => $data, 'error' => $error];
}

/**
 * Ask the site who the name RetroArch is signed in with is, with $key or the
 * kept one. Kept on an answer, so the offline road has the last one.
 * ['ok' => true, 'user' => [...]] or ['ok' => false, 'error' => ..., 'status' => n].
 */
function xs_ach_check(array $ra, ?string $key = null): array
{
    $key = $key ?? xs_ach_key();
    if ($key === null) {
        return ['ok' => false, 'status' => 0, 'error' => 'no key yet: paste yours from the site first'];
    }
    if ($ra['name'] === '') {
        return ['ok' => false, 'status' => 0, 'error' => 'RetroArch is not signed in yet, so there is no name to look up'];
    }
    $r = xs_ach_ask('GetUserProfile', ['u' => $ra['name']], $key);
    if (!$r['ok']) {
        return ['ok' => false, 'status' => $r['status'], 'error' => $r['error']];
    }
    $p = $r['data'];
    $user = ['name' => (string) ($p['User'] ?? $ra['name']), 'points' => (int) ($p['TotalPoints'] ?? 0),
             'softPoints' => (int) ($p['TotalSoftcorePoints'] ?? 0), 'playing' => (string) ($p['RichPresenceMsg'] ?? ''),
             'at' => date('c')];
    xs_log('ACH', 'the account answered: ' . $user['points'] . ' hardcore points, ' . $user['softPoints'] . ' softcore');
    return ['ok' => true, 'user' => $user];
}

/** What the page is told: RetroArch's sign-in as yes or no words, whether a key is kept, the last answer. */
function xs_ach_public(?array $ra = null): array
{
    $ra = $ra ?? xs_ach_ra_state();
    $d  = xs_read_json(xs_ach_path(), []);
    return ['ra' => $ra, 'key' => xs_ach_key() !== null, 'keyElsewhere' => (string) ($d['key'] ?? '') !== '' && xs_ach_key() === null,
            'user' => is_array($d['user'] ?? null) ? $d['user'] : null];
}
