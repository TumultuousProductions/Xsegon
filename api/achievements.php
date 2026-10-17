<?php
/**
 * /api/achievements.php - RetroAchievements (includes\achievements.php).
 *
 *   GET                       RetroArch's sign-in as yes or no words, whether
 *                             a site key is kept, the last account answer
 *   GET ?game=<id>            that game's tab: the set its file opens, what was earned
 *   GET ?badge=<name>[&grey=1]  a badge's picture, colour or grey
 *   POST {"key": "..."}       check the key with the site, then keep it
 *   POST {"check": true}      ask the site again with the kept key
 *   POST {"forget": true}     drop the key and the last answer
 *   POST {"open": "keys"}     the site's settings page, where the key is, in the
 *                             default browser (a test copy opens nothing)
 *
 * No answer from here ever carries the key, RetroArch's password or its token.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/achievements.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    // One badge's picture, in colour or its grey copy (includes\achgame.php).
    if (isset($_GET['badge'])) {
        require_once __DIR__ . '/../includes/achgame.php';
        $pic = xs_achg_badge((string) $_GET['badge'], !empty($_GET['grey']));
        if ($pic === null) {
            http_response_code(404);
            exit;
        }
        header('Content-Type: image/png');
        header('Cache-Control: max-age=604800');
        readfile($pic);
        exit;
    }
    // One game's tab: which set its file opens, and what was earned.
    if (isset($_GET['game'])) {
        require_once __DIR__ . '/../includes/achgame.php';
        $g = xs_game_or_404((string) $_GET['game']);
        if (!xs_ach_for($g)) {
            xs_fail('RetroArch does not start this game, or RetroAchievements has no sets for its console', 409);
        }
        xs_json(['ok' => true] + xs_achg_game($g));
    }
    xs_json(['ok' => true] + xs_ach_public());
}

xs_local_origin_only();
$body = xs_body();

if (($body['open'] ?? '') === 'keys') {
    $url = 'https://retroachievements.org/settings';
    if (xs_test_copy()) {
        xs_json(['ok' => true, 'url' => $url, 'dry' => true]);
    }
    $handle = popen('start "" "' . $url . '"', 'r');
    if ($handle === false) {
        xs_log('ACH', 'could not open the site\'s settings page');
        xs_fail('Windows did not open the page', 500);
    }
    pclose($handle);
    xs_log('ACH', 'opened the site\'s settings page');
    xs_json(['ok' => true, 'url' => $url]);
}

$ra = xs_ach_ra_state();

if (!empty($body['forget'])) {
    if (!xs_ach_keep(null, null)) {
        xs_fail('the kept key could not be deleted', 500);
    }
    xs_log('ACH', 'the key was forgotten');
    xs_json(['ok' => true] + xs_ach_public($ra));
}

if (array_key_exists('key', $body)) {
    $key = trim((string) $body['key']);
    if (!xs_ach_key_valid($key)) {
        xs_fail('that is not a key from the site: it is letters and digits, about 32 of them', 422);
    }
    $check = xs_ach_check($ra, $key);
    // A key the site refused is never kept; with no answer or no name yet it is kept unchecked.
    if (!$check['ok'] && $check['status'] !== 0) {
        xs_fail($check['error'], 422);
    }
    $why = null;
    if (!xs_ach_keep($key, $check['user'] ?? null, $why)) {
        xs_fail('the key was not kept: ' . (string) $why, 500);
    }
    xs_log('ACH', 'a key was kept' . ($check['ok'] ? ', and the site took it' : ', not checked: ' . $check['error']));
    xs_json(['ok' => true, 'kept' => true, 'checked' => $check['ok'], 'why' => $check['ok'] ? null : $check['error']] + xs_ach_public($ra));
}

if (!empty($body['check'])) {
    $key = xs_ach_key();
    $check = xs_ach_check($ra, $key);
    if (!$check['ok']) {
        xs_fail($check['error'], $check['status'] === 0 && $key === null ? 409 : 502);
    }
    $why = null;
    if (!xs_ach_keep($key, $check['user'], $why)) {
        xs_fail('the answer was not kept: ' . (string) $why, 500);
    }
    xs_json(['ok' => true, 'checked' => true] + xs_ach_public($ra));
}

xs_fail('say key, check or forget');
