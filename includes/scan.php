<?php
/**
 * Xsegon - games found on the disk itself.
 *
 *     data\scanned-games.json    [ { id, title, platform, rom, added }, ... ]
 *
 * The scanner walks the ROM folders, offers what the library does not already
 * have, and what you accept is stored here and merged at read the way your own
 * games are (includes\local.php). library.json and the imported library are never
 * touched, and deleting this file is the whole undo. Titles come from cleaned
 * file names, and the art starts empty.
 *
 *   - a FOLDER can be the game (every PS3 game is PS3_GAME\USRDIR\EBOOT.BIN
 *     five levels down; extracted discs sit in folders named after the disc)
 *   - multi-disc sets collapse to one game: m3u first, then PBP, then Disc 1,
 *     and never a bare Disc 2
 *   - an archive on a disc console is NOT a game (a 700 MB bin cannot be
 *     streamed out of a 7z); on a cartridge console it is (cores read zips)
 *   - a disc set with holes is worth a warning, not silence
 *
 * The launch command is built from Xsegon's own emulator table at READ time,
 * not baked at accept time, so pointing Sega Saturn at a core in Settings >
 * Emulators makes every scanned Saturn game playable on the next screen.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/emulators.php';
require_once __DIR__ . '/overrides.php';
require_once __DIR__ . '/art.php';
require_once __DIR__ . '/import.php';    // xs_library, for what is already answered for;
                                         // the require cycle is safe, calls are all runtime
require_once __DIR__ . '/romid.php';     // which console a file is for, read from the file
require_once __DIR__ . '/scanfolders.php';   // the console folders a games folder is given
require_once __DIR__ . '/discsets.php';      // the discs of one game, played as one
require_once __DIR__ . '/arcade.php';        // arcade sets, named by MAME's own list

/*  WHERE A GAME MAY STAND:

      - inside a console's folder, every folder under it is looked into, to
        any depth: a folder holding one game is still that game (a disc and
        its tracks, the discs of one set), a folder holding several is a
        shelf of them (snes\Hacks, psx\RPG\...);
      - outside a console's folder (a file at the top of a games folder, or
        in a folder with any other name, to any depth) the game says which
        console it is for itself: includes\romid.php. A folder named for a
        console, met anywhere on the way down, is read as that console's;
      - what can NOT say (a .chd, a .7z) is counted per folder and named,
        with the folder names the scan understands: api\scan.php lists
        them and makes them on request.

    The folder's name wins inside a console's folder: it is the person's
    own word. */

function xs_scan_path(): string
{
    return xs_data_path('scanned-games.json');
}

/**
 * Every folder Scan for Games looks in: the ROM drive, then the added ones.
 * One function, because the walk, the screen and adding or removing one must
 * agree. Duplicates and blanks are dropped here.
 */
function xs_scan_roots(?array $s = null): array
{
    $s = $s ?? xs_settings();
    $roots = [];
    $seen  = [];
    $add = static function (string $p) use (&$roots, &$seen): void {
        $p = xs_norm_path($p);
        if ($p === '') {
            return;
        }
        $key = strtolower(rtrim($p, '\\/'));
        if (isset($seen[$key])) {
            return;
        }
        $seen[$key] = true;
        $roots[] = $p;
    };
    $add((string) ($s['paths']['romRoot'] ?? ''));
    foreach ((array) ($s['paths']['scanFolders'] ?? []) as $extra) {
        if (is_string($extra)) {
            $add($extra);
        }
    }
    return $roots;
}

function xs_scan_read(): array
{
    $l = xs_read_json(xs_scan_path(), []);
    return is_array($l) ? array_values(array_filter($l, 'is_array')) : [];
}

/**
 * Folder name -> the platform name Xsegon shows. The names on the right must
 * match the imported library's names EXACTLY where the console already
 * exists, or a scanned N64 game would stand up a second "N64" console.
 */
function xs_scan_platforms(): array
{
    return [
        'psx' => 'Sony Playstation',   'ps1' => 'Sony Playstation',  'playstation' => 'Sony Playstation',
        'ps2' => 'Sony Playstation 2', 'ps3' => 'Sony Playstation 3',
        'n64' => 'Nintendo 64',        'nes' => 'Nintendo Entertainment System',
        'snes' => 'Super Nintendo Entertainment System', 'sfc' => 'Super Nintendo Entertainment System',
        'gb' => 'Nintendo Game Boy',   'gbc' => 'Nintendo Game Boy Color', 'gba' => 'Nintendo Game Boy Advance',
        'gc' => 'Nintendo GameCube',   'gamecube' => 'Nintendo GameCube',
        'wii' => 'Nintendo Wii',       'wii u' => 'Wii U', 'wiiu' => 'Wii U',
        'ds' => 'Nintendo DS',
        'dc' => 'Sega Dreamcast',      'dreamcast' => 'Sega Dreamcast',
        'genesis' => 'Sega Genesis',   'megadrive' => 'Sega Genesis', 'md' => 'Sega Genesis',
        'sega 32x' => 'Sega 32X',      '32x' => 'Sega 32X', 'sega32x' => 'Sega 32X',
        'saturn' => 'Sega Saturn',     'mastersystem' => 'Sega Master System', 'gamegear' => 'Sega Game Gear',
        'xbox' => 'Microsoft Xbox',    'xbox360' => 'Microsoft Xbox 360',
        'atari2600' => 'Atari 2600',   'atari7800' => 'Atari 7800', 'lynx' => 'Atari Lynx',
        // The emulator table's own spellings, because it is keyed by them.
        'psp' => 'Sony PSP',           '3do' => '3DO Interactive Multiplayer',
        'neogeo' => 'SNK Neo Geo MVS', 'fds' => 'Nintendo Famicom Disk System',
        'pcengine' => 'NEC TurboGrafx-16', 'channelf' => 'Fairchild Channel F',
        /* The rest of the consoles Xsegon's own RetroArch setup can play
           (includes\setup.php), under the folder names other front ends use. */
        'segacd' => 'Sega CD', 'megacd' => 'Sega CD',
        'pcenginecd' => 'NEC TurboGrafx-CD', 'tg-cd' => 'NEC TurboGrafx-CD', 'tg16' => 'NEC TurboGrafx-16',
        'atari5200' => 'Atari 5200', 'jaguar' => 'Atari Jaguar', 'atarijaguar' => 'Atari Jaguar',
        'colecovision' => 'ColecoVision', 'coleco' => 'ColecoVision',
        'intellivision' => 'Mattel Intellivision', 'vectrex' => 'GCE Vectrex', 'odyssey2' => 'Magnavox Odyssey 2',
        'msx' => 'Microsoft MSX', 'c64' => 'Commodore 64', 'amiga' => 'Commodore Amiga',
        'amstradcpc' => 'Amstrad CPC', 'zxspectrum' => 'Sinclair ZX Spectrum',
        'virtualboy' => 'Nintendo Virtual Boy', 'pokemini' => 'Nintendo Pokemon Mini',
        'ngp' => 'SNK Neo Geo Pocket', 'ngpc' => 'SNK Neo Geo Pocket Color',
        'wonderswan' => 'WonderSwan', 'wswan' => 'WonderSwan',
        'wonderswancolor' => 'WonderSwan Color', 'wswanc' => 'WonderSwan Color',
    ] + xs_scan_own_emulator_names();
}

/** Consoles only an emulator of your own plays (Emulators > Add an emulator). */
function xs_scan_own_emulator_names(): array
{
    return ['switch' => 'Nintendo Switch', '3ds' => 'Nintendo 3DS'];
}

/**
 * The console a folder is for, from its name, or null: the short names above,
 * or a console's full name ("Nintendo 64", "Super Nintendo"). Case, spaces and
 * marks are ignored, and the maker may be left off ("Game Boy", "Xbox 360").
 */
function xs_scan_platform_for(string $folder): ?string
{
    // A folder of arcade sets goes by many names (mame, mame2003, fbneo): includes\arcade.php.
    if (xs_arcade_folder($folder)) {
        return XS_ARCADE;
    }
    static $look = null;
    $norm = static fn(string $s): string => strtolower((string) preg_replace('/[^a-z0-9]+/i', '', $s));
    if ($look === null) {
        $look = [];
        $extra = [
            'supernintendo' => 'Super Nintendo Entertainment System', 'supernes' => 'Super Nintendo Entertainment System',
            'superfamicom' => 'Super Nintendo Entertainment System', 'famicom' => 'Nintendo Entertainment System',
            'psone' => 'Sony Playstation', 'playstation1' => 'Sony Playstation', 'mega drive' => 'Sega Genesis',
            'turbografx' => 'NEC TurboGrafx-16', 'neo geo' => 'SNK Neo Geo MVS', 'gcn' => 'Nintendo GameCube',
            'nds' => 'Nintendo DS', 'sms' => 'Sega Master System', 'gg' => 'Sega Game Gear', 'saturn' => 'Sega Saturn',
        ];
        foreach (xs_scan_platforms() + $extra as $short => $platform) {
            $look[$norm($short)] ??= $platform;
        }
        foreach (array_unique(array_merge(array_values(xs_scan_platforms()), array_values($extra))) as $platform) {
            $look[$norm($platform)] ??= $platform;
            $bare = preg_replace('/^(nintendo|sega|sony|microsoft|atari|nec|snk)\s+/i', '', $platform);
            $look[$norm((string) $bare)] ??= $platform;
        }
    }
    return $look[$norm($folder)] ?? null;
}

