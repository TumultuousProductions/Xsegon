<?php
/**
 * The zip probe, run by tests\t-backup.js.
 *
 * Two things a backup made in a test cannot show: the larger form of a .zip
 * (past 4 GB or 65,535 files), written here for a small one, and an archive
 * damaged after it was written, which the read-back has to catch and name.
 * Driven directly in a temp folder of its own; prints one JSON row per
 * check. Nothing here touches data\.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/backup.php';

$results = [];
$check = static function (string $name, $got, $want = true) use (&$results): void {
    $results[] = ['name' => $name, 'got' => $got, 'want' => $want];
};
$dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xsegon-zip-probe-' . getmypid();
@mkdir($dir, 0777, true);

// ---- the larger form, for a small zip --------------------------------------
$words = str_repeat("the same line again\n", 500);
$big   = $dir . DIRECTORY_SEPARATOR . 'larger-form.zip';
$zip   = xs_zs_begin($big);
xs_zs_put_bytes($zip, 'words.txt', $words, null, true);
xs_zs_put_bytes($zip, 'bytes.bin', random_bytes(4000));
$check('a zip can be ended in the larger form', [xs_zs_end($zip, true), $zip['big']], [true, true]);
$list = xs_zs_list($big) ?? [];
$check('it is listed from that end', array_keys($list), ['words.txt', 'bytes.bin']);
$check('every file in it reads back as it went in', xs_zs_check($big, $zip['entries']), 2);
$check('text went in packed, and comes out whole',
    [$list['words.txt']['method'] ?? null, ($list['words.txt']['packed'] ?? PHP_INT_MAX) < strlen($words),
     isset($list['words.txt']) && xs_zs_bytes($big, $list['words.txt']) === $words], [8, true, true]);
$check('bytes that do not pack went in as they are', $list['bytes.bin']['method'] ?? null, 0);

$small = $dir . DIRECTORY_SEPARATOR . 'ordinary.zip';
$zip   = xs_zs_begin($small);
xs_zs_put_bytes($zip, 'words.txt', $words);
$check('a small zip is in the ordinary form unless asked',
    [xs_zs_end($zip), $zip['big'], strpos((string) file_get_contents($small), "PK\x06\x06")], [true, false, false]);

// ---- an archive as a backup writes it, then damaged -------------------------
$files = [];
foreach (['one.png' => random_bytes(60000), 'two.json' => (string) json_encode(array_fill(0, 200, 'a line of text')),
          'three.png' => random_bytes(60000), 'four.png' => ''] as $name => $bytes) {
    file_put_contents($dir . DIRECTORY_SEPARATOR . $name, $bytes);
    $files['art/' . $name] = $dir . DIRECTORY_SEPARATOR . $name;
}
$path = $dir . DIRECTORY_SEPARATOR . 'backup.zip.part';
$said = static function (array $entries) use ($path): array {
    try {
        return ['', 0, xs_zip_proof($path, $entries)];
    } catch (Throwable $x) {
        return [$x->getMessage(), $x->getCode(), null];
    }
};
$res = xs_zip_write($path, $files, ['manifest.json' => '{}']);
$check('an archive is written: every file, none missed, the ordinary form', [$res['files'], $res['missed'], $res['large']], [5, [], false]);
$check('whole, it passes the read-back', $said($res['entries']), ['', 0, 5]);

$e  = array_values(array_filter($res['entries'], static fn (array $x): bool => $x['name'] === 'art/three.png'))[0];
$fh = fopen($path, 'r+b');
fseek($fh, $e['at'] + 30 + strlen($e['name']) + 30000);
$c = (string) fread($fh, 1);
fseek($fh, -1, SEEK_CUR);
fwrite($fh, chr(ord($c) ^ 0xFF));
fclose($fh);
$got = $said($res['entries']);
$check('one byte turned over in one file is caught, and the file named',
    [str_contains($got[0], 'art/three.png'), str_contains($got[0], 'damaged'), $got[1]], [true, true, XS_BACKUP_FAULT]);

$res = xs_zip_write($path, $files, ['manifest.json' => '{}']);
$fh  = fopen($path, 'r+b');
ftruncate($fh, (int) (filesize($path) / 2));
fclose($fh);
$check('an archive cut short is caught', $said($res['entries'])[0] !== '');

$res = xs_zip_write($path, $files, ['manifest.json' => '{}']);
$check('an archive that lists fewer files than went in is caught',
    $said(array_merge($res['entries'], [['name' => 'art/never.png', 'size' => 1, 'crc' => 1]]))[0], 'it lists 5 files where 6 went in');

// ---- a file that is gone is passed over --------------------------------------
$files['art/gone.png'] = $dir . DIRECTORY_SEPARATOR . 'gone.png';
$res = xs_zip_write($path, $files, ['manifest.json' => '{}']);
$check('a file that is no longer there is passed over, not counted as missed', [$res['files'], $res['missed']], [5, []]);

foreach ((array) scandir($dir) as $f) {
    if (is_string($f) && $f !== '.' && $f !== '..') {
        @unlink($dir . DIRECTORY_SEPARATOR . $f);
    }
}
@rmdir($dir);
echo json_encode($results), "\n";
