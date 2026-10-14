<?php
/**
 * Xsegon - its own console name logos, fetched into img\console-logos.
 *
 *   php tools\get-console-logos.php
 *       --keep <folder>    keep what Commons sent, to work on again
 *       --from <folder>    read what was kept: the internet is not asked
 *       --sheet <folder>   every logo before and after, on Xsegon's dark, to look at
 *
 * The name logos the wheel's rim wears (kind=clearlogo in api\image.php),
 * from Wikimedia Commons pages marked Public domain or CC0: free of
 * copyright, still their owners' trademarks. Any other licence stops the run.
 *
 * One PNG per console, named by libretro's name, margins cut, within 900 by
 * 270. Drawn for white paper, a dark logo's greys are turned over and its
 * dark colours lifted to read on Xsegon's dark screen; 'mode' in the table
 * overrules the guess, and 'ground' takes away a white sheet behind one.
 *
 * Needs gd and openssl (it restarts itself with them when php.ini leaves them
 * off). Commons is asked one file every second and a half: it refuses a burst.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
error_reporting(E_ALL);
ini_set('display_errors', 'stderr');
ini_set('memory_limit', '1024M');
set_time_limit(0);

function say(string $m): void
{
    fwrite(STDOUT, $m . "\n");
}

// The extensions php.ini leaves off, loaded for this one run.
$lacking = array_values(array_filter(['gd', 'openssl'], static fn ($e) => !extension_loaded($e)));
if ($lacking) {
    if (getenv('XSEGON_LOGOS_AGAIN') === '1') {
        say('FAILED: this PHP has no ' . implode(', ', $lacking) . ' extension to load');
        exit(1);
    }
    $extDir = (string) ini_get('extension_dir');
    if ($extDir === '' || !preg_match('#^([A-Za-z]:|[\\\\/])#', $extDir)) {
        $extDir = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . ($extDir !== '' ? $extDir : 'ext');
    }
    $again = [PHP_BINARY, '-d', 'extension_dir=' . $extDir];
    foreach ($lacking as $e) {
        $again[] = '-d';
        $again[] = 'extension=' . $e;
    }
    putenv('XSEGON_LOGOS_AGAIN=1');
    $p = proc_open(array_merge($again, $argv), [0 => STDIN, 1 => STDOUT, 2 => STDERR], $pipes, null, null, ['bypass_shell' => true]);
    exit(is_resource($p) ? proc_close($p) : 1);
}

const OUT = __DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . 'console-logos';
// Twice the rim's largest drawing of one (124 high, 420 wide), for a sharp edge.
const MAX_W = 900;
const MAX_H = 270;
const API = 'https://commons.wikimedia.org/w/api.php';
// Xsegon's ground, for the sheet.
const GROUND = [6, 13, 28];

/* libretro's name for the console => its logo on Commons. Nintendo Switch
   has no libretro name; the one here is in its shape, and api\image.php
   knows it. 'mode': 'turn' or 'keep' where the guess (dark logos are
   turned) is wrong for one. 'ground' => 'drop': a white sheet is drawn
   behind it. 'owner': whose trademark, where the maker in the name is not
   the one. 'note': a line for ABOUT.txt on what is unusual about it. */
