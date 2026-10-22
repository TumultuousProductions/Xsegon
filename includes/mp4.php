<?php
/**
 * Xsegon - MP4 files rewritten without re-encoding, in place of ffmpeg's "-c copy": the first
 * seconds of a recording (bin\videocut.php) and a stream's pieces joined into one file
 * (bin\streamsave.php). The picture and sound are copied byte for byte; only the index around
 * them is new, written first so the file plays as it loads.
 *
 * A track here is its description (copied from the file it came from) and its samples in
 * order: sizes, durations, picture-order offsets, key frames, and the stretches of bytes
 * ("chunks") that hold them, each in a file on this PC.
 */
declare(strict_types=1);

function xs_mp4_u32(string $b, int $at): int
{
    return unpack('N', $b, $at)[1];
}

function xs_mp4_u64(string $b, int $at): int
{
    return unpack('J', $b, $at)[1];
}

function xs_mp4_s32(string $b, int $at): int
{
    $v = unpack('N', $b, $at)[1];
    return $v >= 0x80000000 ? $v - 0x100000000 : $v;
}

/** The boxes of $b inside $parent (or the whole of $b), each [type, at, body, end]. */
function xs_mp4_boxes(string $b, ?array $parent = null): array
{
    $at  = $parent['body'] ?? 0;
    $to  = $parent['end'] ?? strlen($b);
    $out = [];
    while ($at + 8 <= $to) {
        $len  = xs_mp4_u32($b, $at);
        $type = substr($b, $at + 4, 4);
        $body = $at + 8;
        if ($len === 1) {
            $len  = xs_mp4_u64($b, $at + 8);
            $body = $at + 16;
        } elseif ($len === 0) {
            $len = $to - $at;
        }
        if ($len < $body - $at || $at + $len > $to) {
            throw new RuntimeException('the file is damaged: its ' . preg_replace('/[^ -~]/', '?', $type) . ' box at byte ' . $at . ' runs past its end');
        }
        $out[] = ['type' => $type, 'at' => $at, 'body' => $body, 'end' => $at + $len];
        $at += $len;
    }
    return $out;
}

/** The first box of a type inside $parent, following a path of types (moov, trak, ...), or null. */
function xs_mp4_find(string $b, ?array $parent, string ...$path): ?array
{
    foreach ($path as $type) {
        $found = null;
        foreach (xs_mp4_boxes($b, $parent) as $box) {
            if ($box['type'] === $type) {
                $found = $box;
                break;
            }
        }
        if ($found === null) {
            return null;
        }
        $parent = $found;
    }
    return $parent;
}

function xs_mp4_all(string $b, ?array $parent, string $type): array
{
    return array_values(array_filter(xs_mp4_boxes($b, $parent), static fn (array $box): bool => $box['type'] === $type));
}

function xs_mp4_bytes(string $b, array $box): string
{
    return substr($b, $box['at'], $box['end'] - $box['at']);
}

function xs_mp4_box(string $type, string $body): string
{
    return pack('N', 8 + strlen($body)) . $type . $body;
}

function xs_mp4_full(string $type, int $version, int $flags, string $body): string
{
    return xs_mp4_box($type, pack('N', ($version << 24) | $flags) . $body);
}

/**
 * A track's description from its trak box: what kind (vide, soun), its timescale, and the
 * boxes copied as they are. $movieScale is the timescale its edit list is counted in.
 */
