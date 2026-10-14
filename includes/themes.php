<?php
/**
 * Themes: a look as a small file of values, never of code.
 *
 *   themes\<id>.json             a theme Xsegon comes with (dark.json)
 *   themes\<family>\<id>.json    one of a family, listed together under the
 *                                folder's name (carbon\red.json)
 *
 * The house look is the stylesheet itself: always first in the list, with no
 * file to lose. A theme says only what differs from it, and one that is
 * missing or wrong gives the house look and a line in the log.
 *
 * Nothing in a file reaches the page as text. A colour is read into three
 * numbers and written out again from the numbers; a texture, what the
 * panels and the corners are, and a mark, is one of the names below or
 * nothing; a name this file does not know is left out and said in the log.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

const XS_THEME_HOUSE  = 'xsegon';
const XS_THEME_FORMAT = 1;
// What a theme may set: its colours, its pushed colours (High contrast), and what the look has.
const XS_THEME_COLOURS = ['ground', 'panel', 'panelRaised', 'words', 'wordsSecond', 'wordsThird', 'highlight', 'highlightSecond'];
const XS_THEME_PUSHED  = ['ground' => '--hc-ground', 'panel' => '--hc-panel', 'panelRaised' => '--hc-panel-2',
                          'wordsSecond' => '--hc-mute', 'wordsThird' => '--hc-faint'];
const XS_THEME_HAS     = ['glow', 'scanlines'];
// A texture under the panels, 0 to 100 strong. The stylesheet draws them, but rain and snow
// (js\rain.js, js\snow.js) and what moves in the rest (js\motion.js).
const XS_THEME_TEXTURES = ['carbon', 'quilt', 'horizon', 'rain', 'snow', 'stars', 'stars-trees', 'bubbles', 'storm'];
// What else a look is made of, each by a name the stylesheet draws: its panels, its corners, and a small mark beside the wordmark.
const XS_THEME_NAMED = ['surface' => ['sheer', 'gloss'], 'corner' => ['round'], 'mark' => ['bat']];

function xs_themes_dir(): string
{
    return XS_ROOT . DIRECTORY_SEPARATOR . 'themes';
}

// A theme's name on disk, with its family's folder in front when it has one: also what the setting holds, so it is kept plain.
function xs_theme_id_ok(string $id): bool
{
    return $id !== XS_THEME_HOUSE && (bool) preg_match('~^[a-z0-9][a-z0-9-]{0,30}(/[a-z0-9][a-z0-9-]{0,30})?$~', $id);
}

/** "#1f1f1f" or "#abc" as three numbers; anything else is not a colour. */
function xs_theme_colour($v): ?array
{
    if (!is_string($v) || !preg_match('/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/', $v, $m)) {
        return null;
    }
    $h = strlen($m[1]) === 3 ? $m[1][0] . $m[1][0] . $m[1][1] . $m[1][1] . $m[1][2] . $m[1][2] : $m[1];
    return [(int) hexdec(substr($h, 0, 2)), (int) hexdec(substr($h, 2, 2)), (int) hexdec(substr($h, 4, 2))];
}

/**
 * A theme's own text made safe: only the names above, only colours and yes
 * or no. $notes says what was left out. Null when it is not a theme at all.
 */
