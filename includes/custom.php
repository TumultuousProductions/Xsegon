<?php
/**
 * Xsegon - what a person changed: a folder of their own, and Xsegon's files
 * that are not as the release made them (roadmap BB2, and half of BB9).
 *
 *     custom\style.css   read after Xsegon's own stylesheet (index.php), never
 *                        with High contrast; the pictures it names sit beside it
 *                        and are served from /custom/ (router.php)
 *
 * custom\ is never in a download (tools\make-test-copy.js takes only its own
 * folders), never replaced or moved by an update (bin\update-switch.php), and
 * never committed from a checkout (.gitignore). A broken stylesheet there makes
 * the page look wrong and nothing more; deleting the file takes it away.
 */
declare(strict_types=1);

// What a new custom\style.css says, so Notepad is all it takes. CRLF, for the Notepad of an older Windows.
const XS_CUSTOM_STARTER = "/* Your own look for Xsegon.\r\n"
    . "\r\n"
    . "   Xsegon reads this file after its own stylesheet, so what you write here\r\n"
    . "   wins. Updates never touch this folder, and no download carries it.\r\n"
    . "\r\n"
    . "   Save, then press F5 in Xsegon to see the change. A mistake here only\r\n"
    . "   makes the page look wrong; delete this file and it is gone. High\r\n"
    . "   contrast (Settings > Feel) leaves it out.\r\n"
    . "\r\n"
    . "   Xsegon's colours have names, set on :root in css\\xsegon.css and by the\r\n"
    . "   theme you wear; !important lets yours win over the theme's. Take away\r\n"
    . "   the stars and slashes around a line to try it: the first makes the\r\n"
    . "   highlight orange. A picture in this folder is url(\"my-picture.png\"). */\r\n"
    . "\r\n"
    . "/* :root { --cyan-rgb: 255, 122, 0 !important; } */\r\n"
    . "/* body { font-family: \"Segoe UI\", sans-serif; } */\r\n";

function xs_custom_dir(): string
{
    return XS_ROOT . DIRECTORY_SEPARATOR . 'custom';
}

function xs_custom_css(): string
{
    return xs_custom_dir() . DIRECTORY_SEPARATOR . 'style.css';
}

/** The folder, with a stylesheet that says what to do in it, made the first time it is opened. Null when there, else why not. */
function xs_custom_make(): ?string
{
    $dir = xs_custom_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
        return 'Windows did not let Xsegon make ' . $dir;
    }
    if (!is_file(xs_custom_css()) && @file_put_contents(xs_custom_css(), XS_CUSTOM_STARTER) === false) {
        return 'Windows did not let Xsegon write ' . xs_custom_css();
    }
    return null;
}

/** Whether a stylesheet of the person's own is there, and its size: for the page's link and a report. */
function xs_custom_state(): array
{
    $css = xs_custom_css();
    if (!is_file($css)) {
        return ['css' => false];
    }
    $text = (string) @file_get_contents($css, false, null, 0, 1048576);
    return ['css' => true, 'starter' => $text === XS_CUSTOM_STARTER, 'lines' => substr_count($text, "\n") + 1,
            'bytes' => (int) @filesize($css), 'stamp' => (int) @filemtime($css)];
}

/**
 * Xsegon's own files that are not as the release made them (RELEASE.json),
 * or null in a checkout or a tester's copy, which have no list. A report from
 * a changed copy is then read as one.
 */
function xs_release_changes(): ?array
{
    $raw  = @file_get_contents(XS_ROOT . DIRECTORY_SEPARATOR . 'RELEASE.json');
    $list = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($list) || !is_array($list['files'] ?? null)) {
        return null;
    }
    $changed = [];
    $missing = [];
    foreach ($list['files'] as $p => $f) {
        $at = XS_ROOT . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, (string) $p);
        if (!is_file($at)) {
            $missing[] = (string) $p;
        } elseif (filesize($at) !== (int) ($f['size'] ?? -1) || hash_file('sha256', $at) !== ($f['sha256'] ?? '')) {
            $changed[] = (string) $p;
        }
    }
    return ['version' => (string) ($list['version'] ?? ''), 'files' => count($list['files']), 'changed' => $changed, 'missing' => $missing];
}
