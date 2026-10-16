<?php
/**
 * Xsegon - a PlayStation .pbp's discs, written back out as the disc images they were made from.
 *
 * A .pbp made by PSX2PSP or popstation keeps each disc (a PSISOIMG, or up to five under a
 * PSTITLEIMG) as blocks of 16 sectors of 2352 bytes, most of them deflated, with the disc's
 * table of contents and a table saying where each block is. Nothing in the .pbp is changed.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** 16 sectors of 2352 bytes: what one block holds once inflated. */
const XS_PBP_BLOCK = 0x9300;
/** Where a disc's blocks start, from the start of its PSISOIMG; its block table is at 0x4000, 32 bytes a block. */
const XS_PBP_DATA = 0x100000;

function xs_pbp_bcd(string $b): int
{
    $v = ord($b);
    return ($v >> 4) * 10 + ($v & 15);
}

/**
 * The discs a .pbp holds, in order: each one's ID ("SCUS-94491"), where it starts, its sectors,
 * its tracks and its block table. Null with $why when it is no .pbp Xsegon can read.
 */
function xs_pbp_discs(string $file, ?string &$why = null): ?array
{
    $why = null;
    $h = @fopen($file, 'rb');
    if ($h === false) {
        $why = 'it could not be opened (' . xs_file_error_reason() . ')';
        return null;
    }
    $head = (string) fread($h, 40);
    $psar = strlen($head) === 40 && substr($head, 0, 4) === "\0PBP" ? unpack('V', $head, 0x24)[1] : -1;
    $top = $psar > 0 && fseek($h, $psar) === 0 ? (string) fread($h, 0x214) : '';
    $at = str_starts_with($top, 'PSTITLEIMG') && strlen($top) === 0x214 ? array_values(array_filter(unpack('V5', $top, 0x200)))
        : (str_starts_with($top, 'PSISOIMG') ? [0] : []);
    if (!$at) {
        fclose($h);
        $why = 'it is not a .pbp of PlayStation discs';
        return null;
    }
    $discs = [];
    foreach ($at as $n => $o) {
        $start = $psar + $o;
        $hd = fseek($h, $start) === 0 ? (string) fread($h, XS_PBP_DATA) : '';
        if (strlen($hd) !== XS_PBP_DATA || !str_starts_with($hd, 'PSISOIMG0000')) {
            fclose($h);
            $why = 'disc ' . ($n + 1) . ' in it does not start as a disc does';
            return null;
        }
        // Its table of contents, 10 bytes a line from 0x800: point 0xA2 is where the disc ends, 1 to 99 its tracks.
        $sectors = 0;
        $tracks = [];
        for ($t = 0x800; $t + 10 <= 0xC00; $t += 10) {
            $point = ord($hd[$t + 2]);
            $frames = (xs_pbp_bcd($hd[$t + 7]) * 60 + xs_pbp_bcd($hd[$t + 8])) * 75 + xs_pbp_bcd($hd[$t + 9]);
            if ($point === 0xA2) {
                $sectors = $frames;
            } elseif ($point >= 1 && $point <= 0x99 && ord($hd[$t]) !== 0) {
                $tracks[] = ['no' => xs_pbp_bcd($hd[$t + 2]), 'data' => (ord($hd[$t]) & 0x40) !== 0, 'at' => $frames];
            }
        }
        $blocks = intdiv($sectors + 15, 16);
        if ($sectors <= 0 || !$tracks || 0x4000 + $blocks * 32 > XS_PBP_DATA) {
            fclose($h);
            $why = 'disc ' . ($n + 1) . ' in it has no table of contents Xsegon can read';
            return null;
        }
        preg_match('/^_?([A-Z]{4})_(\d{5})/', substr($hd, 0x400, 16), $m);
        $discs[] = ['id' => $m ? $m[1] . '-' . $m[2] : null, 'start' => $start, 'sectors' => $sectors, 'tracks' => $tracks,
                    'index' => substr($hd, 0x4000, $blocks * 32)];
    }
    fclose($h);
    return $discs;
}

/**
 * One disc of a .pbp written out as a .bin of 2352-byte sectors, through a .part file.
 * $tick(blocks done, blocks in all) is told as it goes and stops it by answering false.
 * False with $why.
 */
function xs_pbp_write(string $file, array $disc, string $out, ?callable $tick = null, ?string &$why = null): bool
{
    $why = null;
    $in = @fopen($file, 'rb');
    $to = $in === false ? false : @fopen($out . '.part', 'wb');
    if ($in === false || $to === false) {
        $why = ($in === false ? 'the .pbp' : $out) . ' could not be opened (' . xs_file_error_reason() . ')';
        if ($in !== false) {
            fclose($in);
        }
        return false;
    }
    $left = $disc['sectors'] * 2352;
    $blocks = intdiv(strlen($disc['index']), 32);
    $ok = true;
    for ($i = 0; $i < $blocks && $left > 0; $i++) {
        $e = unpack('Voff/vlen', $disc['index'], $i * 32);
        $raw = $e['len'] > 0 && fseek($in, $disc['start'] + XS_PBP_DATA + $e['off']) === 0 ? (string) fread($in, $e['len']) : '';
        // A block stored whole is as long as an inflated one; any other is deflated.
        $data = strlen($raw) === XS_PBP_BLOCK ? $raw : (strlen($raw) === $e['len'] && $raw !== '' ? @gzinflate($raw) : false);
        if (!is_string($data) || strlen($data) !== XS_PBP_BLOCK || ($i === 0 && substr($data, 0, 12) !== "\0" . str_repeat("\xFF", 10) . "\0")) {
            $why = 'block ' . ($i + 1) . ' of ' . $blocks . ' could not be read: the .pbp is damaged, or made in a way Xsegon does not read';
            $ok = false;
            break;
        }
        $take = min(XS_PBP_BLOCK, $left);
        if (fwrite($to, $take === XS_PBP_BLOCK ? $data : substr($data, 0, $take)) !== $take) {
            $why = $out . ' could not be written (' . xs_file_error_reason() . ')';
            $ok = false;
            break;
        }
        $left -= $take;
        if ($tick !== null && $i % 64 === 0 && $tick($i, $blocks) === false) {
            $why = 'stopped';
            $ok = false;
            break;
        }
    }
    fclose($in);
    fclose($to);
    if ($ok && $left > 0) {
        $why = 'the .pbp ends before its disc does';
        $ok = false;
    }
    if (!$ok || !@rename($out . '.part', $out)) {
        $why ??= $out . ' could not be put in place (' . xs_file_error_reason() . ')';
        @unlink($out . '.part');
        return false;
    }
    return true;
}

/** The .cue beside a .bin written from a .pbp: its tracks, as its table of contents gives them. */
function xs_pbp_cue(array $disc, string $bin): string
{
    $cue = 'FILE "' . basename($bin) . '" BINARY' . "\r\n";
    $first = $disc['tracks'][0]['at'];
    foreach ($disc['tracks'] as $t) {
        $f = $t['at'] - $first;
        $cue .= sprintf("  TRACK %02d %s\r\n", $t['no'], $t['data'] ? 'MODE2/2352' : 'AUDIO')
              . sprintf("    INDEX 01 %02d:%02d:%02d\r\n", intdiv($f, 4500), intdiv($f, 75) % 60, $f % 75);
    }
    return $cue;
}
