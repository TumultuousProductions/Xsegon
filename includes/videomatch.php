<?php
/**
 * Xsegon - which video in a folder of videos is a game's (includes\videopack.php).
 *
 * The folder holds a folder a console (psx, snes, "Sony Playstation"), its
 * videos anywhere under that. A game is matched by its ROM file's name, then
 * by its title, then by its title spelled another way. A name that is only
 * similar is never taken: it is handed back so the person can be told of it.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** How a video was matched, in a person's words. */
const XS_VM_KINDS = [1 => 'same file name', 2 => 'same title', 3 => 'same title, other spelling', 4 => 'similar name'];

/** Xsegon's name for a console, its folders in a videos folder (best first), and other names it goes by. */
function xs_vm_consoles(): array
{
    return [
        ['Nintendo Entertainment System', ['nes', 'famicom'], ['nintendo']],
        ['Super Nintendo Entertainment System', ['snes'], ['super nintendo', 'super nes', 'sfc', 'super famicom']],
        ['Nintendo 64', ['n64'], []],
        ['Nintendo GameCube', ['gamecube'], ['gc', 'gcn', 'ngc']],
        ['Nintendo Wii', ['wii'], []],
        ['Wii U', ['wiiu'], ['wii u', 'nintendo wii u']],
        ['Nintendo Game Boy', ['gb'], ['gameboy']],
        ['Nintendo Game Boy Color', ['gbc'], ['gameboy color']],
        ['Nintendo Game Boy Advance', ['gba'], ['gameboy advance']],
        ['Nintendo DS', ['ds'], ['nds']],
        ['Nintendo 3DS', ['3ds'], []],
        ['Nintendo Virtual Boy', ['virtualboy'], ['vb']],
        ['Nintendo Famicom Disk System', ['fds'], []],
        ['Sony Playstation', ['psx'], ['ps1', 'playstation', 'playstation 1', 'psone', 'ps one']],
        ['Sony Playstation 2', ['ps2'], ['playstation 2']],
        ['Sony Playstation 3', ['ps3'], ['playstation 3']],
        ['Sony PSP', ['psp'], ['playstation portable', 'sony playstation portable']],
        ['Sega Genesis', ['genesis'], ['megadrive', 'mega drive', 'md', 'sega mega drive']],
        ['Sega Master System', ['mastersystem'], ['sms']],
        ['Sega Game Gear', ['gamegear'], ['gg']],
        ['Sega SG-1000', ['sg-1000'], []],
        ['Sega Saturn', ['saturn'], []],
        ['Sega Dreamcast', ['dreamcast'], ['dc']],
        ['Sega CD', ['segacd'], ['mega cd', 'sega mega cd']],
        ['Sega 32X', ['sega32x'], ['32x']],
        ['Microsoft Xbox', ['xbox'], []],
        ['Microsoft Xbox 360', ['xbox360'], ['x360', 'xbox 360']],
        ['Nintendo Switch', ['switch'], []],
        ['Atari 2600', ['atari2600'], ['2600']],
        ['Atari 5200', ['atari5200'], ['5200']],
        ['Atari 7800', ['atari7800'], ['7800']],
        ['Atari Lynx', ['lynx'], []],
        ['Atari Jaguar', ['atarijaguar'], ['jaguar']],
        ['NEC TurboGrafx-16', ['tg16', 'pcengine'], ['turbografx', 'turbografx 16', 'pc engine']],
        ['NEC TurboGrafx-CD', ['tg-cd', 'pcenginecd'], ['turbografx cd', 'pc engine cd']],
        ['NEC SuperGrafx', ['supergrafx'], ['pc engine supergrafx']],
        ['NEC PC-FX', ['pcfx'], []],
        ['ColecoVision', ['coleco'], []],
        ['Mattel Intellivision', ['intellivision'], []],
        ['3DO Interactive Multiplayer', ['3do'], ['panasonic 3do']],
        ['Magnavox Odyssey 2', ['odyssey2'], []],
        ['GCE Vectrex', ['vectrex'], []],
        ['WonderSwan', ['wonderswan'], ['wswan', 'bandai wonderswan']],
        ['WonderSwan Color', ['wonderswancolor'], ['wswanc', 'bandai wonderswan color']],
        ['SNK Neo Geo Pocket', ['ngp'], []],
        ['SNK Neo Geo Pocket Color', ['ngpc'], []],
        ['Microsoft MSX', ['msx'], []],
        ['Microsoft MSX2', ['msx2'], []],
        ['Microsoft MSX2+', ['msx2plus'], ['msx2 plus']],
        ['MS-DOS', ['dos'], ['msdos']],
        ['Arcade', ['arcade', 'neogeo', 'cps1', 'cps2', 'cps3', 'cps', 'naomi', 'model2', 'cave', 'snk-classics', 'nintendo-arcade'],
            ['mame', 'fbneo', 'fba', 'neo geo', 'snk neo geo mvs', 'snk neo geo aes']],
    ];
}