const LOGOS = [
    'Atari - 2600'                                   => ['file' => 'Atari_2600_logo-01-05.svg'],
    'Atari - 5200'                                   => ['file' => 'Atari 5200 logo.svg'],
    'Atari - 7800'                                   => ['file' => 'Atari_7800_logo-01.svg'],
    // Black letters on its yellow discs: turned, they go white and are lost.
    'Atari - Jaguar'                                 => ['file' => 'Atari Jaguar logo.svg', 'mode' => 'keep'],
    'Atari - Lynx'                                   => ['file' => 'Atari Lynx logo-01.svg'],
    'Bandai - WonderSwan'                            => ['file' => 'Bandai WonderSwan horizontal logo.svg'],
    'Bandai - WonderSwan Color'                      => ['file' => 'Wonderswan-Color-Logo.svg'],
    'Coleco - ColecoVision'                          => ['file' => 'COLECO VISION LOGO.svg', 'mode' => 'keep'],
    'Commodore - 64'                                 => ['file' => 'Commodore 64 logo (2).svg', 'mode' => 'turn'],
    'Commodore - Amiga'                              => ['file' => 'Commodore Amiga logo-03.svg', 'mode' => 'turn', 'owner' => 'Amiga Corporation'],
    'FBNeo - Arcade Games'                           => ['file' => 'MAMELogo.svg', 'owner' => 'Gregory Ember (MAME)',
        'note' => 'The name arcade game sets go by. Xsegon starts Arcade in FinalBurn Neo unless a MAME is added; see MAME below.'],
    'Fairchild - Channel F'                          => ['file' => 'Channel F Logo.svg', 'ground' => 'drop', 'mode' => 'turn',
        'note' => 'Its drawer also offers this drawing under CC BY-SA 4.0, should the Public domain mark not hold: this copy is offered the same way. The white sheet behind it is taken away here.'],
    'GCE - Vectrex'                                  => ['file' => 'Vectrex logo (rest of the world).svg',
        'note' => 'The ground Commons gives: that the Vectrex\'s makers gave its material away.'],
    'MAME'                                           => ['file' => 'MAMELogo.svg',
        'note' => 'The drawing is CC0 in MAME\'s own repository (docs/source/images/MAMElogo.svg). MAME\'s legal page, mamedev.org/legal.html, asks that its name and logo be used with permission.'],
    'Mattel - Intellivision'                         => ['file' => 'Intellivision-logo.svg',
        'note' => 'The small line above the name, Mattel Electronics, is Mattel\'s.'],
    // White letters on its black block: turned, the block goes white too.
    'Microsoft - MSX'                                => ['file' => 'MSX-Logo.svg', 'mode' => 'keep', 'owner' => 'MSX Licensing Corporation'],
    'Microsoft - Xbox'                               => ['file' => 'Xbox_Logo.svg'],
    'Microsoft - Xbox 360'                           => ['file' => 'Xbox_360_logo.svg'],
    'NEC - PC Engine - TurboGrafx 16'                => ['file' => 'PC engine logo red.svg',
        'note' => 'The console\'s name in Japan: no free logo of its American name was found.'],
    'NEC - PC Engine CD - TurboGrafx-CD'             => ['file' => 'Super CD-ROM2 logo.png', 'mode' => 'keep',
        'note' => 'The mark its CD games carry.'],
    // Its black lines are part of it: left dark, only the yellow words show.
    'Nintendo - Family Computer Disk System'         => ['file' => 'Family Computer Disk System logo.svg', 'mode' => 'turn'],
    'Nintendo - Game Boy'                            => ['file' => 'Gameboy_logo.svg'],
    'Nintendo - Game Boy Advance'                    => ['file' => 'Game_Boy_Advance_logo.svg'],
    'Nintendo - Game Boy Color'                      => ['file' => 'Game_Boy_Color_logo.svg'],
    'Nintendo - GameCube'                            => ['file' => 'Nintendo_GameCube_Official_Logo.svg'],
    'Nintendo - Nintendo 3DS'                        => ['file' => 'Nintendo_3DS_logo.svg'],
    'Nintendo - Nintendo 64'                         => ['file' => 'Nintendo_64_wordmark.svg'],
    'Nintendo - Nintendo DS'                         => ['file' => 'Nintendo_DS_Logo.svg'],
    'Nintendo - Nintendo Entertainment System'       => ['file' => 'NES_logo.svg'],
    // White on its red square: reads as drawn.
    'Nintendo - Nintendo Switch'                     => ['file' => 'Nintendo_Switch_logo.svg', 'mode' => 'keep'],
    'Nintendo - Super Nintendo Entertainment System' => ['file' => 'Super_Nintendo_Entertainment_System_logo.svg'],
    'Nintendo - Virtual Boy'                         => ['file' => 'Virtualboy logo.svg'],
    'Nintendo - Wii'                                 => ['file' => 'Wii.svg'],
    'Nintendo - Wii U'                               => ['file' => 'WiiU.svg'],
    // Its dark disc is part of it: turned, the disc goes pale behind the letters.
    'SNK - Neo Geo'                                  => ['file' => 'Neo_Geo_logo.svg', 'mode' => 'keep'],
    'SNK - Neo Geo CD'                               => ['file' => 'NEOGEO CD logo.svg'],
    'SNK - Neo Geo Pocket'                           => ['file' => 'Neo_Geo_Pocket_logo.svg'],
    'SNK - Neo Geo Pocket Color'                     => ['file' => 'Neo Geo Pocket Color logo.svg'],
    // Its black shadow would turn white and stand in front of the red.
    'Sega - 32X'                                     => ['file' => 'Sega 32X logo.svg', 'mode' => 'keep'],
    'Sega - Dreamcast'                               => ['file' => 'Dreamcast_logo.svg'],
    'Sega - Game Gear'                               => ['file' => 'Game gear eu logo.svg'],
    'Sega - Master System - Mark III'                => ['file' => 'Master System Logo.svg'],
    'Sega - Mega Drive - Genesis'                    => ['file' => 'Sega_genesis_logo.svg'],
    'Sega - Mega-CD - Sega CD'                       => ['file' => 'Sega CD Logo (USA).svg', 'mode' => 'keep'],
    'Sega - SG-1000'                                 => ['file' => 'SG-1000 Logo.svg'],
    'Sega - Saturn'                                  => ['file' => 'Sega_Saturn_USA_logo.svg'],
    'Sony - PlayStation'                             => ['file' => 'PlayStation_logo.svg'],
    'Sony - PlayStation 2'                           => ['file' => 'PlayStation_2_logo.svg'],
    'Sony - PlayStation 3'                           => ['file' => 'PS3-Logo.svg'],
    'Sony - PlayStation Portable'                    => ['file' => 'PSP_Logo.svg'],
    'Sony - PlayStation Vita'                        => ['file' => 'PlayStation_Vita_logo.svg'],
    // Not a name logo: Steam's icon, which RetroArch's set has none of (api\image.php, kind=icon).
    'Steam (icon)'                                   => ['file' => 'Steam icon logo.svg', 'mode' => 'keep', 'owner' => 'Valve',
        'note' => 'An icon, not a name logo: shown small in the sidebar and the console picker, where the other consoles wear RetroArch\'s icons.'],
    'The 3DO Company - 3DO'                          => ['file' => '3DO Logo.svg', 'mode' => 'keep'],
];

