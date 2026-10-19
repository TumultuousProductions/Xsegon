<?php
/**
 * Xsegon - is a newer Xsegon out? Said once per version, in the mailbox.
 *
 *     data\newversion.json   the last look: when, what this copy is, the newest
 *                            release, and which version was already said
 *
 * Once a day, as the page loads, bin\newversion.php asks GitHub for the
 * project's releases in the background. A newer one is written into the
 * mailbox once, with Update now where this copy can take it and a button to
 * its page; nothing is downloaded unless Download new versions by themselves
 * is on, and nothing on this PC changes. Only a release's own copy asks
 * (RELEASE.json, written by tools\make-test-copy.js --release): a checkout and
 * a tester's copy never do. Settings > Window > New versions switches it off,
 * and then nothing is asked.
 */
declare(strict_types=1);

require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/version.php';

const XS_NEWVERSION_ASK  = 'https://api.github.com/repos/TumultuousProductions/Xsegon/releases?per_page=30';
const XS_NEWVERSION_PAGE = 'https://github.com/TumultuousProductions/Xsegon/releases/';
const XS_NEWVERSION_MSG  = 'msg-newversion';   // one message, replaced by the next version's

function xs_newversion_path(): string
{
    return xs_data_path('newversion.json');
}

function xs_newversion_on(): bool
{
    return (xs_settings()['window']['tellNewVersions'] ?? true) !== false;
}

/** Download new versions by themselves: off unless the person chose it, in Settings or in the Update now window. */
function xs_newversion_get(): bool
{
    return (xs_settings()['window']['getNewVersions'] ?? false) === true;
}

/** This copy's release, or null. A test copy may stand in for one (XSEGON_TEST_RELEASE). */
function xs_newversion_have(): ?string
{
    $test = getenv('XSEGON_TEST_RELEASE');
    if (xs_test_copy() && is_string($test) && $test !== '') {
        return $test;
    }
    return xs_release();
}

/** Where the releases are asked for. XSEGON_NEWVERSION_URL: the tests' stand-in, on a test copy only. */
function xs_newversion_ask_url(): ?string
{
    $test = getenv('XSEGON_NEWVERSION_URL');
    if (xs_test_copy()) {
        return is_string($test) && $test !== '' ? $test : null;   // a test copy never asks GitHub by itself
    }
    return XS_NEWVERSION_ASK;
}

/**
 * As the page loads: the look in the background, at most once a day, never
 * when switched off, never in a checkout or a tester's copy. The page never waits.
 */
function xs_newversion_maybe(): void
{
    if (!xs_newversion_on() || xs_newversion_have() === null || xs_newversion_ask_url() === null) {
        return;
    }
    $last = xs_newversion_path();
    if (is_file($last) && time() - (int) filemtime($last) < 86400) {
        return;
    }
    // Stamped now, what it says kept, so the next page load does not start a second look while this one asks.
    is_file($last) ? @touch($last) : xs_write_json($last, []);
    require_once __DIR__ . '/gamesdb.php';
    $cmd = array_merge(xs_gamesdb_php_cmd(true), [XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'newversion.php']);
    $h = @popen('start /B "" ' . implode(' ', array_map(static fn ($a) => '"' . $a . '"', $cmd)) . ' > NUL 2>&1', 'r');
    if ($h === false) {
        xs_log('NEWV', 'the look for a newer Xsegon could not be started (popen failed)');
        return;
    }
    pclose($h);
}

/**
 * The newest release with a version number for a tag (v0.15), leaving out
 * drafts, pre-releases and the Games Database's own release: its version,
 * its page and its first lines of notes. Null when there is none.
 */
function xs_newversion_pick(array $releases): ?array
{
    $best = null;
    foreach ($releases as $r) {
        if (!is_array($r) || !empty($r['draft']) || !empty($r['prerelease'])) {
            continue;
        }
        $v = ltrim((string) ($r['tag_name'] ?? ''), 'vV');
        if (!preg_match('/^\d+(\.\d+){1,3}$/', $v) || ($best !== null && version_compare($v, $best['version'], '<='))) {
            continue;
        }
        $page = (string) ($r['html_url'] ?? '');
        $assets = $sizes = [];
        foreach ((array) ($r['assets'] ?? []) as $a) {
            if (is_array($a)) {
                $assets[(string) ($a['name'] ?? '')] = (string) ($a['browser_download_url'] ?? '');
                $sizes[(string) ($a['name'] ?? '')]  = (int) ($a['size'] ?? 0);
            }
        }
        $best = ['version' => $v, 'page' => str_starts_with($page, XS_NEWVERSION_PAGE) ? $page : XS_NEWVERSION_PAGE . 'latest',
                 'notes' => xs_newversion_notes((string) ($r['body'] ?? '')), 'assets' => $assets, 'sizes' => $sizes];
    }
    return $best;
}

