<?php
/**
 * The phone page, from the main server's side.
 * router-phone.php says what a phone may ask and what keeps that safe.
 *
 * A third `php -S`, on the home network's address and never on any other,
 * started when Connect a phone... is switched on and stopped when it goes off or the
 * main server ends (bin\phonelane.ps1). What is kept is data\phone.json,
 * which only the main server writes: the switch, the port, the phones let in
 * (each one's key, kept as its sum) and the code in the square (it works
 * once, for two minutes).
 */
declare(strict_types=1);

require_once __DIR__ . '/settings.php';

const XS_PHONE_CODE_SEC = 120;     // how long the square's code works
const XS_PHONE_IDLE_MIN = 30;      // "off by itself": this long with no phone asking
const XS_PHONE_MOST     = 20;      // phones remembered; the one let in longest ago goes first
const XS_PHONE_BUSY_SEC = 30;      // silent for longer is not at work (a start takes 20 at most): ended, and started again

function xs_phone_file(): string
{
    return xs_data_path('phone.json');
}

function xs_phone_read(): array
{
    $p = xs_read_json(xs_phone_file(), []);
    $p = is_array($p) ? $p : [];
    return [
        'on'      => !empty($p['on']),
        'address' => (string) ($p['address'] ?? ''),
        'port'    => (int) ($p['port'] ?? 0),
        'mainPid' => (int) ($p['mainPid'] ?? 0),
        'tried'   => (int) ($p['tried'] ?? 0),
        'busy'    => (int) ($p['busy'] ?? 0),
        'mark'    => (string) ($p['mark'] ?? ''),
        'phones'  => array_values(array_filter((array) ($p['phones'] ?? []), 'is_array')),
        'code'    => is_array($p['code'] ?? null) ? $p['code'] : null,
    ];
}

function xs_phone_write(array $p): bool
{
    if ($p['mark'] === '') {
        $p['mark'] = bin2hex(random_bytes(8));     // how the main server knows its own phone server
    }
    return xs_write_json(xs_phone_file(), $p);
}

/** How long it stays open once switched on: 'on' (until switched off), 'close' (until Xsegon closes), 'idle'. */
function xs_phone_stays(): string
{
    $v = (string) (xs_settings()['window']['phoneStays'] ?? 'on');
    return in_array($v, ['on', 'close', 'idle'], true) ? $v : 'on';
}

/** A home network's own ranges: not Tailscale's (100.64 and up), not a dead one (169.254). */
function xs_phone_home_like(string $ip): bool
{
    return (bool) preg_match('/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)\d/', $ip);
}

/**
 * The address a phone is given: the one this PC reaches the internet through,
 * found by asking Windows which it would use (no packet is sent), else the
 * likeliest of the PC's own. '' when the PC is on no home network.
 */
function xs_phone_address(): string
{
    if (xs_test_copy()) {
        return '127.0.0.1';                        // a test's phone is this PC itself
    }
    $s = @stream_socket_client('udp://192.0.2.1:9', $no, $err, 1.0);
    if ($s !== false) {
        $name = (string) stream_socket_get_name($s, false);
        fclose($s);
        $ip = substr($name, 0, (int) strrpos($name, ':'));
        if (xs_phone_home_like($ip)) {
            return $ip;
        }
    }
    $mine = array_values(array_filter((array) @gethostbynamel((string) gethostname()), 'xs_phone_home_like'));
    usort($mine, static fn($a, $b) => strcmp(str_starts_with($a, '192.') ? '0' : ($a[1] === '0' ? '1' : '2'),
                                              str_starts_with($b, '192.') ? '0' : ($b[1] === '0' ? '1' : '2')));
    return (string) ($mine[0] ?? '');
}

/** A port that opens here. Tried on this PC's own loopback, so Windows is asked nothing yet. */
function xs_phone_port(int $kept): int
{
    $base = (int) ($_SERVER['SERVER_PORT'] ?? 8099) + 2;
    foreach (array_merge($kept > 0 ? [$kept] : [], range($base, $base + 9)) as $port) {
        $s = @stream_socket_server('tcp://127.0.0.1:' . $port, $no, $err);
        if ($s !== false) {
            fclose($s);
            return $port;
        }
    }
    return 0;
}

