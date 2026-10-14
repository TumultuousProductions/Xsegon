<?php
/**
 * GET /api/sound.php?name=move
 *
 * A pack in Xsegon's own folder (data\sounds), else a built-in set (sounds\).
 * Which set is a setting (sound.soundSet), and whether they play at all is
 * another (sound.sounds), checked by the front end rather than here.
 *
 * A set that is NOT ON THIS PC is answered with the built-in one
 * (sounds\Xsegon, includes\sounds.php), and the log says so. A set that is
 * here answers only with itself: a sound it lacks stays silent.
 *
 * A sound may be a .wav, an .ogg or an .mp3.
 *
 * HOVER (js\sound.js): yours under every set (includes\ownsounds.php), else
 * the set's own, else the built-in set's, the one sound a set borrows. With
 * none, &or=move (the Shelf) plays the set's Move.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/sounds.php';

$known = ['move' => 'Move', 'hover' => 'Hover', 'select' => 'Select', 'back' => 'Back', 'startup' => 'Startup', 'ok' => 'Ok'];
$name  = strtolower(trim((string) ($_GET['name'] ?? '')));

if (!isset($known[$name])) {
    http_response_code(404);
    exit;
}

$s   = xs_settings();
// ?set= names the set outright: a set can be auditioned BEFORE it is saved,
// and with the set in the URL a switch never plays a cached old sound. The
// same character filter and realpath guard apply as to the stored value.
$asked = (string) ($_GET['set'] ?? '');
$set = preg_replace('/[^A-Za-z0-9 _-]/', '', $asked !== '' ? $asked : (string) $s['sound']['soundSet']) ?: XS_SOUND_BUILTIN;
$random = false;
// Xsegon's own pack of that name, else the built-in set.
$dirs = xs_sound_pack_dirs($s);
$standIn = false;
$dir = $dirs[$set] ?? '';
if ($dir === '') {
    $dir = xs_sounds_builtin_pack();
    $standIn = true;
    // Said in the log, since a person hearing the wrong set would look there.
    xs_log('SND', 'the sound set "' . $set . '" is not on this PC: '
        . ($dir !== '' ? 'the built-in set plays ' . $known[$name] . ' instead' : 'and there is no built-in set, so ' . $known[$name] . ' is silent'));
}
if ($dir === '') {
    http_response_code(404);
    exit;
}

// Your own Hover first, whatever the set.
$file = $name === 'hover' ? xs_sound_file(xs_own_dir(), 'Hover', $random) : '';

// Move.wav, .ogg or .mp3, or a random one of a folder of variants.
if ($file === '') {
    $file = xs_sound_file($dir, $known[$name], $random);
}

// Ok is how a finished fetch sounds; a pack with no Ok file plays its Select.
if ($file === '' && $name === 'ok') {
    $file = xs_sound_file($dir, 'Select', $random);
}

// Your own sounds fill only what you chose; the rest is the built-in set's.
$fill = $dir === xs_own_dir() ? xs_sounds_builtin_pack() : '';
if ($file === '' && $fill !== '') {
    $file = xs_sound_file($fill, $known[$name], $random);
}

// A copy made from the source has the built-in set without its licensed sounds: the other built-in set plays.
$builtin = xs_sounds_builtin_pack();
$spare = xs_sounds_builtin_own_pack();
$spared = false;
if ($file === '' && $spare !== '' && $builtin !== '' && ($dir === $builtin || $fill === $builtin)) {
    $file = xs_sound_file($spare, $known[$name], $random);
    $spared = $file !== '';
    if ($spared) {
        xs_log('SND', 'the built-in set has no ' . $known[$name] . ' in this copy (one made from the source): ' . XS_SOUND_BUILTIN_OWN . "'s plays");
    }
}

// Hover is Xsegon's own sound, so a set with none plays the built-in one.
if ($file === '' && $name === 'hover' && xs_sounds_builtin_pack() !== '') {
    $file = xs_sound_file(xs_sounds_builtin_pack(), 'Hover', $random);
}

// No Hover anywhere (a copy with no built-in set): silent, but where Move is asked for in its place.
if ($file === '' && $name === 'hover' && ($_GET['or'] ?? '') === 'move') {
    $file = xs_sound_file($dir, 'Move', $random);
    if ($file === '' && $fill !== '') {
        $file = xs_sound_file($fill, 'Move', $random);
    }
}

if ($file === '') {
    http_response_code(404);
    exit;
}

// The same guard as ever, over three roots: a name can only ever reach inside
// Xsegon's own sounds folder, the built-in sets', or your own sounds'.
$real  = realpath($file);
$roots = array_filter([realpath(xs_sounds_dir()), realpath(xs_sounds_builtin_dir()), realpath(xs_own_dir())]);
$inside = false;
foreach ($roots as $root) {
    if ($real !== false && xs_inside($real, $root)) {
        $inside = true;
        break;
    }
}
if (!$inside) {
    http_response_code(403);
    exit;
}

// Which set really answered, for the tests and anyone reading the network tab.
header('X-Xsegon-Sound-Set: ' . ($spared ? XS_SOUND_BUILTIN_OWN : ($standIn ? XS_SOUND_BUILTIN : $set)));
/* A random variant must not be cached, or "random" means "the first one".
   Anything else is asked about again on each page load (a 304 when it is the
   same file), so a sound changed under the same name is heard at once. */
if ($random) {
    header('Cache-Control: no-store');
} else {
    $tag = '"' . substr(sha1($real . '|' . filesize($real) . '|' . filemtime($real)), 0, 16) . '"';
    header('Cache-Control: private, no-cache');
    header('ETag: ' . $tag);
    if (trim((string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '')) === $tag) {
        http_response_code(304);
        exit;
    }
}
header('Content-Type: ' . XS_SOUND_TYPES[strtolower(pathinfo($real, PATHINFO_EXTENSION))]);
header('Content-Length: ' . filesize($real));
readfile($real);
