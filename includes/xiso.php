<?php
/**
 * Xsegon - an original Xbox disc image, read and never changed: its XDVDFS file system
 * (a plain XISO, or a full dump with the game after the disc's video part) and the
 * default.xbe it starts.
 *
 *     xs_xbe_id($file)                      the title ID and the code's fingerprint (fan projects)
 *     xs_xiso_list($file) / xs_xiso_write   every file of the game, written out into a folder (Make)
 */
declare(strict_types=1);

const XS_XISO_SECTOR = 2048;
/** Where the game part starts, in bytes: an XISO at once, a full dump of each kind of disc after its video part. */
const XS_XISO_BASES = [0, 0x18300000, 0xFD90000, 0x2080000];

/** An image opened at its game part: its handle, where the part starts and its root folder. Null when it is no Xbox disc. */
function xs_xiso_open(string $file): ?array
{
    $h = @fopen($file, 'rb');
    if ($h === false) {
        return null;
    }
    foreach (XS_XISO_BASES as $base) {
        $d = fseek($h, $base + 32 * XS_XISO_SECTOR) === 0 ? (string) fread($h, 28) : '';
        if (strlen($d) === 28 && substr($d, 0, 20) === 'MICROSOFT*XBOX*MEDIA') {
            $r = unpack('Vat/Vsize', $d, 20);
            return ['h' => $h, 'base' => $base, 'root' => $r['at'], 'size' => $r['size']];
        }
    }
    fclose($h);
    return null;
}

/**
 * One folder's entries: name, sector, size and whether it is a folder. Read in a line through each
 * sector, as entries lie one after another there, so the tree's own links are never followed.
 * Null when the folder cannot be read or names a file no folder on Windows can hold.
 */
function xs_xiso_dir(array $img, int $at, int $size): ?array
{
    if ($size <= 0) {
        return [];
    }
    if ($size > 16 << 20 || fseek($img['h'], $img['base'] + $at * XS_XISO_SECTOR) !== 0) {
        return null;
    }
    $data = (string) fread($img['h'], $size);
    if (strlen($data) !== $size) {
        return null;
    }
    $out = [];
    for ($s = 0; $s < $size; $s += XS_XISO_SECTOR) {
        $end = min($size, $s + XS_XISO_SECTOR);
        for ($o = $s; $o + 14 <= $end;) {
            $e = unpack('vl/vr/Vat/Vsize/Cattr/Clen', $data, $o);
            if (($e['l'] === 0xFFFF && $e['r'] === 0xFFFF) || $e['len'] === 0 || $o + 14 + $e['len'] > $end) {
                break;                       // the rest of the sector is padding
            }
            $name = substr($data, $o + 14, $e['len']);
            if ($name === '.' || $name === '..' || strpbrk($name, "/\\:*?\"<>|\0") !== false) {
                return null;
            }
            $out[] = ['name' => $name, 'at' => $e['at'], 'size' => $e['size'], 'dir' => ($e['attr'] & 0x10) !== 0];
            $o += (14 + $e['len'] + 3) & ~3;
        }
    }
    return $out;
}

