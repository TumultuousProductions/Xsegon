<?php
/**
 * GET  /api/settings.php  - current settings, and the defaults they came from
 * POST /api/settings.php  - merge a partial update, return the new state
 * POST /api/settings.php?reset=1 - back to defaults
 *
 * The defaults are returned alongside the values on purpose: the settings
 * screen renders itself from this, so adding a toggle in includes\settings.php
 * makes it appear in the UI without touching the UI.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/settings.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    if (isset($_GET['reset'])) {
        /* Back to defaults, but the folders (Settings > Paths) are kept, or
           the library could not find its games, and so are the tips put away
           for good (feel.tipsGone); the old file is copied to data\safety
           first, so a reset can be undone by hand. */
        xs_local_origin_only();
        $was  = xs_settings();
        $path = xs_settings_path();
        $copy = null;
        if (is_file($path)) {
            $copy = xs_data_path('safety' . DIRECTORY_SEPARATOR . 'settings.before-reset-' . date('Y-m-d-His') . '.json');
            @mkdir(dirname($copy), 0777, true);
            if (!@copy($path, $copy)) {
                xs_fail('the settings were not reset: a copy of them could not be kept first', 500);
            }
        }
        @unlink($path);
        xs_settings_save(['paths' => $was['paths'] ?? [], 'feel' => ['tipsGone' => $was['feel']['tipsGone'] ?? []]], $why);
        if ($why !== null) {
            xs_fail('reset, but your folders could not be written back: ' . $why . ($copy ? ' (the old settings are in ' . $copy . ')' : ''), 500);
        }
        xs_log('SET', 'reset to defaults, folders and tips put away kept' . ($copy ? ', old settings in ' . $copy : ''));
        xs_json(['ok' => true, 'kept' => 'paths', 'copy' => $copy,
                 'settings' => xs_settings(), 'defaults' => xs_settings_defaults()]);
    }
    $before  = xs_settings();
    $body    = xs_body();
    /* A Steam folder is one with Steam's steamapps in it. Any other would be
       kept and only ever find no games, later and without a word. */
    $steamTo = $body['paths']['steam'] ?? null;
    if (is_string($steamTo) && trim($steamTo) !== '' && $steamTo !== ($before['paths']['steam'] ?? '')
        && !is_dir(rtrim(trim($steamTo), '/\\') . DIRECTORY_SEPARATOR . 'steamapps')) {
        xs_fail('that is not Steam\'s folder: it has no steamapps folder in it. Steam\'s is usually '
            . 'C:\\Program Files (x86)\\Steam, or leave it blank for Xsegon to find it', 400);
    }
    $updated = xs_settings_save($body, $why);
    if ($why !== null) {
        xs_fail((string) $why, 500);
    }
    // What changed, from what to what, so a setting that went back can be followed in the log.
    $changed = [];
    foreach ($updated as $group => $values) {
        foreach (is_array($values) ? $values : [] as $key => $value) {
            $was = $before[$group][$key] ?? null;
            if ($was !== $value) {
                $show = static fn($v) => mb_substr((string) json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 0, 60);
                $changed[] = $group . '.' . $key . ' ' . $show($was) . ' -> ' . $show($value);
            }
        }
    }
    if ($changed) {
        xs_log('SET', implode('; ', $changed));
    }
    xs_json(['ok' => true, 'settings' => $updated, 'defaults' => xs_settings_defaults()]);
}

$s      = xs_settings();
$schema = xs_settings_schema();

// A saved value of the wrong kind is written down every time the screen
// opens, so the log names it before anything breaks over it.
$drift = xs_settings_drift();
foreach ($drift as $line) {
    xs_log('WARN', 'settings: ' . $line);
}

// An option list discovered rather than declared: the sound sets are the
// folders that exist (xs_sound_sets).
$schema['sound']['soundSet']['options'] = xs_sound_sets($s);

// Back can be the pack's own, the pack's Select, or borrowed from any pack.
$backFrom = ['' => 'Same as the sound set', 'select' => 'Use the Select sound'];
foreach (xs_sound_sets($s) as $k => $label) {
    $backFrom[$k] = 'Back from: ' . $label;
}
$schema['sound']['backSound']['options'] = $backFrom;

// And the themes are whatever files are in themes\, the house look first.
require_once __DIR__ . '/../includes/themes.php';
$schema['feel']['theme']['options'] = xs_theme_list();
// A theme in a family's folder stands under the family's name in the list.
$schema['feel']['theme']['groups'] = array_filter(array_column(xs_theme_catalogue(), 'family', 'id')) ?: new stdClass();

/* The screen lists one page per category of `defaults`, in the order they
   arrive, so the order is applied here rather than by shuffling the
   definitions (see xs_settings_order). Settings themselves are looked up by
   name and do not care. */
xs_json([
    'ok'       => true,
    'settings' => $s,
    'defaults' => xs_settings_sort(xs_settings_defaults()),
    'schema'   => xs_settings_sort($schema),
    'drift'    => $drift,
]);
