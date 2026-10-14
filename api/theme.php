<?php
/**
 * /api/theme.php - the look (includes\themes.php).
 *
 *   GET                 the theme in use, the list to choose from, and the names a theme may wear
 *   GET ?id=dark        that theme's values and its sums, for the page to put on
 *   POST ?check=1       {"theme": {...}}: a theme's own text read and weighed,
 *                       never kept. What a file would do, before it is one.
 *
 * The page never reads a theme file: it is handed values made here.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/settings.php';
require_once __DIR__ . '/../includes/themes.php';

$list = xs_theme_catalogue();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    xs_local_origin_only();
    if (!isset($_GET['check'])) {
        xs_fail('a theme is chosen in Settings: this only reads one', 400);
    }
    $t = xs_theme_parse(xs_body()['theme'] ?? null, 'check', $notes);
    $vars = $t !== null ? xs_theme_vars($t) : null;
    xs_json(['ok' => true, 'usable' => $vars !== null, 'notes' => $notes,
             'theme' => $vars !== null ? ['id' => 'check', 'name' => $t['name'], 'house' => false, 'vars' => $vars ?: new stdClass(), 'has' => $t['has'],
                                          'wears' => xs_theme_wears($t)] : null,
             'sums' => $vars !== null ? xs_theme_sums($t) : null]);
}

$asked = isset($_GET['id']);
$id = $asked ? mb_substr((string) $_GET['id'], 0, 64) : (string) (xs_settings()['feel']['theme'] ?? XS_THEME_HOUSE);
$theme = xs_theme_payload($id, $asked);
$read = $theme['house'] ? null : xs_theme_read($theme['id']);
xs_json(['ok' => true, 'theme' => $theme, 'list' => $list, 'dials' => ['texture' => XS_THEME_TEXTURES] + XS_THEME_NAMED, 'sums' => xs_theme_sums($read)]);
