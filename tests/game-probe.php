<?php
// Used by tests\t-api.js: is one game read alone (xs_game) the row the whole
// library has? Every <step>th game, and the first of each kind.
//   php game-probe.php <step>
declare(strict_types=1);
require __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/import.php';

$step = max(1, (int) ($argv[1] ?? 20));
$enc = static fn ($v): string => (string) json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
$asked = 0;
$differ = [];
$kinds = [];
foreach (xs_library()['games'] ?? [] as $i => $row) {
    $kind = (!empty($row['local']) ? 'own' : 'game') . ($row['launch'] === null ? ' unplayable' : '')
          . (isset($row['variant']) ? ' variant' : '') . (!empty($row['artRev']) ? ' pictures' : '');
    if ($i % $step !== 0 && isset($kinds[$kind])) {
        continue;
    }
    $kinds[$kind] = true;
    $asked++;
    if ($enc(xs_game((string) $row['id'])) !== $enc($row)) {
        $differ[] = (string) $row['title'];
    }
}
echo json_encode(['asked' => $asked, 'kinds' => count($kinds), 'differ' => $differ, 'none' => xs_game('xs-scan-ffffffffffff')]);
