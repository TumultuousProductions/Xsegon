<?php
/**
 * A person's sittings, read off the day logs: each time Xsegon was open, from
 * when to when, what was played and opened, and whether a controller was
 * found. For a report (includes\report.php), so "how often did they come
 * back, and what did they do" is answered without reading the log.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** Seconds with nothing written that end a sitting, unless a game was on. */
const XS_SITTING_GAP = 600;

/** How many sittings a report shows, the newest ones. */
const XS_SITTINGS_SHOWN = 30;

/** The controllers that pressed a button in Xsegon, by the browser's name for each, from these day logs. */
function xs_sittings_pads(array $files): array
{
    $ids = [];
    foreach ($files as $path) {
        foreach (@file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            if (preg_match('/^\S+ P PAD\s+seen: (.+?) \| /', $line, $m)) {
                $ids[$m[1]] = true;
            }
        }
    }
    return array_keys($ids);
}

/**
 * $files: day (YYYY-MM-DD) => that day's log. Each sitting comes back with
 * its times, its plays, what was opened, the presses, the controllers and
 * the trouble lines, oldest first.
 */
function xs_sittings(array $files): array
{
    ksort($files);
    $rows = [];
    foreach ($files as $day => $path) {
        $base = strtotime($day . ' 00:00:00');
        if ($base === false) {
            continue;
        }
        foreach (@file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            if (preg_match('/^(\d\d):(\d\d):(\d\d)\.(\d{3}) ([SP]) (\S+)\s*(.*)$/', $line, $m)) {
                $rows[] = [$base + (int) $m[1] * 3600 + (int) $m[2] * 60 + (int) $m[3] + (int) $m[4] / 1000, $m[5], $m[6], $m[7]];
            }
        }
    }
    // The page's lines arrive in batches, behind server lines written later: by their time, not their place.
    usort($rows, static fn(array $a, array $b): int => $a[0] <=> $b[0]);

    $new = static fn(float $t): array => ['from' => $t, 'to' => $t, 'page' => 0, 'startup' => null, 'plays' => [], 'did' => [],
        'opened' => [], 'details' => [], 'clicks' => 0, 'keys' => 0, 'settings' => 0, 'pads' => [], 'windows' => [],
        'trouble' => [], 'busy' => 0, 'restarts' => 0];
    $out = [];
    $cur = null;
    $last = 0.0;
    $left = 0.0;             // when the page last said it was leaving
    $restart = 0.0;          // when the watchdog last restarted the window
    $burst = 0.0;            // when the lines now arriving began, after half a minute of none
    $before = 0.0;           // the last line ahead of them
    $burstPage = true;       // whether the page wrote any of them
    $playing = false;
    foreach ($rows as [$t, $who, $code, $msg]) {
        if ($last > 0 && $t - $last >= 30) {
            $before = $last;
            $burst = $t;
            $burstPage = false;
        }
        $burstPage = $burstPage || $who === 'P';
        $opening = ($who === 'S' && $code === 'WIN' && str_starts_with($msg, 'opened the app window'))
                || ($who === 'P' && $code === 'BOOT' && str_starts_with($msg, 'page ') && $left > 0 && $t - $left >= 30);
        // A window the watchdog restarted is the same sitting, and so are a start's own lines before its window.
        $fresh = $opening && $cur !== null && $cur['page'] > 0 && $t - $restart > 120;
        if ($cur === null || $fresh || (!$playing && $t - $last >= XS_SITTING_GAP)) {
            $from = $t;
            if ($cur !== null) {
                // A start writes a line or two before its window is up: those are the new sitting's, not the last one's.
                if ($fresh && !$burstPage && $burst > $cur['from'] && $t - $burst <= 120) {
                    $cur['to'] = $before;
                    $from = $burst;
                }
                $out[] = $cur;
            }
            $cur = $new($from);
            $playing = false;
        }
        $last = $t;
        $cur['to'] = $t;
        if ($who === 'P') {
            $cur['page']++;
        }
        if (in_array($code, ['ERR', 'BUG', 'WARN', 'PHPE', 'FAIL', 'WRIT'], true)) {
            $cur['trouble'][$code] = ($cur['trouble'][$code] ?? 0) + 1;
        } elseif ($code === 'BUSY') {
            $cur['busy']++;
        } elseif ($who === 'P' && $code === 'CLK') {
            $cur['clicks']++;
        } elseif ($who === 'P' && $code === 'KEY') {
            $cur['keys']++;
        } elseif ($who === 'P' && $code === 'PAD') {
            if (preg_match('/^seen: (.+?) \| /', $msg, $m)) {
                $cur['pads'][$m[1]] = true;
            }
        } elseif ($who === 'S' && $code === 'PAD') {
            if (preg_match('/^(Windows (?:lists|could not be asked).*?)(?: \((?:as|when) [^()]*\))?$/', $msg, $m)) {
                $cur['windows'][$m[1]] = true;
            }
        } elseif ($who === 'P' && $code === 'BOOT') {
            if ($msg === 'leave' || str_starts_with($msg, 'leave ')) {
                $left = $t;
            } elseif ($cur['startup'] === null && preg_match('/^start-up took (\d+)ms/', $msg, $m)) {
                $cur['startup'] = (int) $m[1];
            }
        } elseif ($who === 'S' && $code === 'LNCH') {
            if (str_starts_with($msg, 'run ')) {
                $playing = true;
            } elseif (preg_match('/^end (.+) (\d+)s exit (-?\d+)/', $msg, $m)) {
                $playing = false;
                $cur['plays'][] = ['title' => $m[1], 'seconds' => (int) $m[2], 'exit' => (int) $m[3]];
            }
        } elseif ($who === 'P' && $code === 'ED') {
            if (!str_starts_with($msg, 'close ')) {
                $name = trim((string) preg_replace('/ \[\*\d+\]$/', '', $msg));
                $cur['opened'][$name] = ($cur['opened'][$name] ?? 0) + 1;
            }
        } elseif ($who === 'P' && $code === 'NAV') {
            if (str_starts_with($msg, 'settings')) {
                $cur['opened']['Settings'] = ($cur['opened']['Settings'] ?? 0) + 1;
            } elseif (preg_match('/^details (?!tab )(.+?)(?: \[\*\d+\])?$/', $msg, $m)) {
                $cur['details'][$m[1]] = true;
            }
        } elseif ($who === 'S' && $code === 'SET') {
            $cur['settings']++;
        } elseif ($who === 'S' && $code === 'WDOG' && str_starts_with($msg, 'restarting the app window')) {
            $restart = $t;
            $cur['restarts']++;
        } elseif ($who === 'S') {
            $did = match (true) {
                $code === 'SETUP' && str_starts_with($msg, 'setting up begins') => 'Set it all up',
                $code === 'FILL' && str_starts_with($msg, 'started') => 'Get Pictures',
                $code === 'ARCV' && str_starts_with($msg, 'asked to fetch') => 'Videos from online archives',
                $code === 'RPT' && str_starts_with($msg, 'made ') => 'made a report',
                $code === 'RA' && str_starts_with($msg, 'opened') => 'opened RetroArch by itself',
                $code === 'RA' && str_starts_with($msg, 'closed after') => 'RetroArch ' . (string) preg_replace('/ \(.*$/', '', $msg),
                default => null,
            };
            if ($did !== null) {
                $cur['did'][$did] = ($cur['did'][$did] ?? 0) + 1;
            }
        }
    }
    if ($cur !== null) {
        $out[] = $cur;
    }
    // A start that never got a page (a server started and stopped) is not a sitting.
    return array_values(array_filter($out, static fn(array $s): bool => $s['page'] > 0));
}