/** The disc's default.xbe: its title ID ("5443000D") and the SHA-1 its header keeps of its .text code. Null when it has none. */
function xs_xbe_id(string $file): ?array
{
    $img = xs_xiso_open($file);
    if ($img === null) {
        return null;
    }
    $xbe = null;
    foreach (xs_xiso_dir($img, $img['root'], $img['size']) ?? [] as $e) {
        if (!$e['dir'] && strtolower($e['name']) === 'default.xbe') {
            $xbe = $e;
        }
    }
    $d = '';
    if ($xbe !== null && fseek($img['h'], $img['base'] + $xbe['at'] * XS_XISO_SECTOR) === 0) {
        $d = (string) fread($img['h'], min($xbe['size'], 65536));
    }
    fclose($img['h']);
    if (strlen($d) < 0x180 || substr($d, 0, 4) !== 'XBEH') {
        return null;
    }
    // Every address in the header is where it is loaded; less the base, where it is in the file.
    $base = unpack('V', $d, 0x104)[1];
    $cert = unpack('V', $d, 0x118)[1] - $base;
    $n = unpack('V', $d, 0x11C)[1];
    $table = unpack('V', $d, 0x120)[1] - $base;
    if ($cert < 0 || $cert + 12 > strlen($d)) {
        return null;
    }
    $code = null;
    for ($i = 0; $i < min($n, 64) && $table >= 0 && $table + ($i + 1) * 56 <= strlen($d); $i++) {
        $at = unpack('V', $d, $table + $i * 56 + 20)[1] - $base;
        if ($at >= 0 && $at < strlen($d) && explode("\0", substr($d, $at, 16), 2)[0] === '.text') {
            $code = bin2hex(substr($d, $table + $i * 56 + 36, 20));
        }
    }
    return ['title' => sprintf('%08X', unpack('V', $d, $cert + 8)[1]), 'code' => $code];
}

/** Every file of the game with where it is on the disc ('path' with / between folders), or null with $why. */
function xs_xiso_list(string $file, ?string &$why = null): ?array
{
    $why = null;
    $img = xs_xiso_open($file);
    if ($img === null) {
        $why = 'file is not an Xbox disc image Xsegon can read';
        return null;
    }
    $files = [];
    $walk = static function (int $at, int $size, string $in, int $depth) use (&$walk, &$files, $img): bool {
        $list = $depth > 32 || count($files) > 200000 ? null : xs_xiso_dir($img, $at, $size);
        if ($list === null) {
            return false;
        }
        foreach ($list as $e) {
            if (!$e['dir']) {
                $files[] = ['path' => $in . $e['name'], 'at' => $e['at'], 'size' => $e['size']];
            } elseif (!$walk($e['at'], $e['size'], $in . $e['name'] . '/', $depth + 1)) {
                return false;
            }
        }
        return true;
    };
    $ok = $walk($img['root'], $img['size'], '', 0);
    fclose($img['h']);
    if (!$ok || !array_filter($files, static fn($f) => strtolower($f['path']) === 'default.xbe')) {
        $why = 'disc image could not be read through (a folder of it is damaged, or it has no default.xbe)';
        return null;
    }
    return $files;
}

/**
 * The files xs_xiso_list() found written into $dir, in its folders. $tick(bytes so far) is told
 * as it goes and stops it by answering false. The bytes written, or null with $why.
 */
function xs_xiso_write(string $file, array $files, string $dir, callable $tick, ?string &$why = null): ?int
{
    $why = null;
    $img = xs_xiso_open($file);
    if ($img === null) {
        $why = 'your disc image could not be opened';
        return null;
    }
    $done = 0;
    foreach ($files as $f) {
        $to = $dir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $f['path']);
        if (!is_dir(dirname($to)) && !@mkdir(dirname($to), 0777, true) && !is_dir(dirname($to))) {
            $why = 'the folder ' . dirname($to) . ' could not be made (' . xs_file_error_reason() . ')';
            break;
        }
        $out = @fopen($to, 'wb');
        if ($out === false || fseek($img['h'], $img['base'] + $f['at'] * XS_XISO_SECTOR) !== 0) {
            $why = $f['path'] . ' could not be written out (' . xs_file_error_reason() . ')';
            break;
        }
        for ($left = $f['size']; $left > 0 && $why === null;) {
            $b = (string) fread($img['h'], min($left, 4194304));
            if ($b === '') {
                $why = 'your disc image ends before ' . $f['path'] . ' does: it may be cut short';
            } elseif (fwrite($out, $b) !== strlen($b)) {
                $why = $f['path'] . ' could not be written out (' . xs_file_error_reason() . ')';
            } else {
                $left -= strlen($b);
                $done += strlen($b);
                if ($tick($done) === false) {
                    $why = 'stopped';
                }
            }
        }
        fclose($out);
        if ($why !== null) {
            break;
        }
    }
    fclose($img['h']);
    return $why === null ? $done : null;
}