function xs_mp4_track_head(string $b, array $trak, int $movieScale): array
{
    $tkhd = xs_mp4_find($b, $trak, 'tkhd');
    $mdia = xs_mp4_find($b, $trak, 'mdia');
    $mdhd = $mdia !== null ? xs_mp4_find($b, $mdia, 'mdhd') : null;
    $hdlr = $mdia !== null ? xs_mp4_find($b, $mdia, 'hdlr') : null;
    $minf = $mdia !== null ? xs_mp4_find($b, $mdia, 'minf') : null;
    $stsd = $minf !== null ? xs_mp4_find($b, $minf, 'stbl', 'stsd') : null;
    if ($tkhd === null || $mdhd === null || $hdlr === null || $minf === null || $stsd === null) {
        throw new RuntimeException('a track has no description');
    }
    $tv   = ord($b[$tkhd['body']]);
    $mv   = ord($b[$mdhd['body']]);
    $head = ['kind' => substr($b, $hdlr['body'] + 8, 4),
             'scale' => xs_mp4_u32($b, $mdhd['body'] + ($mv === 1 ? 20 : 12)),
             'lang' => substr($b, $mdhd['body'] + ($mv === 1 ? 32 : 20), 2),
             // Layer to height: the same in both versions of tkhd, after its times, id and duration.
             'tail' => substr($b, $tkhd['body'] + ($tv === 1 ? 36 : 24), 60),
             'hdlr' => xs_mp4_bytes($b, $hdlr), 'stsd' => xs_mp4_bytes($b, $stsd),
             'mhd' => '', 'dinf' => '', 'edits' => [], 'movieScale' => $movieScale];
    foreach (xs_mp4_boxes($b, $minf) as $box) {
        if (in_array($box['type'], ['vmhd', 'smhd', 'nmhd', 'sthd'], true)) {
            $head['mhd'] = xs_mp4_bytes($b, $box);
        } elseif ($box['type'] === 'dinf') {
            $head['dinf'] = xs_mp4_bytes($b, $box);
        }
    }
    $elst = xs_mp4_find($b, $trak, 'edts', 'elst');
    if ($elst !== null) {
        $v = ord($b[$elst['body']]);
        $n = xs_mp4_u32($b, $elst['body'] + 4);
        for ($i = 0, $at = $elst['body'] + 8; $i < $n && $at < $elst['end']; $i++) {
            $head['edits'][] = $v === 1
                ? ['dur' => xs_mp4_u64($b, $at), 'media' => xs_mp4_u64($b, $at + 8)]
                : ['dur' => xs_mp4_u32($b, $at), 'media' => xs_mp4_s32($b, $at + 4)];
            $at += $v === 1 ? 20 : 12;
        }
    }
    return $head;
}

/** Where the track's own first frame is shown: its edit list's media time, or 0. */
function xs_mp4_media_start(array $head): int
{
    foreach ($head['edits'] as $e) {
        if ($e['media'] >= 0) {
            return $e['media'];
        }
    }
    return 0;
}

/**
 * The tracks of a stream: its init piece (a moov with no samples) and its media pieces (moof and
 * mdat pairs), as files on this PC, in order. Returns the tracks by their id, with every sample.
 */
function xs_mp4_fragments(string $initFile, array $pieceFiles): array
{
    $init = (string) file_get_contents($initFile);
    $moov = xs_mp4_find($init, null, 'moov');
    if ($moov === null) {
        throw new RuntimeException('the stream\'s first piece describes no tracks');
    }
    $mvhd   = xs_mp4_find($init, $moov, 'mvhd');
    $mscale = $mvhd !== null ? xs_mp4_u32($init, $mvhd['body'] + (ord($init[$mvhd['body']]) === 1 ? 20 : 12)) : 1000;
    $tracks = [];
    foreach (xs_mp4_all($init, $moov, 'trak') as $trak) {
        $tkhd = xs_mp4_find($init, $trak, 'tkhd');
        $id   = xs_mp4_u32($init, $tkhd['body'] + (ord($init[$tkhd['body']]) === 1 ? 20 : 12));
        $tracks[$id] = xs_mp4_track_head($init, $trak, $mscale)
            + ['s' => [], 'd' => [], 'c' => [], 'k' => [], 'chunks' => [], 'trex' => [0, 0, 0]];
    }
    $mvex = xs_mp4_find($init, $moov, 'mvex');
    foreach ($mvex !== null ? xs_mp4_all($init, $mvex, 'trex') : [] as $trex) {
        $id = xs_mp4_u32($init, $trex['body'] + 4);
        if (isset($tracks[$id])) {
            $tracks[$id]['trex'] = [xs_mp4_u32($init, $trex['body'] + 12), xs_mp4_u32($init, $trex['body'] + 16), xs_mp4_u32($init, $trex['body'] + 20)];
        }
    }
    foreach ($pieceFiles as $file) {
        $piece = (string) file_get_contents($file);
        foreach (xs_mp4_all($piece, null, 'moof') as $moof) {
            foreach (xs_mp4_all($piece, $moof, 'traf') as $traf) {
                xs_mp4_traf($piece, $moof, $traf, $file, $tracks);
            }
        }
    }
    return $tracks;
}