/** The console a name means: ['name' => Xsegon's, 'folders' => [...]], or null. */
function xs_vm_console(string $said): ?array
{
    static $by = null;
    if ($by === null) {
        $by = [];
        foreach (xs_vm_consoles() as [$name, $folders, $others]) {
            $bare = (string) preg_replace('/^(nintendo|sega|sony|microsoft|atari|nec|snk|gce|magnavox)\s+/i', '', $name);
            foreach (array_merge([$name, $bare], $others, $folders) as $n) {
                $by[xs_vm_norm($n)] ??= ['name' => $name, 'folders' => $folders];
            }
        }
    }
    return $by[xs_vm_norm($said)] ?? null;
}

// ---- names -----------------------------------------------------------------

/** Accented letters, lower case, and the plain letter each stands for. */
function xs_vm_accents(): array
{
    static $map = null;
    if ($map === null) {
        $map = ['ß' => 'ss', 'æ' => 'ae', 'œ' => 'oe'];
        foreach (['a' => 'àáâãäåāăą', 'c' => 'çćč', 'd' => 'ďđ', 'e' => 'èéêëēėęě', 'g' => 'ğ', 'i' => 'ìíîïīįı', 'l' => 'ł',
                  'n' => 'ñńň', 'o' => 'òóôõöøōő', 'r' => 'ř', 's' => 'śšş', 't' => 'ťţ', 'u' => 'ùúûüūůű', 'y' => 'ýÿ', 'z' => 'źżž'] as $to => $from) {
            foreach (mb_str_split($from, 1, 'UTF-8') as $ch) {
                $map[$ch] = $to;
            }
        }
    }
    return $map;
}

/** Lower case with the accents off. */
function xs_vm_plain(string $s): string
{
    return strtr(mb_strtolower($s, 'UTF-8'), xs_vm_accents());
}

/** Letters and digits only, of any script, "&" read as "and". */
function xs_vm_norm(string $s): string
{
    $s = str_replace('&', ' and ', xs_vm_plain($s));
    return preg_replace('/[^\p{L}\p{N}]+/u', '', $s) ?? (string) preg_replace('/[^a-z0-9]+/', '', $s);
}

/** A name without its (USA) and [!] marks. */
function xs_vm_bare(string $s): string
{
    $s = (string) preg_replace('/\s*[(\[{][^)\]}]*[)\]}]/', ' ', str_replace('_', ' ', $s));
    return trim((string) preg_replace('/\s+/', ' ', $s));
}

/** The same name however it puts its article: "The Legend of Zelda: X" and "Legend of Zelda, The - X". */
function xs_vm_title_keys(string $title): array
{
    $t = trim(str_replace('_', ' ', $title));
    $keys = [xs_vm_norm($t) => true];
    if (preg_match('/^(the|a|an)\s+(.+)$/i', $t, $m)) {
        $cut = preg_match('/\s+-\s+|:\s+/', $m[2], $c, PREG_OFFSET_CAPTURE) ? (int) $c[0][1] : -1;
        $keys[xs_vm_norm($cut < 0 ? $m[2] . ' ' . $m[1] : substr($m[2], 0, $cut) . ' ' . $m[1] . ' ' . substr($m[2], $cut))] = true;
    }
    if (preg_match('/^(.*?),\s*(the|a|an)\b(.*)$/i', $t, $m)) {
        $keys[xs_vm_norm($m[2] . ' ' . $m[1] . ' ' . $m[3])] = true;
    }
    unset($keys['']);
    return array_map('strval', array_keys($keys));
}

