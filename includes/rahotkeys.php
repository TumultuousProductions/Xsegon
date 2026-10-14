<?php
/**
 * RetroArch's hotkeys, read only: the presses that leave a game, pause it or
 * save it. They are in retroarch.cfg as input_<hotkey> (a keyboard key),
 * input_<hotkey>_btn (a pad button), input_<hotkey>_axis (a stick or
 * trigger), and two "controller combo" numbers for the menu and for quit.
 *
 * The file is RetroArch's and is read as a guest (doc\RULES.md rule 1).
 * Each row carries the name RetroArch gives it in Settings > Input > Hotkeys,
 * where it is changed.
 *
 * A per-core or per-game override (config\<Core>\<Core>.cfg and
 * config\<Core>\<game>.cfg) wins over retroarch.cfg, as it does in
 * RetroArch, and a row that came from one says which file.
 */
declare(strict_types=1);

/**
 * hotkey => [our words, RetroArch's own name in Settings > Input > Hotkeys, group].
 * The names are RetroArch 1.22.2's own Hotkeys page (after Next Cheat Index, from its source).
 */
function xs_ra_hotkey_table(): array
{
    return [
        // leaving and pausing: always listed, set or not
        'menu_toggle'         => ['Open RetroArch\'s menu', 'Menu Toggle', 'leave'],
        'exit_emulator'       => ['Quit the game', 'Quit', 'leave'],
        'close_content'       => ['Close the game, stay in RetroArch', 'Close Content', 'leave'],
        'pause_toggle'        => ['Pause', 'Pause', 'leave'],
        'enable_hotkey'       => ['Hotkey Enable', 'Hotkey Enable', 'leave'],
        // the rest: listed when set
        'save_state'          => ['Save state', 'Save State', 'other'],
        'load_state'          => ['Load state', 'Load State', 'other'],
        'state_slot_increase' => ['Next save slot', 'Next Save State Slot', 'other'],
        'state_slot_decrease' => ['Previous save slot', 'Previous Save State Slot', 'other'],
        'toggle_fast_forward' => ['Fast forward (turbo speed), on and off', 'Fast-Forward (Toggle)', 'other'],
        'hold_fast_forward'   => ['Fast forward (turbo speed) while held', 'Fast-Forward (Hold)', 'other'],
        'turbo_fire_toggle'   => ['Turbo fire, on and off', 'Turbo Fire (Toggle)', 'other'],
        'rewind'              => ['Rewind', 'Rewind', 'other'],
        'toggle_slowmotion'   => ['Slow motion, on and off', 'Slow-Motion (Toggle)', 'other'],
        'hold_slowmotion'     => ['Slow motion while held', 'Slow-Motion (Hold)', 'other'],
        'frame_advance'       => ['One frame forward', 'Frame Advance', 'other'],
        'reset'               => ['Restart the game', 'Reset Content', 'other'],
        'screenshot'          => ['Take a screenshot', 'Take Screenshot', 'other'],
        'toggle_fullscreen'   => ['Full screen, on and off', 'Fullscreen (Toggle)', 'other'],
        'audio_mute'          => ['Mute', 'Audio Mute', 'other'],
        'volume_up'           => ['Volume up', 'Volume Up', 'other'],
        'volume_down'         => ['Volume down', 'Volume Down', 'other'],
        'disk_eject_toggle'   => ['Eject or insert the disc', 'Disc Eject (Toggle)', 'other'],
        'disk_next'           => ['Next disc', 'Next Disc', 'other'],
        'disk_prev'           => ['Previous disc', 'Previous Disc', 'other'],
        'cheat_toggle'        => ['Cheats, on and off', 'Cheats (Toggle)', 'other'],
        'cheat_index_plus'    => ['Next cheat', 'Next Cheat Index', 'other'],
        'cheat_index_minus'   => ['Previous cheat', 'Previous Cheat Index', 'other'],
        'shader_toggle'       => ['Shaders, on and off', 'Shaders (Toggle)', 'other'],
        'shader_next'         => ['Next shader', 'Next Shader', 'other'],
        'shader_prev'         => ['Previous shader', 'Previous Shader', 'other'],
        'grab_mouse_toggle'   => ['Keep the mouse inside the game', 'Mouse Grab (Toggle)', 'other'],
        'netplay_game_watch'  => ['Netplay: play or watch', 'Netplay Toggle Play/Spectate', 'other'],
        'netplay_player_chat' => ['Netplay: chat', 'Netplay Player Chat', 'other'],
        'fps_toggle'          => ['Show the frame rate', 'Show FPS (Toggle)', 'other'],
        'game_focus_toggle'   => ['Game focus (the keyboard goes to the game only)', 'Game Focus (Toggle)', 'other'],
        'desktop_menu_toggle' => ['RetroArch\'s desktop menu', 'Desktop Menu (Toggle)', 'other'],
        // no key as RetroArch comes; here so a key you give one is kept off the buttons
        'play_replay'         => ['Replay: play', 'Play Replay', 'other'],
        'record_replay'       => ['Replay: record', 'Record Replay', 'other'],
        'halt_replay'         => ['Replay: stop', 'Halt Record/Replay', 'other'],
        'save_replay_checkpoint' => ['Replay: save a checkpoint', 'Save Replay Checkpoint', 'other'],
        'prev_replay_checkpoint' => ['Replay: previous checkpoint', 'Prev Replay Checkpoint', 'other'],
        'next_replay_checkpoint' => ['Replay: next checkpoint', 'Next Replay Checkpoint', 'other'],
        'replay_slot_increase'   => ['Next replay slot', 'Next Replay Slot', 'other'],
        'replay_slot_decrease'   => ['Previous replay slot', 'Previous Replay Slot', 'other'],
        'shader_hold'         => ['Shaders while held', 'Shaders (Hold)', 'other'],
        'recording_toggle'    => ['Recording, on and off', 'Recording (Toggle)', 'other'],
        'streaming_toggle'    => ['Streaming, on and off', 'Streaming (Toggle)', 'other'],
        'toggle_vrr_runloop'  => ['Sync to the game\'s exact frame rate, on and off', 'Sync to Exact Content Framerate (Toggle)', 'other'],
        'runahead_toggle'     => ['Run-ahead, on and off', 'Run-Ahead (Toggle)', 'other'],
        'preempt_toggle'      => ['Preemptive frames, on and off', 'Preemptive Frames (Toggle)', 'other'],
        'toggle_statistics'   => ['Show technical statistics', 'Show Technical Statistics (Toggle)', 'other'],
        'ai_service'          => ['AI service', 'AI Service', 'other'],
        'netplay_ping_toggle' => ['Netplay: show the ping', 'Netplay Ping (Toggle)', 'other'],
        'netplay_host_toggle' => ['Netplay: host, on and off', 'Netplay Hosting (Toggle)', 'other'],
        'netplay_fade_chat_toggle' => ['Netplay: fade the chat', 'Netplay Fade Chat (Toggle)', 'other'],
        'overlay_next'        => ['Next overlay', 'Next Overlay', 'other'],
        'osk_toggle'          => ['On-screen keyboard', 'Keyboard Overlay (Toggle)', 'other'],
    ];
}

