<?php
/**
 * Xsegon - the console folders a games folder is given.
 *
 * The names the scan reads a folder by, the folders made for someone who has
 * none yet, and the first games folder of a new setup. Loaded by scan.php,
 * which every caller already loads.
 */
declare(strict_types=1);

require_once __DIR__ . '/scan.php';

/**
 * One folder name for each console: what the scan screen lists as "names it
 * understands" and what "Make the console folders" creates. Only consoles with
 * an emulator are made (api\scan.php), so nobody gets forty empty folders.
 */
function xs_scan_folder_names(): array
{
    return [
        'nes' => 'Nintendo Entertainment System', 'snes' => 'Super Nintendo Entertainment System', 'n64' => 'Nintendo 64',
        'gb' => 'Nintendo Game Boy', 'gbc' => 'Nintendo Game Boy Color', 'gba' => 'Nintendo Game Boy Advance',
        'ds' => 'Nintendo DS', 'gc' => 'Nintendo GameCube', 'wii' => 'Nintendo Wii',
        'virtualboy' => 'Nintendo Virtual Boy', 'fds' => 'Nintendo Famicom Disk System', 'pokemini' => 'Nintendo Pokemon Mini',
        'genesis' => 'Sega Genesis', 'mastersystem' => 'Sega Master System', 'gamegear' => 'Sega Game Gear',
        '32x' => 'Sega 32X', 'segacd' => 'Sega CD', 'saturn' => 'Sega Saturn', 'dreamcast' => 'Sega Dreamcast',
        'psx' => 'Sony Playstation', 'ps2' => 'Sony Playstation 2', 'psp' => 'Sony PSP',
        'atari2600' => 'Atari 2600', 'atari5200' => 'Atari 5200', 'atari7800' => 'Atari 7800', 'lynx' => 'Atari Lynx',
        'jaguar' => 'Atari Jaguar', 'pcengine' => 'NEC TurboGrafx-16', 'pcenginecd' => 'NEC TurboGrafx-CD',
        'neogeo' => 'SNK Neo Geo MVS', 'ngp' => 'SNK Neo Geo Pocket', 'ngpc' => 'SNK Neo Geo Pocket Color',
        'wonderswan' => 'WonderSwan', 'wonderswancolor' => 'WonderSwan Color',
        'colecovision' => 'ColecoVision', 'intellivision' => 'Mattel Intellivision', 'vectrex' => 'GCE Vectrex',
        'odyssey2' => 'Magnavox Odyssey 2', 'channelf' => 'Fairchild Channel F', '3do' => '3DO Interactive Multiplayer',
        'msx' => 'Microsoft MSX', 'c64' => 'Commodore 64', 'amiga' => 'Commodore Amiga',
        'amstradcpc' => 'Amstrad CPC', 'zxspectrum' => 'Sinclair ZX Spectrum',
        'arcade' => 'Arcade',           // sets named by MAME's list (includes\arcade.php); mame and fbneo read as it too
    ];
}

/**
 * The same list, cut down to the consoles this PC has an emulator for. With
 * no emulator set up yet (a brand new copy before Getting started) it is the
 * whole list: the names are still the names.
 */
function xs_scan_folder_names_playable(): array
{
    $table = xs_read_json(xs_emulators_path(), null);
    $have  = is_array($table) && !empty($table['platforms']) ? $table['platforms'] : null;
    $out = [];
    foreach (xs_scan_folder_names() as $name => $console) {
        if ($have === null || isset($have[strtolower($console)])) {
            $out[$name] = $console;
        }
    }
    // Never part of the whole list: RetroArch alone does not play these.
    foreach (xs_scan_own_emulator_names() as $name => $console) {
        if (isset($have[strtolower($console)])) {
            $out[$name] = $console;
        }
    }
    return $out;
}

/**
 * One empty folder per console there is an emulator for, inside $base. A
 * console that already has a folder there, whatever it is called, gets no
 * second one; nothing is moved or deleted. Shared by "Make console folders"
 * (api\scan.php) and the Games folder a new copy starts with, below.
 */
function xs_scan_make_folders(string $base): array
{
    $there = [];
    foreach (@scandir($base) ?: [] as $e) {
        if ($e !== '.' && $e !== '..' && is_dir($base . DIRECTORY_SEPARATOR . $e)) {
            $console = xs_scan_platform_for($e);
            if ($console !== null) {
                $there[$console] = true;
            }
        }
    }
    $made = $had = $failed = [];
    foreach (xs_scan_folder_names_playable() as $name => $console) {
        if (isset($there[$console])) {
            $had[] = $name;
        } elseif (@mkdir($base . DIRECTORY_SEPARATOR . $name)) {
            $made[] = $name;
        } else {
            $failed[] = $name;
        }
    }
    return ['made' => $made, 'had' => $had, 'failed' => $failed];
}

