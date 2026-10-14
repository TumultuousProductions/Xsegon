<?php
/**
 * Xsegon - a .zip written and read by Xsegon itself: a package of videos
 * (includes\videopack.php), a backup and a report (includes\backup.php).
 *
 * This PHP has no zip extension, and a package or a backup can be gigabytes:
 * so a file goes in as it is, straight from where it lies (a picture or a
 * video does not shrink), a few bytes of text can go in packed, and past
 * 4 GB or 65,535 files the .zip is written the way Windows and 7-Zip read
 * (zip64). Reading takes a packed file too.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

const XS_ZS_CHUNK = 4 * 1048576;

/** A new .zip to write into: its handle and what is in it so far, or null with why. */
function xs_zs_begin(string $path, ?string &$why = null): ?array
{
    $fh = @fopen($path, 'w+b');
    if ($fh === false) {
        $why = xs_file_error_reason();
        return null;
    }
    return ['fh' => $fh, 'at' => 0, 'entries' => []];
}

/** The start of one file inside: written with no sum and no size, which are filled in once its bytes are through. */
function xs_zs_head(array &$zip, string $name, int $when, int $method = 0): array
{
    $d = getdate($when > 315532800 ? $when : time());
    $e = ['name' => $name, 'at' => $zip['at'], 'crc' => 0, 'size' => 0, 'packed' => 0, 'method' => $method,
          'time' => ($d['hours'] << 11) | ($d['minutes'] << 5) | ($d['seconds'] >> 1),
          'date' => (($d['year'] - 1980) << 9) | ($d['mon'] << 5) | $d['mday']];
    // 0x0800: the name is UTF-8.
    fwrite($zip['fh'], pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, $method, $e['time'], $e['date'], 0, 0, 0, strlen($name), 0) . $name);
    $zip['at'] += 30 + strlen($name);
    return $e;
}

/** $packed: how many bytes it takes in the .zip, where that is not its own size. */
function xs_zs_foot(array &$zip, array $e, int $crc, int $size, ?int $packed = null): void
{
    $e['crc']    = $crc;
    $e['size']   = $size;
    $e['packed'] = $packed ?? $size;
    fseek($zip['fh'], $e['at'] + 14);
    fwrite($zip['fh'], pack('VVV', $crc, $e['packed'], $size));
    $zip['at'] += $e['packed'];
    fseek($zip['fh'], $zip['at']);
    $zip['entries'][] = $e;
}

/** A few bytes as a file inside. $pack: packed where that comes out smaller, as text does. */
function xs_zs_put_bytes(array &$zip, string $name, string $bytes, ?int $when = null, bool $pack = false): bool
{
    $small  = $pack ? gzdeflate($bytes, 6) : false;
    $packed = is_string($small) && strlen($small) < strlen($bytes);
    $body   = $packed ? $small : $bytes;
    $e = xs_zs_head($zip, $name, $when ?? time(), $packed ? 8 : 0);
    if (fwrite($zip['fh'], $body) !== strlen($body)) {
        return false;
    }
    xs_zs_foot($zip, $e, (int) hexdec(hash('crc32b', $bytes)), strlen($bytes), strlen($body));
    return true;
}

/**
 * A file from the disk as a file inside, read once. $tick is told of each
 * piece's length and answers false to stop. Answers 'ok'; 'skip' when the
 * file itself could not be read, and nothing of it is left in the .zip;
 * 'full' when the .zip could not be written; 'stop'. $why has the words.
 */
function xs_zs_put_file(array &$zip, string $name, string $source, ?callable $tick = null, ?string &$why = null): string
{
    $why  = null;
    $size = @filesize($source);
    $in   = @fopen($source, 'rb');
    if ($in === false || $size === false || $size >= 0xFFFFFFFF) {
        if ($in !== false) {
            fclose($in);
        }
        $why = $in !== false && $size !== false ? 'is over 4 GB' : 'could not be read';
        return 'skip';
    }
    $e    = xs_zs_head($zip, $name, (int) @filemtime($source));
    $sum  = hash_init('crc32b');
    $done = 0;
    $how  = 'ok';
    while (!feof($in)) {
        $buf = fread($in, XS_ZS_CHUNK);
        if ($buf === false) {
            [$how, $why] = ['skip', 'could not be read to its end'];
            break;
        }
        if ($buf === '') {
            continue;
        }
        if (fwrite($zip['fh'], $buf) !== strlen($buf)) {
            [$how, $why] = ['full', 'could not be written whole (is the drive full?)'];
            break;
        }
        hash_update($sum, $buf);
        $done += strlen($buf);
        if ($tick !== null && $tick(strlen($buf)) === false) {
            [$how, $why] = ['stop', 'stopped'];
            break;
        }
    }
    fclose($in);
    if ($how === 'ok' && $done !== $size) {
        [$how, $why] = ['skip', 'changed while it was being read'];
    }
    if ($how !== 'ok') {
        // Back to where this file began: a file that is not all there leaves nothing behind it.
        $zip['at'] = $e['at'];
        @ftruncate($zip['fh'], $e['at']);
        fseek($zip['fh'], $e['at']);
        return $how;
    }
    xs_zs_foot($zip, $e, (int) hexdec(hash_final($sum)), $done);
    return 'ok';
}