/**
 * RetroArch's own key for each hotkey when its settings file does not say
 * (config.def.keybinds.h, v1.22.2): a file with no line for one means this
 * key, not none. Hotkeys not listed here come with no key.
 */
const XS_RA_HOTKEY_DEFAULTS = [
    'menu_toggle' => 'f1', 'exit_emulator' => 'escape', 'pause_toggle' => 'p', 'reset' => 'h',
    'toggle_fast_forward' => 'space', 'hold_fast_forward' => 'l', 'hold_slowmotion' => 'e',
    'rewind' => 'r', 'frame_advance' => 'k', 'audio_mute' => 'f9', 'volume_up' => 'add', 'volume_down' => 'subtract',
    'load_state' => 'f4', 'save_state' => 'f2', 'state_slot_increase' => 'f7', 'state_slot_decrease' => 'f6',
    'shader_toggle' => 'comma', 'shader_next' => 'm', 'shader_prev' => 'n',
    'cheat_toggle' => 'u', 'cheat_index_plus' => 'y', 'cheat_index_minus' => 't',
    'screenshot' => 'f8', 'grab_mouse_toggle' => 'f11', 'game_focus_toggle' => 'scroll_lock',
    'toggle_fullscreen' => 'f', 'desktop_menu_toggle' => 'f5', 'fps_toggle' => 'f3',
    'netplay_game_watch' => 'i', 'netplay_player_chat' => 'tilde',
];

