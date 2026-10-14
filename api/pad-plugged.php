<?php
/**
 * GET /api/pad-plugged.php?for=page|check - which game controllers Windows
 * has plugged in (includes\padplugged.php), written to the log as a PAD line.
 * Asked as the page opens, for the log alone, and as the controller picture
 * opens, which says the answer under the picture until a controller presses.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/padplugged.php';

$asks = (string) ($_GET['for'] ?? '');
$for  = ['page' => 'as the page opened', 'check' => 'as the controller picture opened'][$asks] ?? 'when asked';

$why  = null;
// The picture's words wait on the answer, so a server that cannot ask Windows itself asks through the helper.
$pads  = $asks === 'check' ? xs_pads_plugged_ask($why) : xs_pads_plugged($why);
$words = xs_pads_plugged_words($pads, $why);
xs_log('PAD', $words . ' (' . $for . ')');
xs_json(['ok' => true, 'asked' => $pads !== null, 'pads' => $pads ?? [], 'words' => $words]);