/** One track's run of samples in a moof, added to its track. */
function xs_mp4_traf(string $p, array $moof, array $traf, string $file, array &$tracks): void
{
    $tfhd = xs_mp4_find($p, $traf, 'tfhd');
    if ($tfhd === null) {
        throw new RuntimeException('a stream piece names no track');
    }
    $f  = xs_mp4_u32($p, $tfhd['body']) & 0xffffff;
    $id = xs_mp4_u32($p, $tfhd['body'] + 4);
    if (!isset($tracks[$id])) {
        return;
    }
    $t   = &$tracks[$id];
    $at  = $tfhd['body'] + 8;
    $base = $moof['at'];
    if ($f & 0x1) {
        $base = xs_mp4_u64($p, $at);
        $at  += 8;
    }
    if ($f & 0x2) {
        $at += 4;
    }
    [$dDur, $dSize, $dFlags] = $t['trex'];
    if ($f & 0x8) {
        $dDur = xs_mp4_u32($p, $at);
        $at  += 4;
    }
    if ($f & 0x10) {
        $dSize = xs_mp4_u32($p, $at);
        $at   += 4;
    }
    if ($f & 0x20) {
        $dFlags = xs_mp4_u32($p, $at);
    }
    $next = $base;
    foreach (xs_mp4_all($p, $traf, 'trun') as $trun) {
        $vf    = xs_mp4_u32($p, $trun['body']);
        $tf    = $vf & 0xffffff;
        $n     = xs_mp4_u32($p, $trun['body'] + 4);
        $at    = $trun['body'] + 8;
        $start = $next;
        if ($tf & 0x1) {
            $start = $base + xs_mp4_s32($p, $at);
            $at   += 4;
        }
        $first = null;
        if ($tf & 0x4) {
            $first = xs_mp4_u32($p, $at);
            $at   += 4;
        }
        $len = 0;
        for ($i = 0; $i < $n; $i++) {
            $dur   = $tf & 0x100 ? xs_mp4_u32($p, ($at += 4) - 4) : $dDur;
            $size  = $tf & 0x200 ? xs_mp4_u32($p, ($at += 4) - 4) : $dSize;
            $flags = $tf & 0x400 ? xs_mp4_u32($p, ($at += 4) - 4) : ($i === 0 && $first !== null ? $first : $dFlags);
            $cto   = 0;
            if ($tf & 0x800) {
                $cto = ($vf >> 24) === 1 ? xs_mp4_s32($p, $at) : xs_mp4_u32($p, $at);
                $at += 4;
            }
            $t['s'][] = $size;
            $t['d'][] = $dur;
            $t['c'][] = $cto;
            $t['k'][] = ($flags & 0x10000) === 0;
            $len     += $size;
        }
        if ($n > 0) {
            if ($start + $len > strlen($p)) {
                throw new RuntimeException('a stream piece is shorter than its own index says (' . basename($file) . ')');
            }
            $t['chunks'][] = ['src' => $file, 'off' => $start, 'len' => $len, 'n' => $n];
        }
        $next = $start + $len;
    }
    unset($t);
}

/** The table inside a stbl child box, from its entry count on, or null when there is none. */
function xs_mp4_table(string $b, array $stbl, string $type): ?array
{
    $box = xs_mp4_find($b, $stbl, $type);
    return $box === null ? null : ['v' => ord($b[$box['body']]), 'n' => xs_mp4_u32($b, $box['body'] + 4), 'at' => $box['body'] + 8, 'box' => $box];
}

/**
 * The first $seconds of a recording's picture and sound, from its moov alone: the first
 * picture track and the first sound track, each with its samples, and chunks that point at
 * the recording's own byte offsets ('src' => null until those bytes are fetched).
 */
function xs_mp4_head(string $b, array $moov, float $seconds): array
{
    $mvhd   = xs_mp4_find($b, $moov, 'mvhd');
    $mscale = $mvhd !== null ? xs_mp4_u32($b, $mvhd['body'] + (ord($b[$mvhd['body']]) === 1 ? 20 : 12)) : 1000;
    $tracks = [];
    foreach (xs_mp4_all($b, $moov, 'trak') as $trak) {
        $head = xs_mp4_track_head($b, $trak, $mscale);
        if (!in_array($head['kind'], ['vide', 'soun'], true) || isset($tracks[$head['kind']])) {
            continue;
        }
        $stbl = xs_mp4_find($b, $trak, 'mdia', 'minf', 'stbl');
        $tracks[$head['kind']] = $head + xs_mp4_head_samples($b, $stbl, (int) floor($seconds * $head['scale']) + xs_mp4_media_start($head));
    }
    if (!isset($tracks['vide'])) {
        throw new RuntimeException('the recording has no picture');
    }
    return array_values($tracks);
}

