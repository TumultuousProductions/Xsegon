<?php
/**
 * /api/padlist.php?vendor=0f30&product=010a - a controller's line in the
 * shared list (includes\padlist.php), for a pad the browser does not know.
 * Answers found: false when the list has no Windows line for those numbers.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/padlist.php';

$vendor  = strtolower(trim((string) ($_GET['vendor'] ?? '')));
$product = strtolower(trim((string) ($_GET['product'] ?? '')));
if (!preg_match('/^[0-9a-f]{4}$/', $vendor) || !preg_match('/^[0-9a-f]{4}$/', $product)) {
    xs_fail('vendor and product are four hex digits each', 400);
}

$line = xs_padlist_find($vendor, $product);
xs_log('PAD', 'the shared list was asked for ' . $vendor . ':' . $product . ': ' . ($line === null ? 'not in it' : $line['name']));
xs_json(['ok' => true, 'found' => $line !== null, 'name' => $line['name'] ?? null, 'parts' => $line['parts'] ?? null]);
