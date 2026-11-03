<?php
/**
 * Cemu (Wii U). Portable with a portable\ folder or settings.xml beside it, else %APPDATA%\Cemu.
 * Bindings: controllerProfiles\controllerN.xml, player N+1: <mapping> the Wii U control, <button> the pad's input.
 */
declare(strict_types=1);

// The GamePad's controls by mapping number (src\input\emulated\VPADController.h).
const XS_CEMU_GAMEPAD = [1 => 'A', 2 => 'B', 3 => 'X', 4 => 'Y', 5 => 'L', 6 => 'R', 7 => 'ZL', 8 => 'ZR', 9 => 'Plus', 10 => 'Minus',
    11 => 'D-pad up', 12 => 'D-pad down', 13 => 'D-pad left', 14 => 'D-pad right', 15 => 'Left stick press', 16 => 'Right stick press',
    17 => 'Left stick up', 18 => 'Left stick down', 19 => 'Left stick left', 20 => 'Left stick right',
    21 => 'Right stick up', 22 => 'Right stick down', 23 => 'Right stick left', 24 => 'Right stick right',
    25 => 'Microphone', 26 => 'Show the GamePad screen', 27 => 'Home'];

// An XInput pad's inputs by Cemu's number, read off a profile Cemu wrote for an Xbox pad.
const XS_CEMU_XINPUT = [0 => 'D-pad up', 1 => 'D-pad down', 2 => 'D-pad left', 3 => 'D-pad right', 4 => 'Start', 5 => 'Back',
    6 => 'Left stick press', 7 => 'Right stick press', 8 => 'LB', 9 => 'RB', 12 => 'A', 13 => 'B', 14 => 'X', 15 => 'Y',
    38 => 'Left stick right', 39 => 'Left stick up', 40 => 'Right stick right', 41 => 'Right stick up', 42 => 'LT', 43 => 'RT',
    44 => 'Left stick left', 45 => 'Left stick down', 46 => 'Right stick left', 47 => 'Right stick down'];

/** One profile: ['type', 'api', 'pad', 'map' => [mapping => input]]; null when it will not read. */
function xs_cemu_profile(string $file): ?array
{
    $x = @simplexml_load_file($file);
    if ($x === false || !isset($x->type)) {
        return null;
    }
    $map = [];
    foreach ($x->controller->mappings->entry ?? [] as $en) {
        $map[(int) $en->mapping] = (int) $en->button;
    }
    return ['type' => trim((string) $x->type), 'api' => trim((string) ($x->controller->api ?? '')),
            'pad' => trim((string) ($x->controller->uuid ?? '')), 'map' => $map];
}

// The XInput inputs, Nintendo's places (A on the right): the GamePad's mapping numbers, then the Pro Controller's
// (src\input\emulated\ProController.h). Home has none: Cemu reads XInput without the Xbox button.
const XS_CEMU_PAD_MAP = [1 => 13, 2 => 12, 3 => 15, 4 => 14, 5 => 8, 6 => 9, 7 => 42, 8 => 43, 9 => 4, 10 => 5, 11 => 0, 12 => 1,
    13 => 2, 14 => 3, 15 => 6, 16 => 7, 17 => 39, 18 => 45, 19 => 44, 20 => 38, 21 => 41, 22 => 47, 23 => 46, 24 => 40];
const XS_CEMU_PRO_MAP = [1 => 13, 2 => 12, 3 => 15, 4 => 14, 5 => 8, 6 => 9, 7 => 42, 8 => 43, 9 => 4, 10 => 5, 12 => 0, 13 => 1,
    14 => 2, 15 => 3, 16 => 6, 17 => 7, 18 => 39, 19 => 45, 20 => 44, 21 => 38, 22 => 41, 23 => 47, 24 => 46, 25 => 40];

/** A controller profile as Cemu writes one: an emulated type on one XInput pad. */
function xs_cemu_profile_xml(string $type, string $name, int $pad, array $map): string
{
    $x = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<emulated_controller>\n\t<type>" . $type . "</type>\n\t<profile>" . $name . "</profile>\n"
       . "\t<controller>\n\t\t<api>XInput</api>\n\t\t<uuid>" . $pad . "</uuid>\n\t\t<display_name>Controller " . ($pad + 1) . "</display_name>\n\t\t<rumble>0</rumble>\n";
    foreach (['axis', 'rotation', 'trigger'] as $t) {
        $x .= "\t\t<" . $t . ">\n\t\t\t<deadzone>0.15</deadzone>\n\t\t\t<range>1</range>\n\t\t</" . $t . ">\n";
    }
    $x .= "\t\t<mappings>\n";
    foreach ($map as $m => $b) {
        $x .= "\t\t\t<entry>\n\t\t\t\t<mapping>" . $m . "</mapping>\n\t\t\t\t<button>" . $b . "</button>\n\t\t\t</entry>\n";
    }
    return $x . "\t\t</mappings>\n\t</controller>\n</emulated_controller>\n";
}