/** Seconds as a person says them. */
function xs_sittings_span(int $secs): string
{
    return $secs < 120 ? $secs . ' s' : (int) round($secs / 60) . ' min';
}

/** The sittings as the section of report.txt, or one sentence when there are none to tell. */
function xs_sittings_text(array $sittings): string
{
    $out = "SITTINGS: EACH TIME XSEGON WAS OPEN IN THE LOGS OF THIS ZIP\n" . str_repeat('-', 68) . "\n";
    if (!$sittings) {
        return $out . "None can be told: the logs hold no line from the page. With logging off\n(Settings > Debug) there is nothing to read them from.\n";
    }
    $count = count($sittings);
    $shown = array_slice($sittings, -XS_SITTINGS_SHOWN, null, true);
    if ($count > count($shown)) {
        $out .= 'The last ' . count($shown) . ' of ' . $count . ".\n";
    }
    $many = static function (array $counts, int $limit): string {
        $said = [];
        foreach (array_slice($counts, 0, $limit, true) as $name => $n) {
            $said[] = $name . ($n > 1 ? ' x' . $n : '');
        }
        return implode('; ', $said) . (count($counts) > $limit ? '; and ' . (count($counts) - $limit) . ' more' : '');
    };
    foreach ($shown as $i => $s) {
        $secs = (int) round($s['to'] - $s['from']);
        $day  = date('j M', (int) $s['from']);
        $end  = date('j M', (int) $s['to']) === $day ? date('H:i', (int) $s['to']) : date('j M H:i', (int) $s['to']);
        $out .= str_pad(($i + 1) . '.', 4) . $day . ' ' . date('H:i', (int) $s['from']) . ' to ' . $end
              . ' (' . ($secs < 60 ? 'under a minute' : (int) round($secs / 60) . ' min') . ')'
              . ($s['startup'] !== null ? '. Start-up ' . number_format($s['startup'] / 1000, 1) . ' s' : '')
              . ($s['restarts'] ? '. The window was restarted ' . $s['restarts'] . ($s['restarts'] === 1 ? ' time' : ' times') : '') . ".\n";
        $row = static fn(string $label, string $says): string => '    ' . str_pad($label, 12) . $says . "\n";
        if ($s['plays']) {
            $plays = array_map(static fn(array $p): string => $p['title'] . ' ' . xs_sittings_span($p['seconds'])
                . ($p['exit'] !== 0 ? ' (ended with ' . $p['exit'] . ')' : ''), array_slice($s['plays'], 0, 8));
            $out .= $row('Played', count($s['plays']) . (count($s['plays']) === 1 ? ' time: ' : ' times: ') . implode('; ', $plays)
                  . (count($s['plays']) > 8 ? '; and ' . (count($s['plays']) - 8) . ' more' : ''));
        }
        if ($s['did']) {
            $out .= $row('Did', $many($s['did'], 10));
        }
        if ($s['opened'] || $s['details']) {
            $opened = $s['opened'];
            if ($s['details']) {
                $opened['the details of ' . count($s['details']) . (count($s['details']) === 1 ? ' game' : ' games')] = 1;
            }
            $out .= $row('Opened', $many($opened, 12));
        }
        $out .= $row('Pressed', $s['clicks'] . ($s['clicks'] === 1 ? ' click, ' : ' clicks, ') . $s['keys'] . ($s['keys'] === 1 ? ' key' : ' keys')
              . ($s['settings'] ? ', ' . $s['settings'] . ($s['settings'] === 1 ? ' setting changed' : ' settings changed') : ''));
        $pads = array_keys($s['pads']);
        $out .= $row('Controller', ($pads ? 'pressed a button: ' . implode('; ', $pads) : 'none pressed a button')
              . ($s['windows'] ? '. ' . implode(', then: ', array_keys($s['windows'])) : ''));
        if ($s['trouble'] || $s['busy']) {
            $said = [];
            foreach ($s['trouble'] as $code => $n) {
                $said[] = $n . ' ' . $code;
            }
            if ($s['busy']) {
                $said[] = $s['busy'] . ' BUSY (the PC was slow: those lines say with what)';
            }
            $out .= $row('Trouble', implode(', ', $said));
        }
    }
    return $out . "A sitting ends when the window closes, or when nothing is written for\n10 minutes with no game on.\n";
}
