<?php
/**
 * Xsegon - an xdelta patch put on a game: VCDIFF (RFC 3284) as xdelta3 writes it.
 *
 * Plain VCDIFF only: no second packing (xdelta3's -S) and no code table of the patch's
 * own, which Smash Remix's patches never use. Each window's Adler-32, where xdelta3
 * wrote one, is checked against what the window made, so a patch that came damaged or
 * was made for another file stops with the reason and nothing is kept.
 */
declare(strict_types=1);

/** RFC 3284's default code table: [type, size, mode] twice a row; 0 nothing, 1 ADD, 2 RUN, 3 COPY. */
function xs_vcdiff_table(): array
{
    static $t = null;
    if ($t !== null) {
        return $t;
    }
    $t = [[2, 0, 0, 0, 0, 0]];
    for ($s = 0; $s <= 17; $s++) {
        $t[] = [1, $s, 0, 0, 0, 0];
    }
    for ($m = 0; $m < 9; $m++) {
        $t[] = [3, 0, $m, 0, 0, 0];
        for ($s = 4; $s <= 18; $s++) {
            $t[] = [3, $s, $m, 0, 0, 0];
        }
    }
    for ($m = 0; $m < 6; $m++) {
        for ($a = 1; $a <= 4; $a++) {
            for ($c = 4; $c <= 6; $c++) {
                $t[] = [1, $a, 0, 3, $c, $m];
            }
        }
    }
    for ($m = 6; $m < 9; $m++) {
        for ($a = 1; $a <= 4; $a++) {
            $t[] = [1, $a, 0, 3, 4, $m];
        }
    }
    for ($m = 0; $m < 9; $m++) {
        $t[] = [3, 4, $m, 1, 1, 0];
    }
    return $t;
}

/** One of VCDIFF's numbers: seven bits a byte, high byte first, the top bit saying more follow. */
function xs_vcdiff_int(string $s, int &$p, int $end): ?int
{
    $v = 0;
    for ($n = 0; $n < 9; $n++) {
        if ($p >= $end) {
            return null;
        }
        $b = ord($s[$p++]);
        $v = ($v << 7) | ($b & 127);
        if (($b & 128) === 0) {
            return $v;
        }
    }
    return null;
}

/**
 * The patched bytes, or null with $why. $tick(done, of) is told the patch's bytes read
 * after each window, for a bar. $checked: how many windows carried a checksum, all matched.
 */
