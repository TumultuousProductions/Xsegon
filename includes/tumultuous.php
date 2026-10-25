<?php
/**
 * Xsegon - Tumultuous Productions' page (js\tppage.js): help from the person
 * who makes Xsegon, and the games they are making.
 *
 *     includes\tumultuous\page.json   its words, shipped with each release
 *     data\tumultuous.json            the games a person asked to hear of
 *
 * Nothing here asks a server. "Tell me when it's out" is kept here, and the
 * startup look (api\news.php) says once in the mailbox when a release marks
 * an asked-of game out.
 */
declare(strict_types=1);

require_once __DIR__ . '/news.php';

const XS_TP_MSG = 'msg-tp-';

/** The page's words; an empty page when the file will not read. XSEGON_TP_PAGE: the tests' own, on a test copy only. */
function xs_tp_page(): array
{
    $test = getenv('XSEGON_TP_PAGE');
    $file = xs_test_copy() && is_string($test) && $test !== '' ? $test : __DIR__ . DIRECTORY_SEPARATOR . 'tumultuous' . DIRECTORY_SEPARATOR . 'page.json';
    $p = xs_read_json($file, []);
    return is_array($p) ? $p : [];
}

/** The games, by id. */
function xs_tp_games(): array
{
    $out = [];
    foreach ((array) (xs_tp_page()['games']['list'] ?? []) as $g) {
        if (is_array($g) && is_string($g['id'] ?? null)) {
            $out[$g['id']] = $g;
        }
    }
    return $out;
}

/**
 * One of the page's own addresses, by what it is: "mail" (an email to the page's
 * address with this copy's version in it), "watch:<game id>", "site:<game id>" or
 * "link:<n>". Null for anything else, and for an address that is not https.
 */
function xs_tp_url(string $what): ?string
{
    $page = xs_tp_page();
    if ($what === 'mail') {
        require_once __DIR__ . '/version.php';
        $mail = (string) ($page['mail'] ?? '');
        $body = "Version: " . xs_version_line() . "\n\nWhat were you doing, and what did you expect?\n\n\nWhat happened instead?\n\n\n"
              . "(If you can, attach the report: Help > Report a problem > Save a copy.)";
        return preg_match('/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/', $mail) ? 'mailto:' . $mail . '?subject=' . rawurlencode('Xsegon help') . '&body=' . rawurlencode($body) : null;
    }
    [$kind, $key] = array_pad(explode(':', $what, 2), 2, '');
    $games = xs_tp_games();
    $url = match ($kind) {
        'watch' => $games[$key]['watchUrl'] ?? null,
        'site'  => $games[$key]['siteUrl'] ?? null,
        'link'  => ctype_digit($key) ? ($page['games']['links'][(int) $key]['url'] ?? null) : null,
        default => null,
    };
    return is_string($url) && str_starts_with($url, 'https://') ? $url : null;
}

/** What data\tumultuous.json holds, as an array whatever the file says. */
function xs_tp_kept(): array
{
    $all = xs_read_json(xs_data_path('tumultuous.json'), []);
    $all = is_array($all) ? $all : [];
    $all['tell'] = is_array($all['tell'] ?? null) ? $all['tell'] : [];
    return $all;
}

/** The games asked of: id => "asked", or when it was said. */
function xs_tp_tells(): array
{
    return xs_tp_kept()['tell'];
}

/** Ask, or stop asking, to hear when a game is out. Null when kept, else why not. */
function xs_tp_tell_set(string $id, bool $on): ?string
{
    $games = xs_tp_games();
    if (!isset($games[$id])) {
        return 'there is no game ' . $id . ' on the page';
    }
    $all = xs_tp_kept();
    if ($on) {
        $all['tell'][$id] = $all['tell'][$id] ?? 'asked';
    } else {
        unset($all['tell'][$id]);
    }
    if (!xs_write_json(xs_data_path('tumultuous.json'), $all)) {
        return 'data\\tumultuous.json could not be written';
    }
    xs_log('TP', ($on ? 'tell me when ' : 'no message when ') . $games[$id]['name'] . ' is out');
    return null;
}

/** Each asked-of game a release now marks out, said once in the mailbox. Answers how many were said. */
function xs_tp_tell(): int
{
    $all  = xs_tp_kept();
    $said = 0;
    foreach (xs_tp_games() as $id => $g) {
        if (($all['tell'][$id] ?? '') !== 'asked' || empty($g['out'])) {
            continue;
        }
        // Kept as said first: one that could not be marked would be said again at every look.
        $all['tell'][$id] = date('c');
        if (!xs_write_json(xs_data_path('tumultuous.json'), $all)) {
            xs_log('TP', $g['name'] . ' is out, but data\\tumultuous.json could not be written, so it is not said yet');
            break;
        }
        xs_messages_add([
            'id'    => XS_TP_MSG . $id,
            'at'    => date('c'),
            'kind'  => 'info',
            'title' => $g['name'] . ' is out',
            'body'  => 'You asked Xsegon to say when ' . $g['name'] . ' came out. ' . (string) ($g['outText'] ?? "Tumultuous Productions' page has where to get it."),
            'opens' => ['tumultuous'],
            'read'  => false,
        ]);
        xs_log('TP', $g['name'] . ' is out: said in the mailbox, as asked');
        $said++;
    }
    return $said;
}
