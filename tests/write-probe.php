<?php
/**
 * The write probe, run by tests\t-writes.js.
 *
 * xs_write_json's failures cannot be reached through the browser (a held file,
 * a missing folder), so this drives the function directly in a temp folder of
 * its own and prints one JSON row per check.
 *
 * The held-file case works inside one process because Windows shares files per
 * handle, not per process: PHP's fopen takes the file without granting delete
 * access, exactly as a virus scanner does.
 *
 * Nothing here writes to data\. It reads the data folder's log, to prove a
 * failed write left a WRIT line behind.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/version.php';

$results = [];
$check = static function (string $name, $got, $want = true) use (&$results): void {
    $results[] = ['name' => $name, 'got' => $got, 'want' => $want];
};

/* Where today's log has got to, so the checks below read only what this run
   wrote, not lines an older build wrote earlier in the day. */
$logPath  = xs_data_path('log') . DIRECTORY_SEPARATOR . date('Y-m-d') . '.log';
$logStart = is_file($logPath) ? (int) filesize($logPath) : 0;

$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xsegon-write-probe-' . getmypid();
@mkdir($dir, 0777, true);
$file = $dir . DIRECTORY_SEPARATOR . 'thing.json';
$tmp  = $file . '.tmp';

// ---- the ordinary write ---------------------------------------------------
$ok = xs_write_json($file, ['a' => 1, 'accented' => 'Pokémon'], $why);
$check('an ordinary write says it worked', $ok);
$check('it gives no reason when it worked', $why, null);
$check('the value comes back', xs_read_json($file), ['a' => 1, 'accented' => 'Pokémon']);
$check('no working copy is left behind', is_file($tmp), false);

// ---- writing over a file that is already there -----------------------------
$ok = xs_write_json($file, ['a' => 2]);
$check('writing over an existing file works', $ok);
$check('and the new value replaced the old', xs_read_json($file), ['a' => 2]);

// ---- a held file ------------------------------------------------------------
/* Hold the target the way a scanner does, then write. An unlink before the
   rename would lose the file when the rename fails. */
$held = fopen($file, 'r');
$ok   = xs_write_json($file, ['a' => 3], $why);
$check('a write onto a held file fails', $ok, false);
$check('the file is STILL THERE', is_file($file));
$check('holding the old value, not half of anything', xs_read_json($file), ['a' => 2]);
$check('the reason names being held', (bool) preg_match('/holding it/i', (string) $why));
$check('and the whole reason fits in a line a person will read', mb_strlen((string) $why) < 260);
$check('the reason says nothing was lost', str_contains((string) $why, 'Nothing was lost'));
$check('the reason names the file', str_contains((string) $why, 'thing.json'));
$check('and the new version is waiting in the working copy', xs_read_json($tmp), ['a' => 3]);
fclose($held);
@unlink($tmp);

// ---- a hold that lets go is retried, not reported --------------------------
/* Three tries with 60ms between them, so the usual momentary hold never
   reaches the person at all. Proved by counting the time a failure takes. */
$held = fopen($file, 'r');
$t0   = microtime(true);
xs_write_json($file, ['a' => 4]);
$spent = (microtime(true) - $t0) * 1000;
fclose($held);
@unlink($tmp);
$check('a failure is tried three times before it is called one', $spent > 110 && $spent < 900,
    true);

// ---- a folder that is not there -------------------------------------------
$deep = $dir . DIRECTORY_SEPARATOR . 'not' . DIRECTORY_SEPARATOR . 'there' . DIRECTORY_SEPARATOR . 'x.json';
$ok   = xs_write_json($deep, ['a' => 1], $why);
$check('a missing folder is made rather than refused', $ok);
$check('and the file is in it', is_file($deep));

// ---- a folder that cannot be made -----------------------------------------
/* A file standing where a folder needs to be: the same shape as data\ living
   on a drive that has been unplugged. */
$blocker = $dir . DIRECTORY_SEPARATOR . 'blocker';
file_put_contents($blocker, 'not a folder');
$ok = xs_write_json($blocker . DIRECTORY_SEPARATOR . 'x.json', ['a' => 1], $why);
$check('a folder that cannot be made fails', $ok, false);
$check('and says the folder is the problem', str_contains((string) $why, 'folder'));
$check('naming the folder it meant', str_contains((string) $why, 'blocker'));

// ---- something that is not JSON -------------------------------------------
$ok = xs_write_json($file, ['bad' => "\xB1\x31"], $why);
$check('a value that will not encode fails', $ok, false);
$check('it says so plainly, and says it is a bug', str_contains((string) $why, 'bug in Xsegon'));
// a=3 and a=4 both failed on a held file, so a=2 is still what is on disk
$check('the old file is untouched by it', xs_read_json($file), ['a' => 2]);
$check('and no working copy was left', is_file($tmp), false);

// ---- every failure leaves a line in the log --------------------------------
$log = is_file($logPath) ? (string) file_get_contents($logPath, false, null, $logStart) : '';
$check('a failed write writes a WRIT line', (bool) preg_match('/ S WRIT thing\.json: /', $log));
/* The log line is abbreviated on purpose: the whole sentence would make the
   report's "last few trouble lines" near-identical paragraphs. */
$longest = 0;
foreach (explode("\n", $log) as $line) {
    if (str_contains($line, ' S WRIT ')) { $longest = max($longest, mb_strlen($line)); }
}
$check('and keeps it short enough to scan', $longest > 0 && $longest < 200, true);

// ---- the version stamp -----------------------------------------------------
$check('the build line names Xsegon, a version, PHP and the OS',
    (bool) preg_match('/^Xsegon \d+(\.\d+){1,3} .*PHP \d+\.\d+\.\d+, Windows/', xs_version_line()));
$v = xs_version();
$check('it found the commit, being a git checkout', (bool) preg_match('/^[0-9a-f]{7}$/', (string) $v['commit']));
$check('and the branch it is on', is_string($v['branch']) && $v['branch'] !== '');
$check('it names the php.exe that is running, for a report', is_file((string) $v['phpExe']));
/* The package's own name (tools\make-test-copy.js --build): a checkout has
   none, and a package's BUILD file is one line, taken as plain letters. */
$check('a checkout is no package', [xs_package(), $v['package'], str_contains(xs_version_line(), 'package')], [null, null, false]);
file_put_contents($dir . DIRECTORY_SEPARATOR . 'BUILD', "\xEF\xBB\xBF v0.01 (e447564, 2026-10-02) \r\nsecond line\r\n");
$check('a package says which copy it is, in one clean line', xs_package($dir), 'v0.01 (e447564, 2026-10-02)');
file_put_contents($dir . DIRECTORY_SEPARATOR . 'BUILD', "\r\n  \r\n");
$check('and an empty BUILD file is no name at all', xs_package($dir), null);
@unlink($dir . DIRECTORY_SEPARATOR . 'BUILD');

// ---- tidy up ---------------------------------------------------------------
foreach ([$file, $tmp, $blocker, $deep] as $p) { @unlink($p); }
@rmdir(dirname($deep));
@rmdir(dirname(dirname($deep)));
@rmdir($dir);
$check('the probe cleaned up after itself', is_dir($dir), false);

echo json_encode($results);