/** Consoles whose games are disc images: an archive here is a flag, not a game. */
function xs_scan_disc_platforms(): array
{
    return ['Sony Playstation', 'Sony Playstation 2', 'Sony Playstation 3', 'Sega Saturn',
            'Sega Dreamcast', 'Nintendo GameCube', 'Nintendo Wii', 'Wii U', 'Sony PSP',
            '3DO Interactive Multiplayer', 'Microsoft Xbox', 'Microsoft Xbox 360',
            'Sega CD', 'NEC TurboGrafx-CD'];
}

/** What counts as a game file, per kind of console. A disc's order is the dive's: earlier wins, a .cue over its .ccd over its .img. */
function xs_scan_extensions(bool $disc): array
{
    return $disc
        ? ['m3u', 'cue', 'gdi', 'chd', 'pbp', 'iso', 'ciso', 'cso', 'wbfs', 'wux', 'rvz', 'wia', 'gcm', 'cdi', 'ccd', 'bin', 'img']
        : ['zip', '7z', 'z64', 'n64', 'v64', 'nes', 'unf', 'fds', 'sfc', 'smc', 'gb', 'gbc', 'gba', 'nds',
           'md', 'gen', '32x', 'sms', 'gg', 'a26', 'a78', 'lnx', 'pce', 'vb', 'chd',
           // the rest of the consoles named in xs_scan_platforms
           'a52', 'j64', 'col', 'int', 'vec', 'min', 'ws', 'wsc', 'ngp', 'ngc',
           // Nintendo Switch and 3DS, played by an emulator of your own
           'nsp', 'xci', 'nsz', '3ds', 'cia', 'cci'];
}

/** Consoles whose emulators play another console's games too: those stay with the folder's console. */
function xs_scan_also_plays(): array
{
    return [
        'Nintendo Game Boy Color'   => ['Nintendo Game Boy'],
        'Nintendo Game Boy Advance' => ['Nintendo Game Boy', 'Nintendo Game Boy Color'],
        'Sega Game Gear'            => ['Sega Master System'],
        'Sega 32X'                  => ['Sega Genesis'],
        'Nintendo Wii'              => ['Nintendo GameCube'],
    ];
}

/**
 * The console a file in a console's folder names for sure, when the folder's
 * console cannot play it: by an ending only one console uses, or on a disc
 * console by the disc's own label (includes\romid.php, never a guess). Null
 * leaves it to the folder: a .zip, a .7z, a disc with no label, .md and .gen
 * (text files have them too), or a game the folder's console plays (.gb in gbc).
 */
function xs_scan_file_says(array $row, string $platform, bool $disc): ?string
{
    $ext  = strtolower((string) ($row['ext'] ?? ''));
    $ends = xs_romid_endings();
    $says = null;
    if (isset($ends[$ext]) && !in_array($ext, ['md', 'gen', 'vb'], true)) {
        $says = $ends[$ext];
    } elseif ($disc && in_array($ext, ['cue', 'ccd', 'm3u', 'iso', 'bin', 'img', 'pbp', 'ciso', 'rvz', 'wia', 'chd'], true)) {
        $read = xs_romid((string) $row['rom'], 0, false);
        $says = is_string($read) ? $read : null;
    }
    if ($says === null || strcasecmp($says, $platform) === 0 || in_array($says, xs_scan_also_plays()[$platform] ?? [], true)) {
        return null;
    }
    return $says;
}

/** "Legend of Dragoon, The (USA) (Disc 2).7z" -> "The Legend of Dragoon". */
function xs_scan_bare(string $name): string
{
    static $endings = null;
    if ($endings === null) {
        $endings = implode('|', array_map(static fn($e) => preg_quote($e, '/'),
            array_unique(array_merge(xs_scan_extensions(true), xs_scan_extensions(false), ['rar', 'gz', 'ecm']))));
    }
    $t = $name;
    for ($i = 0; $i < 3; $i++) {
        $t = preg_replace('/\.(?:' . $endings . ')$/i', '', $t) ?? $t;
    }
    return $t;
}

/**
 * A name down to its letters and digits, of every script, in lower case:
 * what two names are compared by. Latin letters alone made one key of every
 * game named in Japanese.
 */
function xs_scan_letters(string $s): string
{
    $k = preg_replace('/[^\p{L}\p{N}]+/u', '', $s);
    // Not UTF-8 (a name out of an old archive): the Latin letters, as before.
    return $k === null ? strtolower((string) preg_replace('/[^a-z0-9]+/i', '', $s)) : mb_strtolower($k, 'UTF-8');
}

function xs_scan_title(string $name): string
{
    /* Only what IS a file ending comes off the end, up to three of them
       ("Game.cue.zip"), so "Chase H.Q. Plus S.C.I.chd" keeps its dots. */
    $t = xs_scan_bare($name);
    /* Underscores standing for spaces, only when the name has no space at
       all. Bare region words at the end stay: taking them off would cut real
       titles short ("Big Trouble in Little China"), and bin\gamesdb.php
       looks past them. */
    if (strpos($t, '_') !== false && strpos($t, ' ') === false) {
        $t = str_replace('_', ' ', $t);
    }
    $t = preg_replace('/\[[^\]]*\]/', ' ', $t) ?? $t;
    $t = preg_replace('/\([^)]*\)/', ' ', $t) ?? $t;
    $t = preg_replace('/\{[^}]*\}/', ' ', $t) ?? $t;         // "{NGC} Skies of Arcadia"
    // A note whose closing bracket never came ("... [T+Eng1.0_Zoinkity"):
    // from the opening one to the end, when a title is left in front of it.
    $t = preg_replace('/(?<=\S)\s+[\[({][^\])}]*$/', '', $t) ?? $t;
    $t = trim(preg_replace('/\s+/', ' ', $t) ?? $t);
    $t = preg_replace('/^(.*),\s*(The|A|An)$/i', '$2 $1', $t) ?? $t;
    return $t !== '' ? $t : $name;
}

/**
 * The title of a game that is one disc of several: a bare disc tag at the
 * end ("Soldier of Fortune CD1") goes too, as "(Disc 2)" in brackets does.
 */
function xs_scan_set_title(string $name): string
{
    $t = xs_scan_title($name);
    $bare = trim((string) preg_replace('/[\s_.,-]*\b(?:Disc|Disk|CD)\s*\d+\s*$/i', '', $t));
    return $bare !== '' ? $bare : $t;
}

/** The disc number in a name, or null. */
function xs_scan_disc(string $name): ?int
{
    return preg_match('/\((?:Disc|Disk|CD)\s*(\d+)[^)]*\)|\b(?:Disc|Disk|CD)\s*(\d+)\b/i', $name, $m)
        ? (int) ($m[1] !== '' ? $m[1] : $m[2]) : null;
}

/**
 * Folders that are never a game, wherever they stand: a game's pictures and
 * manuals, and an emulator's own data kept beside the games. One list, read
 * by the walk and by the dive into a game's folder alike.
 *
 * Dolphin's portable User folder can sit in gc\ or wii\, and its NAND's .bin
 * files would pass for discs. The match is whole, so "Save the Date" or
 * "BioShock" is not caught.
 */
const XS_SCAN_NOT_GAMES = '/^(imgs?|images|media|manuals|user|saves?|states|savestates|screenshots|cache|shaders|logs|config|bios|\.xsegon-unpacking)$/i';

/**
 * A folder that is a program's own, not a place games are kept: RetroArch's,
 * a copy of Xsegon (this one or another), or Xsegon's data folder. Says
 * which, or null.
 *
 * A games folder can HOLD such a program (Xsegon unzipped beside the console
 * folders), and its own files would pass for games (RetroArch's system\dc\*.bin
 * as Dreamcast). It is not looked through, and the screen says so.
 */
function xs_scan_program_folder(string $dir): ?string
{
    $dir = rtrim($dir, '\\/');
    if (is_file($dir . DIRECTORY_SEPARATOR . 'retroarch.exe')) {
        return 'RetroArch\'s own folder';
    }
    if (is_file($dir . DIRECTORY_SEPARATOR . 'router.php') && is_file($dir . DIRECTORY_SEPARATOR . 'start.ps1')
        && is_dir($dir . DIRECTORY_SEPARATOR . 'includes')) {
        return 'a copy of Xsegon';
    }
    static $data = null, $made = null;
    if ($data === null) {
        $data = strtolower(rtrim((string) (realpath(xs_data_dir()) ?: xs_data_dir()), '\\/'));
        // A PC version Fan projects set up is a program's folder, though it may hold a disc's files (an Xbox port's game folder).
        $made = [];
        foreach ((array) xs_read_json(xs_data_path('fan-made.json'), []) as $rec) {
            if (is_array($rec) && isset($rec['folder'])) {
                $made[strtolower(rtrim((string) (realpath((string) $rec['folder']) ?: $rec['folder']), '\\/'))] = true;
            }
        }
    }
    $here = strtolower(rtrim((string) (realpath($dir) ?: $dir), '\\/'));
    return $here === $data ? 'Xsegon\'s data folder' : (isset($made[$here]) ? 'a PC version Fan projects set up' : null);
}

