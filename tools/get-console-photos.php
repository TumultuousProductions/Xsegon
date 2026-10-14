<?php
/**
 * Xsegon - its own console photos, fetched into img\console-photos.
 *
 *   php tools\get-console-photos.php
 *
 * The console itself, in the middle of the wheel and on each carousel card
 * (kind=device in api\image.php). From Wikimedia Commons pages marked Public
 * domain or CC0, nearly all by Evan-Amos: no credit owed, and sources.json
 * keeps where each came from. Any other licence stops the run, so a console
 * whose best photo is CC BY-SA has another angle here, or none.
 *
 * One WebP per console, named by libretro's name, within 800 by 600 with its
 * transparency kept. The NES photo is on white, which is cut away here. A
 * console with no photo keeps its icon (img\consoles).
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

/* The extensions php.ini leaves off, loaded for this one run, as
   tools\build-gamesdb.php does. */
$lacking = array_values(array_filter(['gd', 'openssl'], static fn ($e) => !extension_loaded($e)));
if ($lacking) {
    if (getenv('XSEGON_PHOTOS_AGAIN') === '1') {
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
    putenv('XSEGON_PHOTOS_AGAIN=1');
    $p = proc_open(array_merge($again, $argv), [0 => STDIN, 1 => STDOUT, 2 => STDERR], $pipes, null, null, ['bypass_shell' => true]);
    exit(is_resource($p) ? proc_close($p) : 1);
}

const OUT = __DIR__ . DIRECTORY_SEPARATOR . '..' . DIRECTORY_SEPARATOR . 'img' . DIRECTORY_SEPARATOR . 'console-photos';
const MAX_W = 800;
const MAX_H = 600;
const QUALITY = 85;
const API = 'https://commons.wikimedia.org/w/api.php';

/* libretro's name for the console => the photo on Commons, chosen by eye on
   Xsegon's dark background. 'cut' => true: the white round it is taken out. */
const PHOTOS = [
    'Atari - 2600'                                   => ['file' => 'Atari-2600-Wood-4Sw-Set.png'],
    'Atari - 5200'                                   => ['file' => 'Atari-5200-Console-Set.png'],
    'Atari - 7800'                                   => ['file' => 'Atari-7800-Euro-Console-FL.png'],
    'Atari - Jaguar'                                 => ['file' => 'Atari-Jaguar-Bare-HL.png'],
    'Atari - Lynx'                                   => ['file' => 'Atari-Lynx-II-Handheld-Angled.png'],
    'Bandai - WonderSwan'                            => ['file' => 'WonderSwan-Black-Left.png'],
    'Bandai - WonderSwan Color'                      => ['file' => 'WonderSwan-Color-Blue-Left.png'],
    'Coleco - ColecoVision'                          => ['file' => 'ColecoVision-wController-L.png'],
    'Commodore - 64'                                 => ['file' => 'Commodore-64-Computer-FL.png'],
    'Fairchild - Channel F'                          => ['file' => 'Fairchild-Channel-F-System-II-Console.png'],
    'Microsoft - Xbox'                               => ['file' => 'Xbox-Console-Set.png'],
    'Microsoft - Xbox 360'                           => ['file' => 'Microsoft-Xbox-360-Pro-Flat-wController-L.png'],
    'NEC - PC Engine - TurboGrafx 16'                => ['file' => 'TurboGrafx16-Console-Set.png'],
    'NEC - PC Engine CD - TurboGrafx-CD'             => ['file' => 'NEC-TurboGrafx-16-CD-FL.png'],
    'Nintendo - Family Computer Disk System'         => ['file' => 'Nintendo-Famicom-Disk-System.png'],
    'Nintendo - Game Boy'                            => ['file' => 'Game-Boy-FL.png'],
    'Nintendo - Game Boy Advance'                    => ['file' => 'Nintendo-Game-Boy-Advance-Purple-FL.png'],
    'Nintendo - Game Boy Color'                      => ['file' => 'Nintendo-Game-Boy-Color-FL.png'],
    'Nintendo - GameCube'                            => ['file' => 'GameCube-Console-Set.png'],
    'Nintendo - Nintendo 3DS'                        => ['file' => 'Nintendo-3DS-XL-angled.png'],
    'Nintendo - Nintendo 64'                         => ['file' => 'N64-Console-Set.png'],
    'Nintendo - Nintendo DS'                         => ['file' => 'Nintendo-DS-Fat-Blue.png'],
    'Nintendo - Nintendo Entertainment System'       => ['file' => 'NES-Console-Set.png', 'cut' => true],
    'Nintendo - Super Nintendo Entertainment System' => ['file' => 'SNES-Model-2-Set.png'],
    'Nintendo - Virtual Boy'                         => ['file' => 'Virtual-Boy-Set.png'],
    'Nintendo - Wii'                                 => ['file' => 'Wii-Console.png'],
    'SNK - Neo Geo'                                  => ['file' => 'Neo-Geo-AES-FL.png'],
    'SNK - Neo Geo CD'                               => ['file' => 'Neo-Geo-CD-TL-FL.png'],
    'SNK - Neo Geo Pocket'                           => ['file' => 'Neo-Geo-Pocket-Anthra-Left.png'],
    'SNK - Neo Geo Pocket Color'                     => ['file' => 'Neo-Geo-Pocket-Color-Blue-Left.png'],
    'Sega - 32X'                                     => ['file' => 'Sega-Genesis-Model2-32X.png'],
    'Sega - Dreamcast'                               => ['file' => 'Sega-Dreamcast-Console-FL.png'],
    'Sega - Game Gear'                               => ['file' => 'Sega-Game-Gear-WB.png'],
    'Sega - Master System - Mark III'                => ['file' => 'Sega-Master-System-Set.png'],
    'Sega - Mega Drive - Genesis'                    => ['file' => 'Sega-Genesis-Mod1-Set.png'],
    'Sega - Mega-CD - Sega CD'                       => ['file' => 'Sega-CD-Model2-Set.png'],
    'Sega - Saturn'                                  => ['file' => 'Sega-Saturn-Console-Set-Mk1.png'],
    'Sony - PlayStation'                             => ['file' => 'PSX-Console-wController.png'],
    'Sony - PlayStation 2'                           => ['file' => 'PS2-Fat-Console-Set.png'],
    'Sony - PlayStation 3'                           => ['file' => 'PS3-slim-console.png'],
    'Sony - PlayStation Portable'                    => ['file' => 'PSP-2000-trans.png'],
    'Sony - PlayStation Vita'                        => ['file' => 'PlayStation-Vita-1101-FL.png'],
    'The 3DO Company - 3DO'                          => ['file' => '3DO-FZ-1-Console-FL.png'],
];

function ctx(): array
{
    // The certificates that come with this PHP, when php.ini names none.
    $ssl = ['verify_peer' => true, 'verify_peer_name' => true];
    $pem = dirname(PHP_BINARY) . DIRECTORY_SEPARATOR . 'cacert.pem';
    if ((string) ini_get('openssl.cafile') === '' && is_file($pem)) {
        $ssl['cafile'] = $pem;
    }
    // Wikimedia asks every program to say who it is.
    return ['http' => ['timeout' => 60, 'user_agent' => 'Xsegon console photo fetcher (tools/get-console-photos.php)',
                       'follow_location' => 1, 'ignore_errors' => true], 'ssl' => $ssl];
}

function fetch(string $url): string
{
    $body = @file_get_contents($url, false, stream_context_create(ctx()));
    // Every answer's headers, the last one's status line among them (a
    // redirect comes first); the function where this PHP has it.
    $headers = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : ($http_response_header ?? []);
    $statuses = array_values(array_filter($headers, static fn ($h) => str_starts_with((string) $h, 'HTTP/')));
    $status = $statuses && preg_match('#^HTTP/\S+ (\d+)#', (string) end($statuses), $m) ? (int) $m[1] : 0;
    if ($body === false || $status !== 200) {
        throw new RuntimeException($url . ' answered ' . ($status ?: 'nothing'));
    }
    return $body;
}

/**
 * Take out the near-white that touches the picture's edges: a flood from
 * every edge pixel through pixels lighter than CUT, made fully see-through,
 * then the pixels bordering it softened by how light they are, so the edge
 * of the console is not left with a white seam.
 */
function cut_white(GdImage $im): int
{
    $w = imagesx($im);
    $h = imagesy($im);
    $light = static function (int $c): int {
        return min(($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF);
    };
    $cut = 236;
    $seen = array_fill(0, $w * $h, false);
    $queue = new SplQueue();
    for ($x = 0; $x < $w; $x++) {
        $queue->enqueue([$x, 0]);
        $queue->enqueue([$x, $h - 1]);
    }
    for ($y = 0; $y < $h; $y++) {
        $queue->enqueue([0, $y]);
        $queue->enqueue([$w - 1, $y]);
    }
    $clear = imagecolorallocatealpha($im, 255, 255, 255, 127);
    $done = 0;
    while (!$queue->isEmpty()) {
        [$x, $y] = $queue->dequeue();
        $i = $y * $w + $x;
        if ($seen[$i]) {
            continue;
        }
        $seen[$i] = true;
        $c = imagecolorat($im, $x, $y);
        if ((($c >> 24) & 0x7F) === 127) {
            continue;                                       // already see-through
        }
        if ($light($c) < $cut) {
            continue;
        }
        imagesetpixel($im, $x, $y, $clear);
        $done++;
        foreach ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [$dx, $dy]) {
            $nx = $x + $dx;
            $ny = $y + $dy;
            if ($nx >= 0 && $ny >= 0 && $nx < $w && $ny < $h && !$seen[$ny * $w + $nx]) {
                $queue->enqueue([$nx, $ny]);
            }
        }
    }
    // The border: a pixel next to a cleared one, still light, keeps its
    // colour and loses some of its cover, the lighter the more.
    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $w; $x++) {
            $c = imagecolorat($im, $x, $y);
            if ((($c >> 24) & 0x7F) === 127 || $light($c) < 200) {
                continue;
            }
            $next = false;
            foreach ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [$dx, $dy]) {
                $nx = $x + $dx;
                $ny = $y + $dy;
                if ($nx >= 0 && $ny >= 0 && $nx < $w && $ny < $h && ((imagecolorat($im, $nx, $ny) >> 24) & 0x7F) === 127) {
                    $next = true;
                    break;
                }
            }
            if ($next) {
                $alpha = (int) round(($light($c) - 200) / ($cut - 200) * 100);
                imagesetpixel($im, $x, $y, imagecolorallocatealpha($im, ($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF, max(0, min(110, $alpha))));
            }
        }
    }
    return $done;
}