function xs_vcdiff_apply(string $src, string $p, ?string &$why = null, ?callable $tick = null, ?array &$checked = null): ?string
{
    $why = null;
    $checked = ['windows' => 0, 'summed' => 0];
    $n = strlen($p);
    if ($n < 5 || substr($p, 0, 3) !== "\xD6\xC3\xC4") {
        $why = 'the patch is not an xdelta file';
        return null;
    }
    $hdr = ord($p[4]);
    if ($hdr & 1) {
        $why = 'the patch is packed a second time (xdelta\'s -S), which Xsegon cannot read';
        return null;
    }
    if ($hdr & 2) {
        $why = 'the patch brings a code table of its own, which Xsegon cannot read';
        return null;
    }
    $at = 5;
    if ($hdr & 4) {                          // xdelta3 names its files here
        $skip = xs_vcdiff_int($p, $at, $n);
        $at += (int) $skip;
    }
    $short = 'the patch ends early: it may not have come whole';
    $table = xs_vcdiff_table();
    $out = '';
    $windows = 0;
    while ($at < $n) {
        $win = ord($p[$at++]);
        $seg = '';
        if ($win & 3) {
            $len = xs_vcdiff_int($p, $at, $n);
            $pos = xs_vcdiff_int($p, $at, $n);
            $from = ($win & 1) ? $src : $out;
            if ($len === null || $pos === null || $pos + $len > strlen($from)) {
                $why = ($win & 1) ? 'the patch reaches past the end of the game it was made for: it was made for another file' : $short;
                return null;
            }
            $seg = substr($from, $pos, $len);
        }
        $enc = xs_vcdiff_int($p, $at, $n);   // the length of what follows: read to move past it
        $tlen = xs_vcdiff_int($p, $at, $n);
        if ($enc === null || $tlen === null || $at >= $n) {
            $why = $short;
            return null;
        }
        if (ord($p[$at++]) !== 0) {
            $why = 'the patch packs its sections, which Xsegon cannot read';
            return null;
        }
        $dlen = xs_vcdiff_int($p, $at, $n);
        $ilen = xs_vcdiff_int($p, $at, $n);
        $alen = xs_vcdiff_int($p, $at, $n);
        if ($dlen === null || $ilen === null || $alen === null) {
            $why = $short;
            return null;
        }
        $sum = null;
        if ($win & 4) {                      // xdelta3's Adler-32 of what this window makes
            $sum = bin2hex(substr($p, $at, 4));
            $at += 4;
        }
        $d = $at;
        $dend = $d + $dlen;
        $i = $dend;
        $iend = $i + $ilen;
        $a = $iend;
        $aend = $a + $alen;
        if ($aend > $n) {
            $why = $short;
            return null;
        }
        $at = $aend;
        $slen = strlen($seg);
        $t = '';
        $near = [0, 0, 0, 0];
        $next = 0;
        $same = array_fill(0, 768, 0);
        while ($i < $iend) {
            $e = $table[ord($p[$i++])];
            for ($k = 0; $k < 6; $k += 3) {
                $type = $e[$k];
                if ($type === 0) {
                    continue;
                }
                $size = $e[$k + 1];
                if ($size === 0 && ($size = xs_vcdiff_int($p, $i, $iend)) === null) {
                    $why = $short;
                    return null;
                }
                if ($type === 1) {           // ADD: bytes from the patch
                    $t .= substr($p, $d, $size);
                    $d += $size;
                    continue;
                }
                if ($type === 2) {           // RUN: one byte, again and again
                    $t .= str_repeat($p[$d++], $size);
                    continue;
                }
                // COPY: from the game, or from what this window has made so far
                $mode = $e[$k + 2];
                $here = $slen + strlen($t);
                if ($mode < 6) {
                    $v = xs_vcdiff_int($p, $a, $aend);
                    if ($v === null) {
                        $why = $short;
                        return null;
                    }
                    $addr = $mode === 0 ? $v : ($mode === 1 ? $here - $v : $near[$mode - 2] + $v);
                } else {
                    $addr = $same[($mode - 6) * 256 + ord($p[$a++])];
                }
                $near[$next] = $addr;
                $next = ($next + 1) & 3;
                $same[$addr % 768] = $addr;
                if ($addr < 0 || $addr >= $here) {
                    $why = 'the patch does not read as an xdelta to its end';
                    return null;
                }
                if ($addr + $size <= $slen) {
                    $t .= substr($seg, $addr, $size);
                    continue;
                }
                if ($addr < $slen) {
                    $t .= substr($seg, $addr, $slen - $addr);
                    $size -= $slen - $addr;
                    $addr = $slen;
                }
                // From what is being made: where it reaches into itself, a run repeats.
                $back = $addr - $slen;
                $gap = strlen($t) - $back;
                $t .= $gap >= $size ? substr($t, $back, $size) : substr(str_repeat(substr($t, $back, $gap), intdiv($size, $gap) + 1), 0, $size);
            }
        }
        if (strlen($t) !== $tlen || $d !== $dend || $a !== $aend) {
            $why = 'the patch does not read as an xdelta to its end';
            return null;
        }
        if ($sum !== null && hash('adler32', $t) !== $sum) {
            $why = 'the patch\'s own checksum does not match what it made: it came damaged, or was made for another file';
            return null;
        }
        $out .= $t;
        $windows++;
        $checked = ['windows' => $windows, 'summed' => $checked['summed'] + ($sum !== null ? 1 : 0)];
        if ($tick !== null) {
            $tick($at, $n);
        }
    }
    if ($windows === 0) {
        $why = 'the patch holds nothing to make';
        return null;
    }
    return $out;
}