/**
 * A file named like a cartridge that is a note: .md, .gen and .vb are also
 * text files (README.md). A real one is not text, and not tiny.
 */
function xs_scan_note_not_game(string $file, string $ext): bool
{
    return in_array($ext, ['md', 'gen', 'vb'], true) && !xs_romid_binary($file, 16384);
}

/**
 * "(Track 7).bin" is one track of a disc: the cue sheet's data, never a game
 * on its own, even with the sheet missing. A bare bin WITHOUT a track number
 * stays a game: PS1 single-file dumps ship that way.
 */
function xs_scan_track_bin(string $name): bool
{
    return (bool) preg_match('/\(\s*Track\s*\d+\s*\)\s*\.bin$/i', $name);
}

/**
 * A file of another file's dump, by name: a .img beside the .cue or .ccd of
 * its name, a .sub beside its .ccd, a .ccd beside its .cue. The sheet is the
 * game, as a .bin beside its .cue is the cue's data.
 */
function xs_scan_dump_part(string $full, string $ext): bool
{
    $sheets = ['img' => ['cue', 'ccd'], 'sub' => ['ccd'], 'ccd' => ['cue']][$ext] ?? [];
    $stem = substr($full, 0, -strlen($ext) - 1);
    foreach ($sheets as $sheet) {
        if (is_file($stem . '.' . $sheet)) {
            return true;
        }
    }
    return false;
}

/**
 * True when a folder holds a disc's track bins and no sheet (cue or gdi)
 * to bind them: an incomplete dump, reported rather than junk-counted. A
 * sheet anywhere in the folder absolves it, because the dive would have
 * found that sheet and never asked this question.
 */
function xs_scan_orphan_tracks(string $dir, int $depth = 0): bool
{
    if ($depth > 2) {
        return false;
    }
    $tracks = false;
    foreach (@scandir($dir) ?: [] as $n) {
        if ($n === '.' || $n === '..') {
            continue;
        }
        $full = $dir . DIRECTORY_SEPARATOR . $n;
        if (is_dir($full)) {
            $tracks = $tracks || xs_scan_orphan_tracks($full, $depth + 1);
            continue;
        }
        if (preg_match('/\.(cue|gdi)$/i', $n)) {
            return false;
        }
        $tracks = $tracks || xs_scan_track_bin($n);
    }
    return $tracks;
}

/**
 * What makes two files the same game: the name with its disc tag, its
 * ending and its [tags] taken off. "(USA)" and "(Europe)" stay in, so two
 * regions are two games.
 */
function xs_scan_set_key(string $name): string
{
    // "(Disc 2)" and a bare "CD2" both leave the key, or "Saga CD1" and "Saga CD2" never meet.
    $key = preg_replace('/\((?:Disc|Disk|CD)\s*\d+[^)]*\)|\b(?:Disc|Disk|CD)\s*\d+\b/i', '', $name) ?? $name;
    // Only what is a file ending comes off: "v1.0" and "v1.1" are two games, not two endings.
    $key = xs_scan_bare($key);
    $key = preg_replace('/\[[^\]]*\]/', ' ', $key) ?? $key;
    return xs_scan_letters($key);
}

/**
 * Whether files that share a set key are one game. A disc number, a
 * playlist or a PBP says so; on a disc console so do the files of one dump
 * (a .cue beside its .ccd), which never share an ending. Anything else is
 * one game per file: a translation beside its original, two revisions.
 */
function xs_scan_one_game(array $files, bool $disc): bool
{
    $ends = [];
    foreach ($files as $f) {
        if (xs_scan_disc((string) $f['name']) !== null || in_array($f['ext'], ['m3u', 'pbp'], true)) {
            return true;
        }
        $ends[(string) $f['ext']] = true;
    }
    return count($files) < 2 || ($disc && count($ends) === count($files));
}

/**
 * Every file under a folder that could be a game of this kind of console,
 * to any depth down to five, and (for a disc console) the archives met on
 * the way. This is how a folder inside a console's folder is told apart:
 * the files of ONE game all share a set key (a disc and its tracks, the
 * discs of one set), and two keys or more make it a shelf of games.
 *
 *   games     [ {name, rom, ext}, ... ]
 *   archives  [ path, ... ]   a disc in a .zip or .7z, or an empty one: named, never offered
 *
 * A folder with a sheet in it (.cue, .gdi, .m3u) has its .bin files left
 * out: they are that sheet's tracks, whatever they are called.
 */
function xs_scan_candidates(string $dir, bool $disc, int $depth = 0): array
{
    $out = ['games' => [], 'archives' => []];
    if ($depth > 5) {
        return $out;
    }
    // The PS3 shape: the folder is the game, and nothing inside it is another.
    $eboot = $dir . DIRECTORY_SEPARATOR . 'PS3_GAME' . DIRECTORY_SEPARATOR . 'USRDIR' . DIRECTORY_SEPARATOR . 'EBOOT.BIN';
    if (is_file($eboot)) {
        $out['games'][] = ['name' => basename($dir), 'rom' => $eboot, 'ext' => 'bin'];
        return $out;
    }
    $exts  = array_flip(xs_scan_extensions($disc));
    $items = @scandir($dir) ?: [];
    $sheet = false;
    foreach ($items as $n) {
        if (preg_match('/\.(cue|gdi|m3u)$/i', $n)) {
            $sheet = true;
            break;
        }
    }
    foreach ($items as $n) {
        if ($n === '.' || $n === '..') {
            continue;
        }
        $full = $dir . DIRECTORY_SEPARATOR . $n;
        if (is_dir($full)) {
            if (!preg_match(XS_SCAN_NOT_GAMES, $n) && xs_scan_program_folder($full) === null) {
                $deeper = xs_scan_candidates($full, $disc, $depth + 1);
                $out['games']    = array_merge($out['games'], $deeper['games']);
                $out['archives'] = array_merge($out['archives'], $deeper['archives']);
            }
            continue;
        }
        $ext = strtolower((string) pathinfo($n, PATHINFO_EXTENSION));
        if (($ext === 'zip' || $ext === '7z') && @filesize($full) === 0) {
            $out['archives'][] = $full;           // a download not finished: the caller names it
            continue;
        }
        if (!isset($exts[$ext]) && !xs_scan_cart_bin($full, $ext, $disc)) {
            if ($disc && ($ext === 'zip' || $ext === '7z')) {
                $out['archives'][] = $full;
            }
            continue;
        }
        if (($ext === 'bin' && ($sheet || xs_scan_track_bin($n))) || xs_scan_dump_part($full, $ext)) {
            continue;
        }
        if (xs_scan_note_not_game($full, $ext)) {
            continue;
        }
        $out['games'][] = ['name' => $n, 'rom' => $full, 'ext' => $ext];
    }
    return $out;
}

/**
 * An empty archive's download so far. Firefox makes the archive's name as an
 * empty file and fills Name.<letters>.7z.part beside it until the end: the
 * newest such file, or null.
 */
function xs_scan_part_of(string $file): ?string
{
    $stem = preg_quote((string) pathinfo($file, PATHINFO_FILENAME), '/');
    $ext  = preg_quote((string) pathinfo($file, PATHINFO_EXTENSION), '/');
    $part = null;
    foreach (@scandir(dirname($file)) ?: [] as $n) {
        if (preg_match('/^' . $stem . '(\.[A-Za-z0-9]{1,12})?\.' . $ext . '\.part$/i', $n)) {
            $full = dirname($file) . DIRECTORY_SEPARATOR . $n;
            if (is_file($full) && ($part === null || (int) @filemtime($full) > (int) @filemtime($part))) {
                $part = $full;
            }
        }
    }
    return $part;
}

/** A part file written to in the last two minutes: its download is still going. */
function xs_scan_part_going(?string $part): bool
{
    return $part !== null && time() - (int) @filemtime($part) < 120;
}

/** Why an empty .zip or .7z holds no game: how far its download got, and when it last moved. */
function xs_scan_unfinished(string $file, ?string $part): string
{
    if ($part === null) {
        return 'an empty file, so there is no game in it: a download or a copy that did not finish. Fetch it again, then scan again';
    }
    require_once __DIR__ . '/jobs.php';
    $got = xs_jobs_size((int) @filesize($part));
    $at  = (int) @filemtime($part);
    if (xs_scan_part_going($part)) {
        return 'still downloading: ' . $got . ' so far in ' . basename($part) . ' beside it. Scan again when the download has finished';
    }
    return 'an empty file: its download stopped part way on ' . date('Y-m-d \a\t H:i', $at) . ', with ' . $got . ' of it in '
        . basename($part) . ' beside it. Finish the download in your browser, then scan again';
}

