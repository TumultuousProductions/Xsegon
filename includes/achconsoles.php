<?php
/**
 * Xsegon - the consoles RetroAchievements has sets for, by Xsegon's names, with
 * the site's own numbers (its GetConsoleIDs, read 2026-10-17). Small on purpose:
 * the library reads it for every game.
 */
declare(strict_types=1);

/** Matched here by the file's checksum (File check's reader, the site's header rules), arcade by its name. */
const XS_ACH_FILES = [
    'Nintendo Entertainment System' => 7, 'Nintendo Famicom Disk System' => 81, 'Super Nintendo Entertainment System' => 3,
    'Nintendo 64' => 2, 'Nintendo Game Boy' => 4, 'Nintendo Game Boy Color' => 6, 'Nintendo Game Boy Advance' => 5,
    'Nintendo Virtual Boy' => 28, 'Sega Genesis' => 1, 'Sega Mega Drive' => 1, 'Sega 32X' => 10, 'Sega Master System' => 11,
    'Sega Game Gear' => 15, 'Sega SG-1000' => 33, 'Atari 2600' => 25, 'Atari 7800' => 51, 'Atari Lynx' => 13,
    'Atari Jaguar' => 17, 'ColecoVision' => 44, 'Mattel Intellivision' => 45, 'GCE Vectrex' => 46, 'Fairchild Channel F' => 57,
    'WonderSwan' => 53, 'WonderSwan Color' => 53, 'Bandai WonderSwan' => 53, 'Bandai WonderSwan Color' => 53,
    'SNK Neo Geo Pocket' => 14, 'SNK Neo Geo Pocket Color' => 14, 'Arcade' => 27, 'MAME' => 27,
];

/** Sets exist, but the site reads these files its own way (a disc's boot program, a header of its own): not matched yet. */
const XS_ACH_LATER = [
    'Sony Playstation' => 12, 'Sony Playstation 2' => 21, 'Sony PSP' => 41, 'Sega CD' => 9, 'Sega Saturn' => 39,
    'Sega Dreamcast' => 40, 'Nintendo GameCube' => 16, 'Nintendo DS' => 18, 'NEC TurboGrafx-16' => 8,
    'NEC TurboGrafx-CD' => 76, '3DO Interactive Multiplayer' => 43, 'SNK Neo Geo CD' => 56, 'Microsoft MSX' => 29,
];

/** The site's number for a console, or null when it has no sets for it. */
function xs_ach_console(string $platform): ?int
{
    return XS_ACH_FILES[$platform] ?? XS_ACH_LATER[$platform] ?? null;
}

/** Whether a game of the library gets the Achievements tab: a console the site has, started by RetroArch. */
function xs_ach_for(array $g): bool
{
    return empty($g['local']) && empty($g['steam']) && ($g['launch']['kind'] ?? '') === 'retroarch'
        && xs_ach_console((string) ($g['platform'] ?? '')) !== null;
}