/**
 * No wider than MAX_W and no taller than MAX_H, see-through parts kept.
 * Commons hands out its own standard widths, so the last sizing is done here.
 */
function fit(GdImage $im): GdImage
{
    $w = imagesx($im);
    $h = imagesy($im);
    $scale = min(1, MAX_W / $w, MAX_H / $h);
    if ($scale >= 1) {
        return $im;
    }
    $nw = max(1, (int) round($w * $scale));
    $nh = max(1, (int) round($h * $scale));
    $out = imagecreatetruecolor($nw, $nh);
    imagealphablending($out, false);
    imagesavealpha($out, true);
    imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
    imagecopyresampled($out, $im, 0, 0, 0, 0, $nw, $nh, $w, $h);
    return $out;
}

if (!is_dir(OUT) && !mkdir(OUT, 0777, true)) {
    say('STOP: could not make ' . OUT);
    exit(1);
}

// What Commons says of every file, in one request: its licence, size and
// the original's SHA-1, which says later whether the file has changed there.
$titles = array_map(static fn ($p) => 'File:' . $p['file'], array_values(PHOTOS));
$meta = [];
foreach (array_chunk($titles, 50) as $chunk) {
    $q = json_decode(fetch(API . '?' . http_build_query([
        'action' => 'query', 'format' => 'json', 'formatversion' => '2', 'titles' => implode('|', $chunk),
        'prop' => 'imageinfo', 'iiprop' => 'size|sha1|extmetadata', 'iiextmetadatafilter' => 'LicenseShortName',
    ])), true);
    foreach ($q['query']['pages'] ?? [] as $page) {
        $ii = $page['imageinfo'][0] ?? null;
        $meta[$page['title']] = $ii === null ? null : [
            'width' => (int) $ii['width'], 'height' => (int) $ii['height'], 'sha1' => (string) $ii['sha1'],
            'licence' => (string) ($ii['extmetadata']['LicenseShortName']['value'] ?? ''),
        ];
    }
}

