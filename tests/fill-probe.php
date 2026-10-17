<?php
/**
 * For tests\t-scan.js: the pictures Get Pictures asks for once more
 * (includes\fill.php, xs_fill_retry), with a stand-in fetch that answers what
 * each ask carries. Prints one JSON object.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/fill.php';

/* "tell <rows as JSON>": the message for the games left to a person
   (xs_fill_tell), written into the data folder XSEGON_DATA names. Never
   against the real one. */
/* "sort <rows as JSON>": whose decision each row is (xs_fill_sort), which logs
   the games named only after a console into XSEGON_DATA's log. */
if (in_array($argv[1] ?? '', ['tell', 'sort'], true)) {
    if ((string) getenv('XSEGON_DATA') === '') {
        fwrite(STDERR, $argv[1] . " wants XSEGON_DATA, a test's own data folder\n");
        exit(2);
    }
    $rows = json_decode((string) ($argv[2] ?? '[]'), true);
    $rows = is_array($rows) ? $rows : [];
    echo json_encode($argv[1] === 'tell' ? ['wrote' => xs_fill_tell($rows)] : ['rows' => xs_fill_sort($rows)]);
    exit(0);
}

$calls = [];
$fetch = static function (array $ask) use (&$calls): string {
    $calls[] = $ask[0]['title'] . ':' . $ask[2];
    return (string) $ask[3];
};
$asks = [
    [['id' => 'a', 'title' => 'Came The Second Time'], '1', 'box', 'stored'],
    [['id' => 'b', 'title' => 'Never Came'], '2', 'logo', 'failed: could not fetch that picture'],
    [['id' => 'c', 'title' => 'Chosen Meanwhile'], '3', 'box', 'already has one'],
    [['id' => 'd', 'title' => 'Gone'], '4', 'shot', 'not stored: the game was removed'],
];
$seen = [];
$all = xs_fill_retry($asks, $fetch, static fn (): bool => false,
    static function (array $ask, string $got) use (&$seen): void { $seen[] = $got; });
$once = $calls;

$looks = 0;
$halted = xs_fill_retry($asks, $fetch, static function () use (&$looks): bool { return ++$looks > 2; });

echo json_encode([
    'all'    => $all,
    'calls'  => $once,
    'seen'   => $seen,
    'halted' => $halted,
    'wanted' => array_map('xs_fill_retry_wanted', [
        'failed: could not fetch that picture from images.launchbox-app.com',
        'failed: libretro could not be reached',
        'failed: that is not a Games Database picture name',
        'stored', 'already has one', 'none on record',
    ]),
]);