/** Letters and digits only, "the" left out: "Legend of Zelda, The - Breath of the Wild" meets "The Legend of Zelda: Breath of the Wild". */
function xs_cemu_name_key(string $s): string
{
    $s = strtolower((string) preg_replace('/\s*[\(\[][^)\]]*[\)\]]/', '', $s));
    return (string) preg_replace('/[^a-z0-9]+/', '', (string) preg_replace('/\bthe\b/', '', $s));
}

/**
 * A Wii U game's title ID, for its own profile's name: its name found in the graphic packs Cemu
 * downloaded (each pack's path starts with the game's name, its titleIds list every region's),
 * and the region from the file name told by the profile Cemu ships for each ID. Null with $why.
 */
/**
 * Every graphic pack Cemu would load (graphicPacks\, downloaded and the person's own), from its
 * rules.txt: ['file', 'rel' (as settings.xml names it), 'ids' (lower case), 'path', 'name',
 * 'description', 'default']. Read once a request.
 */
function xs_cemu_rules(string $home): array
{
    static $memo = [];
    if (isset($memo[$home])) {
        return $memo[$home];
    }
    $out = [];
    $root = $home . '\\graphicPacks';
    $it = is_dir($root) ? new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) : [];
    foreach ($it as $f) {
        if (strcasecmp($f->getFilename(), 'rules.txt') !== 0) {
            continue;
        }
        $t = (string) @file_get_contents($f->getPathname(), false, null, 0, 8192);
        // Only [Definition] says what a pack is; presets below it have their own name lines.
        $def = (string) preg_replace('/\n\[(?!Definition\])[\s\S]*$/', '', str_replace("\r", '', $t));
        if (!preg_match('/^\s*titleIds\s*=\s*([0-9A-Fa-f,\s]+)$/m', $def, $ids)) {
            continue;
        }
        $get = static fn(string $k): string => preg_match('/^\s*' . $k . '\s*=\s*"?([^"\n]*)"?\s*$/mi', $def, $m) ? trim($m[1]) : '';
        $out[] = ['file' => $f->getPathname(),
                  'rel' => 'graphicPacks/' . str_replace('\\', '/', substr($f->getPathname(), strlen($root) + 1)),
                  'ids' => array_values(array_filter(array_map('strtolower', preg_split('/[,\s]+/', trim($ids[1])) ?: []))),
                  'path' => $get('path'), 'name' => $get('name'), 'description' => $get('description'),
                  'default' => in_array(strtolower($get('default')), ['1', 'true'], true)];
    }
    return $memo[$home] = $out;
}

function xs_cemu_title_id(string $home, string $exe, string $title, string $rom, ?string &$why = null): ?string
{
    $names = [];
    foreach (xs_cemu_rules($home) as $r) {
        if (preg_match('~^([^/]+)/~', $r['path'], $p)) {
            foreach ($r['ids'] as $id) {
                if (preg_match('/^00050000[0-9a-f]{8}$/', $id)) {
                    $names[xs_cemu_name_key($p[1])][$id] = true;
                }
            }
        }
    }
    $k = xs_cemu_name_key($title);
    $ids = array_keys($names[$k] ?? []);
    if (!$ids) {
        $why = 'no graphic pack Cemu downloaded names ' . $title . ', so its title ID is not known (Options > Graphic packs > Download latest in Cemu adds them)';
        return null;
    }
    if (count($ids) === 1) {
        return $ids[0];
    }
    // The region in the file name, as the profiles Cemu ships write it on their first line.
    $want = preg_match('/\((USA|US)\b/i', $rom) ? 'US' : (preg_match('/\((Europe|EUR|EU)\b/i', $rom) ? 'EU' : (preg_match('/\((Japan|JPN|JP)\b/i', $rom) ? 'JP' : ''));
    $dir = dirname($exe) . '\\gameProfiles\\default';
    $hit = [];
    foreach (@scandir($dir) ?: [] as $f) {
        $id = strtolower(pathinfo($f, PATHINFO_FILENAME));
        if (in_array($id, $ids, true) && preg_match('/\((USA|US|EUR|EU|JPN|JP)\)/i', (string) @file_get_contents($dir . '\\' . $f, false, null, 0, 200), $m)
            && $want !== '' && str_starts_with(strtoupper($m[1]), $want)) {
            $hit[] = $id;
        }
    }
    if (count($hit) === 1) {
        return $hit[0];
    }
    $why = 'which region\'s copy of ' . $title . ' this is could not be told from its file name and Cemu\'s own game profiles';
    return null;
}

