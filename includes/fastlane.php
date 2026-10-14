<?php
/**
 * The fast lane, from the main server's side; router-fast.php says what it is.
 *
 * Started when the page loads (index.php), however the main server was started.
 * bin\fastlane.ps1 stops it when the main server ends. The page is told of it only once
 * it proves to be this folder's own lane; a port held by anything else is left alone.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

function xs_fast_lane_port(): int
{
    return (int) ($_SERVER['SERVER_PORT'] ?? 8099) + (xs_fast_lane() ? 0 : 1);
}

/** Whether something answers on 127.0.0.1:$port, in at most $wait seconds. */
function xs_port_open(int $port, float $wait = 0.15): bool
{
    $s = @fsockopen('127.0.0.1', $port, $no, $err, $wait);
    if ($s === false) {
        return false;
    }
    fclose($s);
    return true;
}

/**
 * From the fast lane: whether the main server is there at all (a busy one still takes the
 * connection). A "no" counts as a missed poll, so the offline screen still comes up.
 */
function xs_main_server_up(): bool
{
    return xs_port_open((int) ($_SERVER['SERVER_PORT'] ?? 8100) - 1, 0.3);
}

/**
 * From the fast lane: what the main server has been on for three seconds or more, or
 * null, from data\main-busy (written in includes\boot.php).
 */
function xs_main_busy(): ?array
{
    $raw = @file_get_contents(xs_data_path('main-busy'));
    if (!is_string($raw) || $raw === '') {
        return null;
    }
    [$at, , $path] = array_pad(explode('|', $raw, 3), 3, '');
    $sec = time() - (int) $at;
    return $sec >= 3 ? ['sec' => $sec, 'what' => basename((string) $path) ?: '?'] : null;
}

/**
 * 'ours' (this folder's fast lane answers), 'down' (nothing on the port) or
 * 'other' (something else holds it: another program, another Xsegon).
 */
function xs_fast_lane_state(): string
{
    $port = xs_fast_lane_port();
    if (!xs_port_open($port)) {
        return 'down';
    }
    $ctx = stream_context_create(['http' => ['timeout' => 1.0, 'ignore_errors' => true]]);
    $raw = @file_get_contents('http://127.0.0.1:' . $port . '/api/lane.php', false, $ctx);
    $a = is_string($raw) ? json_decode($raw, true) : null;
    $ours = is_array($a) && ($a['app'] ?? '') === 'xsegon' && ($a['lane'] ?? '') === 'fast'
         && ($a['id'] ?? '') === md5(strtolower(XS_ROOT));
    $GLOBALS['xs_lane_pid'] = $ours ? (int) ($a['pid'] ?? 0) : 0;
    return $ours ? 'ours' : 'other';
}

/**
 * The fast lane's address for the page, started first if needed; null when its port is
 * held by something else or a start was tried in the last minute. The page falls back meanwhile.
 */
function xs_fast_lane_url(): ?string
{
    if (PHP_OS_FAMILY !== 'Windows' || xs_fast_lane()) {
        return null;
    }
    $port = xs_fast_lane_port();
    $url = 'http://127.0.0.1:' . $port;
    $state = xs_fast_lane_state();
    $mark = xs_data_path('fastlane.json');
    $last = xs_read_json($mark, []);
    $said = is_array($last) ? $last : [];
    if ($state === 'ours') {
        /* A lane started for another main server outlives its minder when that console is
           closed: it is ended here and a new one started below. */
        $for = (int) ($said['mainPid'] ?? 0);
        $lanePid = (int) ($GLOBALS['xs_lane_pid'] ?? 0);
        if ($for === 0 || $for === getmypid() || $lanePid <= 0) {
            return $url;
        }
        @shell_exec('taskkill /PID ' . $lanePid . ' /F 2>NUL');
        xs_log('LANE', 'a fast lane left by an earlier main server (process ' . $for . ') was still running (process ' . $lanePid . '): ended, and a new one is started');
        $said['tried'] = 0;
        $state = 'down';
    }
    if ($state === 'other') {
        if (($said['other'] ?? 0) < time() - 3600) {       // once an hour, not every page load
            xs_log('LANE', 'port ' . $port . ' is held by something that is not this Xsegon\'s fast lane; the page uses the main server only');
            $said['other'] = time();
            xs_write_json($mark, $said);
        }
        return null;
    }
    // Down: started at most once a minute, not on every page load.
    if (($said['tried'] ?? 0) > time() - 60) {
        // Logged once per wait, so a lane that will not come up is not silent.
        if (($said['waitSaid'] ?? 0) !== ($said['tried'] ?? 0)) {
            xs_log('LANE', 'the fast lane is not running and was started under a minute ago; the page uses the main server until it is tried again');
            $said['waitSaid'] = $said['tried'];
            xs_write_json($mark, $said);
        }
        return null;
    }
    $said['tried'] = time();
    $said['mainPid'] = getmypid();
    xs_write_json($mark, $said);
    $script = XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'fastlane.ps1';
    $cache = (string) ini_get('opcache.cache_id');
    $ok = xs_spawn_ps(xs_ps_call($script, [
        'Php'      => xs_php_exe(),
        'Port'     => $port,
        'MainPid'  => getmypid(),
        'CacheId'  => ($cache !== '' ? $cache : 'xsegon-' . substr(md5(strtolower(XS_ROOT)), 0, 12)) . '-fast',
        'CaFile'   => xs_utf8_path((string) ini_get('openssl.cafile')) ?: null,
        'Ffi'      => extension_loaded('ffi'),
    ]), ['hidden' => true]);
    xs_log('LANE', $ok ? 'starting the fast lane on port ' . $port : 'could not start the fast lane; the page uses the main server only');
    return $ok ? $url : null;
}
