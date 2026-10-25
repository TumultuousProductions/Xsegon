<?php
/**
 * /api/news.php - what changed, and the mailbox.
 *
 *   GET                     the messages, newest first, and how many unread
 *   GET  ?check=1           compare the library with last time and sweep the
 *                           files: what arrived, what left, whose file is
 *                           gone. Writes the new snapshot and any messages
 *   GET  ?check=1&dry=1     the same answer, changing nothing
 *   POST {"action":"read"}  mark everything read (the red dot goes out)
 *   POST {"action":"read", "key": "launch:<game id>"}
 *                           mark one piece of trouble read: the strip's
 *                           Clear, which means you saw it
 *   POST {"action":"delete", "id": "msg-..."}   take one message out
 *   POST {"action":"clear"} empty the mailbox
 *   POST {"action":"clear", "level": "error" | "info"}
 *                           take out the errors, or everything that is not
 *
 * A message with level "error" is trouble that happened by itself (a failed
 * launch, a job that stopped, a file that will not read: includes\news.php);
 * every other message is plain news. Every read looks for new trouble first.
 *
 * The check is a GET but it does write: the snapshot it compares against has
 * to move forward, or the same news is announced for ever.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/news.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method !== 'POST') {
    if (($_GET['dry'] ?? '') !== '1') {
        xs_trouble_sweep();
    }
    if (($_GET['check'] ?? '') === '1') {
        $found = xs_news_check(($_GET['dry'] ?? '') !== '1');
        // Once, for someone whose games are in: that they can have videos and cheats (includes\tips.php).
        if (($_GET['dry'] ?? '') !== '1') {
            require_once __DIR__ . '/../includes/tips.php';
            xs_tips_tell('the startup look');
            // Files whose names say they go with a game: named once, nothing changed (includes\accompanied.php).
            xs_acc_tell('the startup look');
            // A game asked of on Tumultuous Productions' page that this release marks out: said once (includes\tumultuous.php).
            require_once __DIR__ . '/../includes/tumultuous.php';
            xs_tp_tell();
        }
        $msgs  = xs_messages();
        xs_json(['ok' => true, 'unread' => xs_messages_unread($msgs)] + $found);
    }
    $msgs = xs_messages();
    xs_json(['ok' => true, 'messages' => $msgs, 'unread' => xs_messages_unread($msgs)]);
}

xs_local_origin_only();
$body   = xs_body();
$action = (string) ($body['action'] ?? '');

if ($action === 'read' && isset($body['key'])) {
    // Kept first if the look has not come round to it yet, then read.
    xs_trouble_sweep();
    xs_messages_read_key((string) $body['key']);
    xs_json(['ok' => true, 'unread' => xs_messages_unread()]);
}

if ($action === 'delete') {
    $id   = (string) ($body['id'] ?? '');
    $msgs = xs_messages();
    $kept = array_values(array_filter($msgs, static fn (array $m): bool => (string) ($m['id'] ?? '') !== $id));
    if ($id === '' || count($kept) === count($msgs)) {
        xs_fail('no message with that id', 404);
    }
    xs_write_or_fail(xs_messages_path(), $kept);
    xs_log('NEWS', 'a message deleted (' . count($kept) . ' left)');
    xs_json(['ok' => true, 'messages' => $kept, 'unread' => xs_messages_unread($kept)]);
}

if ($action === 'clear' && isset($body['level'])) {
    $level = (string) $body['level'];
    if ($level !== 'error' && $level !== 'info') {
        xs_fail('level is error or info', 400);
    }
    $msgs = xs_messages();
    $kept = array_values(array_filter($msgs, static fn (array $m): bool => ((($m['level'] ?? '') === 'error') !== ($level === 'error'))));
    xs_write_or_fail(xs_messages_path(), $kept);
    xs_log('NEWS', 'mailbox cleared of ' . ($level === 'error' ? 'errors' : 'news') . ' (' . (count($msgs) - count($kept)) . ')');
    xs_json(['ok' => true, 'messages' => $kept, 'unread' => xs_messages_unread($kept)]);
}

if ($action === 'read') {
    $msgs = xs_messages();
    foreach ($msgs as $i => $m) {
        $msgs[$i]['read'] = true;
    }
    if ($msgs && !xs_write_json(xs_messages_path(), $msgs, $why)) {
        xs_fail((string) $why, 500);
    }
    xs_log('NEWS', 'read all (' . count($msgs) . ')');
    xs_json(['ok' => true, 'unread' => 0]);
}

if ($action === 'clear') {
    xs_write_or_fail(xs_messages_path(), []);
    xs_log('NEWS', 'mailbox cleared');
    xs_json(['ok' => true, 'messages' => [], 'unread' => 0]);
}

xs_fail('unknown action', 400);
