<?php
/**
 * /api/changelog.php - What's new, read from doc\CHANGELOG.md.
 *
 *   GET                 every day's changes, newest first:
 *                       {days: [{date, items: ["...", ...]}], newest, seen}
 *   POST {"seen": date} What's new was opened on the newest day
 *   POST {"told": date} the note in the corner said there was something new
 *
 * The file itself is shown, so no second copy drifts from it. "## <date>"
 * starts a day, "- " an entry, an indented line carries on the one above;
 * **bold** and `code` are left for the page to draw.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/boot.php';
require_once __DIR__ . '/../includes/settings.php';   // is a LaunchBox in use (What's new leaves it out if not)

function xs_changelog_days(string $path): array
{
    $raw = @file_get_contents($path);
    if ($raw === false) {
        return [];
    }
    $days = [];
    $day = null;
    foreach (preg_split('/\r?\n/', xs_strip_bom($raw)) as $line) {
        if (preg_match('/^##\s+(\d{4}-\d{2}-\d{2})/', $line, $m)) {
            if ($day !== null) {
                $days[] = $day;
            }
            $day = ['date' => $m[1], 'items' => []];
            continue;
        }
        if ($day === null) {
            continue;
        }
        if (preg_match('/^[-*]\s+(.*)$/', $line, $m)) {
            $day['items'][] = trim($m[1]);
        } elseif ($day['items'] && preg_match('/^\s+(\S.*)$/', $line, $m)) {
            $day['items'][count($day['items']) - 1] .= ' ' . trim($m[1]);
        }
    }
    if ($day !== null) {
        $days[] = $day;
    }
    return array_values(array_filter($days, static fn ($d) => $d['items']));
}

$seenPath = xs_data_path('setup.json');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $days = xs_changelog_days(XS_ROOT . DIRECTORY_SEPARATOR . 'doc' . DIRECTORY_SEPARATOR . 'CHANGELOG.md');
    /* Without a LaunchBox in use, changes about LaunchBox are left out. The
       LaunchBox Games Database ships with Xsegon, so changes naming it stay. */
    $lbDir = xs_norm_path((string) (xs_settings()['paths']['launchbox'] ?? ''));
    if ($lbDir === '' || !is_dir($lbDir)) {
        foreach ($days as $i => $d) {
            $days[$i]['items'] = array_values(array_filter($d['items'],
                static fn($t) => stripos(str_ireplace('LaunchBox Games Database', '', (string) $t), 'launchbox') === false));
        }
        $days = array_values(array_filter($days, static fn($d) => $d['items'] !== []));
    }
    $seen = xs_read_json($seenPath, []);
    xs_json([
        'ok'     => true,
        'days'   => $days,
        'newest' => $days[0]['date'] ?? null,
        'seen'   => is_array($seen) ? ($seen['seenChangelog'] ?? null) : null,
        'told'   => is_array($seen) ? ($seen['toldChangelog'] ?? null) : null,
    ]);
}

xs_local_origin_only();
$body = xs_body();
// "seen": What's new was opened on this day's changes. "told": the note in
// the corner said so, which is not the same as having read them.
$key  = isset($body['told']) ? 'told' : 'seen';
$date = (string) ($body[$key] ?? '');
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    xs_fail('say which day, as YYYY-MM-DD');
}
$seen = xs_read_json($seenPath, []);
$seen = is_array($seen) ? $seen : [];
$seen[$key . 'Changelog'] = $date;
xs_write_or_fail($seenPath, $seen);
xs_json(['ok' => true, 'seen' => $date]);