/** The key on one hotkey as RetroArch will use it: its settings file's, else its own default. $keys as read (xs_ra_read_keys). */
function xs_ra_hotkey_key(array $keys, string $id): string
{
    return (string) ($keys['input_' . $id] ?? XS_RA_HOTKEY_DEFAULTS[$id] ?? '');
}

/** RetroArch's controller combos, by the number its settings file keeps (input/input_defines.h, v1.22.2). */
function xs_ra_combo_words(string $n): ?string
{
    $words = [
        '1' => 'D-pad down + Y + L1 + R1', '2' => 'both sticks pressed in (L3 + R3)',
        '3' => 'L1 + R1 + Start + Select', '4' => 'Start + Select', '5' => 'L3 + R1', '6' => 'L1 + R1',
        '7' => 'Start held for two seconds', '8' => 'Select held for two seconds',
        '9' => 'D-pad down + Select', '10' => 'L2 + R2',
    ];
    return $words[$n] ?? null;
}

/** A key name as RetroArch writes it, as a person says it. '' for none. */
function xs_ra_key_words(string $k): string
{
    $k = trim($k);
    if ($k === '' || $k === 'nul') {
        return '';
    }
    $named = ['escape' => 'Esc', 'space' => 'Space', 'enter' => 'Enter', 'tab' => 'Tab', 'backspace' => 'Backspace',
              'comma' => ',', 'period' => '.', 'add' => 'Numpad +', 'subtract' => 'Numpad -', 'multiply' => 'Numpad *',
              'divide' => 'Numpad /', 'scroll_lock' => 'Scroll Lock', 'print_screen' => 'Print Screen', 'pause' => 'Pause',
              'tilde' => '~', 'backquote' => '`', 'pageup' => 'Page Up', 'pagedown' => 'Page Down',
              'up' => 'Up', 'down' => 'Down', 'left' => 'Left', 'right' => 'Right',
              'rshift' => 'Right Shift', 'shift' => 'Shift', 'rctrl' => 'Right Ctrl', 'ctrl' => 'Ctrl', 'alt' => 'Alt', 'ralt' => 'Right Alt'];
    if (isset($named[$k])) {
        return $named[$k];
    }
    if (preg_match('/^f\d{1,2}$/', $k) || strlen($k) === 1) {
        return strtoupper($k);
    }
    // num0 to num9 are the row above the letters, keypad0 to keypad9 the number pad (RetroArch's key map).
    if (preg_match('/^num(\d)$/', $k, $m)) {
        return $m[1];
    }
    if (preg_match('/^keypad(\d)$/', $k, $m)) {
        return 'Numpad ' . $m[1];
    }
    $more = ['kp_enter' => 'Numpad Enter', 'kp_period' => 'Numpad .', 'insert' => 'Insert', 'del' => 'Delete', 'home' => 'Home',
             'end' => 'End', 'minus' => '-', 'equals' => '=', 'leftbracket' => '[', 'rightbracket' => ']', 'backslash' => '\\',
             'semicolon' => ';', 'quote' => '\'', 'slash' => '/', 'capslock' => 'Caps Lock'];
    if (isset($more[$k])) {
        return $more[$k];
    }
    return $k;
}

/** What each raw button number means under the sdl2 driver, in an Xbox pad's words (RetroArch's own Xbox profile in autoconfig\sdl2 agrees). */
function xs_ra_sdl2_names(): array
{
    return ['A', 'B', 'X', 'Y', 'View', 'the Xbox button', 'Menu', 'left stick pressed in (L3)', 'right stick pressed in (R3)',
            'LB', 'RB', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];
}