/*  THE GAMES FOLDER A NEW COPY STARTS WITH: one Games folder with a folder per
    console and a note, put on the list Scan for Games looks in. Made once, only
    for a copy with no games folder; data\setup.json remembers it, so one taken
    off the list or deleted is not made again. start.ps1 asks on every start. */

/** Where that folder stands: beside Start Xsegon.bat in a download; inside
    Xsegon's own folder in a checkout, so nothing is made outside it; inside
    the data copy for a test server. */
function xs_scan_first_folder_path(): string
{
    if (xs_test_copy()) {
        return xs_data_path('Games');
    }
    $above = dirname(XS_ROOT);
    return (is_file($above . DIRECTORY_SEPARATOR . 'Start Xsegon.bat') ? $above : XS_ROOT) . DIRECTORY_SEPARATOR . 'Games';
}

/** The folder Xsegon made, or '' when it made none. */
function xs_scan_first_folder_made(): string
{
    $setup = xs_read_json(xs_data_path('setup.json'), []);
    return is_array($setup) && is_string($setup['gamesFolder'] ?? null) ? $setup['gamesFolder'] : '';
}

/**
 * Make it, when this copy has no games folder and never had this one.
 * Answers made (bool), path, folders (how many console folders) and why.
 */
function xs_scan_first_folder(): array
{
    $setup = xs_read_json(xs_data_path('setup.json'), []);
    $setup = is_array($setup) ? $setup : [];
    $path  = xs_scan_first_folder_path();
    if (array_key_exists('gamesFolder', $setup)) {
        return ['made' => false, 'path' => (string) $setup['gamesFolder'], 'folders' => 0, 'why' => 'made on an earlier start'];
    }
    if (xs_scan_roots() !== []) {
        return ['made' => false, 'path' => $path, 'folders' => 0, 'why' => 'this copy already has a games folder'];
    }
    // A Games folder that is already there is taken as it is: a newer copy
    // unzipped over an older one, with a person's games in it.
    if (!is_dir($path) && !@mkdir($path)) {
        $why = xs_file_error_reason();
        xs_log('SCAN', 'the Games folder could NOT be made at ' . $path . ': ' . $why);
        return ['made' => false, 'path' => $path, 'folders' => 0, 'why' => 'it could not be made: ' . $why];
    }
    $did  = xs_scan_make_folders($path);
    $note = $path . DIRECTORY_SEPARATOR . 'Put your games here.txt';
    if (!is_file($note)) {
        $lines = [
            'Put your games in this folder, then choose Games > Scan for Games in Xsegon.',
            '',
            'Most games are found wherever they are in here, in any folder you like: Xsegon reads',
            'which console a game is for from the game file itself.',
            '',
            'Two kinds of file cannot be read that way: .chd and .7z. Put those in the folder',
            'named for their console. (A .zip holding several games needs unpacking first.)',
            '',
        ];
        foreach (xs_scan_folder_names_playable() as $name => $console) {
            $lines[] = '    ' . str_pad($name, 18) . $console;
        }
        $lines[] = '';
        $lines[] = 'A folder you name yourself works too, by the console\'s full name (Sega Saturn, Game Boy Advance).';
        $lines[] = 'Folders you do not need can be deleted. Xsegon never moves or deletes anything in here.';
        @file_put_contents($note, implode("\r\n", $lines) . "\r\n");
    }
    $s = xs_settings();
    $folders = array_values(array_filter((array) ($s['paths']['scanFolders'] ?? []), 'is_string'));
    $folders[] = $path;
    xs_settings_save(['paths' => ['scanFolders' => $folders]], $why);
    if ($why !== null) {
        // Not remembered as made: the next start tries again.
        xs_log('SCAN', 'the Games folder at ' . $path . ' could NOT be put on the list: ' . $why);
        return ['made' => false, 'path' => $path, 'folders' => count($did['made']), 'why' => 'it could not be put on the list: ' . $why];
    }
    $setup['gamesFolder'] = $path;
    xs_write_json(xs_data_path('setup.json'), $setup);
    xs_log('SCAN', 'a new copy with no games folder: Games made at ' . $path . ' with ' . count($did['made'])
        . ' console folders (' . count($did['had']) . ' were there'
        . ($did['failed'] ? ', ' . count($did['failed']) . ' could NOT be made' : '') . '), and put on the list');
    return ['made' => true, 'path' => $path, 'folders' => count($did['made']) + count($did['had']), 'why' => ''];
}