/** Its words, looser: no articles, no "and", II read as 2. */
function xs_vm_words(string $title): array
{
    static $roman = ['ii' => '2', 'iii' => '3', 'iv' => '4', 'v' => '5', 'vi' => '6', 'vii' => '7', 'viii' => '8', 'ix' => '9',
                     'x' => '10', 'xi' => '11', 'xii' => '12', 'xiii' => '13'];
    $s = str_replace(["'", "\u{2019}", '&', '_'], ['', '', ' and ', ' '], xs_vm_plain($title));
    $out = [];
    foreach (preg_split('/[^\p{L}\p{N}]+/u', $s) ?: [] as $w) {
        if ($w !== '' && !in_array($w, ['the', 'a', 'an', 'and'], true)) {
            $out[] = $roman[$w] ?? $w;
        }
    }
    return $out;
}

function xs_vm_loose(string $title): string
{
    return implode('', xs_vm_words($title));
}

/** The part of a name before its subtitle: "Spyro 2" of "Spyro 2 - Ripto's Rage!". */
function xs_vm_main(string $title): string
{
    return (string) (preg_split('/\s+-\s+|:\s+/', str_replace('_', ' ', $title))[0] ?? '');
}

function xs_vm_numbers(array $words): string
{
    $n = array_values(array_filter($words, static fn ($w) => preg_match('/^\d+$/', (string) $w) === 1));
    sort($n, SORT_STRING);
    return implode(',', $n);
}

/** How alike a game's name and a video's are, 0 to 1. Never across a number: "Mega Man 2" is not "Mega Man 3". */
function xs_vm_alike(string $title, array $v): float
{
    $a = xs_vm_words($title);
    if (!$a) {
        return 0.0;
    }
    $main = xs_vm_loose(xs_vm_main($title));
    $best = strlen($main) >= 4 && $main === $v['main'] ? 0.8 : 0.0;
    if (xs_vm_numbers($a) !== xs_vm_numbers($v['words'])) {
        return $best;
    }
    $mine   = array_unique($a);
    $theirs = array_unique($v['words']);
    $both   = count(array_intersect($mine, $theirs));
    $share  = $both / max(count($mine), count($theirs));
    if ($both >= 2 && $share >= 0.75) {
        $best = max($best, $share);
    }
    $ka = implode('', $a);
    $kb = (string) $v['loose'];
    if (min(strlen($ka), strlen($kb)) >= 10 && abs(strlen($ka) - strlen($kb)) <= 2 && strlen($ka) < 250 && levenshtein($ka, $kb) <= 2) {
        $best = max($best, 0.85);
    }
    [$short, $long] = strlen($ka) <= strlen($kb) ? [$ka, $kb] : [$kb, $ka];
    if (strlen($short) >= 12 && str_starts_with($long, $short) && strlen($short) / strlen($long) >= 0.6) {
        $best = max($best, 0.7 + 0.2 * strlen($short) / strlen($long));
    }
    return $best;
}

/** What may follow a title in a name written without spaces: "usa", "europe", "proto", "reva", "enfrde". */
const XS_VM_TAIL = '/^(the|a|an|usa|us|europe|eu|japan|jp|world|asia|australia|brazil|korea|china|taiwan|hongkong|germany|france|spain|italy|netherlands|sweden|canada|russia|unl|proto|prototype|beta|demo|sample|pirate|aftermarket|homebrew|virtualconsole|translated|rev[a-z0-9]{1,2}|v\d+|disc\d|en|fr|de|es|it|ja|pt|nl|sv|no|da|fi|zh|ko|ru|pl|ntsc|pal|sgbenhanced|gbcompatible)*$/';
const XS_VM_REGIONS = ['usa', 'world', 'europe', 'japan', 'asia', 'australia', 'brazil', 'korea', 'germany', 'france', 'spain', 'italy'];