/**
 * The list at the end that makes it a .zip. False when the last bytes could
 * not be written. $big asks for the larger form whatever the size, and
 * $zip['big'] says afterwards which form it is in.
 */
function xs_zs_end(array &$zip, bool $big = false): bool
{
    $fh    = $zip['fh'];
    $start = $zip['at'];
    $big   = $big || count($zip['entries']) > 0xFFFE;
    $cd    = '';
    foreach ($zip['entries'] as $e) {
        $far   = $e['at'] >= 0xFFFFFFFF;
        $extra = $far ? pack('vvP', 1, 8, $e['at']) : '';
        $big   = $big || $far;
        $cd   .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 45, $far ? 45 : 20, 0x0800, $e['method'], $e['time'], $e['date'], $e['crc'], $e['packed'], $e['size'],
                      strlen($e['name']), strlen($extra), 0, 0, 0, 0, $far ? 0xFFFFFFFF : $e['at']) . $e['name'] . $extra;
    }
    $n   = count($zip['entries']);
    $big = $big || $start >= 0xFFFFFFFF || strlen($cd) >= 0xFFFFFFFF;
    $end = '';
    if ($big) {
        $end .= pack('VPvvVVPPPP', 0x06064b50, 44, 45, 45, 0, 0, $n, $n, strlen($cd), $start);
        $end .= pack('VVPV', 0x07064b50, 0, $start + strlen($cd), 1);
    }
    $end .= pack('VvvvvVVv', 0x06054b50, 0, 0, min($n, 0xFFFF), min($n, 0xFFFF),
                 $big ? 0xFFFFFFFF : strlen($cd), $big ? 0xFFFFFFFF : $start, 0);
    $ok = fwrite($fh, $cd . $end) === strlen($cd . $end);
    $ok = fflush($fh) && $ok;
    fclose($fh);
    $zip['fh']  = null;
    $zip['big'] = $big;
    return $ok;
}

/**
 * A .zip just written, read back whole: every file that went in is listed
 * with the size and the sum it went in with, and comes out as that. Answers
 * how many were read, or null with the file and what is wrong with it.
 * $wrote: the writer's own entries. $tick is told of each file as it is read.
 */
function xs_zs_check(string $file, array $wrote, ?callable $tick = null, ?string &$why = null): ?int
{
    $why  = null;
    $list = xs_zs_list($file);
    if ($list === null) {
        $why = 'it cannot be read back as a .zip';
        return null;
    }
    if (count($list) !== count($wrote)) {
        $why = 'it lists ' . count($list) . ' files where ' . count($wrote) . ' went in';
        return null;
    }
    foreach (array_values($wrote) as $n => $w) {
        $e = $list[$w['name']] ?? null;
        if ($e === null || $e['size'] !== $w['size'] || $e['crc'] !== $w['crc']) {
            $why = $w['name'] . ($e === null ? ' is not in it' : ' is not listed as it went in');
            return null;
        }
        $said = null;
        if (!xs_zs_read($file, $e, static fn (string $buf): bool => true, $said)) {
            $why = $w['name'] . ' ' . $said;
            return null;
        }
        if ($tick !== null) {
            $tick($n);
        }
    }
    return count($wrote);
}

/** A .zip's own list, by name: ['name', 'size', 'packed', 'method', 'at', 'crc']. Null when it is not a .zip that can be read. */
function xs_zs_list(string $file): ?array
{
    $size = @filesize($file);
    $fh   = @fopen($file, 'rb');
    if ($fh === false || $size === false || $size < 22) {
        if ($fh !== false) {
            fclose($fh);
        }
        return null;
    }
    $len = (int) min($size, 66000);
    fseek($fh, $size - $len);
    $tail = (string) fread($fh, $len);
    $at   = strrpos($tail, "PK\x05\x06");
    if ($at === false || $at + 22 > strlen($tail)) {
        fclose($fh);
        return null;
    }
    $e = unpack('vcount/Vsize/Vat', substr($tail, $at + 10, 10));
    // Past 4 GB or 65,535 files the real numbers are in a record before this one, which a pointer just ahead of it names.
    if ($e['count'] === 0xFFFF || $e['size'] === 0xFFFFFFFF || $e['at'] === 0xFFFFFFFF) {
        $loc = $at >= 20 ? substr($tail, $at - 20, 20) : '';
        if (substr($loc, 0, 4) !== "PK\x06\x07") {
            fclose($fh);
            return null;
        }
        fseek($fh, unpack('P', substr($loc, 8, 8))[1]);
        $rec = (string) fread($fh, 56);
        if (strlen($rec) < 56 || substr($rec, 0, 4) !== "PK\x06\x06") {
            fclose($fh);
            return null;
        }
        $e = unpack('Pcount/Psize/Pat', substr($rec, 32, 24));
    }
    if ($e['size'] > 256 * 1048576 || $e['at'] + $e['size'] > $size) {
        fclose($fh);
        return null;
    }
    fseek($fh, $e['at']);
    $cd = $e['size'] > 0 ? (string) fread($fh, $e['size']) : '';
    fclose($fh);
    $out = [];
    for ($p = 0, $n = 0; $n < $e['count'] && $p + 46 <= strlen($cd); $n++) {
        if (substr($cd, $p, 4) !== "PK\x01\x02") {
            return null;
        }
        $h = unpack('vmethod/vtime/vdate/Vcrc/Vpacked/Vsize/vname/vextra/vcomment', substr($cd, $p + 10, 24));
        $name  = substr($cd, $p + 46, $h['name']);
        $extra = substr($cd, $p + 46 + $h['name'], $h['extra']);
        $row   = ['name' => $name, 'size' => (int) $h['size'], 'packed' => (int) $h['packed'], 'method' => (int) $h['method'],
                  'at' => (int) unpack('V', substr($cd, $p + 42, 4))[1], 'crc' => (int) $h['crc']];
        // The 64-bit numbers, in this order, each there only when its short form is all ones.
        for ($x = 0; $x + 4 <= strlen($extra);) {
            $f = unpack('vid/vlen', substr($extra, $x, 4));
            if ($f['id'] === 1) {
                $q = $x + 4;
                foreach (['size', 'packed', 'at'] as $k) {
                    if ($row[$k] === 0xFFFFFFFF && $q + 8 <= $x + 4 + $f['len']) {
                        $row[$k] = unpack('P', substr($extra, $q, 8))[1];
                        $q += 8;
                    }
                }
            }
            $x += 4 + $f['len'];
        }
        if (!str_ends_with($name, '/')) {
            $out[$name] = $row;
        }
        $p += 46 + $h['name'] + $h['extra'] + $h['comment'];
    }
    return $out;
}