/**
 * Clear it: deletes an empty archive and its download so far. Read again at
 * the press: only an empty .zip or .7z under a games folder, never while its
 * download is going. The bytes freed, or null with $why; $fault when the disk
 * refused, which is said with the report pointer.
 */
function xs_scan_clear_unfinished(string $file, ?string &$why = null, bool &$fault = false): ?int
{
    require_once __DIR__ . '/unpack.php';
    $fault = false;
    if (!xs_unpack_allowed($file, $why)) {
        return null;
    }
    clearstatcache();
    if ((int) @filesize($file) !== 0) {
        $why = 'it is no longer empty: its download has finished. Scan again to unpack it';
        return null;
    }
    $part = xs_scan_part_of($file);
    if (xs_scan_part_going($part)) {
        $why = 'it is still downloading. Stop it in your browser first';
        return null;
    }
    $bytes = $part === null ? 0 : (int) @filesize($part);
    // The part first: a browser holding it open refuses, and the empty file then stays to say so.
    foreach (array_filter([$part, $file]) as $f) {
        if (!@unlink($f)) {
            $said = (string) (error_get_last()['message'] ?? 'Windows gave no reason');
            // Held open (PHP says "temporarily unavailable") is the person's to end, not a fault to report.
            if (stripos($said, 'temporarily unavailable') !== false) {
                $why = 'another program has ' . basename($f) . ' open, most likely your browser. Close it, then press Clear it again';
                return null;
            }
            $fault = true;
            $why = basename($f) . ' could not be deleted: ' . $said;
            return null;
        }
    }
    return $bytes;
}

/**
 * A cartridge kept as a .bin, which Genesis dumps often are. The ending is
 * anyone's (a disc's track, a BIOS, a save), so in a cartridge console's
 * folder it is a game only when the file itself says it is one.
 */
function xs_scan_cart_bin(string $full, string $ext, bool $disc): bool
{
    return !$disc && $ext === 'bin' && is_string(xs_romid($full));
}

/** One game's playable file inside a folder, or null. Depth-limited. */
function xs_scan_dive(string $dir, bool $disc, int $depth = 0): ?string
{
    if ($depth > 4) {
        return null;
    }
    // The PS3 shape first: the folder is the game, the file never varies.
    $eboot = $dir . DIRECTORY_SEPARATOR . 'PS3_GAME' . DIRECTORY_SEPARATOR . 'USRDIR' . DIRECTORY_SEPARATOR . 'EBOOT.BIN';
    if (is_file($eboot)) {
        return $eboot;
    }
    $items = @scandir($dir) ?: [];
    $best = null;
    $rank = array_flip(xs_scan_extensions($disc));       // earlier in the list wins: cue over bin
    foreach ($items as $n) {
        if ($n === '.' || $n === '..') {
            continue;
        }
        $full = $dir . DIRECTORY_SEPARATOR . $n;
        if (is_dir($full)) {
            if (preg_match(XS_SCAN_NOT_GAMES, $n) || xs_scan_program_folder($full) !== null) {
                continue;
            }
            $found = xs_scan_dive($full, $disc, $depth + 1);
            if ($found !== null && $best === null) {
                $best = $found;
            }
            continue;
        }
        $ext = strtolower((string) pathinfo($n, PATHINFO_EXTENSION));
        if (!isset($rank[$ext]) || $ext === '7z' || $ext === 'zip') {
            continue;                     // an archive inside a game folder is not the game
        }
        if ($ext === 'bin' && xs_scan_track_bin($n)) {
            continue;                     // a track of a disc; the cue is the game, or nothing is
        }
        if ($best === null || $rank[$ext] < $rank[strtolower((string) pathinfo($best, PATHINFO_EXTENSION))]) {
            $best = $full;
        }
    }
    return $best;
}

/**
 * Walk the ROM folders and say what is there. Nothing is written: this is
 * the dry look the review screen shows. $known is every ROM path the library
 * already answers for, lowercased and slash-normalised.
 */
