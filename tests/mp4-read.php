<?php
// For tests\t-mp4.js: an MP4's tracks read back by includes\mp4.php, as JSON. Its top-level boxes,
// and per track the kind, timescale, sample count and length, and digests of the samples' bytes
// and of their sizes, durations, picture-order offsets and key frames.
//   php tests\mp4-read.php <file> [seconds]                  a whole file, or its first seconds
//   php tests\mp4-read.php <init piece> <piece> <piece>...   a stream's pieces
declare(strict_types=1);

require __DIR__ . '/../includes/mp4.php';

$file = $argv[1];
$b    = (string) file_get_contents($file);
if (count($argv) > 3 || str_ends_with($file, '.m4s')) {
    $tracks = array_values(xs_mp4_fragments($file, array_slice($argv, 2)));
    $top    = [];
} else {
    $tracks = xs_mp4_head($b, xs_mp4_find($b, null, 'moov'), (float) ($argv[2] ?? 1e9));
    $top    = array_column(xs_mp4_boxes($b), 'type');
    foreach ($tracks as &$t) {
        foreach ($t['chunks'] as &$c) {
            $c['src'] = $file;
        }
        unset($c);
    }
    unset($t);
}
$out = ['top' => $top, 'tracks' => []];
foreach ($tracks as $t) {
    $data = '';
    foreach ($t['chunks'] as $c) {
        $f = fopen((string) $c['src'], 'rb');
        fseek($f, $c['off']);
        $data .= (string) fread($f, $c['len']);
        fclose($f);
    }
    $out['tracks'][] = ['kind' => $t['kind'], 'scale' => $t['scale'], 'n' => count($t['s']), 'secs' => round(array_sum($t['d']) / $t['scale'], 3),
        'bytes' => sha1($data), 'sizes' => sha1(implode(',', $t['s'])), 'durs' => sha1(implode(',', $t['d'])),
        'ctos' => sha1(implode(',', $t['c'])), 'keys' => sha1(implode(',', array_map('intval', $t['k']))), 'firstKey' => $t['k'][0] ?? null];
}
echo json_encode($out);