/**
 * A pad button as the settings file keeps it, as a person says it. The file
 * keeps a NUMBER, and what a number means belongs to the joypad driver: under
 * sdl2 the numbers are SDL's own for a standard pad (RetroArch's own Xbox
 * profile in autoconfig\sdl2 agrees: L is 9, the Guide button 5), so those
 * are named, in an Xbox pad's words. Any other driver gets the bare number.
 */
function xs_ra_button_words(string $b, string $driver): string
{
    $b = trim($b);
    if ($b === '' || $b === 'nul') {
        return '';
    }
    if (preg_match('/^h(\d+)(up|down|left|right)$/', $b, $m)) {
        return 'D-pad ' . $m[2];
    }
    $sdl = xs_ra_sdl2_names();
    if ($driver === 'sdl2' && ctype_digit($b) && isset($sdl[(int) $b])) {
        return 'pad button ' . $b . ' (' . $sdl[(int) $b] . ' on an Xbox pad)';
    }
    return 'pad button ' . $b;
}

/** Every key = "value" line of one RetroArch settings file that this page reads, or [] when it will not open. */
function xs_ra_read_keys(string $file): array
{
    $out = [];
    foreach (@file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (preg_match('/^\s*(input_[a-z0-9_]+|quit_press_twice|menu_pause_libretro)\s*=\s*"(.*)"\s*$/', $line, $m)) {
            $out[$m[1]] = $m[2];
        }
    }
    return $out;
}

/**
 * The hotkeys as RetroArch will use them: retroarch.cfg, then each override
 * file in turn on top of it (core first, then game).
 *
 * Answer: driver, where (the page in RetroArch), leave (always listed) and
 * other (only those that are set), each row {id, name, ra, value, set,
 * note?, from?}, and unset: how many of the others are not set.
 */
function xs_ra_hotkeys(string $cfg, array $overrides = []): array
{
    $keys = xs_ra_read_keys($cfg);
    $from = [];
    foreach ($overrides as $file) {
        foreach (xs_ra_read_keys((string) $file) as $k => $v) {
            if (!array_key_exists($k, $keys) || $keys[$k] !== $v) {
                $from[$k] = basename((string) $file);
            }
            $keys[$k] = $v;
        }
    }
    $driver = strtolower((string) ($keys['input_joypad_driver'] ?? ''));
    $twice  = ($keys['quit_press_twice'] ?? 'false') === 'true';
    $pauses = ($keys['menu_pause_libretro'] ?? 'true') === 'true';
    $combos = ['menu_toggle' => 'input_menu_toggle_gamepad_combo', 'exit_emulator' => 'input_quit_gamepad_combo'];

    $leave = [];
    $other = [];
    $unset = 0;
    foreach (xs_ra_hotkey_table() as $id => [$name, $ra, $group]) {
        $parts = [];
        $src = null;
        $kb = xs_ra_key_words(xs_ra_hotkey_key($keys, $id));
        if ($kb !== '') {
            $parts[] = $kb . ($id === 'exit_emulator' && $twice ? ', pressed twice' : '');
            $src = $from['input_' . $id] ?? $src;
        }
        $btn = xs_ra_button_words((string) ($keys['input_' . $id . '_btn'] ?? ''), $driver);
        if ($btn !== '') {
            $parts[] = $btn;
            $src = $from['input_' . $id . '_btn'] ?? $src;
        }
        $axis = trim((string) ($keys['input_' . $id . '_axis'] ?? ''));
        if ($axis !== '' && $axis !== 'nul') {
            $parts[] = 'pad axis ' . $axis;
            $src = $from['input_' . $id . '_axis'] ?? $src;
        }
        if (isset($combos[$id])) {
            $combo = xs_ra_combo_words((string) ($keys[$combos[$id]] ?? '0'));
            if ($combo !== null) {
                $parts[] = $combo;
                $src = $from[$combos[$id]] ?? $src;
            }
        }
        $row = ['id' => $id, 'name' => $name, 'ra' => $ra, 'set' => $parts !== [],
                'value' => $parts !== [] ? implode(', or ', $parts) : 'not set'];
        if ($src !== null) {
            $row['from'] = $src;
        }
        if ($id === 'menu_toggle' && $pauses) {
            $row['note'] = 'The game is paused while the menu is open.';
        }
        if ($id === 'enable_hotkey' && $parts !== []) {
            $row['note'] = 'While this is set, the other hotkeys only answer with it held.';
        }
        if ($group === 'leave') {
            $leave[] = $row;
        } elseif ($parts !== []) {
            $other[] = $row;
        } else {
            $unset++;
        }
    }
    return ['driver' => $driver, 'where' => 'Settings > Input > Hotkeys', 'file' => $cfg,
            'leave' => $leave, 'other' => $other, 'unset' => $unset,
            'turbo' => xs_ra_turbo($keys, $driver)];
}