/** What a name's marks say of the release: its regions, unfinished, translated, which disc. */
function xs_vm_marks(string $stem): array
{
    preg_match_all('/[(\[][^)\]]*[)\]]/', $stem, $m);
    $inside = strtolower(implode(' ', $m[0]));
    return [
        'regions'    => array_values(array_filter(XS_VM_REGIONS, static fn ($r) => str_contains($inside, $r))),
        'rough'      => preg_match('/proto|beta|demo|sample|pirate/', $inside) === 1,
        'translated' => preg_match('/translated|\[t[+-]/', $inside) === 1,
        'disc'       => preg_match('/dis[ck]\s*(\d+)/', $inside, $d) ? (int) $d[1] : 0,
    ];
}

// ---- the videos, a console folder at a time ----------------------------------

/** Whether an MP4's picture is H.265, which many browsers do not play. False when it cannot be told. */
function xs_vm_hevc(string $file): bool
{
    $fh = @fopen($file, 'rb');
    if ($fh === false) {
        return false;
    }
    $size = (int) @filesize($file);
    $found = false;
    // The boxes at the top of the file, one after the other, until the one that describes the tracks.
    for ($at = 0, $n = 0; $n < 64 && $at + 8 <= $size; $n++) {
        fseek($fh, $at);
        $h = (string) fread($fh, 16);
        if (strlen($h) < 8) {
            break;
        }
        $len  = unpack('N', $h)[1];
        $head = 8;
        if ($len === 1 && strlen($h) === 16) {
            $len  = unpack('J', substr($h, 8, 8))[1];
            $head = 16;
        } elseif ($len === 0) {
            $len = $size - $at;
        }
        if ($len < $head) {
            break;
        }
        if (substr($h, 4, 4) === 'moov') {
            fseek($fh, $at + $head);
            $moov  = (string) fread($fh, (int) min($len - $head, 8 * 1048576));
            $found = preg_match('/stsd.{12}(hvc1|hev1)/s', $moov) === 1;
            break;
        }
        $at += $len;
    }
    fclose($fh);
    return $found;
}

/** One video put on a shelf, its names worked out. $v: abs, rel, set, name, size, and hevc where that is known. */
function xs_vm_shelf_add(array &$shelf, array $v): void
{
    $stem   = pathinfo($v['name'], PATHINFO_FILENAME);
    $spaced = preg_match('/[ (]/', $stem) === 1;
    $v += ['full' => xs_vm_norm($stem), 'spaced' => $spaced];
    $n = count($shelf['all']);
    if ($spaced) {
        $bare       = xs_vm_bare($stem);
        $v['keys']  = xs_vm_title_keys($bare);
        $v['words'] = xs_vm_words($bare);
        $v['loose'] = implode('', $v['words']);
        $v['main']  = xs_vm_loose(xs_vm_main($bare));
        $v['marks'] = xs_vm_marks($stem);
        foreach ($v['keys'] as $k) {
            $shelf['key'][$k][] = $n;
        }
        if ($v['loose'] !== '') {
            $shelf['loose'][$v['loose']][] = $n;
        }
    } else {
        $v['marks'] = ['regions' => array_values(array_filter(XS_VM_REGIONS, static fn ($r) => str_contains($v['full'], $r))),
                       'rough' => preg_match('/proto|beta|demo|sample/', $v['full']) === 1,
                       'translated' => str_contains($v['full'], 'translated'), 'disc' => 0];
        $shelf['plain'][] = $n;
    }
    if ($v['full'] !== '') {
        $shelf['full'][$v['full']][] = $n;
    }
    $shelf['all'][] = $v;
}

/**
 * Every video under one console folder, with its names worked out once:
 * ['all' => [video], 'full' => [name => [n]], 'key' => [title => [n]], 'loose' => [..], 'plain' => [n written without spaces]].
 * $listed: the videos of a folder that is not on this PC (includes\archivevid.php), kept as that folder's shelf.
 */
