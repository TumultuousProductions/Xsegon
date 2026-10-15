<?php
/**
 * Xsegon - new games in your games folders, added by themselves (roadmap AL7).
 *
 *     data\newgames-job.json   the look at work, or the last one: why it ran,
 *                              what came, what was left for Scan for Games
 *     data\newgames-told.json  the files the mailbox has named as not sure of
 *
 * The page asks at its start and when its window comes back to the front
 * (js\newgames.js). The look is Scan for Games' own (xs_scan_walk), run by
 * bin\newgames.php so the server is never held by a big library. Only what
 * Scan for Games would add with no question comes in; the rest waits for it,
 * named once in the mailbox.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/scan.php';

const XS_NG_GAP_S   = 30;     // the least time between two looks, whoever asks
const XS_NG_FRESH_S = 30;     // a file younger than this may still be copying
const XS_NG_MOST    = 100;    // more new games than this at once is a choice for Scan for Games
const XS_NG_CHECKS  = 30;     // cartridges checked against their console's list in one look

function xs_ng_job_path(): string  { return xs_data_path('newgames-job.json'); }
function xs_ng_told_path(): string { return xs_data_path('newgames-told.json'); }

function xs_ng_job(): array
{
    $j = xs_read_json(xs_ng_job_path(), []);
    return is_array($j) ? $j : [];
}

function xs_ng_on(): bool
{
    return (xs_settings()['library']['addNewGames'] ?? true) !== false;
}

/** A look at work: its worker alive, however long it takes on a slow drive. A dead one never holds the next. */
function xs_ng_busy(array $job): bool
{
    return ($job['state'] ?? '') === 'running' && xs_job_dead($job, xs_ng_job_path()) === null;
}

/**
 * One look, started in the background; false with $no saying why not. The
 * guardrails are here, so no page can ask too often.
 */
function xs_ng_start(string $why, ?string &$no = null): bool
{
    $no = null;
    if (!xs_ng_on()) {
        $no = 'switched off in Settings > Library';
        return false;
    }
    $job = xs_ng_job();
    if (xs_ng_busy($job)) {
        $no = 'a look is at work already';
        return false;
    }
    $last = (int) ($job['ended'] ?? $job['started'] ?? 0);
    if ($last > 0 && time() - $last < XS_NG_GAP_S) {
        $no = 'the last look was ' . (time() - $last) . ' seconds ago';
        return false;
    }
    // A look reads the whole games drive: not while a game wants it.
    if (xs_game_running() !== null) {
        $no = 'a game is running';
        return false;
    }
    require_once __DIR__ . '/unpack.php';
    if (xs_unpack_running()) {
        $no = 'Unpack and add is at work, and adds its own games';
        return false;
    }
    if (!xs_scan_roots()) {
        $no = 'no games folder chosen yet';
        return false;
    }
    $job = ['state' => 'running', 'why' => $why, 'started' => time(), 'beat' => time()];
    if (!xs_write_json(xs_ng_job_path(), $job, $w)) {
        $no = 'its file could not be written: ' . $w;
        return false;
    }
    if (!xs_spawn_worker('newgames.php')) {
        $no = 'it could not be started';
        xs_write_json(xs_ng_job_path(), ['state' => 'failed', 'error' => $no, 'ended' => time()] + $job);
        return false;
    }
    return true;
}

/**
 * The walk's offer cut down to what Scan for Games would add with no question.
 * Answers [add, left, fresh]: left rows carry why. Nothing here changes a file
 * but the file check's own answers (kept by game id, as Scan for Games keeps them).
 */
function xs_ng_sort(array $found): array
{
    require_once __DIR__ . '/filecheck.php';
    require_once __DIR__ . '/hackof.php';
    require_once __DIR__ . '/accompanied.php';
    $noEmu = array_flip($found['noEmulator'] ?? []);
    // A disc set that plays as Disc 1 until its playlist is written: Scan for Games offers the playlist.
    $sets = [];
    foreach ($found['m3u'] ?? [] as $o) {
        foreach ($o['discs'] as $d) {
            $sets[strtolower($o['dir'] . DIRECTORY_SEPARATOR . $d)] = true;
        }
    }
    $add = $left = $fresh = [];
    $checks = 0;
    foreach ($found['new'] ?? [] as $row) {
        $rom = (string) $row['rom'];
        $why = null;
        if (isset($noEmu[$row['platform']])) {
            $why = 'no emulator for ' . $row['platform'] . ' yet';
        } elseif (isset($sets[strtolower($rom)])) {
            $why = 'a disc set waiting for its playlist';
        } elseif (xs_fc_guess($rom, null) === 'hack' || xs_acc_kind_from_name($rom) !== null) {
            $why = xs_acc_kind_from_name($rom) !== null ? 'its name says it is not played' : 'its name says it may be a hack';
        } elseif ($checks < XS_NG_CHECKS && xs_fc_can((string) $row['platform']) && xs_ng_list_fresh((string) $row['platform'])) {
            // A cartridge whose console's list is here already: its checksum says whether it is a patched game.
            $checks++;
            $g = ['id' => $row['id'], 'platform' => $row['platform'], 'romPath' => $rom];
            $rec = xs_fc_check($g);
            if (xs_hackof_may($g, is_array($rec) ? $rec : null, []) === 'ask') {
                $why = 'its checksum says it may be a hack';
            }
        }
        if ($why !== null) {
            $left[] = $row + ['why' => $why];
            continue;
        }
        /* Still being copied, perhaps: the next look takes it. A copy in Explorer
           is written under its own name and given the original's time only at
           its end, so a time of now is a file still arriving. */
        if ((int) @filemtime($rom) > time() - XS_NG_FRESH_S) {
            $fresh[] = $row;
            continue;
        }
        $add[] = $row;
    }
    return [$add, $left, $fresh];
}