/** The samples of one track that start before $limit (in its timescale), and their chunks. */
function xs_mp4_head_samples(string $b, array $stbl, int $limit): array
{
    $stts = xs_mp4_table($b, $stbl, 'stts');
    $stsz = xs_mp4_table($b, $stbl, 'stsz');
    $stsc = xs_mp4_table($b, $stbl, 'stsc');
    $stco = xs_mp4_table($b, $stbl, 'stco') ?? xs_mp4_table($b, $stbl, 'co64');
    if ($stts === null || $stsz === null || $stsc === null || $stco === null) {
        throw new RuntimeException(xs_mp4_find($b, $stbl, 'stz2') !== null
            ? 'the recording lists its sample sizes in a short form this cannot read yet'
            : 'a track of the recording has no sample table');
    }
    $durs = [];
    $dts  = 0;
    for ($i = 0; $i < $stts['n'] && $dts < $limit; $i++) {
        $count = xs_mp4_u32($b, $stts['at'] + $i * 8);
        $delta = xs_mp4_u32($b, $stts['at'] + $i * 8 + 4);
        $take  = $delta > 0 ? min($count, (int) ceil(($limit - $dts) / $delta)) : $count;
        array_push($durs, ...array_fill(0, $take, $delta));
        $dts += $take * $delta;
    }
    $n = count($durs);
    if ($n === 0) {
        throw new RuntimeException('a track of the recording has no samples');
    }
    // Sizes: one for all (in the header), or a table of which the first $n are read.
    $one   = xs_mp4_u32($b, $stsz['box']['body'] + 4);
    $count = xs_mp4_u32($b, $stsz['box']['body'] + 8);
    $n     = min($n, $count);
    $durs  = array_slice($durs, 0, $n);
    $sizes = $one > 0 ? array_fill(0, $n, $one) : array_values(unpack('N' . $n, $b, $stsz['box']['body'] + 12));
    $ctos  = array_fill(0, $n, 0);
    $ctts  = xs_mp4_table($b, $stbl, 'ctts');
    for ($i = 0, $s = 0; $ctts !== null && $i < $ctts['n'] && $s < $n; $i++) {
        $count = xs_mp4_u32($b, $ctts['at'] + $i * 8);
        $off   = $ctts['v'] === 1 ? xs_mp4_s32($b, $ctts['at'] + $i * 8 + 4) : xs_mp4_u32($b, $ctts['at'] + $i * 8 + 4);
        for ($j = 0; $j < $count && $s < $n; $j++) {
            $ctos[$s++] = $off;
        }
    }
    $stss = xs_mp4_table($b, $stbl, 'stss');
    $keys = array_fill(0, $n, $stss === null);
    for ($i = 0; $stss !== null && $i < $stss['n']; $i++) {
        $k = xs_mp4_u32($b, $stss['at'] + $i * 4) - 1;
        if ($k >= $n) {
            break;
        }
        $keys[$k] = true;
    }
    // Chunks: how many samples each holds (stsc's runs) and where it starts (stco or co64).
    $chunks = [];
    $wide   = xs_mp4_find($b, $stbl, 'co64') !== null && xs_mp4_find($b, $stbl, 'stco') === null;
    for ($e = 0, $s = 0; $e < $stsc['n'] && $s < $n; $e++) {
        $first = xs_mp4_u32($b, $stsc['at'] + $e * 12);
        $per   = xs_mp4_u32($b, $stsc['at'] + $e * 12 + 4);
        $last  = $e + 1 < $stsc['n'] ? xs_mp4_u32($b, $stsc['at'] + ($e + 1) * 12) - 1 : $stco['n'];
        for ($c = $first; $c <= $last && $s < $n; $c++) {
            if ($c > $stco['n']) {
                throw new RuntimeException('a track of the recording names more chunks than it lists');
            }
            $off  = $wide ? xs_mp4_u64($b, $stco['at'] + ($c - 1) * 8) : xs_mp4_u32($b, $stco['at'] + ($c - 1) * 4);
            $take = min($per, $n - $s);
            $chunks[] = ['src' => null, 'off' => $off, 'len' => array_sum(array_slice($sizes, $s, $take)), 'n' => $take];
            $s += $take;
        }
    }
    if (array_sum(array_column($chunks, 'n')) !== $n) {
        throw new RuntimeException('a track of the recording places fewer samples than it lists');
    }
    return ['s' => $sizes, 'd' => $durs, 'c' => $ctos, 'k' => $keys, 'chunks' => $chunks];
}