function xs_scan_walk(?string $rootOverride = null): array
{
    $t0   = microtime(true);
    $s    = xs_settings();
    // The ROM drive first, then the added folders; an override (the tests) replaces the lot.
    $roots = $rootOverride !== null
        ? [xs_norm_path($rootOverride)]
        : xs_scan_roots($s);
    $out  = ['root' => $roots[0] ?? '', 'roots' => $roots, 'folders' => [],
             'new' => [], 'archives' => [], 'gaps' => [], 'unknown' => [], 'm3u' => [], 'orphans' => [], 'loose' => [],
             'unsure' => [],
             // An empty .zip or .7z: a download not finished (xs_scan_unfinished), named and never offered to unpack.
             'unfinished' => [],
             'skippedFolders' => [], 'alreadyHave' => 0, 'junk' => 0, 'newPlatforms' => [], 'noEmulator' => [],
             // Of alreadyHave, the files of games deleted from Xsegon: the screen says where they come back.
             'deletedLeft' => 0,
             // Said, never passed over in silence: a file taken for a game that is here under another
             // file ('passed'), and what was counted as no game at all ('junkFiles').
             'passed' => [], 'junkFiles' => [],
             // A second file of the same name and title in another folder: the first is offered, this one named.
             'copies' => [],
             // A folder of arcade sets: how many files, how many are games, and what was left out (includes\arcade.php).
             'arcade' => [],
             // A file whose own contents name a console its folder's cannot play: offered as that one (xs_scan_file_says).
             'refiled' => [],
             'ms' => 0];
    if (!$roots) {
        $out['error'] = 'no games folder chosen yet: Help > Getting started asks for one, or press Add a folder below';
        return $out;
    }
    /* A folder that is not there is reported per folder: one unplugged disk
       must not stop the others being read. Only ALL of them failing is an error. */
    $bases = [];
    foreach ($roots as $root) {
        if (!is_dir($root)) {
            $out['folders'][] = ['path' => $root, 'ok' => false,
                'why' => 'not there. If that is a drive, plug it in and scan again'];
            continue;
        }
        // A program's own folder chosen as the games folder: said, not read
        // (what it would offer is the program's own files).
        if (($own = xs_scan_program_folder($root)) !== null) {
            $out['folders'][] = ['path' => $root, 'ok' => false,
                'why' => 'it is ' . $own . ', not a games folder. If your games are in a folder inside it, add that folder'];
            continue;
        }
        /* A folder that IS a console, added by itself (gb rather than the
           folder holding it): walked as that console, its parent standing as
           the base, as if it stood inside a games folder. */
        $own = xs_scan_platform_for(basename($root));
        if ($own !== null) {
            if (@scandir($root) === false) {
                $out['folders'][] = ['path' => $root, 'ok' => false,
                    'why' => 'could not be read. ' . xs_file_error_reason()];
                continue;
            }
            $out['folders'][] = ['path' => $root, 'ok' => true, 'base' => $root, 'console' => $own];
            $bases[] = [rtrim(dirname($root), '\\/'), [basename($root)]];
            continue;
        }
        $base = is_dir($root . DIRECTORY_SEPARATOR . 'systems') ? $root . DIRECTORY_SEPARATOR . 'systems' : $root;
        $list = @scandir($base);
        if ($list === false) {
            // is_dir said yes but the listing failed: said, not "nothing new", which reads as "you have everything".
            $out['folders'][] = ['path' => $root, 'ok' => false,
                'why' => 'could not be read. ' . xs_file_error_reason()];
            continue;
        }
        $out['folders'][] = ['path' => $root, 'ok' => true, 'base' => $base];
        $bases[] = [$base, $list];
    }
    if (!$bases) {
        $first = $out['folders'][0] ?? ['path' => '', 'why' => 'not there'];
        $out['error'] = count($roots) === 1
            ? $first['path'] . ' is ' . $first['why']
            : 'none of the ' . count($roots) . ' folders could be read';
        return $out;
    }

    $known = [];
    $knownTitle = [];                    // platform|normalised title: the same game
                                         // can be known by another path (another disc)
    $lib   = xs_library();
    foreach ($lib['games'] ?? [] as $g) {
        $p = strtolower(str_replace('/', '\\', (string) ($g['romPath'] ?? '')));
        if ($p !== '') {
            $known[$p] = true;
            // A game that is a playlist answers for every disc on it, wherever each stands.
            if (str_ends_with($p, '.m3u')) {
                foreach (xs_scan_m3u_discs((string) $g['romPath']) as $d) {
                    $known[strtolower($d)] = true;
                }
            }
        }
        // A file in its game's Files tab is out of the list, not unknown.
        foreach ($g['accompanied'] ?? [] as $f) {
            $known[strtolower(str_replace('/', '\\', (string) $f['romPath']))] = true;
        }
        $knownTitle[strtolower((string) $g['platform']) . '|'
            . xs_scan_letters((string) $g['title'])] ??= ['why' => 'have', 'rom' => (string) ($g['romPath'] ?? '')];
    }
    // A game you hid is gone from the library's answer, but it is not unknown: not offered back.
    foreach (xs_read_json(xs_data_path('hidden.json'), []) ?: [] as $h) {
        if (is_array($h) && isset($h['title'], $h['platform'])) {
            $knownTitle[strtolower((string) $h['platform']) . '|'
                . xs_scan_letters((string) $h['title'])] ??= ['why' => 'hidden', 'rom' => ''];
        }
    }
    // And the ones deleted on purpose, for the same reason; counted, so the screen says where they come back.
    require_once __DIR__ . '/deleted.php';
    $deletedRoms = [];
    foreach (xs_deleted() as $d) {
        $knownTitle[strtolower((string) ($d['platform'] ?? '')) . '|'
            . xs_scan_letters((string) ($d['title'] ?? ''))] ??= ['why' => 'deleted', 'rom' => (string) ($d['rom'] ?? '')];
        if (!empty($d['rom'])) {
            $known[strtolower(str_replace('/', '\\', (string) $d['rom']))] = true;
            $deletedRoms[strtolower(str_replace('/', '\\', (string) $d['rom']))] = true;
        }
    }
    $platformsHave = array_change_key_case($lib['platforms'] ?? [], CASE_LOWER);
    $map   = xs_scan_platforms();
    $discs = array_flip(xs_scan_disc_platforms());
    $table = xs_read_json(xs_emulators_path(), null);
    $gameExts = array_flip(array_unique(array_merge(xs_scan_extensions(true), xs_scan_extensions(false), ['img', 'rvz', 'wia'])));
    // A game reached through two folders on the list (a games folder and a
    // console folder inside it) is counted as one known game, not two.
    $countedKnown = [];
    /* Who holds each id: the games accepted before, then each one offered.
       The id is console and file name, so a second file of that name in
       another folder meets the first one here. */
    $idHeld = [];
    $accepted = [];                      // files accepted before, by path: never filed under another console
    foreach (xs_scan_read() as $e) {
        $idHeld[(string) $e['id']] = ['rom' => strtolower(str_replace('/', '\\', (string) ($e['rom'] ?? ''))), 'title' => (string) ($e['title'] ?? ''), 'kept' => true];
        $accepted[$idHeld[(string) $e['id']]['rom']] = true;
    }

    /* ---- what becomes of a console's candidate rows ----------------------
       The second and third passes, the same for rows read out of a console's
       folder and for rows a file's own contents placed (includes\romid.php).
       Each row: name (what the title is made from), rom, ext, and sibs when
       it stands for the discs of one folder. */
    $process = static function (string $platform, array $rows) use (&$out, &$countedKnown, &$idHeld, $discs, $known, $knownTitle, $deletedRoms, $platformsHave, $table): void {
        /* Second pass: collapse disc sets. m3u beats PBP beats Disc 1. */
        $bySet = [];
        foreach ($rows as $i => $r) {
            // A row that comes with its title (an arcade set) is one game: its file name is a code, not a name to read.
            $given = isset($r['title']);
            $rows[$i]['disc'] = $given ? null : xs_scan_disc($r['name']);
            $rows[$i]['set']  = $given ? 'given:' . $i : xs_scan_set_key($r['name']);
            $bySet[$rows[$i]['set']][] = $i;
        }
        foreach ($bySet as $indexes) {
            if (count($indexes) < 2 && $rows[$indexes[0]]['disc'] === null) {
                continue;
            }
            $members = array_map(static fn($i) => $rows[$i], $indexes);
            // Alike in name only (a translation, another revision): each stays a game of its own.
            if (!xs_scan_one_game($members, isset($discs[$platform]))) {
                continue;
            }
            /* The m3u offer: a set with no playlist plays as Disc 1 only. The
               file is written only from the review screen, on request
               (api\scan.php, action m3u). Known games are offered too. */
            $discFiles = count($members) === 1 && !empty($members[0]['sibs'])
                ? $members[0]['sibs']
                : array_map(static fn($m) => $m['rom'], $members);
            $offer = xs_scan_m3u_offer($platform, $discFiles);
            if ($offer !== null && !$offer['exists']) {
                $out['m3u'][] = $offer;
            }
            $pick = null;
            foreach (['m3u', 'pbp'] as $championExt) {
                foreach ($indexes as $i) {
                    if ($rows[$i]['ext'] === $championExt) {
                        $pick = $i;
                        break 2;
                    }
                }
            }
            if ($pick === null) {
                $discNos = array_filter(array_map(static fn($m) => $m['disc'], $members), 'is_int');
                sort($discNos);
                foreach ($indexes as $i) {
                    if ($rows[$i]['disc'] === ($discNos[0] ?? null)) {
                        $pick = $i;
                        break;
                    }
                }
                // Not a hole when the library's playlist names these discs: the others stand elsewhere.
                $listed = !array_filter($members, static fn($m) => !isset($known[strtolower(str_replace('/', '\\', $m['rom']))]));
                if (!$listed && $discNos !== [] && ($discNos[0] !== 1 || $discNos !== range(1, count($discNos)))) {
                    $out['gaps'][] = ['platform' => $platform,
                        'title' => xs_scan_title($members[0]['name']),
                        'have'  => implode(',', $discNos),
                        'why'   => $discNos[0] !== 1 ? 'no disc 1 here' : 'the discs are not consecutive'];
                }
            }
            foreach ($indexes as $i) {
                if ($i !== $pick) {
                    $rows[$i] = null;      // consumed by the set
                }
            }
        }

        /* Third pass: what survives and is not already in the library is new. */
        $newHere = 0;
        foreach ($rows as $r) {
            if ($r === null) {
                continue;
            }
            $title = $r['title'] ?? ($r['disc'] !== null ? xs_scan_set_title($r['name']) : xs_scan_title($r['name']));
            $romKey = strtolower(str_replace('/', '\\', $r['rom']));
            $titleKey = strtolower($platform) . '|' . xs_scan_letters($title);
            /* The id hashes console and FILE name, so a game keeps its id
               when its folder is renamed. Every PS3 game's file is EBOOT.BIN,
               so for that shape the folder holding PS3_GAME joins the hash,
               or the duplicate filter below would drop all but one. */
            $idName = strtolower(basename($r['rom']));
            if ($idName === 'eboot.bin') {
                $idName = strtolower(basename(dirname(dirname(dirname($r['rom']))))) . '|eboot.bin';
            }
            $row = [
                'id'       => 'xs-scan-' . substr(sha1(strtolower($platform) . '|' . $idName), 0, 12),
                'title'    => $title,
                'platform' => $platform,
                'rom'      => $r['rom'],
                'discs'    => $r['disc'] !== null || $r['ext'] === 'm3u' || $r['ext'] === 'pbp' ? true : false,
            ];
            if (isset($r['filedIn'])) {
                $row['filedIn'] = $r['filedIn'];    // it stands in another console's folder
            }
            /* That id held by another file: a game of another name kept under
               the same file name (disc.gdi in each game's own folder) takes
               its folder into the hash and is a game of its own. One of the
               same name is a second copy: the first stands, and this one is
               said, not dropped unseen. A game whose folder was renamed
               keeps its id: the file it was accepted at is gone. */
            $holder = $idHeld[$row['id']] ?? null;
            if ($holder !== null && $holder['rom'] !== $romKey && !(!empty($holder['kept']) && !is_file($holder['rom']))) {
                // One the library has by name is named below as another file of it, and needs an id of its own to be added.
                if (xs_scan_letters($holder['title']) !== xs_scan_letters($title) || isset($knownTitle[$titleKey])) {
                    $row['id'] = 'xs-scan-' . substr(sha1(strtolower($platform) . '|' . strtolower(basename(dirname($r['rom']))) . '|' . $idName), 0, 12);
                } elseif (!isset($known[$romKey])) {
                    $out['copies'][] = $row + ['has' => $holder['rom']];
                    continue;
                }
            }
            if (isset($known[$romKey]) || isset($knownTitle[$titleKey])) {
                if (!isset($countedKnown[$romKey])) {
                    $countedKnown[$romKey] = true;
                    $out['alreadyHave']++;
                    // The file of a game deleted from Xsegon, or another file of one: left out, and Settings > Library puts it back.
                    if (isset($deletedRoms[$romKey]) || (!isset($known[$romKey]) && $knownTitle[$titleKey]['why'] === 'deleted')) {
                        $out['deletedLeft']++;
                    }
                    // Known by its name alone: another file of a game that is here, hidden or taken out.
                    // Said with all it takes to add it after all, as another version of that game.
                    if (!isset($known[$romKey])) {
                        $has = $knownTitle[$titleKey]['rom'];
                        // A later disc of a game that plays through a playlist can be joined to it
                        // (xs_scan_join): the playlist stands beside the game's file and reaches down to this one.
                        $join = $knownTitle[$titleKey]['why'] === 'have' && $r['disc'] !== null && $has !== ''
                            && str_starts_with(strtolower($r['rom']), strtolower(dirname($has)) . DIRECTORY_SEPARATOR)
                            && (str_ends_with(strtolower($has), '.m3u') || (xs_scan_disc(basename($has)) ?? $r['disc']) !== $r['disc'])
                            && xs_scan_reads_playlists(xs_scan_command($platform, $has, $table));
                        $out['passed'][] = $row + ['why' => $knownTitle[$titleKey]['why'], 'has' => $has, 'disc' => $r['disc'], 'join' => $join];
                    }
                }
                continue;
            }
            $newHere++;
            $idHeld[$row['id']] ??= ['rom' => $romKey, 'title' => $title];
            $out['new'][] = $row;
            if (isset($row['filedIn'])) {
                $out['refiled'][] = ['rom' => $row['rom'], 'folder' => $row['filedIn'], 'platform' => $platform];
            }
        }
        // An empty folder called "gamegear" is not a new console.
        if ($newHere > 0) {
            if (!isset($platformsHave[strtolower($platform)]) && !in_array($platform, $out['newPlatforms'], true)) {
                $out['newPlatforms'][] = $platform;
            }
            if (!isset($table['platforms'][strtolower($platform)]) && !in_array($platform, $out['noEmulator'], true)) {
                $out['noEmulator'][] = $platform;
            }
        }
    };

    /* ---- the first pass: a console's folder becomes candidate rows --------
       Files in it are games. A folder in it is ONE game when everything
       playable under it shares a set key, and a shelf of games when it does
       not (snes\Hacks with two zips in it, psx\RPG with ten discs): the
       shelf's games join the rows as if they stood at the top. */
    $consoleRows = static function (string $dir, string $platform) use (&$out, $discs): array {
        if ($platform === XS_ARCADE) {
            return xs_arcade_rows($dir, $out);
        }
        $isDisc = isset($discs[$platform]);
        $exts   = array_flip(xs_scan_extensions($isDisc));
        $rows   = [];
        $archive = static function (string $file) use (&$out, $platform): void {
            if (@filesize($file) === 0) {
                $part = xs_scan_part_of($file);
                $out['unfinished'][] = ['platform' => $platform, 'file' => $file, 'why' => xs_scan_unfinished($file, $part),
                    'part' => $part, 'bytes' => $part === null ? 0 : (int) @filesize($part), 'going' => xs_scan_part_going($part)];
                return;
            }
            $out['archives'][] = ['platform' => $platform, 'file' => $file,
                'why' => 'looks like a disc in an archive: a CD core cannot read it from there. Extract it and rescan'];
        };
        foreach (@scandir($dir) ?: [] as $n) {
            if ($n === '.' || $n === '..' || (is_dir($dir . DIRECTORY_SEPARATOR . $n) && preg_match(XS_SCAN_NOT_GAMES, $n))) {
                continue;
            }
            $full = $dir . DIRECTORY_SEPARATOR . $n;
            if (is_dir($full)) {
                if (xs_scan_program_folder($full) !== null) {
                    continue;                 // an emulator kept beside its console's games
                }
                $inside = xs_scan_candidates($full, $isDisc);
                /* A bare .bin never makes a shelf, and is never one of its
                   games: a game unpacked into its folder can hold hundreds of
                   .bin data files. A folder of nothing but bare .bin discs is
                   left to the dive. */
                $shelf = array_values(array_filter($inside['games'],
                    static fn($c) => $c['ext'] !== 'bin' || !$isDisc || basename($c['rom']) === 'EBOOT.BIN'));
                /* A .zip down here is opened as far as its list of names: one
                   with no game in it (a patch, a tool's source) is not a game.
                   A zip at the TOP of a console's folder is taken on the
                   folder's word. */
                $shelf = array_values(array_filter($shelf, static function ($c) use (&$out) {
                    if ($c['ext'] === 'zip' && !xs_romid_zip_game($c['rom'])) {
                        $out['junk']++;
                        $out['junkFiles'][] = $c['rom'];
                        return false;
                    }
                    return true;
                }));
                $inside['games'] = array_values(array_filter($inside['games'],
                    static fn($c) => $c['ext'] !== 'zip' || xs_romid_zip_game($c['rom'])));
                $keys = [];
                foreach ($shelf as $c) {
                    $keys[xs_scan_set_key($c['name'])] = true;
                }
                if (count($keys) >= 2 || !xs_scan_one_game($shelf, $isDisc)) {
                    // A shelf: each of its games is a row of its own.
                    foreach ($shelf as $c) {
                        $rows[] = $c;
                    }
                    array_map($archive, $inside['archives']);
                    continue;
                }
                $rom = xs_scan_dive($full, $isDisc);
                if ($rom === null) {
                    // Nothing playable found. A disc's track bins with no cue sheet are a
                    // game the person thinks they have: said, not counted as junk.
                    if (xs_scan_orphan_tracks($full)) {
                        $out['orphans'][] = ['platform' => $platform, 'folder' => $n,
                            'why' => 'only the tracks of a disc are here, with no cue sheet to bind them, so nothing can launch it. Re-download the dump, or bring its .cue back'];
                    } elseif (count($inside['games']) === 1) {
                        // One game file in a folder of its own that the dive does not take: a cartridge in a zip.
                        $c = $inside['games'][0];
                        $rows[] = ['name' => mb_strlen(xs_scan_title($c['name'])) > mb_strlen(xs_scan_title($n)) ? $c['name'] : $n,
                                   'rom' => $c['rom'], 'ext' => $c['ext']];
                    } elseif ($inside['archives']) {
                        array_map($archive, $inside['archives']);
                    } else {
                        $out['junk']++;
                        $out['junkFiles'][] = $full;
                    }
                    continue;
                }
                // The folder is the game, but a folder named "FF8" may hold a file with the
                // full name. Whichever says more becomes the title.
                $fileName = basename($rom);
                $name = mb_strlen(xs_scan_title($fileName)) > mb_strlen(xs_scan_title($n)) ? $fileName : $n;
                // A folder can hold every disc of one game. The dive hands back one file; the set
                // decides the m3u offer and that Disc 1 is launched, as a set at the top level.
                $sibs = xs_scan_disc_siblings($rom);
                if (count($sibs) > 1) {
                    $rom = $sibs[0];
                    $fileName = basename($rom);
                }
                $rows[] = ['name' => $name, 'rom' => $rom, 'ext' => strtolower((string) pathinfo($rom, PATHINFO_EXTENSION)),
                           'sibs' => count($sibs) > 1 ? $sibs : null];
                continue;
            }
            $ext = strtolower((string) pathinfo($n, PATHINFO_EXTENSION));
            // An empty archive is a download not finished, on a cartridge console too, where a .zip is a game.
            if (($ext === 'zip' || $ext === '7z') && @filesize($full) === 0) {
                $archive($full);
                continue;
            }
            // A .img, .sub or .ccd that belongs to the sheet of its name: the sheet is the game, and this is no junk.
            if ($isDisc && xs_scan_dump_part($full, $ext)) {
                continue;
            }
            if (!isset($exts[$ext]) && !xs_scan_cart_bin($full, $ext, $isDisc)) {
                if (preg_match('/\.(7z|zip)$/i', $n) && $isDisc) {
                    $archive($full);
                } else {
                    $out['junk']++;
                    $out['junkFiles'][] = $full;
                }
                continue;
            }
            // A bare .bin beside a .cue is the cue's data, and a "(Track N).bin" is a track.
            // is_file, never glob: these names are full of ( ) and [ ], which glob reads as patterns.
            if ($ext === 'bin' && (xs_scan_track_bin($n) || is_file((string) preg_replace('/\.bin$/i', '.cue', $full)))) {
                continue;
            }
            if (xs_scan_note_not_game($full, $ext)) {
                $out['junk']++;
                $out['junkFiles'][] = $full;
                continue;
            }
            $rows[] = ['name' => $n, 'rom' => $full, 'ext' => $ext];
        }
        return $rows;
    };

    /* ---- outside a console's folder: the file says which console ----------
       $place asks the file (includes\romid.php). A console is a row for
       that console, gathered per games folder and passed through the same
       two passes as any other. "Cannot be told" is counted per folder and
       kind, for the screen to name. "Not a game" is junk. */
    $placed = [];                        // console => rows
    $unsure = [];                        // folder => [ending => how many]
    $place = static function (string $full) use (&$placed, &$unsure, &$out, $gameExts): bool {
        $n   = basename($full);
        $ext = strtolower((string) pathinfo($n, PATHINFO_EXTENSION));
        if (!isset($gameExts[$ext])) {
            return false;
        }
        // A track, or the data of the sheet beside it: the sheet answers for it.
        if (($ext === 'bin' && (xs_scan_track_bin($n) || is_file((string) preg_replace('/\.bin$/i', '.cue', $full))))
            || xs_scan_dump_part($full, $ext)) {
            return false;
        }
        $console = xs_romid($full);
        if ($console === false) {
            $out['junk']++;
            $out['junkFiles'][] = $full;
            return false;
        }
        if ($console === null) {
            $unsure[dirname($full)][$ext] = ($unsure[dirname($full)][$ext] ?? 0) + 1;
            return true;
        }
        $placed[$console][] = ['name' => $n, 'rom' => $full, 'ext' => $ext];
        return true;
    };
    /* Inside a console's folder: a file that names, for sure, a console the
       folder's cannot play joins that console's rows (a PlayStation disc in
       gc). One the library has, or one accepted before (a game hidden since among
       them, which the library leaves out), stays as it is and is not read. */
    $sortOut = static function (string $platform, array $rows) use (&$placed, &$out, $known, $accepted, $discs): array {
        if ($platform === XS_ARCADE) {
            return $rows;
        }
        $kept = [];
        foreach ($rows as $r) {
            $rom  = strtolower(str_replace('/', '\\', (string) $r['rom']));
            $says = isset($r['title']) || isset($known[$rom]) || isset($accepted[$rom])
                ? null : xs_scan_file_says($r, $platform, isset($discs[$platform]));
            if ($says === null) {
                $kept[] = $r;
                continue;
            }
            $placed[$says][] = $r + ['filedIn' => $platform];
        }
        return $kept;
    };
    /* A folder that is no console's: everything under it, to six levels. A
       folder named for a console on the way down is read as that console's.
       Answers whether anything that is, or may be, a game was met. Stops
       after 40,000 files in all: a whole Documents folder is not a games
       folder, and the screen says to add the folder that is. */
    $budget = 40000;
    $wander = static function (string $dir, int $depth) use (&$wander, &$budget, &$out, $place, $process, $consoleRows, $sortOut, $map): bool {
        $any = false;
        foreach (@scandir($dir) ?: [] as $n) {
            if ($n === '.' || $n === '..') {
                continue;
            }
            if (--$budget < 0) {
                return $any;
            }
            $full = $dir . DIRECTORY_SEPARATOR . $n;
            if (!is_dir($full)) {
                $any = $place($full) || $any;
                continue;
            }
            if (preg_match(XS_SCAN_NOT_GAMES, $n) || preg_match('/^(bios|_incoming|hacking)/i', $n) || $n[0] === '.' || $n[0] === '$') {
                continue;
            }
            // A program's own folder met on the way down: named, not read.
            if (($own = xs_scan_program_folder($full)) !== null) {
                $out['skippedFolders'][] = ['folder' => $full, 'why' => $own . ', not a place games are kept: it was not looked through'];
                continue;
            }
            $platform = $map[strtolower(trim($n))] ?? xs_scan_platform_for($n);
            if ($platform !== null) {
                $rows = $consoleRows($full, $platform);
                $process($platform, $sortOut($platform, $rows));
                $any = $any || $rows !== [];
            } elseif ($depth < 6) {
                $any = $wander($full, $depth + 1) || $any;
            }
        }
        return $any;
    };

    // How far the walk is, for the window waiting on it (xs_step): one step a folder at the top of each place.
    $stepOf = 0;
    foreach ($bases as [, $top]) {
        $stepOf += count(array_diff($top, ['.', '..']));
    }
    $stepAt = 0;
    foreach ($bases as [$base, $top]) {
        foreach ($top as $folder) {
            if ($folder === '.' || $folder === '..') {
                continue;
            }
            xs_step('Looking in ' . $folder, $stepAt++, $stepOf);
            $dir = $base . DIRECTORY_SEPARATOR . $folder;
            if (!is_dir($dir)) {
                $place($dir);                // a file at the top of a games folder
                continue;
            }
            $key = strtolower(trim($folder));
            if (preg_match('/^(bios|_incoming|hacking)/i', $key)) {
                $out['skippedFolders'][] = ['folder' => $folder, 'why' => 'not a console folder'];
                continue;
            }
            if (($own = xs_scan_program_folder($dir)) !== null) {
                $out['skippedFolders'][] = ['folder' => $folder, 'why' => $own . ', not a place games are kept: it was not looked through'];
                continue;
            }
            $platform = $map[$key] ?? xs_scan_platform_for($folder);
            if ($platform === null) {
                // Not a console's name: looked into, and named as before
                // only when nothing in it is, or may be, a game.
                if ($folder[0] === '$' || !$wander($dir, 1)) {
                    $n = count(@scandir($dir) ?: []) - 2;
                    $out['unknown'][] = ['folder' => $folder, 'items' => max(0, $n)];
                }
                continue;
            }
            $process($platform, $sortOut($platform, $consoleRows($dir, $platform)));
        }
        // What the files of this games folder said for themselves.
        foreach ($placed as $platform => $rows) {
            $process($platform, $rows);
        }
        $placed = [];
    }
    if ($budget < 0) {
        $out['skippedFolders'][] = ['folder' => '(the rest)', 'why' => 'the scan stopped after 40,000 files outside any console folder: add the folder that holds the games, not a whole drive or Documents'];
    }
    foreach ($unsure as $folder => $kinds) {
        arsort($kinds);
        $out['unsure'][] = ['folder' => $folder, 'n' => array_sum($kinds),
            'kinds' => implode(', ', array_map(static fn($e, $c) => $c . ' .' . $e, array_keys($kinds), $kinds))];
    }
    // A rescan never re-offers what was already accepted.
    $accepted = [];
    foreach (xs_scan_read() as $e) {
        $accepted[(string) $e['id']] = true;
    }
    /* Two folders can hold the same game (a copy, or one drive added twice),
       and the id is a hash of console and file name: first one wins. */
    $seenId = [];
    $out['new'] = array_values(array_filter($out['new'], static function ($g) use ($accepted, &$seenId) {
        if (isset($accepted[$g['id']]) || isset($seenId[$g['id']])) {
            return false;
        }
        $seenId[$g['id']] = true;
        return true;
    }));
    usort($out['new'], static fn($a, $b) => [$a['platform'], $a['title']] <=> [$b['platform'], $b['title']]);
    $out['ms'] = (int) round((microtime(true) - $t0) * 1000);
    return $out;
}

