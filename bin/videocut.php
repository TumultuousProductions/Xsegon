<?php
/**
 * Xsegon - the first seconds of a recording on the internet saved as a video of its own,
 * without fetching the whole recording or re-encoding it (includes\mp4.php).
 *
 *   php bin\videocut.php <address> <file to write> [seconds, 30]
 *
 * Reads the recording's index, then only the bytes that hold those seconds. Ends 0 with the
 * file written, or 1 with the reason as its last line.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/mp4.php';

set_time_limit(0);
ini_set('memory_limit', '1024M');

[, $url, $to] = $argv + [null, '', ''];
$seconds = (float) ($argv[3] ?? 30);
if ($url === '' || $to === '' || $seconds <= 0) {
    fwrite(STDERR, "php bin\\videocut.php <address> <file to write> [seconds]\n");
    exit(1);
}
$bytes = $to . '.bytes';

try {
    // The top-level boxes, read a header at a time past what came first, to the index (moov).
    $head = xs_mp4_get($url, 0, 65535);
    $at   = 0;
    $moov = null;
    for ($i = 0; $i < 64 && $moov === null; $i++) {
        $hdr = $at + 16 <= strlen($head) ? substr($head, $at, 16) : xs_mp4_get($url, $at, $at + 15);
        if (strlen($hdr) < 8) {
            break;
        }
        $len = xs_mp4_u32($hdr, 0);
        if ($len === 1 && strlen($hdr) >= 16) {
            $len = xs_mp4_u64($hdr, 8);
        }
        // A box is named in letters: anything else is not an MP4, and its "length" means nothing.
        if ($len < 8 || !preg_match('/^[A-Za-z0-9 ]{4}$/', substr($hdr, 4, 4))) {
            break;
        }
        if (substr($hdr, 4, 4) === 'moov') {
            $moov = $at + $len <= strlen($head) ? substr($head, $at, $len) : xs_mp4_get($url, $at, $at + $len - 1);
        }
        $at += $len;
    }
    if ($moov === null || strlen($moov) < 8) {
        throw new RuntimeException('the recording has no index to read');
    }
    $tracks = xs_mp4_head($moov, xs_mp4_find($moov, null, 'moov'), $seconds);

    // Only the stretches that hold those seconds, near ones fetched together.
    $spans = [];
    foreach ($tracks as $t) {
        foreach ($t['chunks'] as $c) {
            $spans[] = [$c['off'], $c['off'] + $c['len']];
        }
    }
    sort($spans);
    $merged = [];
    foreach ($spans as [$a, $b]) {
        $last = count($merged) - 1;
        if ($last >= 0 && $a <= $merged[$last][1] + 1048576) {
            $merged[$last][1] = max($merged[$last][1], $b);
        } else {
            $merged[] = [$a, $b];
        }
    }
    $total = array_sum(array_map(static fn (array $m): int => $m[1] - $m[0], $merged));
    if ($total > 300 * 1048576) {
        throw new RuntimeException('those seconds are spread over ' . round($total / 1048576) . ' MB of the recording, too much to fetch for them');
    }
    $out = fopen($bytes, 'wb');
    $map = [];
    foreach ($merged as [$a, $b]) {
        $map[] = [$a, $b, (int) ftell($out)];
        $got = xs_mp4_get($url, $a, $b - 1);
        if (strlen($got) !== $b - $a) {
            throw new RuntimeException('the recording ended early: ' . strlen($got) . ' of ' . ($b - $a) . ' bytes at ' . $a);
        }
        fwrite($out, $got);
    }
    fclose($out);
    foreach ($tracks as &$t) {
        foreach ($t['chunks'] as &$c) {
            foreach ($map as [$a, $b, $local]) {
                if ($c['off'] >= $a && $c['off'] + $c['len'] <= $b) {
                    $c = ['src' => $bytes, 'off' => $local + $c['off'] - $a] + $c;
                    break;
                }
            }
        }
        unset($c);
    }
    unset($t);
    xs_mp4_write($to, $tracks);
    @unlink($bytes);
    exit(0);
} catch (Throwable $e) {
    @unlink($bytes);
    @unlink($to);
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