function xs_vm_shelf(string $root, string $folder, ?array $listed = null): array
{
    static $shelves = [];
    $id = strtolower($root . '|' . $folder);
    if (isset($shelves[$id]) && $listed === null) {
        return $shelves[$id];
    }
    $shelf = ['all' => [], 'full' => [], 'key' => [], 'loose' => [], 'plain' => []];
    if ($listed !== null) {
        foreach ($listed as $v) {
            xs_vm_shelf_add($shelf, $v);
        }
        return $shelves[$id] = $shelf;
    }
    $dir   = $root . DIRECTORY_SEPARATOR . $folder;
    if (!is_dir($dir)) {
        return $shelves[$id] = $shelf;
    }
    try {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if (!$f->isFile() || !in_array(strtolower($f->getExtension()), ['mp4', 'm4v', 'webm'], true)) {
                continue;
            }
            $abs    = $f->getPathname();
            $rel    = str_replace('\\', '/', substr($abs, strlen($root) + 1));
            $inside = explode('/', substr($rel, strlen($folder) + 1));
            xs_vm_shelf_add($shelf, ['abs' => $abs, 'rel' => $rel, 'set' => count($inside) > 1 ? $inside[0] : '', 'name' => $f->getFilename(),
                                     'size' => (int) $f->getSize()]);
        }
    } catch (\Throwable $e) {
        xs_log('VPK', 'the folder ' . $dir . ' could not be read to its end: ' . $e->getMessage());
    }
    return $shelves[$id] = $shelf;
}

// ---- one game ----------------------------------------------------------------

/**
 * The video for a game ['title', 'platform', 'file']:
 *   ['video' => a video of the shelf or null, 'kind' => 1 to 3 or 0, 'why' => words when there is none,
 *    'near' => the similar name that was left out, 'others' => how many more would have done]
 */