function xs_theme_parse($raw, string $id, ?array &$notes = null): ?array
{
    $notes = [];
    if (!is_array($raw) || array_is_list($raw)) {
        $notes[] = 'not a set of named values';
        return null;
    }
    if (($raw['format'] ?? null) !== XS_THEME_FORMAT) {
        $notes[] = 'format ' . mb_substr((string) json_encode($raw['format'] ?? null), 0, 20) . ', this Xsegon reads format ' . XS_THEME_FORMAT;
        return null;
    }
    $name = is_string($raw['name'] ?? null) ? trim((string) preg_replace('/[^\p{L}\p{N} \-]+/u', '', $raw['name'])) : '';
    $name = mb_substr($name !== '' ? $name : ucfirst($id), 0, 30);
    $colours = static function ($set, array $known, string $where) use (&$notes): array {
        $out = [];
        if ($set === null) {
            return $out;
        }
        if (!is_array($set)) {
            $notes[] = $where . ' is not a set of colours';
            return $out;
        }
        foreach ($set as $key => $value) {
            $c = in_array($key, $known, true) ? xs_theme_colour($value) : null;
            if ($c === null) {
                $notes[] = $where . '.' . mb_substr((string) $key, 0, 30) . (in_array($key, $known, true) ? ' is not a colour like #1f1f1f' : ' is not known') . ', left out';
                continue;
            }
            $out[$key] = $c;
        }
        return $out;
    };
    $has = array_fill_keys(XS_THEME_HAS, true);
    foreach (is_array($raw['has'] ?? null) ? $raw['has'] : [] as $key => $value) {
        if (in_array($key, XS_THEME_HAS, true) && is_bool($value)) {
            $has[$key] = $value;
        } else {
            $notes[] = 'has.' . mb_substr((string) $key, 0, 30) . ' is not known or not yes or no, left out';
        }
    }
    $texture = null;
    if (isset($raw['texture'])) {
        $kind = is_array($raw['texture']) ? ($raw['texture']['kind'] ?? null) : null;
        $strength = is_array($raw['texture']) ? ($raw['texture']['strength'] ?? 100) : null;
        if (is_string($kind) && in_array($kind, XS_THEME_TEXTURES, true) && is_int($strength) && $strength >= 0 && $strength <= 100) {
            $texture = ['kind' => $kind, 'strength' => $strength];
        } else {
            $notes[] = 'texture is not a kind this Xsegon draws (' . implode(', ', XS_THEME_TEXTURES) . ') with a strength of 0 to 100, left out';
        }
    }
    $named = [];
    foreach (XS_THEME_NAMED as $dial => $known) {
        if (!isset($raw[$dial])) {
            continue;
        }
        if (is_string($raw[$dial]) && in_array($raw[$dial], $known, true)) {
            $named[$dial] = $raw[$dial];
        } else {
            $notes[] = $dial . ' is not one this Xsegon draws (' . implode(', ', $known) . '), left out';
        }
    }
    foreach (array_diff(array_keys($raw), ['format', 'name', 'colours', 'has', 'highContrast', 'texture'], array_keys(XS_THEME_NAMED)) as $extra) {
        $notes[] = mb_substr((string) $extra, 0, 30) . ' is not known, left out';
    }
    return ['id' => $id, 'name' => $name, 'has' => $has, 'texture' => $texture, 'named' => $named,
            'colours' => $colours($raw['colours'] ?? null, XS_THEME_COLOURS, 'colours'),
            'pushed'  => $colours($raw['highContrast'] ?? null, array_keys(XS_THEME_PUSHED), 'highContrast')];
}

function xs_theme_read(string $id, ?array &$notes = null): ?array
{
    $notes = [];
    if (!xs_theme_id_ok($id)) {
        $notes[] = 'not a theme\'s name';
        return null;
    }
    $path = xs_themes_dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $id) . '.json';
    if (!is_file($path)) {
        $notes[] = 'its file is not in the themes folder';
        return null;
    }
    // A theme is a dozen lines: anything large is not one.
    if ((int) @filesize($path) > 16384) {
        $notes[] = 'its file is too large to be a theme';
        return null;
    }
    $raw = json_decode(xs_strip_bom((string) @file_get_contents($path)), true);
    if ($raw === null) {
        $notes[] = 'its file is not JSON: ' . json_last_error_msg();
        return null;
    }
    return xs_theme_parse($raw, $id, $notes);
}

/**
 * Every theme there is, as [id, name, family]: the house look first, then
 * the themes that stand by themselves, then each family (a folder in
 * themes\, named for the folder), each lot by name. What the Theme row and
 * the round X offer.
 */