/** A curl handle with Xsegon's usual terms: gives up when nothing comes for 30 s. */
function xs_mp4_curl(string $url)
{
    $h = curl_init($url);
    curl_setopt_array($h, [CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5, CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_LOW_SPEED_LIMIT => 256, CURLOPT_LOW_SPEED_TIME => 30, CURLOPT_USERAGENT => 'Xsegon',
        CURLOPT_FAILONERROR => true, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS]);
    // Windows' own certificates: PHP's curl has none of its own.
    if (defined('CURLSSLOPT_NATIVE_CA')) {
        curl_setopt($h, CURLOPT_SSL_OPTIONS, CURLSSLOPT_NATIVE_CA);
    }
    return $h;
}

/** A file:/// address as the path it names; anything else as it is. */
function xs_mp4_local(string $url): string
{
    return preg_match('#^file:///(.+)$#i', $url, $m) ? rawurldecode($m[1]) : $url;
}

/**
 * The bytes at a web address, or at a path on this PC (the tests' stand-ins): all of them, or
 * $from to $to. A server that answers a part with the whole is stopped there, so a long
 * recording is never fetched whole by mistake. Throws with the reason.
 */
function xs_mp4_get(string $url, ?int $from = null, ?int $to = null): string
{
    if (!preg_match('#^https?://#i', $url)) {
        $f = @fopen(xs_mp4_local($url), 'rb');
        if ($f === false) {
            throw new RuntimeException('there is no ' . $url);
        }
        fseek($f, $from ?? 0);
        $got = (string) stream_get_contents($f, $to !== null ? $to - ($from ?? 0) + 1 : -1);
        fclose($f);
        return $got;
    }
    $h    = xs_mp4_curl($url);
    $body = '';
    $want = $to !== null ? $to - ($from ?? 0) + 1 : PHP_INT_MAX;
    curl_setopt_array($h, [CURLOPT_TIMEOUT => 600,
        CURLOPT_WRITEFUNCTION => static function ($h, string $part) use (&$body, $want): int {
            $body .= $part;
            return strlen($body) > $want ? 0 : strlen($part);
        }] + ($from !== null ? [CURLOPT_RANGE => $from . '-' . ($to ?? '')] : []));
    $ok   = curl_exec($h);
    $code = (int) curl_getinfo($h, CURLINFO_RESPONSE_CODE);
    $why  = curl_error($h);
    if ($from !== null && $from > 0 && $code === 200) {
        throw new RuntimeException('the server sends only whole files, so a part of one cannot be read: ' . $url);
    }
    if ($ok === false && strlen($body) <= $want) {
        throw new RuntimeException(($why !== '' ? $why : 'HTTP ' . $code) . ': ' . $url);
    }
    return substr($body, 0, $want === PHP_INT_MAX ? null : $want);
}

/** Several web addresses (or paths) saved to files, four at a time: [url => file]. Throws with the first reason. */
function xs_mp4_get_files(array $want): void
{
    $multi = curl_multi_init();
    $queue = $want;
    $going = [];
    $fail  = '';
    try {
        while (($queue !== [] || $going !== []) && $fail === '') {
            while (count($going) < 4 && $queue !== []) {
                $url  = array_key_first($queue);
                $file = $queue[$url];
                unset($queue[$url]);
                if (!preg_match('#^https?://#i', $url)) {
                    if (!@copy(xs_mp4_local($url), $file)) {
                        $fail = 'there is no ' . $url;
                    }
                    continue;
                }
                $fh = @fopen($file, 'wb');
                if ($fh === false) {
                    $fail = 'cannot write ' . $file;
                    break;
                }
                $h = xs_mp4_curl($url);
                curl_setopt_array($h, [CURLOPT_FILE => $fh, CURLOPT_TIMEOUT => 900]);
                curl_multi_add_handle($multi, $h);
                $going[(int) $h] = [$h, $fh, $url];
            }
            if ($going === []) {
                continue;
            }
            curl_multi_exec($multi, $running);
            curl_multi_select($multi, 1.0);
            while (($info = curl_multi_info_read($multi)) !== false) {
                [$h, $fh, $url] = $going[(int) $info['handle']];
                unset($going[(int) $info['handle']]);
                fclose($fh);
                if ($info['result'] !== CURLE_OK) {
                    $fail = curl_error($h) . ': ' . $url;
                }
                curl_multi_remove_handle($multi, $h);
            }
        }
    } finally {
        foreach ($going as [$h, $fh]) {
            curl_multi_remove_handle($multi, $h);
            fclose($fh);
        }
        curl_multi_close($multi);
    }
    if ($fail !== '') {
        throw new RuntimeException($fail);
    }
}