/**
 * Accept some findings: append them to the file. Returns how many, or a why.
 * A pick that cannot be kept is named in $skipped with the reason.
 */
function xs_scan_accept(array $picks, ?string &$why = null, ?array &$skipped = null): int|false
{
    $skipped = [];
    $fresh = [];
    $all = xs_scan_read();
    $have = [];
    foreach ($all as $e) {
        $have[(string) $e['id']] = true;
    }
    $added = 0;
    foreach ($picks as $p) {
        if (!is_array($p) || empty($p['id']) || empty($p['title']) || empty($p['platform']) || empty($p['rom'])) {
            $skipped[] = ['id' => is_array($p) ? (string) ($p['id'] ?? '') : '', 'title' => is_array($p) ? (string) ($p['title'] ?? '?') : '?',
                          'why'   => 'the entry was missing a field: it did not come from the scan'];
            continue;
        }
        if (isset($have[(string) $p['id']])) {
            $skipped[] = ['id' => (string) $p['id'], 'title' => (string) $p['title'], 'why' => 'already accepted before'];
            continue;
        }
        if (!is_file((string) $p['rom'])) {
            $skipped[] = ['id' => (string) $p['id'], 'title' => (string) $p['title'],
                          'why'   => 'the file is not there any more: ' . (string) $p['rom']];
            continue;
        }
        $all[] = ['id' => (string) $p['id'], 'title' => (string) $p['title'],
                  'platform' => (string) $p['platform'], 'rom' => xs_norm_path((string) $p['rom']),
                  'added' => date('c')];
        $fresh[] = $all[count($all) - 1];
        $have[(string) $p['id']] = true;
        $added++;
    }
    if ($added > 0 && !xs_write_json(xs_scan_path(), array_values($all), $why)) {
        return false;
    }
    // You chose these, so the mailbox does not announce them (includes\news.php).
    if ($added > 0) {
        require_once __DIR__ . '/news.php';
        xs_news_know($fresh);
    }
    return $added;
}