/** A console's list is kept and fresh, so a check fetches nothing (as xs_hackof_check_new asks). */
function xs_ng_list_fresh(string $platform): bool
{
    $have = xs_read_json(xs_lr_cache_name((string) xs_lr_system($platform), 'releases'), null);
    return is_array($have) && time() - (int) ($have['at'] ?? 0) < XS_LR_KEEP_DAYS * 86400;
}

/**
 * What Scan for Games has to settle and the mailbox has not named yet: the
 * offer left out, archives, files whose console could not be told, second
 * copies, disc sets with holes and dumps with no cue sheet. Named once each.
 */
function xs_ng_unsure(array $found, array $left): array
{
    $all = [];
    foreach ($left as $r) {
        $all[strtolower((string) $r['rom'])] = basename((string) $r['rom']) . ': ' . $r['why'];
    }
    // An archive whose game stands unpacked already is not one to settle (includes\unpack.php).
    require_once __DIR__ . '/unpack.php';
    $still = xs_unpack_sort($found['archives'] ?? [])[0];
    xs_unpack_room($still);                  // marks a spare copy of one unpacked elsewhere
    foreach ($still as $a) {
        $p = (string) ($a['file'] ?? '');
        if ($p !== '' && empty($a['spare'])) {
            $all[strtolower($p)] = basename($p) . ': an archive to unpack';
        }
    }
    foreach ($found['copies'] ?? [] as $c) {
        $all[strtolower((string) $c['rom'])] = basename((string) $c['rom']) . ': the same game as one in another folder';
    }
    foreach ($found['unsure'] ?? [] as $u) {
        $k = 'unsure|' . strtolower((string) ($u['folder'] ?? '')) . '|' . (int) ($u['n'] ?? 0);
        $all[$k] = (int) ($u['n'] ?? 0) . ' files in ' . basename((string) ($u['folder'] ?? '')) . ' whose console could not be told';
    }
    foreach ($found['gaps'] ?? [] as $g) {
        $all['gap|' . strtolower($g['platform'] . '|' . $g['title'])] = $g['title'] . ': ' . $g['why'];
    }
    foreach ($found['orphans'] ?? [] as $o) {
        $all['orphan|' . strtolower($o['platform'] . '|' . $o['folder'])] = $o['folder'] . ': a dump missing its cue sheet';
    }
    $told = xs_read_json(xs_ng_told_path(), []);
    $told = is_array($told) ? $told : [];
    return array_diff_key($all, $told);
}

/**
 * Named in the mailbox, once: the file of what was named is kept first, so a failed write is not said again at every look.
 * $many comes back 0 when that many was said before, so the strip does not say it again either.
 */
function xs_ng_tell(array $unsure, int &$many): bool
{
    $told = xs_read_json(xs_ng_told_path(), []);
    $told = is_array($told) ? $told : [];
    // So many at once is one message, said again only when the number changes.
    $was = (int) ($told['many'] ?? 0);
    if ($many === $was) {
        $many = 0;
    } elseif ($many === 0) {
        unset($told['many']);               // taken in by Scan for Games: the next such batch is said again
    } else {
        $told['many'] = $many;
    }
    if (!$unsure && $many === 0) {
        if ($was && !isset($told['many'])) {
            xs_write_json(xs_ng_told_path(), $told);
        }
        return false;
    }
    foreach (array_keys($unsure) as $k) {
        $told[$k] = date('c');
    }
    if (!xs_write_json(xs_ng_told_path(), $told)) {
        return false;
    }
    require_once __DIR__ . '/news.php';
    $lines = array_values($unsure);
    $n = count($lines);
    $body = $many > 0
        ? $many . ' new games were found at once, more than Xsegon adds by itself. Games > Scan for Games lists them for you to add.'
        : 'Xsegon added the new games it was sure of. ' . ($n === 1 ? 'This one needs' : 'These need') . ' you: Games > Scan for Games shows '
          . ($n === 1 ? 'it' : 'them') . ' with what to do.';
    return xs_messages_add([
        'id'    => $many > 0 ? 'msg-newgames-many' : 'msg-' . bin2hex(random_bytes(6)),
        'at'    => date('c'),
        'kind'  => 'tip',
        'title' => $many > 0 ? $many . ' new games to look over' : ($n === 1 ? 'A file Xsegon was not sure of' : $n . ' files Xsegon was not sure of'),
        'body'  => $body,
        'items' => array_slice($lines, 0, 40),
        'n'     => $n,
        'opens' => ['scan'],
        'read'  => false,
    ]);
}
