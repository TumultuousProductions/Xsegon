<?php
/**
 * Your own sounds: one file per sound, chosen in Settings > Sound and copied
 * into data\sounds-own, which is then the sound set "Your own" (includes\sounds.php).
 *
 *   data\sounds-staged\Move.wav    a chosen file waiting for its length check
 *   data\sounds-own\Move.wav       the kept one
 *   data\sounds-own\sounds.json    where each came from and how long it is
 *
 * A file is checked here for what it is and by the page for how long it
 * plays. One too long is refused and the old sound stays. A sound left empty
 * plays the built-in set's (api\sound.php).
 *
 * Hover is not tied to the set: yours plays whatever set is chosen.
 */
declare(strict_types=1);

require_once __DIR__ . '/sounds.php';

// The longest each may play, in seconds; Move sounds on every step.
const XS_OWN_LIMITS = ['move' => 0.5, 'hover' => 1.0, 'select' => 1.0, 'back' => 1.0, 'ok' => 3.0];
const XS_OWN_NAMES = ['move' => 'Move', 'hover' => 'Hover', 'select' => 'Select', 'back' => 'Back', 'ok' => 'Ok'];
const XS_OWN_MAX_BYTES = 2097152;

/* A folder of its own, so a file still being checked is never a sound. */
function xs_own_stage_dir(): string
{
    return xs_data_path('sounds-staged');
}

function xs_own_meta(): array
{
    $m = xs_read_json(xs_own_dir() . DIRECTORY_SEPARATOR . 'sounds.json', []);
    return is_array($m) ? $m : [];
}

/** Every file of one sound in a folder, whatever its format. */
function xs_own_files(string $dir, string $name): array
{
    $out = [];
    foreach (array_keys(XS_SOUND_TYPES) as $ext) {
        $f = $dir . DIRECTORY_SEPARATOR . XS_OWN_NAMES[$name] . '.' . $ext;
        if (is_file($f)) {
            $out[] = $f;
        }
    }
    // Two formats standing (an old one something held as it was replaced): the newer first.
    if (count($out) > 1) {
        usort($out, static fn (string $a, string $b): int => (int) @filemtime($b) <=> (int) @filemtime($a));
    }
    return $out;
}

/** What the screen shows: the rules, and each sound's file or none. */
function xs_own_state(): array
{
    $meta = xs_own_meta();
    $sounds = [];
    foreach (XS_OWN_NAMES as $name => $label) {
        $file = xs_own_files(xs_own_dir(), $name)[0] ?? null;
        $sounds[$name] = $file === null ? null : [
            'file'    => basename($file),
            'from'    => (string) ($meta[$name]['from'] ?? ''),
            'seconds' => (float) ($meta[$name]['seconds'] ?? 0),
            'bytes'   => (int) filesize($file),
        ];
    }
    return ['set' => XS_OWN_SET, 'limits' => XS_OWN_LIMITS, 'labels' => XS_OWN_NAMES,
            'formats' => array_keys(XS_SOUND_TYPES), 'maxBytes' => XS_OWN_MAX_BYTES, 'sounds' => $sounds];
}

/** Why a file cannot be one of these, or null when it can (its length is the page's to measure). */
function xs_own_refusal(string $path): ?string
{
    if (!is_file($path)) {
        return 'there is no file at ' . $path;
    }
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (!isset(XS_SOUND_TYPES[$ext])) {
        return 'a .' . ($ext !== '' ? $ext : '(no extension)') . ' file: a sound has to be a .wav, an .ogg or an .mp3';
    }
    $bytes = (int) filesize($path);
    if ($bytes > XS_OWN_MAX_BYTES) {
        return round($bytes / 1048576, 1) . ' MB: a sound can be up to 2 MB';
    }
    if ($bytes < 44) {
        return 'the file is empty';
    }
    $head = (string) @file_get_contents($path, false, null, 0, 12);
    $ok = match ($ext) {
        'wav'   => substr($head, 0, 4) === 'RIFF' && substr($head, 8, 4) === 'WAVE',
        'ogg'   => substr($head, 0, 4) === 'OggS',
        'mp3'   => substr($head, 0, 3) === 'ID3' || (ord($head[0] ?? "\0") === 0xFF && (ord($head[1] ?? "\0") & 0xE0) === 0xE0),
        default => false,
    };
    return $ok ? null : 'it is named .' . $ext . ' but is not one inside';
}

/** Copy a chosen file in to wait for its length check. Returns the staged file, or null with $why. */
function xs_own_stage(string $name, string $path, ?string &$why = null): ?string
{
    $why = xs_own_refusal($path);
    if ($why !== null) {
        return null;
    }
    $dir = xs_own_stage_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        $why = 'the folder for checking it could not be made (' . xs_file_error_reason() . ')';
        return null;
    }
    foreach (xs_own_files($dir, $name) as $old) {
        @unlink($old);
    }
    $to = $dir . DIRECTORY_SEPARATOR . XS_OWN_NAMES[$name] . '.' . strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (!@copy($path, $to)) {
        $why = 'it could not be copied (' . xs_file_error_reason() . ')';
        return null;
    }
    return $to;
}

/** The staged file passed its length check: it becomes the sound, in place of any other format. */
function xs_own_keep(string $name, float $seconds, string $from, ?string &$why = null): bool
{
    $why = null;
    $staged = xs_own_files(xs_own_stage_dir(), $name)[0] ?? null;
    if ($staged === null) {
        $why = 'there is no file waiting to be kept: choose it again';
        return false;
    }
    // The page measured it; a measure past the limit is refused here as well.
    if (!($seconds > 0) || $seconds > XS_OWN_LIMITS[$name] + 0.02) {
        @unlink($staged);
        $why = round($seconds, 1) . ' seconds: ' . XS_OWN_NAMES[$name] . ' can be up to ' . XS_OWN_LIMITS[$name] . ' seconds';
        return false;
    }
    $dir = xs_own_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0777, true)) {
        $why = 'the Your own folder could not be made (' . xs_file_error_reason() . ')';
        return false;
    }
    $put = xs_put_file($staged, $dir . DIRECTORY_SEPARATOR . XS_OWN_NAMES[$name], strtolower((string) pathinfo($staged, PATHINFO_EXTENSION)),
                       array_keys(XS_SOUND_TYPES), $held);
    if ($put === null) {
        $why = 'it could not be moved into place (' . $held . '): the sound before it is still there';
        return false;
    }
    $meta = xs_own_meta();
    $meta[$name] = ['from' => $from, 'seconds' => round($seconds, 3), 'at' => date('c')];
    xs_write_json($dir . DIRECTORY_SEPARATOR . 'sounds.json', $meta);
    return true;
}

function xs_own_remove(string $name): bool
{
    $gone = false;
    foreach (xs_own_files(xs_own_dir(), $name) as $f) {
        $gone = @unlink($f) || $gone;
    }
    $meta = xs_own_meta();
    if (isset($meta[$name])) {
        unset($meta[$name]);
        xs_write_json(xs_own_dir() . DIRECTORY_SEPARATOR . 'sounds.json', $meta);
    }
    return $gone;
}