function xs_vm_match(string $root, array $game): array
{
    $none = static fn (string $why, ?array $near = null): array => ['video' => null, 'kind' => 0, 'why' => $why, 'near' => $near, 'others' => 0];
    $c = xs_vm_console((string) ($game['platform'] ?? ''));
    $folders = $c === null ? [] : array_values(array_filter($c['folders'],
        static fn ($f) => is_dir($root . DIRECTORY_SEPARATOR . $f) || xs_vm_shelf($root, $f)['all']));
    if (!$folders) {
        return $none('no videos for this console in the folder');
    }
    $title = (string) ($game['title'] ?? '');
    $file  = basename(str_replace('\\', '/', (string) ($game['file'] ?? '')));
    $stem  = (string) preg_replace('/\.xiso$/i', '', pathinfo($file, PATHINFO_FILENAME));
    // A file name that says nothing of the game (EBOOT.BIN, default.xbe) is not a name to match by.
    $useFile = $stem !== '' && !preg_match('/^(eboot|default|boot|game|disc|launch|index|start|steam|param|main)$/i', $stem);
    $full  = $useFile ? xs_vm_norm(str_replace('_', ' ', $stem)) : '';
    $names = array_values(array_unique(array_filter([$title, xs_vm_bare($title), $useFile ? xs_vm_bare($stem) : ''], static fn ($n) => $n !== '')));
    $keys  = [];
    $loose = [];
    foreach ($names as $n) {
        foreach (xs_vm_title_keys($n) as $k) {
            $keys[$k] = true;
        }
        if (($l = xs_vm_loose($n)) !== '') {
            $loose[$l] = true;
        }
    }
    $keys = array_map('strval', array_keys($keys));
    $mine = $useFile ? xs_vm_marks($stem) : ['regions' => [], 'disc' => 0];
    // The release closest to the game's own: its region, the finished game, the first disc.
    $far = static function (array $v) use ($mine): int {
        $far = 0;
        if (!($mine['regions'] && array_intersect($v['marks']['regions'], $mine['regions']))) {
            $at = -1;
            foreach (XS_VM_REGIONS as $i => $r) {
                if (in_array($r, $v['marks']['regions'], true)) {
                    $at = $i;
                    break;
                }
            }
            $far = $at < 0 ? 4 : 1 + min($at, 3);
        }
        return $far + ($v['marks']['rough'] ? 10 : 0) + ($v['marks']['translated'] ? 5 : 0)
             + ($v['marks']['disc'] > 1 && $v['marks']['disc'] !== $mine['disc'] ? 2 : 0);
    };

    $found = [];        // [kind, folder, video]
    $count = 0;
    foreach ($folders as $fi => $folder) {
        $shelf = xs_vm_shelf($root, $folder);
        $count += count($shelf['all']);
        $kinds = [];
        foreach ($full !== '' ? ($shelf['full'][$full] ?? []) : [] as $n) {
            $kinds[$n] = 1;
        }
        foreach ($keys as $k) {
            foreach ($shelf['key'][$k] ?? [] as $n) {
                $kinds[$n] ??= 2;
            }
        }
        foreach ($shelf['plain'] as $n) {
            if (isset($kinds[$n])) {
                continue;
            }
            $name = $shelf['all'][$n]['full'];
            foreach ($keys as $k) {
                if (strlen($k) >= 3 && str_starts_with($name, $k) && preg_match(XS_VM_TAIL, substr($name, strlen($k)))) {
                    $kinds[$n] = 2;
                    break;
                }
            }
        }
        foreach (array_keys($loose) as $l) {
            foreach ($shelf['loose'][(string) $l] ?? [] as $n) {
                $kinds[$n] ??= 3;
            }
        }
        foreach ($kinds as $n => $kind) {
            $found[] = [$kind, $fi, $shelf['all'][$n]];
        }
    }

    if (!$found) {
        // Nothing by its name: the videos most like it, named only when they all name one game.
        $near = [];
        foreach ($folders as $folder) {
            foreach (xs_vm_shelf($root, $folder)['all'] as $v) {
                if (!$v['spaced']) {
                    continue;
                }
                $how = 0.0;
                foreach ($names as $n) {
                    $how = max($how, xs_vm_alike($n, $v));
                }
                if ($how > 0) {
                    $near[] = [$how, $v];
                }
            }
        }
        if ($near) {
            $top  = max(array_column($near, 0));
            $tops = array_values(array_filter($near, static fn ($x) => $x[0] >= $top - 0.0001));
            $one  = static fn (array $list): bool => count(array_unique(array_map(static fn ($x) => $x[1]['loose'], $list))) === 1;
            // Several games share the main title: the one that is only that title is the game itself.
            if (!$one($tops)) {
                $tops = array_values(array_filter($tops, static fn ($x) => $x[1]['loose'] === $x[1]['main']));
            }
            if ($tops && $one($tops)) {
                usort($tops, static fn ($a, $b) => [$far($a[1]), -$a[1]['size']] <=> [$far($b[1]), -$b[1]['size']]);
                return $none('only a video with a similar name was found, and that is left out: ' . $tops[0][1]['name'], $tops[0][1]);
            }
        }
        return $none('nothing by this name among ' . $count . ' videos for ' . $c['name']);
    }

    // The best by how it matched, which folder, how close the release; then one a browser plays; then the bigger file.
    usort($found, static fn ($a, $b) => [$a[0], $a[1], $far($a[2])] <=> [$b[0], $b[1], $far($b[2])]);
    $lead = [$found[0][0], $found[0][1], $far($found[0][2])];
    $tied = array_values(array_filter($found, static fn ($x) => [$x[0], $x[1], $far($x[2])] === $lead));
    // A video not on this PC says of itself whether it is H.265; one that is here is opened and read.
    $hevc = static fn (array $v): bool => $v['hevc'] ?? xs_vm_hevc($v['abs']);
    $rows = array_map(static fn ($x) => $x + [3 => count($tied) > 1 && $hevc($x[2])], $tied);
    usort($rows, static fn ($a, $b) => [$a[3], -$a[2]['size']] <=> [$b[3], -$b[2]['size']]);
    $best = $rows[0];
    return ['video' => $best[2], 'kind' => $best[0], 'why' => '', 'near' => null, 'others' => count($found) - 1,
            'hevc' => count($tied) > 1 ? $best[3] : $hevc($best[2])];
}