/* Whose trademark each is, by the maker libretro's name starts with: for
   ABOUT.txt. Old names change hands: these are the holders when last
   checked, and 'owner' in the table says it for one console. */
const OWNERS = [
    'Atari' => 'Atari', 'Microsoft' => 'Microsoft', 'Nintendo' => 'Nintendo',
    'SNK' => 'SNK', 'Sega' => 'Sega', 'Sony' => 'Sony Interactive Entertainment',
    'Bandai' => 'Bandai', 'Coleco' => 'Coleco Holdings', 'Commodore' => 'Commodore',
    'Fairchild' => 'Fairchild, its maker, or whoever holds the name now',
    'GCE' => 'Smith Engineering, its maker',
    'MAME' => 'Gregory Ember (MAME)',
    'Mattel' => 'Atari, who bought the Intellivision name in 2024',
    'NEC' => 'NEC and Konami',
    'The' => 'the holders of The 3DO Company\'s rights',
];

// A line of Commons' own words: its links and marks taken out, kept short.
function plain(string $html): string
{
    $t = trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
    return mb_strlen($t) > 160 ? mb_substr($t, 0, 157) . '...' : $t;
}

$opt = ['keep' => '', 'from' => '', 'sheet' => ''];
for ($i = 1; $i < count($argv); $i++) {
    $k = ltrim($argv[$i], '-');
    if (!isset($opt[$k]) || !isset($argv[$i + 1])) {
        say('STOP: ' . $argv[$i] . ' is not --keep, --from or --sheet with a folder after it');
        exit(2);
    }
    $opt[$k] = rtrim($argv[++$i], '\\/');
}
foreach (['keep', 'sheet'] as $k) {
    if ($opt[$k] !== '' && !is_dir($opt[$k]) && !mkdir($opt[$k], 0777, true)) {
        say('STOP: could not make ' . $opt[$k]);
        exit(1);
    }
}

