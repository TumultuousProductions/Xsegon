<?php
/**
 * Xsegon - which core a game runs on, kept as an overlay.
 *
 * A game's core comes from its (emulator, platform) pair's -L "cores\x_libretro.dll".
 * A different core for one game lives in data\cores.json by game id, applied at launch;
 * nothing else is written.
 *
 * Not in overrides.json: that marks a game edited, and a core is a launch setting. An
 * entry naming a core the platform no longer offers is ignored, so a stale file is harmless.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/** Where the choices live. */
function xs_cores_path(): string
{
    return xs_data_path('cores.json');
}

/** Every choice, as [game id => core name]. */
function xs_cores_read(): array
{
    $raw = xs_read_json(xs_cores_path(), []);
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $id => $core) {
        if (is_string($id) && is_string($core) && $id !== '' && $core !== '') {
            $out[$id] = $core;
        }
    }
    return $out;
}

/** The core chosen for one game, or null when the console's usual core stands. */
function xs_core_for(string $id): ?string
{
    return xs_cores_read()[$id] ?? null;
}

/**
 * Remember a choice, or forget it when $core is null. Returns false only if
 * the file could not be written.
 */
function xs_core_set(string $id, ?string $core, ?string &$why = null): bool
{
    $all = xs_cores_read();
    if ($core === null || $core === '') {
        unset($all[$id]);
    } else {
        $all[$id] = $core;
    }
    return xs_write_json(xs_cores_path(), $all, $why);
}

/**
 * Apply a game's chosen core to its launch command: [launch, core or null]. Only the -L
 * value is replaced, as the same line can carry other settings, such as a shader.
 */
function xs_core_apply(array $launch, string $id, string $platform, string $lbRoot): array
{
    $want = xs_core_for($id);
    if ($want === null || ($launch['kind'] ?? '') !== 'retroarch') {
        return [$launch, null];
    }
    /* The emulator table is read only here, for that core's -L; a launch with no core
       chosen reads nothing. $lbRoot is only a fallback for a table never seeded. */
    require_once __DIR__ . '/emulators.php';
    $choices = xs_emu_cores(xs_emulators($lbRoot), $platform);
    foreach ($choices as $c) {
        if ($c['core'] === $want) {
            $before = lb_core_load($launch['args'] ?? '');
            if ($before !== null && lb_core_name($before) === $want) {
                return [$launch, $want];          // already the core it wanted
            }
            $launch['args'] = lb_swap_core((string) $launch['args'], $c['load']);
            $launch['via']  = $c['emulator'] . ' (' . $want . ', your choice)';
            return [$launch, $want];
        }
    }
    // A core the platform no longer offers: launching the default beats refusing.
    xs_log('CORE', 'ignored ' . $want . ' for ' . $id . ': not configured for ' . $platform);
    return [$launch, null];
}