/**
 * One file out of a .zip, a piece at a time into $sink, and checked against
 * the sum the .zip keeps for it. $sink answers false to stop.
 */
function xs_zs_read(string $file, array $e, callable $sink, ?string &$why = null): bool
{
    $why = null;
    if (!in_array($e['method'], [0, 8], true)) {
        $why = 'is packed in a way Xsegon does not read';
        return false;
    }
    $fh = @fopen($file, 'rb');
    if ($fh === false) {
        $why = 'the .zip could not be opened';
        return false;
    }
    fseek($fh, $e['at']);
    $local = (string) fread($fh, 30);
    if (strlen($local) < 30 || substr($local, 0, 4) !== "PK\x03\x04") {
        fclose($fh);
        $why = 'is not where the .zip says';
        return false;
    }
    $l = unpack('vname/vextra', substr($local, 26, 4));
    fseek($fh, $e['at'] + 30 + $l['name'] + $l['extra']);
    $inflate = $e['method'] === 8 ? inflate_init(ZLIB_ENCODING_RAW) : null;
    $sum  = hash_init('crc32b');
    $left = $e['packed'];
    $out  = 0;
    while ($left > 0 && $why === null) {
        $buf = fread($fh, (int) min(XS_ZS_CHUNK, $left));
        if ($buf === false || $buf === '') {
            $why = 'ends before it should: the .zip is cut short';
            break;
        }
        $left -= strlen($buf);
        if ($inflate !== null) {
            $buf = @inflate_add($inflate, $buf, $left > 0 ? ZLIB_NO_FLUSH : ZLIB_FINISH);
            if ($buf === false) {
                $why = 'could not be unpacked';
                break;
            }
        }
        hash_update($sum, $buf);
        $out += strlen($buf);
        if ($buf !== '' && $sink($buf) === false) {
            $why = 'stopped';
        }
    }
    fclose($fh);
    if ($why === null && ($out !== $e['size'] || (int) hexdec(hash_final($sum)) !== $e['crc'])) {
        $why = 'is damaged: it is not the file that was put in';
    }
    return $why === null;
}

/** One small file out of a .zip, whole, or null. */
function xs_zs_bytes(string $file, array $e, int $most = 64 * 1048576): ?string
{
    if ($e['size'] > $most) {
        return null;
    }
    $all = '';
    return xs_zs_read($file, $e, static function (string $buf) use (&$all): bool { $all .= $buf; return true; }) ? $all : null;
}

/** One file out of a .zip onto the disk: written beside its name first, and given the name only when it is whole. */
function xs_zs_take(string $file, array $e, string $dest, ?callable $tick = null, ?string &$why = null): bool
{
    $why  = null;
    $read = null;
    $part = $dest . '.part';
    $out  = @fopen($part, 'wb');
    if ($out === false) {
        $why = 'could not be written (' . xs_file_error_reason() . ')';
        return false;
    }
    $ok = xs_zs_read($file, $e, static function (string $buf) use ($out, $tick, &$why): bool {
        if (fwrite($out, $buf) !== strlen($buf)) {
            $why = 'could not be written whole (is the drive full?)';
            return false;
        }
        return $tick === null || $tick(strlen($buf)) !== false;
    }, $read);
    fclose($out);
    if (!$ok || !@rename($part, $dest)) {
        $why ??= $read ?? 'could not be given its name (' . xs_file_error_reason() . ')';
        @unlink($part);
        return false;
    }
    return true;
}