function ctx(): array
{
    // The certificates that come with this PHP, when php.ini names none.
    $ssl = ['verify_peer' => true, 'verify_peer_name' => true];
    $pem = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . 'cacert.pem';
    if ((string) ini_get('openssl.cafile') === '' && is_file($pem)) {
        $ssl['cafile'] = $pem;
    }
    // Wikimedia asks every program to say who it is.
    return ['http' => ['timeout' => 60, 'user_agent' => 'Xsegon console logo fetcher (tools/get-console-logos.php)',
                       'follow_location' => 1, 'ignore_errors' => true], 'ssl' => $ssl];
}

function fetch(string $url): string
{
    // Commons answers 429 to a burst: waited out, a few times, before giving up.
    for ($try = 1; ; $try++) {
        $body = @file_get_contents($url, false, stream_context_create(ctx()));
        $headers = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : ($http_response_header ?? []);
        $statuses = array_values(array_filter($headers, static fn ($h) => str_starts_with((string) $h, 'HTTP/')));
        $status = $statuses && preg_match('#^HTTP/\S+ (\d+)#', (string) end($statuses), $m) ? (int) $m[1] : 0;
        if ($body !== false && $status === 200) {
            return $body;
        }
        if (!in_array($status, [429, 503], true) || $try >= 5) {
            throw new RuntimeException($url . ' answered ' . ($status ?: 'nothing'));
        }
        say('  Commons says wait (' . $status . '): 30 seconds, then again');
        sleep(30);
    }
}

function blank(int $w, int $h): GdImage
{
    $im = imagecreatetruecolor($w, $h);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
    return $im;
}

// The empty margins cut away, so every logo fills the room it is given.
function trim_empty(GdImage $im): GdImage
{
    $w = imagesx($im);
    $h = imagesy($im);
    [$x0, $y0, $x1, $y1] = [$w, $h, -1, -1];
    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $w; $x++) {
            if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 120) {
                $x0 = min($x0, $x);
                $x1 = max($x1, $x);
                $y0 = min($y0, $y);
                $y1 = max($y1, $y);
            }
        }
    }
    if ($x1 < 0 || ($x0 === 0 && $y0 === 0 && $x1 === $w - 1 && $y1 === $h - 1)) {
        return $im;
    }
    $out = blank($x1 - $x0 + 1, $y1 - $y0 + 1);
    imagecopy($out, $im, 0, 0, $x0, $y0, $x1 - $x0 + 1, $y1 - $y0 + 1);
    return $out;
}

/* A white sheet drawn behind a logo, taken away: its white is the paper
   wherever it shows, inside a letter as much as round the edge. */
function drop_ground(GdImage $im): void
{
    $clear = imagecolorallocatealpha($im, 255, 255, 255, 127);
    for ($y = 0, $h = imagesy($im); $y < $h; $y++) {
        for ($x = 0, $w = imagesx($im); $x < $w; $x++) {
            $c = imagecolorat($im, $x, $y);
            if ((($c >> 16) & 0xFF) > 235 && (($c >> 8) & 0xFF) > 235 && ($c & 0xFF) > 235) {
                imagesetpixel($im, $x, $y, $clear);
            }
        }
    }
}

// How light the drawn part is, 0 to 255, each pixel counted by how solid it is.
function lightness(GdImage $im): float
{
    $sum = 0.0;
    $n = 0.0;
    for ($y = 0, $h = imagesy($im); $y < $h; $y++) {
        for ($x = 0, $w = imagesx($im); $x < $w; $x++) {
            $c = imagecolorat($im, $x, $y);
            $solid = 1 - (($c >> 24) & 0x7F) / 127;
            if ($solid > 0) {
                $sum += $solid * (0.2126 * (($c >> 16) & 0xFF) + 0.7152 * (($c >> 8) & 0xFF) + 0.0722 * ($c & 0xFF));
                $n += $solid;
            }
        }
    }
    return $n > 0 ? $sum / $n : 255.0;
}

function to_hsl(int $r, int $g, int $b): array
{
    [$r, $g, $b] = [$r / 255, $g / 255, $b / 255];
    $max = max($r, $g, $b);
    $min = min($r, $g, $b);
    $l = ($max + $min) / 2;
    if ($max === $min) {
        return [0.0, 0.0, $l];
    }
    $d = $max - $min;
    $s = $l > 0.5 ? $d / (2 - $max - $min) : $d / ($max + $min);
    $h = match (true) {
        $max === $r => fmod(($g - $b) / $d + ($g < $b ? 6 : 0), 6),
        $max === $g => ($b - $r) / $d + 2,
        default     => ($r - $g) / $d + 4,
    };
    return [$h / 6, $s, $l];
}