/** A release's notes as up to eight plain lines: no headings' hashes, no stars, links as their words. */
function xs_newversion_notes(string $body): array
{
    $out = [];
    foreach (preg_split('/\R/', $body) ?: [] as $line) {
        $line = (string) preg_replace('/\[([^\]]*)\]\([^)]*\)/', '$1', $line);
        // A heading's hashes, a list's mark, and stars or underscores for bold and italic; snake_case keeps its own.
        $line = trim((string) preg_replace('/^\s*(#+|[-*+]|\d+\.)\s+|(?<![\pL\pN])[*_]+|[*_]+(?![\pL\pN])|`/u', '', $line));
        if ($line === '') {
            continue;
        }
        $line = mb_scrub($line, 'UTF-8');
        $out[] = mb_strlen($line) > 200 ? rtrim(mb_substr($line, 0, 197)) . '...' : $line;
        if (count($out) === 8) {
            break;
        }
    }
    return $out;
}

/** One ask of GitHub: the decoded answer, or null with $why. */
function xs_newversion_fetch(string $url, ?string &$why = null): ?array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_FAILONERROR    => true,
        CURLOPT_USERAGENT      => 'Xsegon',        // GitHub refuses an ask without one
        CURLOPT_HTTPHEADER     => ['Accept: application/vnd.github+json'],
    ]);
    $body = curl_exec($ch);
    if (!is_string($body)) {
        $why = curl_error($ch) ?: 'no answer';
        return null;
    }
    $got = json_decode($body, true);
    if (!is_array($got)) {
        $why = 'the answer was not a list of releases';
        return null;
    }
    return $got;
}

/**
 * The look itself (bin\newversion.php). A newer version not said before goes
 * into the mailbox; a message deleted stays deleted, as the version is
 * remembered apart from it. Answers what was found, and logs one line.
 */
function xs_newversion_check(): array
{
    require_once __DIR__ . '/news.php';     // here, not at the top: the page's load needs only the gate above
    $t0   = microtime(true);
    $have = xs_newversion_have();
    $url  = xs_newversion_ask_url();
    $was  = xs_read_json(xs_newversion_path(), []);
    $told = is_array($was) ? ($was['told'] ?? null) : null;
    $out  = ['at' => date('c'), 'have' => $have, 'told' => $told];
    if (!xs_newversion_on() || $have === null || $url === null) {
        $out['skipped'] = !xs_newversion_on() ? 'switched off in Settings'
                        : ($have === null ? 'not a release of Xsegon' : 'a test copy, which never asks GitHub by itself');
        return $out;
    }
    $list = xs_newversion_fetch($url, $why);
    $best = $list !== null ? xs_newversion_pick(array_is_list($list) ? $list : [$list]) : null;
    if ($best === null) {
        $out['error'] = $list === null ? (string) $why : 'no release with a version number';
        xs_write_json(xs_newversion_path(), $out);
        xs_log('NEWV', 'could not look for a newer Xsegon: ' . $out['error'] . ' (this is ' . $have . ')');
        return $out;
    }
    $out['newest'] = $best['version'];
    $out['page']   = $best['page'];
    $out['newer']  = version_compare($best['version'], $have, '>');
    // A release that carries an update, for a copy that can take one: kept for Update now (includes\update.php).
    $urls = null;
    if ($out['newer']) {
        require_once __DIR__ . '/update.php';
        $urls = xs_update_cannot() === null ? xs_update_assets($best['version'], $best['assets']) : null;
        if ($urls !== null) {
            $out['urls'] = $urls;
            $out['mb']   = round((int) ($best['sizes']['Xsegon-update-' . $best['version'] . '.zip'] ?? 0) / 1048576, 1);
        }
    }
    $said = false;
    if ($out['newer'] && $told !== $best['version']) {
        $size = !empty($out['mb']) ? $out['mb'] . ' MB' : 'a few MB';
        $said = xs_messages_add([
            'id'    => XS_NEWVERSION_MSG,
            'at'    => date('c'),
            'kind'  => 'info',
            'title' => 'Xsegon ' . $best['version'] . ' is out',
            'body'  => $urls !== null
                ? 'This is ' . $have . '. Nothing has been downloaded or changed. Update now asks first, then downloads it (' . $size . '), checks it '
                  . 'against the list its maker signed and tries it once on its own; only then does it take a backup of your data, close Xsegon, put '
                  . $best['version'] . ' in place and open it again. Your games, settings and pictures stay as they are. Each new version is said '
                  . 'here once. Settings > Window > New versions stops it.'
                : 'This is ' . $have . '. Nothing has been downloaded or changed. To update, close Xsegon, download the new zip from its page and '
                  . 'extract it over this folder, choosing Replace the files: your games, settings and pictures are in the data folder, which the '
                  . 'download does not have, so they stay as they are. Each new version is said here once. Settings > Window > New versions stops it.',
            'items' => $best['notes'],
            'url'   => $best['page'],
            'opens' => $urls !== null ? ['updatenow', 'newversion'] : ['newversion'],
            'read'  => false,
        ]);
        if ($said) {
            $out['told'] = $best['version'];
        }
    }
    // Downloaded ahead only when the person chose it; the message then says "is ready" (bin\update.php).
    if ($urls !== null && xs_newversion_get()) {
        $out['getting'] = xs_update_fetch_auto($best['version'], $urls);
    }
    xs_write_json(xs_newversion_path(), $out);
    xs_log('NEWV', 'this is ' . $have . ', the newest is ' . $best['version']
        . ($out['newer'] ? ($said ? ': said in the mailbox' : ($told === $best['version'] ? ': said before' : ': the mailbox would not take it')) : ': up to date')
        . ', in ' . (int) round((microtime(true) - $t0) * 1000) . 'ms');
    return $out;
}
