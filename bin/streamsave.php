<?php
/**
 * Xsegon - a video a site only streams (HLS in MP4 pieces, as Steam's trailers) saved as one
 * MP4 file, its pieces joined without re-encoding (includes\mp4.php).
 *
 *   php bin\streamsave.php <address of the stream's .m3u8> <file to write> [folder for the pieces]
 *
 * Takes the stream's largest picture and its sound. The pieces are fetched into the folder named
 * (else beside the file) and taken away after. Ends 0 with the file written, or 1 with the
 * reason as its last line.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/mp4.php';

set_time_limit(0);
ini_set('memory_limit', '1024M');

[, $url, $to] = $argv + [null, '', ''];
if ($url === '' || $to === '') {
    fwrite(STDERR, "php bin\\streamsave.php <address of the .m3u8> <file to write> [folder for the pieces]\n");
    exit(1);
}
$dir = (string) ($argv[3] ?? '') !== '' ? $argv[3] : $to . '.pieces';

/**
 * A playlist's address for a line in it: as written, from the site's root, or beside the
 * playlist. A stream on the web may only name the web, never a file on this PC.
 */
function xs_ss_resolve(string $base, string $ref): string
{
    if (preg_match('#^[a-z][a-z0-9+.-]*://#i', $ref)) {
        if (preg_match('#^https?://#i', $base) && !preg_match('#^https?://#i', $ref)) {
            throw new RuntimeException('the stream names something that is not on the web: ' . $ref);
        }
        return $ref;
    }
    $base = (string) preg_replace('/[?#].*$/', '', $base);
    if (str_starts_with($ref, '/') && preg_match('#^([a-z]+://[^/]+)#i', $base, $m)) {
        return $m[1] . $ref;
    }
    return substr($base, 0, (int) strrpos(str_replace('\\', '/', $base), '/') + 1) . $ref;
}

/** A playlist line's attributes: NAME=value pairs, quotes taken off. */
function xs_ss_attrs(string $line): array
{
    preg_match_all('/([A-Z0-9-]+)=("[^"]*"|[^,]*)/', $line, $m, PREG_SET_ORDER);
    $out = [];
    foreach ($m as [, $k, $v]) {
        $out[$k] = trim($v, '"');
    }
    return $out;
}

/** A media playlist's init piece and pieces, as addresses. */
function xs_ss_media(string $url): array
{
    $text   = xs_mp4_get($url);
    $init   = null;
    $pieces = [];
    foreach (preg_split('/\R/', $text) as $line) {
        $line = trim($line);
        if (str_starts_with($line, '#EXT-X-KEY') && (xs_ss_attrs($line)['METHOD'] ?? 'NONE') !== 'NONE') {
            throw new RuntimeException('the stream is locked (encrypted), so it cannot be saved');
        }
        if (str_starts_with($line, '#EXT-X-BYTERANGE')) {
            throw new RuntimeException('the stream\'s pieces are parts of one file, which this cannot join yet');
        }
        if (str_starts_with($line, '#EXT-X-MAP')) {
            $init = xs_ss_resolve($url, (string) (xs_ss_attrs($line)['URI'] ?? ''));
        } elseif ($line !== '' && $line[0] !== '#') {
            $pieces[] = xs_ss_resolve($url, $line);
        }
    }
    if ($pieces === []) {
        throw new RuntimeException('the stream lists no pieces');
    }
    if ($init === null) {
        throw new RuntimeException('the stream\'s pieces are not MP4 pieces (MPEG-TS), which this cannot join yet');
    }
    return [$init, $pieces];
}

try {
    $text   = xs_mp4_get($url);
    $lists  = [$url];
    $lines  = preg_split('/\R/', $text);
    $best   = null;
    foreach ($lines as $i => $line) {
        if (str_starts_with($line, '#EXT-X-STREAM-INF:')) {
            $a   = xs_ss_attrs(substr($line, 18));
            $uri = '';
            for ($j = $i + 1; $j < count($lines) && $uri === ''; $j++) {
                $l   = trim($lines[$j]);
                $uri = $l !== '' && $l[0] !== '#' ? $l : '';
            }
            if ($uri !== '' && ($best === null || (int) ($a['BANDWIDTH'] ?? 0) > $best['bw'])) {
                $best = ['bw' => (int) ($a['BANDWIDTH'] ?? 0), 'uri' => $uri, 'audio' => $a['AUDIO'] ?? ''];
            }
        }
    }
    if ($best !== null) {
        // A list of versions: the largest picture, and its sound when that is a stream of its own.
        $lists = [xs_ss_resolve($url, $best['uri'])];
        $sound = null;
        foreach ($lines as $line) {
            if (str_starts_with($line, '#EXT-X-MEDIA:')) {
                $a = xs_ss_attrs(substr($line, 13));
                if (($a['TYPE'] ?? '') === 'AUDIO' && ($a['GROUP-ID'] ?? '') === $best['audio'] && isset($a['URI'])
                    && ($sound === null || ($a['DEFAULT'] ?? '') === 'YES')) {
                    $sound = $a['URI'];
                }
            }
        }
        if ($sound !== null) {
            $lists[] = xs_ss_resolve($url, $sound);
        }
    }

    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        throw new RuntimeException('cannot make ' . $dir);
    }
    $tracks = [];
    foreach ($lists as $li => $list) {
        [$init, $pieces] = xs_ss_media($list);
        $files = [$init => $dir . DIRECTORY_SEPARATOR . $li . '-init.mp4'];
        foreach ($pieces as $pi => $p) {
            $files[$p] = $dir . DIRECTORY_SEPARATOR . $li . '-' . $pi . '.m4s';
        }
        xs_mp4_get_files($files);
        $tracks = array_merge($tracks, array_values(xs_mp4_fragments(array_shift($files), array_values($files))));
    }
    // One picture and one sound, the first of each.
    $keep = [];
    foreach ($tracks as $t) {
        if (in_array($t['kind'], ['vide', 'soun'], true) && !isset($keep[$t['kind']])) {
            $keep[$t['kind']] = $t;
        }
    }
    if (!isset($keep['vide'])) {
        throw new RuntimeException('the stream has no picture');
    }
    xs_mp4_write($to, array_values($keep));
    $code = 0;
} catch (Throwable $e) {
    @unlink($to);
    fwrite(STDERR, $e->getMessage() . "\n");
    $code = 1;
}
foreach (glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
    @unlink($f);
}
@rmdir($dir);
exit($code);