function from_hsl(float $h, float $s, float $l): array
{
    if ($s <= 0) {
        $v = (int) round($l * 255);
        return [$v, $v, $v];
    }
    $q = $l < 0.5 ? $l * (1 + $s) : $l + $s - $l * $s;
    $p = 2 * $l - $q;
    $part = static function (float $t) use ($p, $q): int {
        $t = $t < 0 ? $t + 1 : ($t > 1 ? $t - 1 : $t);
        $v = match (true) {
            $t < 1 / 6 => $p + ($q - $p) * 6 * $t,
            $t < 1 / 2 => $q,
            $t < 2 / 3 => $p + ($q - $p) * (2 / 3 - $t) * 6,
            default    => $p,
        };
        return (int) round(max(0, min(1, $v)) * 255);
    };
    return [$part($h + 1 / 3), $part($h), $part($h - 1 / 3)];
}

/**
 * A logo drawn for white paper, made to read on a dark screen: its dark
 * greys turned over (black becomes white) and its dark colours lifted, their
 * hue kept. What is already light is left alone, so a white fill stays white.
 */
function for_dark(GdImage $im): void
{
    $memo = [];
    for ($y = 0, $h = imagesy($im); $y < $h; $y++) {
        for ($x = 0, $w = imagesx($im); $x < $w; $x++) {
            $c = imagecolorat($im, $x, $y);
            $a = ($c >> 24) & 0x7F;
            if ($a === 127) {
                continue;
            }
            $rgb = $c & 0xFFFFFF;
            if (!isset($memo[$rgb])) {
                [$hue, $s, $l] = to_hsl(($rgb >> 16) & 0xFF, ($rgb >> 8) & 0xFF, $rgb & 0xFF);
                $l = $s < 0.18 ? max($l, 1 - $l) : max($l, 0.5 + 0.2 * $l);
                [$r, $g, $b] = from_hsl($hue, $s, $l);
                $memo[$rgb] = ($r << 16) | ($g << 8) | $b;
            }
            imagesetpixel($im, $x, $y, ($a << 24) | $memo[$rgb]);
        }
    }
}