function xs_theme_catalogue(): array
{
    $lot = static function (string $dir, string $prefix, string $family): array {
        $found = [];
        foreach (xs_glob($dir, '*.json') as $file) {
            $id = $prefix . basename((string) $file, '.json');
            $t = xs_theme_id_ok($id) ? xs_theme_read($id) : null;
            if ($t !== null) {
                $found[] = ['id' => $id, 'name' => $t['name'], 'family' => $family];
            }
        }
        usort($found, static fn (array $a, array $b): int => strnatcasecmp($a['name'], $b['name']) ?: strcmp($a['id'], $b['id']));
        return $found;
    };
    $out = array_merge([['id' => XS_THEME_HOUSE, 'name' => 'Xsegon', 'family' => '']], $lot(xs_themes_dir(), '', ''));
    foreach (xs_glob(xs_themes_dir(), '*', true) as $folder) {
        $f = basename((string) $folder);
        if (preg_match('/^[a-z0-9][a-z0-9-]{0,30}$/', $f)) {
            $out = array_merge($out, $lot((string) $folder, $f . '/', ucfirst(str_replace('-', ' ', $f))));
        }
    }
    return $out;
}

/** id => name, in the catalogue's order. */
function xs_theme_list(): array
{
    return array_column(xs_theme_catalogue(), 'name', 'id');
}

/** What a look wears by name, for the page to carry on <html>: only names from the lists above, or nothing. */
function xs_theme_wears(?array $t): array
{
    $out = ['texture' => (string) ($t['texture']['kind'] ?? '')];
    foreach (array_keys(XS_THEME_NAMED) as $dial) {
        $out[$dial] = (string) ($t['named'][$dial] ?? '');
    }
    return $out;
}

/**
 * The house look's own numbers, read from the head of the stylesheet: the
 * tones between its marks, the three surfaces they sit between, and the
 * colours the sums need. Empty tones mean the stylesheet could not be read.
 */
function xs_theme_house(): array
{
    $css = (string) @file_get_contents(XS_ROOT . DIRECTORY_SEPARATOR . 'css' . DIRECTORY_SEPARATOR . 'xsegon.css', false, null, 0, 24000);
    $three = static function (string $name) use ($css): ?array {
        return preg_match('~^\s*--' . preg_quote($name, '~') . ':\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3});~m', $css, $m)
            ? [(int) $m[1], (int) $m[2], (int) $m[3]] : null;
    };
    $hex = static function (string $name) use ($css): ?array {
        return preg_match('~^\s*--' . preg_quote($name, '~') . ':\s*(#[0-9a-fA-F]{6});~m', $css, $m) ? xs_theme_colour($m[1]) : null;
    };
    $tones = [];
    if (preg_match('~/\* tones \*/(.*?)/\* tones end \*/~s', $css, $block)
        && preg_match_all('~--([a-z0-9-]+)-rgb:\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3});~', $block[1], $all, PREG_SET_ORDER)) {
        foreach ($all as $t) {
            $tones[$t[1]] = [(int) $t[2], (int) $t[3], (int) $t[4]];
        }
    }
    $ink = preg_match('~--ink-r:\s*(\d{1,3});\s*--ink-g:\s*(\d{1,3});\s*--ink-b:\s*(\d{1,3});~', $css, $m) ? [(int) $m[1], (int) $m[2], (int) $m[3]] : null;
    $ground = $hex('ground');
    $mute = $three('mute-rgb');
    $ok = $tones && $ground && $hex('panel') && $hex('panel-2') && $ink && $mute && $three('cyan-rgb');
    return ['tones' => $ok ? $tones : [], 'ground' => $ground, 'panel' => $hex('panel'), 'panelRaised' => $hex('panel-2'),
            'words' => $ink, 'highlight' => $three('cyan-rgb'),
            // the greyer words are one tint at two strengths over the ground
            'wordsSecond' => $ok ? xs_theme_mix($ground, $mute, 0.84) : null,
            'wordsThird'  => $ok ? xs_theme_mix($ground, $mute, 0.66) : null];
}

function xs_theme_mix(array $a, array $b, float $k): array
{
    $k = max(0.0, min(1.0, $k));
    return [(int) round($a[0] + ($b[0] - $a[0]) * $k), (int) round($a[1] + ($b[1] - $a[1]) * $k), (int) round($a[2] + ($b[2] - $a[2]) * $k)];
}

function xs_theme_luma(array $c): float
{
    return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2];
}

/**
 * One of the house's navy tones as this theme's: as far between black, the
 * ground, the panel and the raised panel as it stands in the house look.
 */