/** Runs of equal values as [count, value] pairs. */
function xs_mp4_runs(array $values): array
{
    $runs = [];
    foreach ($values as $v) {
        $last = count($runs) - 1;
        if ($last >= 0 && $runs[$last][1] === $v) {
            $runs[$last][0]++;
        } else {
            $runs[] = [1, $v];
        }
    }
    return $runs;
}

/** One track's trak box, its chunks starting at the byte offsets given. */
function xs_mp4_trak(array $t, int $id, array $offsets, bool $wide): string
{
    $n      = count($t['s']);
    $dur    = array_sum($t['d']);
    $movie  = intdiv($dur * 1000, $t['scale']);
    $tkhd   = xs_mp4_full('tkhd', 0, 3, pack('NNNNN', 0, 0, $id, 0, min($movie, 0xffffffff)) . $t['tail']);
    // The edit list kept as it was, its shown part ending with the track.
    $edits  = '';
    $count  = 0;
    foreach ($t['edits'] as $e) {
        if ($e['media'] < 0) {
            $edits .= pack('NNN', intdiv($e['dur'] * 1000, max(1, $t['movieScale'])), 0xffffffff, 0x00010000);
        } else {
            $shown  = intdiv(max(0, $dur - $e['media']) * 1000, $t['scale']);
            $edits .= pack('NNN', $shown, $e['media'], 0x00010000);
            $count++;
            break;
        }
        $count++;
    }
    $edts = $count > 0 ? xs_mp4_box('edts', xs_mp4_full('elst', 0, 0, pack('N', $count) . $edits)) : '';
    $mdhd = $dur > 0xffffffff
        ? xs_mp4_full('mdhd', 1, 0, pack('JJNJ', 0, 0, $t['scale'], $dur) . $t['lang'] . "\0\0")
        : xs_mp4_full('mdhd', 0, 0, pack('NNNN', 0, 0, $t['scale'], $dur) . $t['lang'] . "\0\0");
    $stts = '';
    foreach (($runs = xs_mp4_runs($t['d'])) as [$c, $v]) {
        $stts .= pack('NN', $c, $v);
    }
    $stbl = $t['stsd'] . xs_mp4_full('stts', 0, 0, pack('N', count($runs)) . $stts);
    if (array_filter($t['c']) !== []) {
        $runs = xs_mp4_runs($t['c']);
        $neg  = min($t['c']) < 0;
        $body = pack('N', count($runs));
        foreach ($runs as [$c, $v]) {
            $body .= pack('NN', $c, $v & 0xffffffff);
        }
        $stbl .= xs_mp4_full('ctts', $neg ? 1 : 0, 0, $body);
    }
    if (in_array(false, $t['k'], true)) {
        $keys = array_keys(array_filter($t['k']));
        $stbl .= xs_mp4_full('stss', 0, 0, pack('N', count($keys)) . pack('N*', ...array_map(static fn (int $i): int => $i + 1, $keys)));
    }
    $stsc = '';
    $runs = 0;
    $prev = -1;
    foreach ($t['chunks'] as $i => $chunk) {
        if ($chunk['n'] !== $prev) {
            $stsc .= pack('NNN', $i + 1, $chunk['n'], 1);
            $prev  = $chunk['n'];
            $runs++;
        }
    }
    $stbl .= xs_mp4_full('stsc', 0, 0, pack('N', $runs) . $stsc);
    $same  = count(array_unique($t['s'])) === 1;
    $stbl .= xs_mp4_full('stsz', 0, 0, $same ? pack('NN', $t['s'][0], $n) : pack('NN', 0, $n) . pack('N*', ...$t['s']));
    $stbl .= $wide
        ? xs_mp4_full('co64', 0, 0, pack('N', count($offsets)) . pack('J*', ...$offsets))
        : xs_mp4_full('stco', 0, 0, pack('N', count($offsets)) . pack('N*', ...$offsets));
    $minf = xs_mp4_box('minf', $t['mhd'] . $t['dinf'] . xs_mp4_box('stbl', $stbl));
    return xs_mp4_box('trak', $tkhd . $edts . xs_mp4_box('mdia', $mdhd . $t['hdlr'] . $minf));
}