// No wider than MAX_W and no taller than MAX_H, see-through parts kept.
function fit(GdImage $im, int $maxW = MAX_W, int $maxH = MAX_H): GdImage
{
    $w = imagesx($im);
    $h = imagesy($im);
    $scale = min(1, $maxW / $w, $maxH / $h);
    if ($scale >= 1) {
        return $im;
    }
    $nw = max(1, (int) round($w * $scale));
    $nh = max(1, (int) round($h * $scale));
    $out = blank($nw, $nh);
    imagecopyresampled($out, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
    return $out;
}

function open(string $png, string $name): GdImage
{
    $im = @imagecreatefromstring($png);
    if (!$im instanceof GdImage) {
        say('STOP: ' . $name . ' did not open as a picture');
        exit(1);
    }
    if (!imageistruecolor($im)) {
        imagepalettetotruecolor($im);
    }
    imagealphablending($im, false);
    imagesavealpha($im, true);
    return $im;
}

if (!is_dir(OUT) && !mkdir(OUT, 0777, true)) {
    say('STOP: could not make ' . OUT);
    exit(1);
}

// What Commons says of every file: its licence, its size, and the
// original's SHA-1, which says later whether the file has changed there.
$meta = [];
if ($opt['from'] !== '') {
    $meta = json_decode((string) @file_get_contents($opt['from'] . DIRECTORY_SEPARATOR . 'meta.json'), true);
    if (!is_array($meta)) {
        say('STOP: ' . $opt['from'] . ' has no meta.json: fetch with --keep first');
        exit(1);
    }
} else {
    // With the licence: who Commons credits, whether it marks the file a
    // trademark, and the ground it gives for calling it free (its hidden
    // categories: "PD textlogo", "CC-Zero").
    $titles = array_values(array_unique(array_map(static fn ($p) => 'File:' . $p['file'], array_values(LOGOS))));
    foreach (array_chunk($titles, 50) as $chunk) {
        $more = [];
        do {
            $q = json_decode(fetch(API . '?' . http_build_query([
                'action' => 'query', 'format' => 'json', 'formatversion' => '2', 'titles' => implode('|', $chunk),
                'prop' => 'imageinfo|categories', 'iiprop' => 'size|sha1|extmetadata',
                'clshow' => 'hidden', 'cllimit' => 'max',
            ] + $more)), true);
            foreach ($q['query']['pages'] ?? [] as $page) {
                $t = $page['title'];
                $ii = $page['imageinfo'][0] ?? null;
                if ($ii !== null) {
                    $x = $ii['extmetadata'] ?? [];
                    $meta[$t] = [
                        'width' => (int) $ii['width'], 'height' => (int) $ii['height'], 'sha1' => (string) $ii['sha1'],
                        'licence' => (string) ($x['LicenseShortName']['value'] ?? ''),
                        'artist' => plain((string) ($x['Artist']['value'] ?? '')),
                        'credit' => plain((string) ($x['Credit']['value'] ?? '')),
                        'attributionRequired' => ($x['AttributionRequired']['value'] ?? 'false') === 'true',
                        'trademarked' => stripos((string) ($x['Restrictions']['value'] ?? ''), 'trademark') !== false,
                        'grounds' => $meta[$t]['grounds'] ?? [],
                    ];
                } elseif (!isset($meta[$t]) && isset($page['missing'])) {
                    $meta[$t] = null;
                }
                foreach ($page['categories'] ?? [] as $c) {
                    $name = (string) preg_replace('/^Category:/', '', (string) $c['title']);
                    if (isset($meta[$t]) && preg_match('/^(PD[ -]|CC-|Copyrighted free use)/i', $name) && !str_contains($name, 'missing SDC')) {
                        $meta[$t]['grounds'][] = $name;
                    }
                }
            }
            $more = $q['continue'] ?? [];
        } while ($more);
    }
    if ($opt['keep'] !== '') {
        file_put_contents($opt['keep'] . DIRECTORY_SEPARATOR . 'meta.json', json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }
}

$files = [];
$pairs = [];
$got = [];
foreach (LOGOS as $sys => $p) {
    $m = $meta[str_replace('_', ' ', 'File:' . $p['file'])] ?? null;
    if ($m === null) {
        say('STOP: ' . $p['file'] . ' is not on Commons (moved or deleted?)');
        exit(1);
    }
    if (!in_array($m['licence'], ['Public domain', 'CC0'], true)) {
        say('STOP: ' . $p['file'] . ' says "' . $m['licence'] . '" now, not Public domain or CC0');
        exit(1);
    }
    if (!empty($m['attributionRequired'])) {
        say('STOP: ' . $p['file'] . ' asks for a credit on Commons now: read its page before it ships');
        exit(1);
    }
    $owner = $p['owner'] ?? OWNERS[strtok($sys, ' ')] ?? null;
    if ($owner === null) {
        say('STOP: ' . $sys . ' has no trademark owner named in OWNERS');
        exit(1);
    }
    if (isset($got[$p['file']])) {
        // One logo for two consoles: asked for once.
        $png = $got[$p['file']];
    } elseif ($opt['from'] !== '') {
        $png = (string) @file_get_contents($opt['from'] . DIRECTORY_SEPARATOR . $p['file'] . '.png');
        if ($png === '') {
            say('STOP: ' . $opt['from'] . ' has no ' . $p['file'] . '.png: fetch with --keep first');
            exit(1);
        }
    } elseif ($opt['keep'] !== '' && (int) @filesize($opt['keep'] . DIRECTORY_SEPARATOR . $p['file'] . '.png') > 0) {
        // Kept by a run that stopped part way: not asked for twice.
        $png = (string) file_get_contents($opt['keep'] . DIRECTORY_SEPARATOR . $p['file'] . '.png');
    } else {
        // Wide enough for either limit; Commons draws the SVG at the size asked, or its next step up.
        $width = (int) max(300, min(MAX_W, ceil(MAX_H * $m['width'] / max(1, $m['height']))));
        if (!str_ends_with(strtolower($p['file']), '.svg')) {
            // A picture that is no SVG: Commons gives only its own steps, none wider than the picture.
            $steps = array_filter([1280, 960, 500, 330, 250], static fn ($s) => $s <= $m['width']);
            $width = (int) (reset($steps) ?: $m['width']);
        }
        usleep(1500000);
        $png = fetch('https://commons.wikimedia.org/wiki/Special:FilePath/' . rawurlencode($p['file']) . '?width=' . $width);
        if ($opt['keep'] !== '') {
            file_put_contents($opt['keep'] . DIRECTORY_SEPARATOR . $p['file'] . '.png', $png);
        }
    }
    $got[$p['file']] = $png;
    $im = open($png, $p['file']);
    if (($p['ground'] ?? '') === 'drop') {
        drop_ground($im);
    }
    $im = trim_empty($im);
    // A sheet of paper behind it would turn into a black box: said, not guessed at.
    $corner = imagecolorat($im, 0, 0);
    $ground = ((($corner >> 24) & 0x7F) < 20) && ((($corner >> 16) & 0xFF) > 235) && ((($corner >> 8) & 0xFF) > 235) && (($corner & 0xFF) > 235);
    $light = lightness($im);
    $mode = $p['mode'] ?? ($light < 128 ? 'turn' : 'keep');
    $before = $opt['sheet'] !== '' ? fit(open($png, $p['file'])) : null;
    if ($mode === 'turn') {
        for_dark($im);
    }
    $im = fit($im);
    $out = OUT . DIRECTORY_SEPARATOR . $sys . '.png';
    if (!imagepng($im, $out, 9)) {
        say('STOP: could not write ' . $out);
        exit(1);
    }
    $files[$sys . '.png'] = [
        'commons' => $p['file'], 'page' => 'https://commons.wikimedia.org/wiki/File:' . rawurlencode($p['file']),
        'licence' => $m['licence'], 'grounds' => array_values(array_unique($m['grounds'] ?? [])),
        'trademarkOf' => $owner, 'markedTrademarkOnCommons' => !empty($m['trademarked']),
        'creditedOnCommons' => (string) ($m['artist'] ?? ''), 'sourceOnCommons' => (string) ($m['credit'] ?? ''),
        'originalSha1' => $m['sha1'],
        'width' => imagesx($im), 'height' => imagesy($im),
        'sha256' => hash_file('sha256', $out), 'bytes' => filesize($out),
    ] + ($mode === 'turn' ? ['turnedForDark' => true] : []) + (($p['ground'] ?? '') === 'drop' ? ['whiteGroundTakenAway' => true] : [])
      + (isset($p['note']) ? ['note' => $p['note']] : []);
    say(sprintf('  %-52s %4dx%-4d %6d bytes  light %3d  %s%s', $sys . '.png', imagesx($im), imagesy($im), filesize($out), (int) $light,
        $mode . (isset($p['mode']) ? ' (said)' : ''), $ground ? '  HAS A WHITE GROUND' : ''));
    if ($before !== null) {
        $pairs[] = [$sys, $before, $im, $mode];
    }
}

// The folder holds this run's files and nothing else.
$gone = [];
foreach (glob(OUT . DIRECTORY_SEPARATOR . '*.png') ?: [] as $f) {
    if (!isset($files[basename($f)])) {
        unlink($f);
        $gone[] = basename($f);
    }
}
file_put_contents(OUT . DIRECTORY_SEPARATOR . 'sources.json', json_encode([
    'source' => 'https://commons.wikimedia.org/wiki/File:<commons>',
    'licences' => 'Public domain or CC0 only; checked on Commons when fetched',
    'files' => $files,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
$each = [];
foreach ($files as $name => $f) {
    $each[] = substr($name, 0, -4);
    $each[] = '    A trademark of ' . $f['trademarkOf'] . '.';
    $each[] = '    ' . $f['page'];
    $each[] = '    Marked ' . $f['licence'] . ' there' . ($f['grounds'] ? ' (' . implode(', ', $f['grounds']) . ')' : '')
            . ($f['markedTrademarkOnCommons'] ? ', with its trademark notice' : '') . '. No credit is asked for.';
    if ($f['creditedOnCommons'] !== '') {
        $each[] = '    Commons names as its author: ' . $f['creditedOnCommons'];
    }
    $each[] = '    ' . (!empty($f['turnedForDark']) ? 'Lightened here for a dark screen; its shape is unchanged.' : 'Shown as drawn, made smaller.');
    foreach (isset($f['note']) ? explode("\n", wordwrap($f['note'], 72)) : [] as $line) {
        $each[] = '    ' . $line;
    }
    $each[] = '';
}
file_put_contents(OUT . DIRECTORY_SEPARATOR . 'ABOUT.txt', implode("\r\n", array_merge([
    "Xsegon's console name logos",
    '===========================',
    '',
    "The name logo each console wears on the wheel's rim, when you have not",
    'chosen one yourself.',
    '',
    'They are trademarks, and not Xsegon\'s',
    '------------------------------------',
    'Every name and logo here belongs to the company named beside it below.',
    'Xsegon shows them for one purpose: to say which console a game is for.',
    'Xsegon is not made, sponsored, approved or endorsed by Nintendo, Sony',
    'Interactive Entertainment, Microsoft, Sega, Atari, SNK, the MAME team or',
    'anyone else whose console or program it names, and has no connection',
    'with any of them.',
    '',
    'Where they come from',
    '--------------------',
    'Wikimedia Commons, one file each, fetched by tools\get-console-logos.php.',
    'Each file\'s page there marks it Public domain or CC0: Commons\' view is',
    'that a plain wordmark is too simple for copyright to cover, or its',
    'drawer has given the drawing away. That is its editors\' judgement of',
    'each file, not a ruling, and it says nothing about trademark, which is a',
    'separate right and still applies. The tool reads the mark off each page',
    'every time it runs and stops at any other.',
    '',
    'sources.json holds the same for each file as data: its page, the mark and',
    'the ground Commons gives for it, whose trademark it is, who Commons names',
    'as its author and source, the original\'s SHA-1 and this file\'s SHA-256.',
    '',
    'What was changed',
    '----------------',
    'Commons drew each SVG as a PNG; the empty margins were cut away and the',
    'picture made no larger than 900 by 270. Logos drawn in black or dark',
    'colours for white paper are lightened to read on Xsegon\'s dark screen:',
    'black becomes white and dark colours are lifted, their hue kept. Where a',
    'white sheet was drawn behind one it is taken away, and that logo\'s entry',
    'says so. Nothing else is redrawn, added or taken away.',
    '',
    'To take one out',
    '---------------',
    'Delete its file here and the wheel writes that console\'s name in words.',
    'An owner who wants one gone has only to ask: help@tumultuousproductions.site',
    '',
    'A logo of your own',
    '------------------',
    'Right-click a console > Change Pictures, or put a file named',
    '<console>-clearlogo.png in Xsegon\data\platform-art. Yours comes first,',
    'and these files are never changed by it.',
    '',
    'Each logo',
    '---------',
], $each)));
$total = array_sum(array_column($files, 'bytes'));
say(count($files) . ' console logos in img\\console-logos, ' . round($total / 1024) . ' KB' . ($gone ? '; taken out, from an earlier run: ' . implode(', ', $gone) : ''));

// Every logo as Commons drew it and as it is kept, on Xsegon's ground.
if ($opt['sheet'] !== '') {
    $rows = 7;
    [$cw, $ch, $pad] = [430, 130, 14];
    foreach (array_chunk($pairs, $rows) as $n => $chunk) {
        $sheet = imagecreatetruecolor($pad + 2 * ($cw + $pad), $pad + count($chunk) * ($ch + 18 + $pad));
        imagefill($sheet, 0, 0, imagecolorallocate($sheet, GROUND[0], GROUND[1], GROUND[2]));
        $ink = imagecolorallocate($sheet, 150, 200, 215);
        foreach ($chunk as $r => [$sys, $before, $after, $mode]) {
            $top = $pad + $r * ($ch + 18 + $pad);
            imagestring($sheet, 3, $pad, $top, $sys . '   as fetched | as kept (' . $mode . ')', $ink);
            foreach ([$before, $after] as $col => $pic) {
                $pic = fit($pic, $cw, $ch);
                imagealphablending($sheet, true);
                imagecopy($sheet, $pic, $pad + $col * ($cw + $pad), $top + 18 + intdiv($ch - imagesy($pic), 2), 0, 0, imagesx($pic), imagesy($pic));
            }
        }
        imagepng($sheet, $opt['sheet'] . DIRECTORY_SEPARATOR . 'sheet-' . ($n + 1) . '.png');
    }
    say('sheets in ' . $opt['sheet']);
}
