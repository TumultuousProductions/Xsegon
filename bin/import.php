<?php
/**
 * Xsegon - import from the command line.
 *
 *   php bin\import.php
 *
 * Runnable by hand: when the library looks wrong, the whole error shows here.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';

$report = xs_import();

if (!($report['ok'] ?? false)) {
    fwrite(STDERR, "import failed: " . ($report['error'] ?? 'unknown') . "\n");
    exit(1);
}

printf("imported %d games across %d platforms in %d ms\n",
    $report['games'], $report['platforms'], $report['ms']);
printf("  without box art : %d\n", $report['noArt']);
printf("  unlaunchable    : %d\n", $report['noLaunch']);
if ($report['seeded'] > 0) {
    printf("  history seeded  : %d rows from LaunchBox\n", $report['seeded']);
}