$files = [];
foreach (PHOTOS as $sys => $p) {
    $m = $meta[str_replace('_', ' ', 'File:' . $p['file'])] ?? null;
    if ($m === null) {
        say('STOP: ' . $p['file'] . ' is not on Commons (moved or deleted?)');
        exit(1);
    }
    if (!in_array($m['licence'], ['Public domain', 'CC0'], true)) {
        say('STOP: ' . $p['file'] . ' says "' . $m['licence'] . '" now, not Public domain or CC0');
        exit(1);
    }
    $width = (int) min(MAX_W, $m['width'], floor(MAX_H * $m['width'] / max(1, $m['height'])));
    usleep(1500000);
    $png = fetch('https://commons.wikimedia.org/wiki/Special:FilePath/' . rawurlencode($p['file']) . '?width=' . $width);
    $im = @imagecreatefromstring($png);
    if (!$im instanceof GdImage) {
        say('STOP: ' . $p['file'] . ' did not open as a picture');
        exit(1);
    }
    if (!imageistruecolor($im)) {
        imagepalettetotruecolor($im);
    }
    imagealphablending($im, false);
    imagesavealpha($im, true);
    // The white first, at the size Commons sent, then the sizing: the soft
    // edge it leaves is scaled down with the rest.
    $cut = !empty($p['cut']) ? cut_white($im) : 0;
    $im = fit($im);
    $out = OUT . DIRECTORY_SEPARATOR . $sys . '.webp';
    if (!imagewebp($im, $out, QUALITY)) {
        say('STOP: could not write ' . $out);
        exit(1);
    }
    $files[$sys . '.webp'] = [
        'commons' => $p['file'], 'licence' => $m['licence'], 'originalSha1' => $m['sha1'],
        'width' => imagesx($im), 'height' => imagesy($im),
        'sha256' => hash_file('sha256', $out), 'bytes' => filesize($out),
    ] + ($cut ? ['whiteCut' => true] : []);
    say(sprintf('  %-52s %4dx%-4d %6d bytes%s', $sys . '.webp', imagesx($im), imagesy($im), filesize($out), $cut ? '  (white taken out: ' . $cut . ' pixels)' : ''));
}

// The folder holds this run's files and nothing else.
$gone = [];
foreach (glob(OUT . DIRECTORY_SEPARATOR . '*.webp') ?: [] as $f) {
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
$total = array_sum(array_column($files, 'bytes'));
say(count($files) . ' console photos in img\\console-photos, ' . round($total / 1048576, 1) . ' MB' . ($gone ? '; taken out, from an earlier run: ' . implode(', ', $gone) : ''));
