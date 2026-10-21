<?php
/**
 * Xsegon - one message, once: that these games can have videos and cheats,
 * and where, since both stand behind a menu or a tab. Written when a
 * setting-up run ends, or at the first look of someone already set up.
 */
declare(strict_types=1);

require_once __DIR__ . '/news.php';

/** Write the message unless it has been written. True when it was written now. */
function xs_tips_tell(string $by): bool
{
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    if (!empty($asked['tipsTold'])) {
        return false;
    }
    // A setting-up run still at work says it when it ends.
    $run = is_array($asked['run'] ?? null) ? $asked['run'] : null;
    if ($run !== null && empty($run['ended'])) {
        return false;
    }
    require_once __DIR__ . '/cheats.php';
    require_once __DIR__ . '/archivevid.php';
    $lib   = xs_library();
    $games = 0;
    $onRa  = 0;
    foreach ($lib['games'] ?? [] as $g) {
        if (!empty($g['local'])) {
            continue;
        }
        $games++;
        $onRa += ($g['launch']['kind'] ?? '') === 'retroarch' ? 1 : 0;
    }
    if ($games === 0) {
        return false;                     // nothing to say it of yet: the next look asks again
    }

    $lines = [];
    $opens = [];
    // Videos, unless a fetch has been run here already: its own ending said what there is.
    $need = 0;
    if (!is_file(xs_av_job_path()) && xs_curl_exe() !== '') {
        foreach (xs_av_need(xs_settings(), $lib) as $row) {
            $need += $row['sets'] > 0 || !empty($row['wol']) ? (int) $row['need'] : 0;
        }
    }
    if ($need > 0) {
        $lines[] = 'Videos: ' . $need . ($need === 1 ? ' game has' : ' games have') . ' no video, and Get Media > Videos from online archives '
                 . 'fetches a short one for each game it is sure of. They come from the Internet Archive (archive.org), free and with no account.';
        $opens[] = 'archivevid';
    }
    $here = $onRa > 0 && xs_cheat_lists_here($lib);
    if ($onRa > 0 && $here) {
        $lines[] = 'Cheats: a game that plays on RetroArch has them on the Cheats tab of its details, and its details say how many '
                 . 'there are to choose from. A cheat you select stays on until you turn it off.';
    } elseif ($onRa > 0) {
        require_once __DIR__ . '/cheatlists.php';
        $lines[] = 'Cheats: a game that plays on RetroArch can have them, on the Cheats tab of its details. The RetroArch on this PC '
                 . 'came without its cheat lists, which are a ' . XS_CL_ABOUT_MB . ' MB download.';
        $opens[] = 'cheatlists';
    }

    // Read again: the looks above took a moment, and another request may have written since.
    $asked = xs_read_json(xs_data_path('setup.json'), []);
    $asked = is_array($asked) ? $asked : [];
    if (!empty($asked['tipsTold'])) {
        return false;
    }
    $asked['tipsTold'] = date('c');
    if (!xs_write_json(xs_data_path('setup.json'), $asked)) {
        return false;                     // not kept, so not said: it would be said again at every look
    }
    if (!$lines) {
        xs_log('NEWS', 'nothing to say of videos or cheats (' . $by . '): every game has a video, and none plays on RetroArch');
        return false;
    }
    $both = $need > 0 && $onRa > 0;
    xs_messages_add([
        'id'    => 'msg-' . bin2hex(random_bytes(6)),
        'at'    => date('c'),
        'kind'  => 'tip',
        'title' => $both ? 'Two more things your games can have: videos and cheats' : ($need > 0 ? 'Your games can have videos' : 'Your games can have cheats'),
        'body'  => ($both ? 'Both are' : 'It is') . ' optional: your games play without ' . ($both ? 'them' : 'it') . '.',
        'items' => $lines,
        'n'     => count($lines),
        'opens' => $opens,                // the page turns each into a button (js\news.js)
        'read'  => false,
    ]);
    xs_log('NEWS', 'the videos and cheats message was written (' . $by . '): ' . $need . ' games with no video the Archive may have, '
        . $onRa . ' on RetroArch, cheat lists ' . ($here ? 'here' : 'not here'));
    return true;
}
