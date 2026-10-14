<?php
/**
 * Xsegon - which build is this: the version, the commit, the PHP and the
 * Windows under it. Written at the head of every day's log, sent with the
 * status, and leading the problem report.
 *
 * Standalone (no boot.php), so anything can ask. The commit is read out of
 * .git by hand: git is not on every machine, and the status asks every few seconds.
 */
declare(strict_types=1);

/** Bumped by hand when something ships. */
const XS_VERSION = '0.9.0';

/** The commit this copy sits on, or null when there is no .git to read. */
function xs_git_commit(): ?array
{
    static $got = false;
    static $val = null;
    if ($got) {
        return $val;
    }
    $got = true;

    $git = dirname(__DIR__) . DIRECTORY_SEPARATOR . '.git';
    if (!is_dir($git)) {
        return $val = null;                 // a released copy, which is normal
    }
    $head = @file_get_contents($git . DIRECTORY_SEPARATOR . 'HEAD');
    if ($head === false) {
        return $val = null;
    }
    $head = trim($head);

    // "ref: refs/heads/main" on a branch, or a bare sha when detached.
    $branch = null;
    $sha    = $head;
    if (str_starts_with($head, 'ref: ')) {
        $ref    = trim(substr($head, 5));
        $branch = preg_replace('#^refs/heads/#', '', $ref);
        $sha    = trim((string) @file_get_contents($git . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $ref)));
        if ($sha === '') {
            // Packed refs: the loose file is gone once git has tidied up.
            foreach (@file($git . DIRECTORY_SEPARATOR . 'packed-refs') ?: [] as $line) {
                if (str_ends_with(trim($line), ' ' . $ref)) {
                    $sha = strtok(trim($line), ' ');
                    break;
                }
            }
        }
    }
    if (!preg_match('/^[0-9a-f]{40}$/i', (string) $sha)) {
        return $val = null;
    }
    return $val = ['short' => substr($sha, 0, 7), 'full' => $sha, 'branch' => $branch];
}

/**
 * Which package this copy came out of, or null in a checkout: a package has
 * no .git. tools\make-test-copy.js --build v0.01 writes one line into BUILD
 * beside index.php: the package's name, its commit and the day.
 */
function xs_package(?string $root = null): ?string
{
    $text = @file_get_contents(($root ?? dirname(__DIR__)) . DIRECTORY_SEPARATOR . 'BUILD');
    if ($text === false) {
        return null;                        // a checkout, which is normal
    }
    // One line of plain letters: it goes into every log and every report.
    $line = trim((string) preg_replace('/[^\x20-\x7E]/', '', (string) strtok(ltrim($text), "\r\n")));
    return $line !== '' ? substr($line, 0, 80) : null;
}

/** Everything worth putting at the top of a report, as fields. */
function xs_version(): array
{
    $commit = xs_git_commit();
    return [
        'version' => XS_VERSION,
        'package' => xs_package(),
        'commit'  => $commit['short'] ?? null,
        'branch'  => $commit['branch'] ?? null,
        'php'     => PHP_VERSION,
        // In UTF-8 (xs_utf8_path): as PHP gives it, a folder with an accent makes
        // this answer unwritable. Without boot.php a non-UTF-8 path is left out.
        'phpExe'  => function_exists('xs_php_exe') ? xs_php_exe() : (preg_match('//u', PHP_BINARY) === 1 ? PHP_BINARY : 'php.exe'),
        // With the build number: "Windows NT 10.0" is every Windows 10 and 11,
        // and Windows' own tar.exe differs by build.
        'os'      => trim(php_uname('s') . ' ' . php_uname('r') . ' ' . php_uname('m') . ' ' . php_uname('v')),
        'root'    => dirname(__DIR__),
    ];
}

/** The same thing as one line, for the log and for pasting into a report. */
function xs_version_line(): string
{
    $v = xs_version();
    return 'Xsegon ' . $v['version']
        . ($v['commit'] !== null ? ' (' . $v['commit'] . ($v['branch'] !== null ? ' on ' . $v['branch'] : '') . ')' : '')
        . ($v['package'] !== null ? ', package ' . $v['package'] : '')
        . ', PHP ' . $v['php'] . ', ' . $v['os'];
}

/** The short form, for the page: "0.9.0 (7e035fa)", in a package "0.9.0, package v0.01 (...)". */
function xs_version_short(): string
{
    $v = xs_version();
    return $v['version']
        . ($v['commit'] !== null ? ' (' . $v['commit'] . ')' : '')
        . ($v['package'] !== null ? ', package ' . $v['package'] : '');
}