/** Which packs settings.xml switches: [rel path (lower case) => true for on, false for switched off]. Read only. */
function xs_cemu_packs_set(string $home): array
{
    $out = [];
    preg_match_all('~<Entry\s+filename="([^"]+)"([^>]*)>~i', (string) @file_get_contents($home . '\\settings.xml'), $m, PREG_SET_ORDER);
    foreach ($m as $e) {
        $out[strtolower(str_replace('\\', '/', html_entity_decode($e[1])))] = !preg_match('/disabled\s*=\s*"true"/i', $e[2]);
    }
    return $out;
}

/** The profile Cemu ships for a title, whatever the case of its name; null when it ships none. */
function xs_cemu_shipped(string $exe, string $id): ?string
{
    $dir = dirname($exe) . '\\gameProfiles\\default';
    foreach (@scandir($dir) ?: [] as $f) {
        if (strcasecmp($f, $id . '.ini') === 0) {
            return $dir . '\\' . $f;
        }
    }
    return null;
}

return [
    'name'     => 'Cemu',
    'exes'     => ['cemu'],
    'consoles' => ['nintendo wii u', 'wii u'],
    'home'     => static function (string $dir): string {
        if (is_dir($dir . '\\portable')) {
            return $dir . '\\portable';
        }
        return is_file($dir . '\\settings.xml') ? $dir : xs_emus_appdata('Cemu');
    },
    'controls' => static function (string $home, string $platform): array {
        $dir  = $home . DIRECTORY_SEPARATOR . 'controllerProfiles';
        $file = $dir . DIRECTORY_SEPARATOR . 'controller0.xml';
        if (!is_file($file)) {
            return ['rows' => [], 'source' => ['file' => null, 'read' => false,
                    'note' => 'Cemu has no controller set for player 1 (' . $file . ' is not there); Options > Input settings in Cemu sets one.']];
        }
        $p = xs_cemu_profile($file);
        if ($p === null) {
            return ['rows' => [], 'source' => ['file' => $file, 'read' => false, 'note' => 'Cemu\'s player 1 profile would not read as XML.']];
        }
        $xin  = strcasecmp($p['api'], 'XInput') === 0;
        $rows = [['name' => 'Player 1', 'value' => $p['type'] . ($p['api'] !== '' ? ', ' . $p['api'] . ($xin ? ' pad ' . ((int) $p['pad'] + 1) : '') : '')]];
        for ($n = 1; $n < 8; $n++) {
            $o = xs_cemu_profile($dir . DIRECTORY_SEPARATOR . 'controller' . $n . '.xml');
            if ($o !== null) {
                $rows[] = ['name' => 'Player ' . ($n + 1), 'value' => $o['type'] . ($o['api'] !== '' ? ', ' . $o['api'] . (strcasecmp($o['api'], 'XInput') === 0 ? ' pad ' . ((int) $o['pad'] + 1) : '') : '')];
            }
        }
        $gamepad = strcasecmp($p['type'], 'Wii U GamePad') === 0;
        $unset = [];
        foreach ($gamepad ? XS_CEMU_GAMEPAD : [] as $m => $label) {
            if (isset($p['map'][$m])) {
                $b = $p['map'][$m];
                $rows[] = ['name' => $label, 'value' => $xin ? (XS_CEMU_XINPUT[$b] ?? 'input ' . $b) : 'input ' . $b];
            } else {
                $rows[] = ['name' => $label, 'value' => 'not set', 'unset' => true];
                $unset[] = $label;
            }
        }
        if (!$gamepad) {
            foreach ($p['map'] as $m => $b) {
                $rows[] = ['name' => 'Control ' . $m, 'value' => $xin ? (XS_CEMU_XINPUT[$b] ?? 'input ' . $b) : 'input ' . $b];
            }
        }
        $note = 'Cemu\'s own profiles: the Wii U control on the left, the pad input on the right.';
        if (in_array('Home', $unset, true) || in_array('Show the GamePad screen', $unset, true)) {
            $note .= ' Home and the GamePad screen are on no button, so no press on the pad reaches them.';
        }
        return ['rows' => $rows, 'source' => ['file' => $file, 'read' => true, 'note' => $note]];
    },
    'leave'    => 'xsegon',
    'setup'    => [
        'words' => 'Xsegon writes profiles of its own: Xsegon Player 1, your own GamePad as Cemu has it (or one on the first pad, A on the right as on a Wii U), and Xsegon Player 2 to 4, a Pro Controller on each next pad, for the games two to four play. Each game gets them in its own profile the first time Xsegon starts it, starting from the profile Cemu ships for it. Cemu\'s own controllers stay as they are. Home has no button: Cemu reads an Xbox pad without its Xbox button.',
        'own'   => static function (string $home, string $exe, ?string &$why): ?array {
            $dir = $home . '\\controllerProfiles';
            $mine = $dir . '\\controller0.xml';
            $p = is_file($mine) ? xs_cemu_profile($mine) : null;
            $one = $p !== null && strcasecmp($p['type'], 'Wii U GamePad') === 0
                ? (string) @file_get_contents($mine)
                : xs_cemu_profile_xml('Wii U GamePad', 'Xsegon Player 1', 0, XS_CEMU_PAD_MAP);
            $out = [$dir . '\\Xsegon Player 1.xml' => $one];
            for ($n = 2; $n <= 4; $n++) {
                $out[$dir . '\\Xsegon Player ' . $n . '.xml'] = xs_cemu_profile_xml('Wii U Pro Controller', 'Xsegon Player ' . $n, $n - 1, XS_CEMU_PRO_MAP);
            }
            return $out;
        },
        'game'  => static function (string $home, string $exe, array $game, string $rom, ?string &$why): ?array {
            $id = xs_cemu_title_id($home, $exe, (string) ($game['title'] ?? ''), $rom, $why);
            if ($id === null) {
                return null;
            }
            $set = [];
            for ($n = 1; $n <= 4; $n++) {
                $set['controller' . $n] = 'Xsegon Player ' . $n;
            }
            return ['file' => $home . '\\gameProfiles\\' . $id . '.ini', 'section' => 'Controller', 'set' => $set, 'from' => xs_cemu_shipped($exe, $id)];
        },
    ],
    /* A game's graphic packs (roadmap CA18): shown, never switched here. They are switched in
       settings.xml, Cemu's one file for every game, so the person does it in Cemu (CA17). */
    'packs'    => static function (string $home, string $exe, array $game, string $rom, ?string &$why): ?array {
        $id = xs_cemu_title_id($home, $exe, (string) ($game['title'] ?? ''), $rom, $why);
        if ($id === null) {
            return null;
        }
        $set = xs_cemu_packs_set($home);
        $mark = $home . '\\graphicPacks\\downloadedGraphicPacks\\version.txt';
        $got = is_file($mark) ? (int) filemtime($mark) : 0;
        $packs = [];
        foreach (xs_cemu_rules($home) as $r) {
            if (!in_array($id, $r['ids'], true)) {
                continue;
            }
            $bits = explode('/', $r['path']);
            $kind = count($bits) > 2 ? $bits[1] : (count($bits) === 2 ? $bits[1] : 'Pack');
            $state = $set[strtolower($r['rel'])] ?? null;
            $downloaded = stripos($r['rel'], 'graphicPacks/downloadedGraphicPacks/') === 0;
            // Written there after Cemu's download (it writes the whole set in a second, version.txt last):
            // the person's own, which the next download deletes.
            $late = $downloaded && $got > 0 && (int) @filemtime($r['file']) > $got + 60;
            $packs[] = ['name' => $r['name'] !== '' ? $r['name'] : end($bits), 'kind' => $kind, 'description' => $r['description'],
                        'on' => $state ?? $r['default'], 'own' => !$downloaded || $late, 'late' => $late, 'folder' => dirname($r['file'])];
        }
        usort($packs, static fn(array $a, array $b): int => [$a['kind'], $a['name']] <=> [$b['kind'], $b['name']]);
        return ['titleId' => $id, 'packs' => $packs,
                'set' => is_file($mark) ? trim((string) @file_get_contents($mark)) : '',
                'where' => 'In Cemu: Options > Graphic packs, then ' . (string) ($game['title'] ?? 'the game') . ' in the list on the left. Download latest there brings newer packs.',
                'whose' => 'The community\'s graphic packs for Cemu (github.com/cemu-project/cemu_graphic_packs), free for anyone to use (CC0).'];
    },
];
