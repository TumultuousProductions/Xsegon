<?php
/**
 * The phone page, as the Connect a phone window on the TV sees and sets it.
 *
 * GET  /api/phone.php[?square=1][&windows=1]
 *      The switch, the address, whether the phone page answers, the phones
 *      let in. square=1 also makes a new code and gives the link the square
 *      holds (the old square stops working). windows=1 also asks what
 *      Windows' firewall allows, which takes a few seconds.
 * POST {"op":"on"} | {"op":"off"}              the switch; "by" names the phone that pressed Disconnect
 * POST {"op":"forget","id":"<phone>"}          one phone out; with no id, every one
 * POST {"op":"allow"}                          Windows is asked, behind its shield question
 * POST {"op":"join","code":"..","ua":".."}     the phone server's alone: the square's code for a key
 *
 * This is the main server, which answers this PC only: a phone never reaches
 * it. What a phone may ask is router-phone.php.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/phone.php';

/** What Windows' firewall allows for the phone page. Slow, so only when asked for. */
function xs_phone_windows(array $p): array
{
    if (xs_test_copy()) {
        return ['kind' => 'test', 'open' => true, 'why' => 'a test copy answers this PC only'];
    }
    $script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'phone-windows.ps1';
    $raw = @shell_exec('powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' . escapeshellarg($script)
        . ' -Php ' . escapeshellarg(xs_php_exe()) . ' -Address ' . escapeshellarg($p['address']) . ' -Port ' . (int) $p['port'] . ' 2>NUL');
    $a = json_decode(trim((string) $raw), true);
    if (!is_array($a) || !array_key_exists('open', $a)) {
        return ['kind' => 'unknown', 'open' => null, 'why' => 'Windows would not say what it allows'];
    }
    // told: the name Windows' own list has a No under, which only that list takes back (js\phone.js says the way).
    return ['kind' => (string) ($a['kind'] ?? 'unknown'), 'open' => $a['open'] === null ? null : (bool) $a['open'], 'why' => (string) ($a['why'] ?? ''),
            'told' => (string) ($a['told'] ?? '')];
}

/** $up is the caller's own look (xs_phone_ensure): the phone server is asked once a request, not twice. */
function xs_phone_view(array $p, bool $up, bool $square, bool $windows): array
{
    $a = [
        'ok'      => true,
        'on'      => $p['on'],
        'up'      => $up,
        'stays'   => xs_phone_stays(),
        'address' => $p['address'],
        'port'    => $p['port'],
        'codeSec' => XS_PHONE_CODE_SEC,
        'seen'    => ((int) @filemtime(xs_data_path('phone-seen'))) ?: null,
        'phones'  => array_map(static fn(array $ph): array => ['id' => (string) ($ph['id'] ?? ''), 'name' => (string) ($ph['name'] ?? ''),
                                                                 'added' => (int) ($ph['added'] ?? 0)], $p['phones']),
    ];
    if ($p['on'] && !$up) {
        $a['why'] = xs_phone_address() === '' ? 'This PC is on no home network: join the Wi-Fi, then switch it on again.' : 'The phone page is starting.';
    }
    if ($square && $p['on'] && $up) {
        $a['link'] = 'http://' . $p['address'] . ':' . $p['port'] . '/?c=' . xs_phone_new_code();
    }
    if ($windows && $p['on'] && $p['address'] !== '') {
        $a['windows'] = xs_phone_windows($p);
    }
    return $a;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $p = xs_phone_ensure($up);
    xs_json(xs_phone_view($p, (bool) $up, ($_GET['square'] ?? '') === '1', ($_GET['windows'] ?? '') === '1'));
}

xs_post_only();
$body = xs_body();
$op = (string) ($body['op'] ?? '');

if ($op === 'join') {
    $why = null;
    $key = xs_phone_join((string) ($body['code'] ?? ''), (string) ($body['ua'] ?? ''), $why);
    if ($key === null) {
        xs_json(['ok' => false, 'error' => $why], 403);
    }
    xs_json(['ok' => true, 'key' => $key, 'name' => xs_phone_name((string) ($body['ua'] ?? ''))]);
}
if ($op === 'on' || $op === 'off') {
    $p = xs_phone_read();
    if ($p['on'] !== ($op === 'on')) {
        $p['on'] = $op === 'on';
        $p['tried'] = 0;                           // a press is tried at once, whatever was tried a moment ago
        $p['mainPid'] = getmypid();
        if (!xs_phone_write($p)) {
            xs_fail('the switch could not be saved', 500);
        }
        // "by": the phone that pressed Disconnect (router-phone.php), named by what it is.
        $by = substr((string) ($body['by'] ?? ''), 0, 80);
        xs_log('PHONE', 'switched ' . $op . ($by !== '' ? ' from the phone (' . $by . ')' : ' in the Connect a phone window'));
    }
    $p = xs_phone_ensure($up);                     // off: it looks once, says so in the log, and leaves the stop mark
    if ($op === 'off') {
        @touch(xs_data_path('phone-stop'));        // also where the switch was off already
    }
    xs_json(xs_phone_view($p, (bool) $up, false, false));
}
if ($op === 'forget') {
    $id = isset($body['id']) && $body['id'] !== '' ? (string) $body['id'] : null;
    $n = xs_phone_forget($id);
    $p = xs_phone_read();
    xs_json(['ok' => true, 'forgot' => $n] + xs_phone_view($p, $p['on'] && xs_phone_lane_up($p), false, false));
}
if ($op === 'allow') {
    $p = xs_phone_read();
    if (xs_test_copy() || $p['port'] <= 0) {
        xs_json(['ok' => true, 'asked' => false]);
    }
    $ok = xs_spawn_ps(xs_ps_call(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'phone-windows.ps1',
        ['Php' => xs_php_exe(), 'Port' => $p['port'], 'Ask' => true]), ['hidden' => true]);
    xs_log('PHONE', $ok ? 'asking Windows to let phones in (the shield question)' : 'Windows could not be asked');
    xs_json(['ok' => $ok, 'asked' => $ok]);
}
xs_fail('unknown op');
