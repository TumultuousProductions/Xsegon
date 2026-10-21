<?php
/**
 * Xsegon - several addresses fetched side by side, each by its own curl.exe (Windows' own),
 * for a worker in bin\ that brings files in the background.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/**
 * $want: [key => ['url', 'to', 'lane']]. At most $side at once and $perLane per lane,
 * as a set sits on one or two servers. $each(key, ok, why) as each ends; $look(the files
 * being written) between, false to stop: then nothing half written is left. False when stopped.
 */
function xs_curl_many(array $want, int $side, int $perLane, callable $each, callable $look): bool
{
    $curl  = xs_curl_exe();
    $going = [];
    while ($want || $going) {
        foreach ($want as $key => $w) {
            if (count($going) >= $side) {
                break;
            }
            if (count(array_filter($going, static fn ($g) => $g['lane'] === $w['lane'])) >= $perLane) {
                continue;
            }
            unset($want[$key]);
            @unlink($w['to']);
            // Given up only when nothing comes for a minute: no limit on the whole of a file.
            $proc = $curl === '' ? false : @proc_open([$curl, '-L', '--fail', '--silent', '--show-error', '--retry', '2', '--connect-timeout', '20',
                                '--speed-limit', '1024', '--speed-time', '60', '-A', 'Xsegon', '-o', $w['to'], $w['url']],
                [0 => ['file', 'NUL', 'r'], 1 => ['file', 'NUL', 'w'], 2 => ['file', $w['to'] . '.err', 'w']], $pipes, null, null, ['bypass_shell' => true]);
            if (!is_resource($proc)) {
                $each($key, false, 'curl.exe could not be started');
                continue;
            }
            $going[$key] = ['proc' => $proc, 'to' => $w['to'], 'lane' => $w['lane']];
        }
        foreach ($going as $key => $g) {
            $st = proc_get_status($g['proc']);
            if ($st['running']) {
                continue;
            }
            proc_close($g['proc']);
            unset($going[$key]);
            // curl writes a line for each of its tries: the last is why it gave up.
            $lines = preg_split('/\R/', trim((string) @file_get_contents($g['to'] . '.err'))) ?: [''];
            $said  = trim((string) end($lines));
            @unlink($g['to'] . '.err');
            clearstatcache(true, $g['to']);
            $ok = (int) $st['exitcode'] === 0 && is_file($g['to']) && (int) filesize($g['to']) > 0;
            $each($key, $ok, $said !== '' ? mb_substr($said, 0, 200) : 'curl ended with ' . (int) $st['exitcode']);
        }
        if (!$look(array_column($going, 'to'))) {
            foreach ($going as $g) {
                proc_terminate($g['proc']);
                proc_close($g['proc']);
                @unlink($g['to']);
                @unlink($g['to'] . '.err');
            }
            return false;
        }
        usleep(100000);
    }
    return true;
}