/**
 * Turbo fire (a button that presses itself over and over while held), which
 * is not a hotkey and lives on two other pages of RetroArch's: Settings >
 * Input > Turbo Fire for the switch, the mode and the speed, and Port 1
 * Controls for the Turbo button itself. Three rows, in the shape of the
 * hotkey rows, each with the page it is changed on (RetroArch 1.22.2's words).
 */
function xs_ra_turbo(array $keys, string $driver): array
{
    $on   = ($keys['input_turbo_enable'] ?? 'true') === 'true';
    $mode = (string) ($keys['input_turbo_mode'] ?? '0');
    $modes = ['0' => 'Classic', '1' => 'Classic (Toggle)', '2' => 'Single Button (Toggle)', '3' => 'Single Button (Hold)'];
    $classic = $mode === '0' || $mode === '1';
    $page = 'Settings > Input > Turbo Fire';

    // The button that turns it on: one bind for every port when Turbo Bind is
    // set, or else port 1's own Turbo (RetroArch: "Empty uses the port-specific bind").
    $pad = ['B', 'Y', 'Select', 'Start', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right', 'A', 'X', 'L', 'R', 'L2', 'R2', 'L3', 'R3'];
    $bind = (string) ($keys['input_turbo_bind'] ?? '-1');
    $parts = [];
    if (ctype_digit($bind) && isset($pad[(int) $bind])) {
        $parts[] = 'the console\'s ' . $pad[(int) $bind] . ' button';
    }
    $kb = xs_ra_key_words((string) ($keys['input_player1_turbo'] ?? ''));
    if ($kb !== '') {
        $parts[] = $kb;
    }
    $btn = xs_ra_button_words((string) ($keys['input_player1_turbo_btn'] ?? ''), $driver);
    if ($btn !== '') {
        $parts[] = $btn;
    }
    $axis = trim((string) ($keys['input_player1_turbo_axis'] ?? ''));
    if ($axis !== '' && $axis !== 'nul') {
        $parts[] = 'pad axis ' . $axis;
    }

    $period = (int) ($keys['input_turbo_period'] ?? 6);
    $duty   = (int) ($keys['input_turbo_duty_cycle'] ?? 0);
    $rows = [
        ['id' => 'turbo_enable', 'name' => 'Turbo fire', 'ra' => 'Turbo Fire, Turbo Mode', 'page' => $page, 'set' => $on,
         'value' => $on ? 'on, ' . ($modes[$mode] ?? 'mode ' . $mode) : 'off',
         'note' => $classic ? 'Hold the Turbo button and a button: that button presses itself over and over.'
                            : 'One button presses itself over and over, without a second button held.'],
        ['id' => 'turbo_button', 'name' => 'Turbo button', 'ra' => 'Turbo', 'set' => $parts !== [],
         'page' => ctype_digit($bind) ? $page : 'Settings > Input > RetroPad Binds > Port 1 Controls',
         'value' => $parts !== [] ? implode(', or ', $parts) : 'not set'],
        ['id' => 'turbo_speed', 'name' => 'Turbo speed', 'ra' => 'Turbo Period, Turbo Duty Cycle', 'page' => $page, 'set' => $on,
         'value' => 'a press every ' . $period . ' frames, ' . ($duty > 0 ? 'held for ' . $duty : 'held for half of them')],
    ];
    if ($on && $parts === []) {
        $rows[1]['note'] = 'Turbo fire is on, but with no Turbo button nothing fires.';
    }
    return $rows;
}

/* ---- leaving and pausing, your choice ---------------------------------------
 * The menu and quit rows can carry a choice of yours, kept in
 * data\ra-hotkeys.json (api\ra-hotkeys.php) and handed to RetroArch per launch
 * through --appendconfig. Unset says nothing. config_save_on_exit goes off for
 * the run, so an appended value is never saved into RetroArch's file.
 */

/** The two rows a choice can sit on, and the setting RetroArch keeps each in. */
const XS_RA_CHOICE_SLOTS = ['menu' => 'input_menu_toggle_gamepad_combo', 'quit' => 'input_quit_gamepad_combo'];

/**
 * Is this one choice RetroArch can take? {kind: combo, combo: 1..10} on
 * either row; {kind: button, btn: 0..14} on the menu row only, since quit
 * has no single-button setting of its own, only the combo and the key.
 */
function xs_ra_choice_valid($c, string $slot, ?string &$why = null): bool
{
    if (!is_array($c) || !isset($c['kind'])) {
        $why = 'a choice needs a kind: combo or button';
        return false;
    }
    if ($c['kind'] === 'combo') {
        $n = $c['combo'] ?? null;
        if (!is_int($n) || xs_ra_combo_words((string) $n) === null) {
            $why = 'not one of RetroArch\'s controller combos';
            return false;
        }
        return true;
    }
    if ($c['kind'] === 'button') {
        if ($slot !== 'menu') {
            $why = 'only the menu can sit on a single button: RetroArch quits by a combo or a key';
            return false;
        }
        $n = $c['btn'] ?? null;
        if (!is_int($n) || !isset(xs_ra_sdl2_names()[$n])) {
            $why = 'not a pad button number the sdl2 driver is known to use';
            return false;
        }
        return true;
    }
    $why = 'kind must be combo or button';
    return false;
}

/** Your menu and quit choices as kept, any invalid one dropped: [] when none. */
function xs_ra_choices(): array
{
    $all = xs_read_json(xs_data_path('ra-hotkeys.json'), []);
    $out = [];
    foreach (array_keys(XS_RA_CHOICE_SLOTS) as $slot) {
        $c = is_array($all) ? ($all[$slot] ?? null) : null;
        if (is_array($c) && xs_ra_choice_valid($c, $slot)) {
            $out[$slot] = $c;
        }
    }
    return $out;
}

/** One choice in a person's words: "Start + Select", "the Xbox button". */
function xs_ra_choice_words(array $c): string
{
    if (($c['kind'] ?? '') === 'combo') {
        return (string) xs_ra_combo_words((string) $c['combo']);
    }
    return xs_ra_sdl2_names()[(int) ($c['btn'] ?? -1)] ?? ('pad button ' . (string) ($c['btn'] ?? '?'));
}

/**
 * What --appendconfig tells RetroArch for this run: the combo settings as
 * they are, and the menu button only under the sdl2 driver, where its raw
 * number is known. A single menu button works only with Hotkey Enable freed,
 * so input_enable_hotkey_btn goes to nul with it. Answers lines, said (for
 * the log) and skipped (why a part was left out; the launch still goes).
 */
function xs_ra_choice_lines(array $choices, string $cfg): array
{
    $lines = [];
    $said = [];
    $skipped = null;
    foreach ($choices as $slot => $c) {
        if ($c['kind'] === 'combo') {
            $lines[] = XS_RA_CHOICE_SLOTS[$slot] . ' = "' . $c['combo'] . '"';
            $said[] = $slot . '=' . xs_ra_choice_words($c);
            continue;
        }
        $driver = strtolower((string) (xs_ra_read_keys($cfg)['input_joypad_driver'] ?? ''));
        if ($driver !== 'sdl2') {
            $skipped = 'a single menu button is a raw number only known under the sdl2 pad driver, and this RetroArch drives pads with '
                     . ($driver === '' ? 'its default driver' : $driver);
            continue;
        }
        $lines[] = 'input_menu_toggle_btn = "' . $c['btn'] . '"';
        $lines[] = 'input_enable_hotkey_btn = "nul"';
        $said[] = 'menu=' . xs_ra_choice_words($c);
    }
    if ($lines) {
        $lines[] = 'config_save_on_exit = "false"';
    }
    return ['lines' => $lines, 'said' => $said ? implode(' ', $said) : null, 'skipped' => $skipped];
}

/* ---- turbo fire, your choice ------------------------------------------------
 * One global choice in data\ra-hotkeys.json under 'turbo'; one per game in
 * data\game-hotkeys.json, winning over the global. Nothing chosen says
 * nothing: RetroArch as it comes has turbo on but no Turbo button bound.
 */

/** RetroPad buttons in XS_PAD_IDS order, as the Turbo Bind rows say them. */
function xs_ra_retropad_names(): array
{
    return ['B', 'Y', 'Select', 'Start', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right',
            'A', 'X', 'L', 'R', 'L2', 'R2', 'L3', 'R3'];
}

/**
 * Is this a turbo choice RetroArch can take? {set: "off"}, or {set: "on"}
 * with mode 0 (Classic: hold the Turbo button and a button) or 2 (Single
 * Button (Toggle): one button fires by itself), bind null or a RetroPad id,
 * period null or 2 to 30 frames.
 */
function xs_ra_turbo_valid($t, ?string &$why = null): bool
{
    if (!is_array($t) || !in_array($t['set'] ?? null, ['off', 'on'], true)) {
        $why = 'turbo is off or on';
        return false;
    }
    if ($t['set'] === 'off') {
        return true;
    }
    if (!in_array($t['mode'] ?? null, [0, 2], true)) {
        $why = 'turbo\'s mode is 0 (hold the Turbo button and a button) or 2 (one button fires by itself)';
        return false;
    }
    $bind = $t['bind'] ?? null;
    if ($bind !== null && (!is_int($bind) || !isset(xs_ra_retropad_names()[$bind]))) {
        $why = 'the Turbo button is a RetroPad button';
        return false;
    }
    $period = $t['period'] ?? null;
    if ($period !== null && (!is_int($period) || $period < 2 || $period > 30)) {
        $why = 'the speed is a press every 2 to 30 frames';
        return false;
    }
    return true;
}

/** A turbo choice in a person's words. */
function xs_ra_turbo_choice_words(array $t): string
{
    if (($t['set'] ?? '') === 'off') {
        return 'off';
    }
    // Mode 2 is RetroArch's Single Button (Toggle): the Turbo button switches
    // rapid fire on and off for ONE button, the one its own Turbo Button
    // setting names (input_turbo_button, B as RetroArch comes).
    $parts = [($t['mode'] ?? 0) === 2 ? 'on, the Turbo button switches one button\'s rapid fire on and off'
                                      : 'on, hold the Turbo button and a button'];
    if (isset($t['bind']) && $t['bind'] !== null) {
        $parts[] = 'Turbo on ' . xs_ra_retropad_names()[(int) $t['bind']];
    }
    if (isset($t['period']) && $t['period'] !== null) {
        $parts[] = 'a press every ' . (int) $t['period'] . ' frames';
    }
    return implode(', ', $parts);
}

/** The --appendconfig lines for one turbo choice, all RetroPad words, any driver. */
function xs_ra_turbo_lines(array $t): array
{
    if (($t['set'] ?? '') === 'off') {
        return ['input_turbo_enable = "false"'];
    }
    $lines = ['input_turbo_enable = "true"', 'input_turbo_mode = "' . (int) ($t['mode'] ?? 0) . '"'];
    if (isset($t['bind']) && $t['bind'] !== null) {
        $lines[] = 'input_turbo_bind = "' . (int) $t['bind'] . '"';
    }
    if (isset($t['period']) && $t['period'] !== null) {
        $lines[] = 'input_turbo_period = "' . (int) $t['period'] . '"';
    }
    return $lines;
}

/** Every game's own choices (turbo today): game id => ['turbo' => choice]. */
function xs_game_hotkeys(): array
{
    $all = xs_read_json(xs_data_path('game-hotkeys.json'), []);
    return is_array($all) ? $all : [];
}

/** The global turbo choice as kept, or null; invalid dropped like the rest. */
function xs_ra_turbo_choice(): ?array
{
    $all = xs_read_json(xs_data_path('ra-hotkeys.json'), []);
    $t = is_array($all) ? ($all['turbo'] ?? null) : null;
    return is_array($t) && xs_ra_turbo_valid($t) ? $t : null;
}

/** The turbo choice one launch should carry: the game's own over the global, or null. $own says which it was. */
function xs_ra_turbo_for(string $gameId, ?bool &$own = null): ?array
{
    $mine = xs_game_hotkeys()[$gameId]['turbo'] ?? null;
    $own  = is_array($mine) && xs_ra_turbo_valid($mine);
    return $own ? $mine : xs_ra_turbo_choice();
}

/** An xs_ra_hotkeys answer with your choices said on the rows they sit on. */
function xs_ra_apply_yours(array $hot, ?string $gameId = null): array
{
    $choices = xs_ra_choices();
    $ids = ['menu' => 'menu_toggle', 'quit' => 'exit_emulator'];
    foreach ($hot['leave'] as $i => $row) {
        foreach ($ids as $slot => $id) {
            if ($row['id'] === $id && isset($choices[$slot])) {
                $hot['leave'][$i]['yours'] = xs_ra_choice_words($choices[$slot]);
            }
        }
    }
    $own   = false;
    $turbo = $gameId !== null ? xs_ra_turbo_for($gameId, $own) : xs_ra_turbo_choice();
    if ($turbo !== null) {
        foreach ($hot['turbo'] as $i => $row) {
            if ($row['id'] === 'turbo_enable') {
                $hot['turbo'][$i]['yours'] = xs_ra_turbo_choice_words($turbo) . ($own ? ' (this game\'s own)' : '');
            }
        }
    }
    return $hot;
}

/**
 * The override files RetroArch would lay over retroarch.cfg for this launch,
 * in the order it lays them: the core's, then the game's. The folder under
 * config\ wears the core's display name ("Mupen64Plus-Next"), so it is
 * matched against the -L core in the command with everything but letters
 * and digits dropped, the way the Controls panel finds a remap.
 */
function xs_ra_override_files(string $raDir, string $args, string $rom): array
{
    if (!preg_match('/-L\s+"?([^"]+_libretro\.dll)"?/i', $args, $cm)) {
        return [];
    }
    $stem = strtolower((string) preg_replace('/[^a-z0-9]+/i', '', basename($cm[1], '_libretro.dll')));
    $root = $raDir . DIRECTORY_SEPARATOR . 'config';
    $out = [];
    foreach (@scandir($root) ?: [] as $d) {
        $dir = $root . DIRECTORY_SEPARATOR . $d;
        if ($d === '.' || $d === '..' || !is_dir($dir)
            || strtolower((string) preg_replace('/[^a-z0-9]+/i', '', $d)) !== $stem) {
            continue;
        }
        $base = $rom !== '' ? pathinfo(str_replace('\\', '/', $rom), PATHINFO_FILENAME) : '';
        foreach ([$d . '.cfg', $base . '.cfg'] as $f) {
            if ($f !== '.cfg' && is_file($dir . DIRECTORY_SEPARATOR . $f) && !in_array($dir . DIRECTORY_SEPARATOR . $f, $out, true)) {
                $out[] = $dir . DIRECTORY_SEPARATOR . $f;
            }
        }
        break;
    }
    return $out;
}
