<?php
/**
 * /api/bios.php - the BIOS check (Emulators > BIOS check, includes\bios.php)
 * and putting your own files in place (includes\bioshelp.php).
 *
 *   GET   each console with games here, the BIOS files its emulator wants,
 *         and whether each is in place, a wrong file, or missing.
 *   GET   ?platform=..&name=..[&core=..]
 *         what one game of that name would lack on that console (on the core
 *         named, else the console's own), and the words a failed start carries.
 *   POST  {"action":"look","folder":"..."}
 *         what that folder holds that an emulator here wants, and where each
 *         file would go. Reads only.
 *   POST  {"action":"place","folder":"..."}
 *         makes those copies, never into a folder Xsegon only reads.
 *
 * No file is ever fetched, and the folder's own files are never changed.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/bios.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $platform = trim((string) ($_GET['platform'] ?? ''));
    if ($platform === '') {
        xs_json(['ok' => true] + xs_bios_report());
    }
    require_once __DIR__ . '/../includes/bioshelp.php';
    $table = xs_emulators(xs_norm_path((string) (xs_settings()['paths']['launchbox'] ?? '')));
    $opt = xs_emu_option($table, $platform) ?? (xs_emu_options($table, $platform)[0] ?? null);
    if ($opt === null) {
        xs_fail('no emulator set up for ' . $platform, 404);
    }
    $core = strtolower(trim((string) ($_GET['core'] ?? ''))) ?: strtolower((string) ($opt['core'] ?? ''));
    $exe = (string) ($table['programs'][$opt['program'] ?? '']['exe'] ?? '');
    $lack = xs_bios_lack($exe, $core, $platform, (string) ($_GET['name'] ?? ''));
    xs_json(['ok' => true, 'core' => $core, 'lack' => $lack, 'hint' => $lack === null ? null : xs_bios_hint($lack)]);
}

xs_local_origin_only();
require_once __DIR__ . '/../includes/bioshelp.php';
$body   = xs_body();
$action = (string) ($body['action'] ?? '');
if ($action !== 'look' && $action !== 'place') {
    xs_fail('say look or place');
}
$folder = xs_norm_path(trim((string) ($body['folder'] ?? '')));
if ($folder === '' || !is_dir($folder)) {
    xs_fail('there is no folder at ' . ($folder ?: '(nothing chosen)'), 409);
}
if (!xs_bios_dirs()) {
    xs_fail('no RetroArch is set up here yet, so there is nowhere to put a BIOS file: Help > Getting started gets RetroArch', 409);
}

if ($action === 'look') {
    $plan = xs_bios_place_plan($folder);
    xs_log('BIOS', 'looked in ' . $folder . ': ' . $plan['found'] . ' known file(s), ' . $plan['todo'] . ' to copy, '
        . $plan['byHand'] . ' for a folder Xsegon does not write to, ' . $plan['unknown'] . ' not known');
    xs_json(['ok' => true] + $plan);
}

$done = xs_bios_place($folder);
if (!$done['placed'] && $done['failed']) {
    xs_json(['ok' => false, 'error' => 'could not copy ' . implode(', ', $done['failed']) . ' (' . xs_file_error_reason() . ')'] + $done['plan'], 500);
}
xs_json(['ok' => true, 'placed' => $done['placed'], 'failed' => $done['failed']] + $done['plan']);