/**
 * Writes $tracks as one MP4 file at $to: the index first, then each track's chunks in the
 * order they play, so picture and sound sit together. Returns the bytes written.
 */
function xs_mp4_write(string $to, array $tracks): int
{
    $tracks = array_values(array_filter($tracks, static fn (array $t): bool => $t['s'] !== []));
    if ($tracks === []) {
        throw new RuntimeException('there is nothing to write');
    }
    // Every chunk with the time it starts at, in the order they play.
    $order = [];
    foreach ($tracks as $ti => $t) {
        $s   = 0;
        $dts = 0;
        foreach ($t['chunks'] as $ci => $chunk) {
            $order[] = [$dts / $t['scale'], $ti, $ci];
            $dts += array_sum(array_slice($t['d'], $s, $chunk['n']));
            $s   += $chunk['n'];
        }
    }
    usort($order, static fn (array $a, array $b): int => [$a[0], $a[1], $a[2]] <=> [$b[0], $b[1], $b[2]]);
    $data = 0;
    $rel  = [];
    foreach ($order as [, $ti, $ci]) {
        $rel[$ti][$ci] = $data;
        $data += $tracks[$ti]['chunks'][$ci]['len'];
    }
    $ftyp = xs_mp4_box('ftyp', 'isom' . pack('N', 0x200) . 'isomiso2avc1mp41');
    $moov = static function (int $start, bool $wide) use ($tracks, $rel): string {
        $traks = '';
        $long  = 0;
        foreach ($tracks as $ti => $t) {
            $offsets = [];
            foreach ($t['chunks'] as $ci => $chunk) {
                $offsets[] = $start + $rel[$ti][$ci];
            }
            $traks .= xs_mp4_trak($t, $ti + 1, $offsets, $wide);
            $long   = max($long, intdiv(array_sum($t['d']) * 1000, $t['scale']));
        }
        $matrix = pack('N9', 0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);
        $mvhd   = xs_mp4_full('mvhd', 0, 0, pack('NNNNNn', 0, 0, 1000, min($long, 0xffffffff), 0x00010000, 0x0100)
            . str_repeat("\0", 10) . $matrix . str_repeat("\0", 24) . pack('N', count($tracks) + 1));
        return xs_mp4_box('moov', $mvhd . $traks);
    };
    // The index's size does not depend on the offsets in it, only on how wide they are.
    $wide  = strlen($ftyp) + strlen($moov(0, false)) + 8 + $data > 0xffffffff;
    $head  = $wide ? 16 : 8;
    $index = $moov(strlen($ftyp) + strlen($moov(0, $wide)) + $head, $wide);
    $out   = @fopen($to, 'wb');
    if ($out === false) {
        throw new RuntimeException('cannot write ' . $to);
    }
    $files = [];
    try {
        fwrite($out, $ftyp . $index . ($wide ? pack('N', 1) . 'mdat' . pack('J', 16 + $data) : pack('N', 8 + $data) . 'mdat'));
        foreach ($order as [, $ti, $ci]) {
            $chunk = $tracks[$ti]['chunks'][$ci];
            $src   = $files[$chunk['src']] ??= @fopen($chunk['src'], 'rb');
            if ($src === false || fseek($src, $chunk['off']) !== 0
                || stream_copy_to_stream($src, $out, $chunk['len']) !== $chunk['len']) {
                throw new RuntimeException('the picture and sound could not be copied from ' . basename((string) $chunk['src']));
            }
        }
        return (int) ftell($out);
    } finally {
        fclose($out);
        foreach ($files as $f) {
            if ($f !== false) {
                fclose($f);
            }
        }
    }
}