function xs_theme_tone(array $tone, array $house, array $mine): array
{
    $y = xs_theme_luma($tone);
    $yg = max(0.01, xs_theme_luma($house['ground']));
    $yp = max($yg + 0.01, xs_theme_luma($house['panel']));
    $yr = max($yp + 0.01, xs_theme_luma($house['panelRaised']));
    if ($y <= $yg) {
        return xs_theme_mix([0, 0, 0], $mine['ground'], $y / $yg);
    }
    if ($y <= $yp) {
        return xs_theme_mix($mine['ground'], $mine['panel'], ($y - $yg) / ($yp - $yg));
    }
    return xs_theme_mix($mine['panel'], $mine['panelRaised'], ($y - $yp) / ($yr - $yp));
}

/**
 * The stylesheet's names and their values for a theme, every value made here
 * from numbers. Null when it has a surface of its own and the stylesheet's
 * tones could not be read: half a look is worse than the house look.
 */
function xs_theme_vars(array $t): ?array
{
    $c = $t['colours'];
    $three = static fn (array $x): string => $x[0] . ', ' . $x[1] . ', ' . $x[2];
    $whole = static fn (array $x): string => 'rgb(' . $x[0] . ', ' . $x[1] . ', ' . $x[2] . ')';
    $v = [];
    if (isset($c['ground']))          { $v['--ground'] = $whole($c['ground']); $v['--ground-rgb'] = $three($c['ground']); }
    if (isset($c['panel']))           { $v['--panel'] = $whole($c['panel']); }
    if (isset($c['panelRaised']))     { $v['--panel-2'] = $whole($c['panelRaised']); $v['--panel-2-rgb'] = $three($c['panelRaised']); }
    if (isset($c['words'])) {
        $v['--ink-r'] = (string) $c['words'][0];
        $v['--ink-g'] = (string) $c['words'][1];
        $v['--ink-b'] = (string) $c['words'][2];
        // the wheel's glint: the words, half way to white
        $v['--glint-rgb'] = $three(xs_theme_mix($c['words'], [255, 255, 255], 0.5));
    }
    if (isset($c['wordsSecond']))     { $v['--mute'] = $whole($c['wordsSecond']); $v['--mute-rgb'] = $three($c['wordsSecond']); }
    if (isset($c['wordsThird']))      { $v['--faint'] = $whole($c['wordsThird']); }
    if (isset($c['highlight']))       { $v['--cyan-rgb'] = $three($c['highlight']); }
    if (isset($c['highlightSecond'])) { $v['--magenta'] = $whole($c['highlightSecond']); $v['--magenta-rgb'] = $three($c['highlightSecond']); }
    // A theme with a surface of its own gets the whole navy family worked out of its surfaces.
    if (isset($c['ground']) || isset($c['panel']) || isset($c['panelRaised'])) {
        $house = xs_theme_house();
        if (!$house['tones']) {
            return null;
        }
        $mine = ['ground' => $c['ground'] ?? $house['ground'], 'panel' => $c['panel'] ?? $house['panel'],
                 'panelRaised' => $c['panelRaised'] ?? $house['panelRaised']];
        foreach ($house['tones'] as $name => $tone) {
            if (!isset($v['--' . $name . '-rgb'])) {
                $v['--' . $name . '-rgb'] = $three(xs_theme_tone($tone, $house, $mine));
            }
        }
    }
    // High contrast is this theme pushed: what it does not say stays the theme's own, never the house's navy.
    foreach (XS_THEME_PUSHED as $key => $name) {
        $p = $t['pushed'][$key] ?? $c[$key] ?? null;
        if ($p !== null) {
            $v[$name] = $whole($p);
        }
    }
    if (isset($v['--hc-ground'])) {
        $v['--hc-set'] = $whole(xs_theme_mix([0, 0, 0], $t['pushed']['ground'] ?? $c['ground'], 0.5));
    }
    if (($t['texture'] ?? null) !== null) {
        $v['--texture-strength'] = (string) $t['texture']['strength'];
    }
    return $v;
}

