<?php
/**
 * /api/ra-hotkeys.php - RetroArch's menu, quit and turbo, your choice.
 *
 *   GET            what is choosable and what is chosen: RetroArch 1.22.2's
 *                  controller combos, whether a single menu button can apply
 *                  (the pad driver must be sdl2, where the raw numbers are
 *                  known), the pad hotkeys that would stop needing Hotkey
 *                  Enable held, the RetroPad names for the turbo pickers,
 *                  and your choices with their words
 *   POST {menu?, quit?, turbo?}   keep or clear a choice: {kind: "combo",
 *                         combo: N} or, for the menu only, {kind: "button",
 *                         btn: N}; turbo is {set: "off"} or {set: "on",
 *                         mode, bind, period}, the global choice (a game's
 *                         own goes through api\game-remap.php). null clears
 *                         one, a missing key is left alone
 *
 * Appended at launch for that run only (api\launch.php); RetroArch's own
 * settings file is never changed, and with nothing chosen it rules.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/import.php';
require_once __DIR__ . '/../includes/retroarch.php';
require_once __DIR__ . '/../includes/rahotkeys.php';
require_once __DIR__ . '/../includes/padmap.php';

$caps   = ra_capabilities(xs_library());
$cfg    = $caps['config'] !== null ? (string) $caps['config'] : null;
$keys   = $cfg !== null ? xs_ra_read_keys($cfg) : [];
$driver = strtolower((string) ($keys['input_joypad_driver'] ?? ''));

/** Every choice with its words, for either answer: menu, quit and turbo (global). */
$answer = static function (): array {
    $choices = xs_ra_choices();
    $words = [];
    foreach ($choices as $slot => $c) {
        $words[$slot] = xs_ra_choice_words($c);
    }
    $t = xs_ra_turbo_choice();
    if ($t !== null) {
        $choices['turbo'] = $t;
        $words['turbo'] = xs_ra_turbo_choice_words($t);
    }
    return ['choices' => (object) $choices, 'words' => (object) $words];
};

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    $combos = [];
    for ($n = 1; $n <= 10; $n++) {
        $combos[] = ['value' => $n, 'words' => xs_ra_combo_words((string) $n)];
    }
    /* The pad hotkeys that stop waiting for Hotkey Enable when the menu sits
       on its own button (input_enable_hotkey_btn goes to nul for that run):
       only _btn and _axis binds; keys and combos keep their gates. */
    $ungated = [];
    foreach (xs_ra_hotkey_table() as $id => [$name, $ra, $group]) {
        if ($id === 'enable_hotkey' || $id === 'menu_toggle') {
            continue;
        }
        $btn  = trim((string) ($keys['input_' . $id . '_btn'] ?? ''));
        $axis = trim((string) ($keys['input_' . $id . '_axis'] ?? ''));
        if (($btn !== '' && $btn !== 'nul') || ($axis !== '' && $axis !== 'nul')) {
            $ungated[] = $name;
        }
    }
    xs_json(['ok' => true] + $answer() + [
        'none'    => $cfg === null,
        'driver'  => $driver,
        'names'   => xs_ra_sdl2_names(),
        'pad'     => xs_ra_retropad_names(),
        'padIds'  => XS_PAD_IDS,
        'combos'  => $combos,
        'xbox'    => ['btn' => 5, 'ok' => $driver === 'sdl2',
                      'why' => $driver === 'sdl2' ? null
                             : 'A single button is a raw number only known under the sdl2 pad driver. This RetroArch drives pads with '
                             . ($driver === '' ? 'its default driver' : $driver) . ', so a launch will leave the choice out until that changes.'],
        'ungated' => $ungated,
        // whether the pinned jump holds here, for the words on the open row
        'jump'    => (static function () use ($caps): array {
            $j = ra_jump_check($caps);
            return ['ok' => $j['ok'], 'why' => $j['why']];
        })(),
    ]);
}

$body = xs_body();
$path = xs_data_path('ra-hotkeys.json');
$all  = xs_read_json($path, []);
$all  = is_array($all) ? $all : [];
$said = [];
foreach (array_keys(XS_RA_CHOICE_SLOTS) as $slot) {
    if (!array_key_exists($slot, $body)) {
        continue;
    }
    $c = $body[$slot];
    if ($c === null) {
        unset($all[$slot]);
        $said[] = $slot . '=RetroArch\'s own';
        continue;
    }
    $why = null;
    if (!is_array($c) || !xs_ra_choice_valid($c, $slot, $why)) {
        xs_fail((string) ($why ?: 'not a choice this page knows'), 400);
    }
    $kept = $c['kind'] === 'combo' ? ['kind' => 'combo', 'combo' => (int) $c['combo']]
                                   : ['kind' => 'button', 'btn' => (int) $c['btn']];
    $all[$slot] = $kept;
    $said[] = $slot . '=' . xs_ra_choice_words($kept);
}
if (array_key_exists('turbo', $body)) {
    $t = $body['turbo'];
    if ($t === null) {
        unset($all['turbo']);
        $said[] = 'turbo=RetroArch\'s own';
    } else {
        $why = null;
        if (!is_array($t) || !xs_ra_turbo_valid($t, $why)) {
            xs_fail((string) ($why ?: 'not a turbo choice this page knows'), 400);
        }
        $kept = ['set' => $t['set']];
        if ($t['set'] === 'on') {
            $kept['mode']   = (int) $t['mode'];
            $kept['bind']   = isset($t['bind']) && $t['bind'] !== null ? (int) $t['bind'] : null;
            $kept['period'] = isset($t['period']) && $t['period'] !== null ? (int) $t['period'] : null;
        }
        $all['turbo'] = $kept;
        $said[] = 'turbo=' . xs_ra_turbo_choice_words($kept);
    }
}
if (!$said) {
    xs_fail('nothing to change: send menu, quit or turbo', 400);
}
xs_write_or_fail($path, $all);
xs_log('HOTK', implode(' ', $said));
xs_json(['ok' => true] + $answer());