/** The launch command for a scanned game, from Xsegon's own table, now. */
function xs_scan_command(string $platform, string $rom, ?array $table = null): array
{
    // A caller with many games reads the table once and hands it over.
    $table ??= xs_read_json(xs_emulators_path(), null);
    $opts  = $table['platforms'][strtolower($platform)]['options'] ?? [];
    $opt   = null;
    foreach ($opts as $o) {
        if (!empty($o['default'])) {
            $opt = $o;
            break;
        }
    }
    if ($opt === null) {
        $opt = count($opts) === 1 ? $opts[0] : null;
    }
    if ($opt === null) {
        return ['error' => 'no emulator set up for ' . $platform . ': Emulators > Add an emulator gives it one'];
    }
    $prog = $table['programs'][$opt['program']] ?? null;
    if ($prog === null || !xs_file_seen((string) ($prog['exe'] ?? ''))) {
        return ['error' => ($opt['emulator'] ?? 'the emulator') . ' is not where the table says (Settings > Emulators)'];
    }
    // An emulator added by hand is never RetroArch, whatever its options hold.
    $kind = empty($opt['own']) && str_contains(strtolower((string) ($opt['args'] ?? '') . ' "' . $rom . '"'), '-l ') ? 'retroarch' : 'emulator';
    // A playlist is the game, but an emulator that cannot read one is handed the first disc on it.
    $give = $rom;
    if (strtolower((string) pathinfo($rom, PATHINFO_EXTENSION)) === 'm3u' && xs_drive_stuck($rom) === null
        && !xs_scan_reads_playlists(['kind' => $kind, 'exe' => (string) $prog['exe']])) {
        $give = xs_scan_m3u_discs($rom)[0] ?? $rom;
    }
    $quoted = !empty($prog['noQuotes']) ? $give : '"' . $give . '"';
    $args   = trim((string) ($opt['args'] ?? '') . ' ' . $quoted);
    return [
        'exe'  => (string) $prog['exe'],
        'args' => $args,
        'rom'  => $rom,
        'kind' => $kind,
        'via'  => (string) ($opt['emulator'] ?? $prog['name'] ?? 'emulator'),
    ];
}