/** How this folder's own phone server stands at that address: 'up', 'busy' (there, and slow to say so) or 'gone'. */
function xs_phone_lane(array $p): string
{
    // One started for another main server is not this one's, whatever its mark: a data folder that was
    // copied (a test's, a second Xsegon's) carries the mark along with everything else.
    if ($p['address'] === '' || $p['port'] <= 0 || $p['mainPid'] !== getmypid()) {
        return 'gone';
    }
    // Windows takes the whole wait to say that nobody holds a port, so the door is tried first with a
    // short one: a server that is there opens it at once, however busy it is.
    $at = $p['address'] . ':' . $p['port'];
    $s = @stream_socket_client('tcp://' . $at, $no, $err, 0.25);
    if ($s === false) {
        return 'gone';
    }
    stream_set_timeout($s, 1, 500000);
    fwrite($s, "GET /p/hello HTTP/1.0\r\nHost: " . $at . "\r\nConnection: close\r\n\r\n");
    $raw  = (string) stream_get_contents($s);
    $late = !empty(stream_get_meta_data($s)['timed_out']);
    fclose($s);
    // The door opened and nothing was said in time: at work on a phone's request. Started again, it would be two.
    if ($late && $raw === '') {
        return 'busy';
    }
    $cut = strpos($raw, "\r\n\r\n");
    $a = $cut === false ? null : json_decode(substr($raw, $cut + 4), true);
    return is_array($a) && ($a['lane'] ?? '') === 'phone' && $p['mark'] !== ''
        && hash_equals(hash('sha256', $p['mark'] . '|hello'), (string) ($a['mark'] ?? '')) ? 'up' : 'gone';
}

/** Whether this folder's own phone server is there at that address, busy or not. */
function xs_phone_lane_up(array $p): bool
{
    return xs_phone_lane($p) !== 'gone';
}

/** A phone and its browser, as the Connect a phone window lists it. */
function xs_phone_name(string $ua): string
{
    $what = 'A browser';
    if (preg_match('/iPhone|iPad|iPod/', $ua, $m)) {
        $what = $m[0];
    } elseif (preg_match('/Android [\d.]+/', $ua, $m)) {
        $what = $m[0];
    } elseif (preg_match('/Windows NT|Macintosh|Linux/', $ua, $m)) {
        $what = $m[0] === 'Windows NT' ? 'A Windows PC' : $m[0];
    }
    $with = '';
    if (preg_match('/(CriOS|FxiOS|EdgA|EdgiOS|SamsungBrowser|Firefox|Edg|Chrome)\/(\d+)/', $ua, $m)) {
        $names = ['CriOS' => 'Chrome', 'FxiOS' => 'Firefox', 'EdgA' => 'Edge', 'EdgiOS' => 'Edge', 'Edg' => 'Edge', 'SamsungBrowser' => 'Samsung Internet'];
        $with = ($names[$m[1]] ?? $m[1]) . ' ' . $m[2];
    } elseif (preg_match('/Version\/(\d+).*Safari/', $ua, $m)) {
        $with = 'Safari ' . $m[1];
    }
    return $with === '' ? $what : $what . ', ' . $with;
}

/**
 * The switch made true on the screen: with it on the phone server runs, with
 * it off it does not. Called as the page loads and at every press in the
 * Connect a phone window. Gives back what was read, as it now stands, and
 * in $up whether the phone server is there.
 */
function xs_phone_ensure(?bool &$up = null): array
{
    $p = xs_phone_read();
    $was = $p;
    $stop = xs_data_path('phone-stop');
    // "Off by itself": the minder closed it and left word (bin\phonelane.ps1).
    $closed = xs_data_path('phone-closed');
    if (is_file($closed)) {
        @unlink($closed);
        if ($p['on']) {
            $p['on'] = false;
            xs_log('PHONE', 'switched off by itself: no phone asked for ' . XS_PHONE_IDLE_MIN . ' minutes');
        }
    }
    // "Until Xsegon closes": on for another main server than this one.
    if ($p['on'] && xs_phone_stays() === 'close' && $p['mainPid'] !== 0 && $p['mainPid'] !== getmypid()) {
        $p['on'] = false;
        xs_log('PHONE', 'switched off: Xsegon was closed since it was switched on');
    }
    $up = false;
    if ($p['on']) {
        $lane = xs_phone_lane($p);
        $up = $lane !== 'gone';
        if ($lane !== 'busy') {
            $p['busy'] = 0;
        } elseif ($p['busy'] === 0) {
            $p['busy'] = time();
            xs_log('PHONE', 'the phone page did not answer in time: it is busy, and left as it is');
        } elseif (time() - $p['busy'] > XS_PHONE_BUSY_SEC) {
            // Silent this long is not at work. Its minder ends it on the stop mark, and the look after
            // this one finds the port free and starts a new one (which takes the mark away).
            @touch($stop);
            $p['busy'] = 0;
            xs_log('PHONE', 'the phone page has not answered for ' . XS_PHONE_BUSY_SEC . ' seconds: it is closed, and the next look starts it again');
        }
    } elseif ($p['mainPid'] === getmypid() && !is_file($stop)) {
        // Off under this main server and not yet seen to: asked once. The stop mark then stands for the answer,
        // so no page load after it waits on an empty port.
        $up = xs_phone_lane_up($p);
        @touch($stop);                             // also for one still starting, which nothing answers for yet
        if ($up) {
            xs_log('PHONE', 'closing the phone page');     // its minder ends it within two seconds
        }
    }
    if (!$p['on']) {
        $p['busy'] = 0;
    }
    if ($p['on'] && !$up && $p['tried'] <= time() - 20) {
        $addr = xs_phone_address();
        $port = $addr === '' ? 0 : xs_phone_port($p['port']);
        $p['tried'] = time();
        if ($addr === '' || $port === 0) {
            xs_log('PHONE', $addr === '' ? 'not opened: this PC is on no home network' : 'not opened: no port near ' . ((int) ($_SERVER['SERVER_PORT'] ?? 8099) + 2) . ' would open');
        } else {
            if ($p['address'] !== '' && $p['address'] !== $addr) {
                xs_log('PHONE', 'this PC\'s address changed from ' . $p['address'] . ' to ' . $addr . ': each phone scans the square again');
            }
            $p['address'] = $addr;
            $p['port'] = $port;
            $p['mainPid'] = getmypid();
            $p['mark'] = bin2hex(random_bytes(8));     // a new one at every start, so no earlier or copied server passes for this one
            xs_phone_write($p);                    // the mark has to be on the disk before the phone server reads it
            $p = xs_phone_read();
            @unlink($stop);
            $cache = (string) ini_get('opcache.cache_id');
            $ok = xs_spawn_ps(xs_ps_call(XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'phonelane.ps1', [
                'Php'      => xs_php_exe(),
                'Address'  => $addr,
                'Port'     => $port,
                'MainPid'  => getmypid(),
                'MainPort' => (int) ($_SERVER['SERVER_PORT'] ?? 8099),
                'Mark'     => $p['mark'],
                'CacheId'  => ($cache !== '' ? $cache : 'xsegon-' . substr(md5(strtolower(XS_ROOT)), 0, 12)) . '-phone',
                'IdleMin'  => xs_phone_stays() === 'idle' ? XS_PHONE_IDLE_MIN : 0,
            ]), ['hidden' => true]);
            xs_log('PHONE', $ok ? 'opening the phone page at ' . $addr . ':' . $port : 'the phone page could not be started');
        }
    }
    if ($p != $was) {
        xs_phone_write($p);
    }
    return $p;
}

