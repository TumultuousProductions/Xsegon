<?php
/**
 * Emulators for the consoles RetroArch does not play (api\emusuggest.php,
 * js\emuhelp.js): the well-known ones, each with its makers' own website.
 *
 * Xsegon brings RetroArch and nothing else: the others are the person's to
 * get, from their makers. Only the makers' pages are named, never a file to
 * download, and nothing for consoles whose makers go to court over emulation.
 */
declare(strict_types=1);

require_once __DIR__ . '/setup.php';

/** The well-known emulators. needs: what it asks for that Xsegon never provides. */
function xs_emu_suggestions(): array
{
    return [
        ['id' => 'dolphin', 'name' => 'Dolphin', 'url' => 'https://dolphin-emu.org/', 'consoles' => ['Nintendo GameCube', 'Nintendo Wii'],
         'needs' => ''],
        ['id' => 'cemu',    'name' => 'Cemu',    'url' => 'https://cemu.info/',       'consoles' => ['Wii U', 'Nintendo Wii U'],
         'needs' => 'Some kinds of game file need keys from a Wii U of your own.'],
        ['id' => 'pcsx2',   'name' => 'PCSX2',   'url' => 'https://pcsx2.net/',       'consoles' => ['Sony Playstation 2'],
         'needs' => 'It needs the BIOS from a PlayStation 2 of your own.'],
        ['id' => 'rpcs3',   'name' => 'RPCS3',   'url' => 'https://rpcs3.net/',       'consoles' => ['Sony Playstation 3'],
         'needs' => "It asks for the PlayStation 3's system software, a free download from PlayStation's own website."],
        ['id' => 'xemu',    'name' => 'xemu',    'url' => 'https://xemu.app/',        'consoles' => ['Microsoft Xbox'],
         'needs' => 'It needs the BIOS and boot ROM from an Xbox of your own.'],
        ['id' => 'xenia',   'name' => 'Xenia',   'url' => 'https://xenia.jp/',        'consoles' => ['Microsoft Xbox 360'],
         'needs' => ''],
    ];
}

/** Consoles Xsegon names no emulator for: their makers take emulators to court. */
function xs_emu_suggest_none(): array
{
    return ['Nintendo Switch', 'Nintendo 3DS'];
}

/** What one console has: the emulators named for it, and whether none is named on purpose. */
function xs_emu_suggest_for(string $platform): array
{
    $low = strtolower(trim($platform));
    $list = [];
    foreach (xs_emu_suggestions() as $s) {
        if (in_array($low, array_map('strtolower', $s['consoles']), true)) {
            $list[] = xs_emu_suggest_row($s);
        }
    }
    return [
        'platform'  => $platform,
        'emulators' => $list,
        'none'      => in_array($low, array_map('strtolower', xs_emu_suggest_none()), true),
        'ra'        => xs_setup_ra_plays($platform),
    ];
}

/** Every console with a named emulator, in the list's order, and the consoles RetroArch plays. */
function xs_emu_suggest_all(): array
{
    $consoles = [];
    foreach (xs_emu_suggestions() as $s) {
        foreach ($s['consoles'] as $c) {
            // One console under two names (Wii U) is listed once, by its first.
            if ($c === 'Nintendo Wii U') {
                continue;
            }
            $consoles[$c][] = xs_emu_suggest_row($s);
        }
    }
    $rows = [];
    foreach ($consoles as $c => $list) {
        $rows[] = ['platform' => $c, 'emulators' => $list];
    }
    return ['consoles' => $rows, 'none' => xs_emu_suggest_none(), 'ra' => array_keys(xs_setup_default_cores())];
}

/** One emulator as the page shows it: the address itself stays here, and only its site's name goes out. */
function xs_emu_suggest_row(array $s): array
{
    return ['id' => $s['id'], 'name' => $s['name'], 'site' => (string) parse_url($s['url'], PHP_URL_HOST), 'needs' => $s['needs']];
}

/** The makers' page of a listed emulator, or null: an address is never taken from a request. */
function xs_emu_suggest_url(string $id): ?string
{
    foreach (xs_emu_suggestions() as $s) {
        if ($s['id'] === $id) {
            return $s['url'];
        }
    }
    return null;
}