/**
 * Whether a game's file is there, asked of its folder where the folder is
 * shared: one listing of a folder in place of one question a file. $share and
 * $listed are the caller's own, gone with the read. A name the listing does
 * not hold is asked of the disk too, so "not there" is never the listing's
 * word alone (a name Windows reads another way).
 */
function xs_file_there(string $file, array $share, array &$listed): bool
{
    $dir = dirname($file);
    $key = strtolower($dir);
    if (($share[$key] ?? 0) < 2) {
        return xs_look('is_file', $file);
    }
    if (!array_key_exists($key, $listed)) {
        $names = xs_look('scandir', $dir);
        $listed[$key] = is_array($names) ? array_fill_keys(array_map('mb_strtolower', $names), true) : [];
    }
    return isset($listed[$key][mb_strtolower(basename($file))]) || xs_look('is_file', $file);
}

/**
 * Shaped like imported games, so nothing downstream knows the difference.
 * With $only, the disk is asked about that one game's file: the other rows
 * are there for the names they share, and are not to be read (xs_game).
 */
function xs_scanned_games(?string $only = null): array
{
    $games = [];
    /* A games folder away (its drive not plugged in, xs_rom_away): its games
       are not missing, the drive is, and that is said once, by the red mark
       and by Play (api\launch.php's guardrail). */
    $s = xs_settings();
    // Read once for the whole pass, not once a game.
    $table = xs_read_json(xs_emulators_path(), null) ?? [];
    $rows = xs_scan_read();
    // How many games each folder holds, for xs_file_there. One game asked: its file alone is asked.
    $share = [];
    $listed = [];
    if ($only === null) {
        foreach ($rows as $e) {
            if (!empty($e['rom'])) {
                $in = strtolower(dirname((string) $e['rom']));
                $share[$in] = ($share[$in] ?? 0) + 1;
            }
        }
    }
    foreach ($rows as $e) {
        if (empty($e['id']) || empty($e['title']) || empty($e['rom'])) {
            continue;
        }
        $rom = (string) $e['rom'];
        // Accepted as Disc 1; played through the playlist once one is beside it.
        // The m3u's existence is the whole record.
        // Its drive not answering (includes\drives.php): nothing on it is looked at, and the game stands as it is.
        $stuck = xs_drive_stuck($rom) !== null;
        $m3u = $stuck ? null : xs_scan_m3u_for($rom);
        $discSet = $m3u !== null;
        if ($m3u !== null) {
            $rom = $m3u;
        }
        $launch = null;
        $why = null;
        $real = xs_norm_path($rom);
        $asked = $only === null || (string) $e['id'] === $only;
        if ($asked && !$stuck && !xs_file_there($rom, $share, $listed) && xs_rom_away($real, $s) === null) {
            /* The same words xs_apply_missing uses, on purpose: the Missing
               files collection (api\library.php @missing) matches games by
               this phrase. */
            $why = 'the file is not there: ' . $rom;
        } else {
            $cmd = xs_scan_command((string) $e['platform'], $rom, $table);
            if (isset($cmd['error'])) {
                $why = (string) $cmd['error'];
            } else {
                $launch = $cmd;
            }
        }
        $games[] = [
            'id' => (string) $e['id'], 'title' => (string) $e['title'],
            'sortTitle' => (string) $e['title'], 'platform' => (string) $e['platform'],
            'romPath' => $rom, 'emulatorId' => '',
            'developer' => '', 'publisher' => '', 'genre' => '', 'region' => '', 'playMode' => '',
            'released' => '', 'notes' => '', 'rating' => 0.0, 'stars' => 0.0,
            'favourite' => false, 'hidden' => false, 'broken' => false, 'missingVideo' => false,
            'playCount' => 0, 'playTime' => 0, 'wikipedia' => '', 'dbId' => 0,
            'art' => array_fill_keys(array_keys(xs_own_art_kinds()), null),
            'launch' => $launch, 'launchError' => $why,
            'key' => art_key((string) $e['title']),
            'scanned' => true,
            'discSet' => $discSet,
            'added' => (string) ($e['added'] ?? ''),
            'players' => 0,
        ];
    }
    return $games;
}

/** Merge into a library array, the same shape xs_apply_local has. */
function xs_apply_scanned(array $lib, ?string $only = null): array
{
    return xs_lib_with($lib, xs_scanned_games($only));
}

/**
 * What follows games just added, from Scan for Games and from the look that adds
 * them by itself (includes\newgames.php): [hacks, auto]. $byItself: nobody pressed
 * anything, so no Setting up list begins and no Runs check is owed (it opens games).
 */
function xs_scan_after_accept(array $games, int $added, bool $byItself): array
{
    // One that may be a hack is said so as it comes in, so none stands in the
    // library unspoken for (includes\hackof.php, Games > Hacks to settle).
    $hacks = ['checked' => 0, 'ask' => 0];
    if ($added > 0) {
        require_once __DIR__ . '/hackof.php';
        $t0 = microtime(true);
        $hacks = xs_hackof_check_new(array_column(array_filter($games, 'is_array'), 'id'));
        // Said every time, with how long it took and how the games were read: a slow or an odd look shows in a report.
        xs_log('HACK', 'of the ' . $hacks['looked'] . ($hacks['looked'] === 1 ? ' game' : ' games') . ' just added, ' . $hacks['checked'] . ' checked as they came in, ' . $hacks['ask'] . ' may be hacks: looked at in '
            . (int) round((microtime(true) - $t0) * 1000) . 'ms, ' . ($hacks['once'] ? 'the list read once' : 'each game read alone')
            . ($hacks['unknown'] ? ', ' . $hacks['unknown'] . ' not in the library' : ''));
    }
    /* The one yes from Getting started (includes\setup.php, xs_setup_auto):
       the scan is the moment the consoles become known, so the missing cores
       and the names and pictures pass start here by themselves. Skips are
       quiet but said in the log: another fetch already running (the
       RetroArch chain fetches the cores then), or nothing missing. */
    $auto = null;
    if ($added > 0) {
        require_once __DIR__ . '/setup.php';
        if (xs_setup_auto()) {
            $auto = ['cores' => [], 'fill' => false];
            if (!$byItself) {
                // Games scanned in after the yes's own run ended get a list of
                // their own; RetroArch is here by then, or its fetch still shows.
                $tbl = xs_emulators(xs_norm_path((string) (xs_settings()['paths']['launchbox'] ?? '')));
                xs_setup_run_begin('a scan', xs_ra_find($tbl, xs_library())['have']);
                // and last the Runs check, once these are done (api\running.php)
                xs_setup_runs_want(true);
            }
            if (!xs_setup_busy(xs_setup_job())) {
                $err  = null;
                $plan = xs_setup_chain_cores($err);
                if ($plan !== null) {
                    $auto['cores'] = array_map(static fn ($c) => $c['platform'], $plan['cores']);
                } elseif ($err !== null) {
                    xs_log('SETUP', 'cores did not follow the scan: ' . $err);
                }
            }
            require_once __DIR__ . '/fill.php';
            if (xs_setup_pictures_off()) {
                xs_log('FILL', 'not started after the scan: names and pictures were switched off in the setup window');
            } elseif (!xs_fill_running()) {
                $fillWhy = null;
                $auto['fill'] = xs_fill_start(['mode' => 'all', 'picks' => [], 'pictures_wanted' => true,
                                               'complete' => false, 'dry' => false], $fillWhy);
                if ($auto['fill']) {
                    xs_log('FILL', 'started by itself after the scan: every game it is sure of');
                } elseif ($fillWhy !== null) {
                    xs_log('FILL', 'did not start after the scan: ' . $fillWhy);
                }
            }
        }
    }
    return [$hacks, $auto];
}