/** A new code for the square: the old one stops working. Kept as its sum; the code itself is only ever in the square. */
function xs_phone_new_code(): string
{
    $p = xs_phone_read();
    $code = bin2hex(random_bytes(8));
    $p['code'] = ['sum' => hash('sha256', $code), 'until' => time() + XS_PHONE_CODE_SEC, 'tries' => 0];
    xs_phone_write($p);
    return $code;
}

/** A phone hands in the square's code: its key, or null with the reason. The key is given once and kept here as its sum. */
function xs_phone_join(string $code, string $ua, ?string &$why = null): ?string
{
    $p = xs_phone_read();
    $c = $p['code'];
    $name = xs_phone_name($ua);
    if (!$p['on']) {
        $why = 'the phone page is switched off';
    } elseif ($c === null || (int) ($c['until'] ?? 0) < time()) {
        $why = 'that square is no longer good: on the TV, open Connect a phone... and scan the new one';
    } elseif (!hash_equals((string) ($c['sum'] ?? ''), hash('sha256', $code))) {
        $c['tries'] = (int) ($c['tries'] ?? 0) + 1;
        $p['code'] = $c['tries'] >= 5 ? null : $c;       // five wrong ones and the square is spent
        xs_phone_write($p);
        $why = 'that is not the code in the square';
    }
    if ($why !== null) {
        xs_log('PHONE', 'not let in (' . $name . '): ' . $why);
        return null;
    }
    $key = bin2hex(random_bytes(32));
    $sum = hash('sha256', $key);
    $p['code'] = null;                                   // it worked once
    $p['phones'][] = ['id' => substr($sum, 0, 8), 'name' => $name, 'key' => $sum, 'added' => time()];
    usort($p['phones'], static fn($a, $b) => (int) ($b['added'] ?? 0) <=> (int) ($a['added'] ?? 0));
    $p['phones'] = array_slice($p['phones'], 0, XS_PHONE_MOST);
    if (!xs_phone_write($p)) {
        $why = 'the PC could not write the phone down';
        return null;
    }
    xs_log('PHONE', 'let in: ' . $name . ' (' . substr($sum, 0, 8) . '), ' . count($p['phones']) . ' in all');
    return $key;
}

/** The phone a key belongs to, or null. Read only: the phone server asks this at every request. */
function xs_phone_by_key(string $key): ?array
{
    if (!preg_match('/^[0-9a-f]{64}$/', $key)) {
        return null;
    }
    $sum = hash('sha256', $key);
    foreach (xs_phone_read()['phones'] as $ph) {
        if (hash_equals((string) ($ph['key'] ?? ''), $sum)) {
            return $ph;
        }
    }
    return null;
}

/** One phone out, or with no id every one. How many went. */
function xs_phone_forget(?string $id): int
{
    $p = xs_phone_read();
    $keep = $id === null ? [] : array_values(array_filter($p['phones'], static fn($ph) => ($ph['id'] ?? '') !== $id));
    $n = count($p['phones']) - count($keep);
    if ($n > 0) {
        $p['phones'] = $keep;
        xs_phone_write($p);
        xs_log('PHONE', 'forgot ' . ($id === null ? 'every phone (' . $n . ')' : 'one phone (' . $id . ')'));
    }
    return $n;
}
