<?php
/**
 * Xsegon - the sound packs.
 *
 *     data\sounds\<pack>\Move.wav          a pack in Xsegon's own folder
 *     data\sounds\<pack>\Back\BACK000.wav  a pack with variants per action
 *
 * A pack of your own is a folder you drop in here by hand: files named Move,
 * Select and Back (Ok is optional, Select stands in; Hover is optional, the
 * built-in one stands in; nothing plays Startup), each a .wav, .ogg or .mp3,
 * or a folder of variants per action.
 *
 * THE BUILT-IN SETS. Every folder in sounds\ ships with Xsegon (each one's
 * ABOUT.txt says whose its sounds are). They are looked at last, so a pack of
 * the same name in data\sounds wins, and are never copied or written.
 * sounds\Xsegon is the one a new copy starts on and the fallback (api\sound.php).
 *
 * sounds\Xsegon is Ovani Sound's set (its Hover is Xsegon's own clip) and
 * sounds\Xsegon 2 is Xsegon's own. Ovani's five files are in the download and
 * not in git (they may not be handed out on their own): a copy made from the
 * source plays Xsegon 2's in their place. No other sound ever ships:
 * tools\make-test-copy.js stops a package holding any sound it does not name.
 */
declare(strict_types=1);

require_once __DIR__ . '/settings.php';

/** Where Xsegon keeps its own packs. */
function xs_sounds_dir(): string
{
    return xs_data_path('sounds');
}

/** The built-in set a new copy starts on, and the folder holding every built-in set. */
const XS_SOUND_BUILTIN = 'Xsegon';

/* The set made of sounds you chose one by one (includes\ownsounds.php). Its
   own folder, not one inside data\sounds: that one may be a link to packs
   kept elsewhere, and what you chose is yours to back up. */
const XS_OWN_SET = 'Your own';

function xs_own_dir(): string
{
    return xs_data_path('sounds-own');
}

/**
 * The kinds of sound file a pack may hold, in the order a sound is looked
 * for, and what each is sent as. The browser plays all three.
 */
const XS_SOUND_TYPES = ['wav' => 'audio/wav', 'ogg' => 'audio/ogg', 'mp3' => 'audio/mpeg'];

function xs_sounds_builtin_dir(): string
{
    return XS_ROOT . DIRECTORY_SEPARATOR . 'sounds';
}

/** The default built-in set's own folder, or '' when this copy of Xsegon has none. */
function xs_sounds_builtin_pack(): string
{
    $dir = xs_sounds_builtin_dir() . DIRECTORY_SEPARATOR . XS_SOUND_BUILTIN;
    return is_dir($dir) ? $dir : '';
}

/** Xsegon's own built-in set, which every copy has, one made from the source included. */
const XS_SOUND_BUILTIN_OWN = 'Xsegon 2';

/** That set's folder, or '' when this copy of Xsegon has none. */
function xs_sounds_builtin_own_pack(): string
{
    $dir = xs_sounds_builtin_dir() . DIRECTORY_SEPARATOR . XS_SOUND_BUILTIN_OWN;
    return is_dir($dir) ? $dir : '';
}

/** Every built-in set, [name => folder]: "Xsegon" and "Xsegon 2". */
function xs_sounds_builtin_packs(): array
{
    $out = [];
    $root = xs_sounds_builtin_dir();
    foreach (@scandir($root) ?: [] as $e) {
        if ($e !== '.' && $e !== '..' && is_dir($root . DIRECTORY_SEPARATOR . $e)) {
            $out[$e] = $root . DIRECTORY_SEPARATOR . $e;
        }
    }
    return $out;
}

/**
 * A pack's file for one sound ('Move', 'Hover', 'Select', 'Back', 'Ok', 'Startup'), or ''
 * when the pack has none: Move.wav, else Move.ogg, else Move.mp3, else one
 * at random from a folder of variants (Back\BACK000.wav and the like).
 * $random says it was a pick.
 */
function xs_sound_file(string $dir, string $sound, ?bool &$random = null): string
{
    $random = false;
    $file = xs_slot_file($dir . DIRECTORY_SEPARATOR . $sound, array_keys(XS_SOUND_TYPES));
    if ($file !== null) {
        return $file;
    }
    $sub = $dir . DIRECTORY_SEPARATOR . $sound;
    if (is_dir($sub)) {
        $variants = [];
        foreach (@scandir($sub) ?: [] as $e) {
            if (isset(XS_SOUND_TYPES[strtolower(pathinfo($e, PATHINFO_EXTENSION))]) && is_file($sub . DIRECTORY_SEPARATOR . $e)) {
                $variants[] = $sub . DIRECTORY_SEPARATOR . $e;
            }
        }
        if ($variants) {
            $random = true;
            return $variants[array_rand($variants)];
        }
    }
    return '';
}

/**
 * Every pack Xsegon can play, by name, with the folder to read it from.
 * Xsegon's own first, so a pack of the same name as a built-in set shadows it
 * rather than being listed twice.
 */
function xs_sound_pack_dirs(?array $s = null): array
{
    $out = [];
    if (is_dir(xs_own_dir())) {
        $out[XS_OWN_SET] = xs_own_dir();
    }
    foreach ([xs_sounds_dir(), xs_sounds_builtin_dir()] as $root) {
        foreach ($root !== '' ? (@scandir($root) ?: []) : [] as $e) {   // scandir('') throws, @ or not
            if ($e === '.' || $e === '..' || isset($out[$e])) {
                continue;
            }
            if (is_dir($root . DIRECTORY_SEPARATOR . $e)) {
                $out[$e] = $root . DIRECTORY_SEPARATOR . $e;
            }
        }
    }
    ksort($out, SORT_NATURAL | SORT_FLAG_CASE);
    return $out;
}

/** Which packs are Xsegon's own, for the screen to say so. */
function xs_sound_packs_own(): array
{
    $out = [];
    foreach (@scandir(xs_sounds_dir()) ?: [] as $e) {
        if ($e !== '.' && $e !== '..' && is_dir(xs_sounds_dir() . DIRECTORY_SEPARATOR . $e)) {
            $out[] = $e;
        }
    }
    sort($out, SORT_NATURAL | SORT_FLAG_CASE);
    return $out;
}

/** Files and bytes under a folder, sound files only. */
function xs_sounds_weigh(string $dir): array
{
    $files = 0;
    $bytes = 0;
    foreach (xs_sounds_walk($dir) as $rel => $path) {
        $files++;
        $bytes += (int) filesize($path);
    }
    return ['files' => $files, 'bytes' => $bytes];
}

/** [relative path => absolute path] for every sound file (XS_SOUND_TYPES) under a pack. */
function xs_sounds_walk(string $dir): array
{
    $out = [];
    if (!is_dir($dir)) {
        return $out;
    }
    $it = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($it as $file) {
        if (!$file->isFile() || !isset(XS_SOUND_TYPES[strtolower($file->getExtension())])) {
            continue;
        }
        $rel = substr($file->getPathname(), strlen($dir) + 1);
        $out[$rel] = $file->getPathname();
    }
    return $out;
}