// How bright a colour is, and how far apart two are, the way the reading rule (4.5 to 1) counts it.
function xs_theme_light(array $c): float
{
    $l = 0.0;
    foreach ([0.2126, 0.7152, 0.0722] as $i => $weight) {
        $x = $c[$i] / 255;
        $l += $weight * ($x <= 0.03928 ? $x / 12.92 : (($x + 0.055) / 1.055) ** 2.4);
    }
    return $l;
}
function xs_theme_ratio(array $a, array $b): float
{
    $x = xs_theme_light($a);
    $y = xs_theme_light($b);
    return round((max($x, $y) + 0.05) / (min($x, $y) + 0.05), 2);
}

/**
 * The sums for a theme, or for the house look when $t is null: how far each
 * kind of word stands from what it is drawn on, plain and pushed. A pair
 * under 4.5 is hard to read.
 */
function xs_theme_sums(?array $t): array
{
    $house = xs_theme_house();
    if (!$house['tones']) {
        return [];
    }
    $c = ($t['colours'] ?? []) + array_intersect_key($house, array_flip(XS_THEME_COLOURS));
    $out = [];
    foreach (['ground', 'panel', 'panelRaised'] as $on) {
        $out['words on ' . $on] = xs_theme_ratio($c['words'], $c[$on]);
        $out['wordsSecond on ' . $on] = xs_theme_ratio($c['wordsSecond'], $c[$on]);
    }
    $out['wordsThird on ground'] = xs_theme_ratio($c['wordsThird'], $c['ground']);
    $out['wordsThird on panel'] = xs_theme_ratio($c['wordsThird'], $c['panel']);
    $out['highlight on ground'] = xs_theme_ratio($c['highlight'], $c['ground']);
    $out['highlight on panel'] = xs_theme_ratio($c['highlight'], $c['panel']);
    $out['ground on highlight'] = xs_theme_ratio($c['ground'], $c['highlight']);
    // the selection bar's bright end: the highlight at 62% over the list
    $out['white on the selection bar'] = xs_theme_ratio([255, 255, 255], xs_theme_mix($c['panel'], $c['highlight'], 0.62));
    if ($t !== null) {
        $p = $t['pushed'] + $c;
        foreach (['ground', 'panel', 'panelRaised'] as $on) {
            $out['pushed: white on ' . $on] = xs_theme_ratio([255, 255, 255], $p[$on]);
            $out['pushed: wordsSecond on ' . $on] = xs_theme_ratio($p['wordsSecond'], $p[$on]);
        }
        $out['pushed: wordsThird on panel'] = xs_theme_ratio($p['wordsThird'], $p['panel']);
    }
    return $out;
}

/**
 * What the page is handed for a theme: its values under the stylesheet's
 * names, what the look has, and what it wears by name. The house look, or
 * a theme that cannot be used, is no values at all.
 */
function xs_theme_payload(string $id, bool $quiet = false): array
{
    $house = ['id' => XS_THEME_HOUSE, 'name' => 'Xsegon', 'house' => true, 'vars' => new stdClass(),
              'has' => array_fill_keys(XS_THEME_HAS, true), 'wears' => xs_theme_wears(null)];
    if ($id === XS_THEME_HOUSE || $id === '') {
        return $house;
    }
    $t = xs_theme_read($id, $notes);
    $vars = $t !== null ? xs_theme_vars($t) : [];
    if ($vars === null) {
        $t = null;
        $notes = ['the stylesheet\'s tones could not be read'];
    }
    if ($t === null) {
        if (!$quiet) {
            xs_log('WARN', 'theme ' . mb_substr($id, 0, 64) . ' is not used, the Xsegon look is shown: ' . implode('; ', $notes));
        }
        return $house + ['asked' => mb_substr($id, 0, 64), 'why' => implode('; ', $notes)];
    }
    return ['id' => $t['id'], 'name' => $t['name'], 'house' => false, 'vars' => $vars ?: new stdClass(), 'has' => $t['has'],
            'wears' => xs_theme_wears($t), 'notes' => $notes];
}

/** The theme the settings ask for. */
function xs_theme_page(array $s): array
{
    return xs_theme_payload((string) ($s['feel']['theme'] ?? XS_THEME_HOUSE));
}
