<?php
/**
 * The game controllers Windows has plugged in, asked of Windows itself.
 * A page learns of a controller only when one of its buttons is pressed, so
 * "none plugged in" and "plugged in, never pressed" look the same from there.
 * For the log, the report, and the words under the controller picture until
 * a controller presses. Nothing is decided by it: a press always shows the
 * controller, whatever Windows said.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';
require_once __DIR__ . '/padlist.php';

/**
 * Windows' own list of input devices, the joysticks and gamepads of it: one
 * row each with its maker and product numbers. Null, with $why, whenever
 * Windows cannot be asked or does not answer; nothing depends on the answer.
 */
function xs_pads_plugged(?string &$why = null): ?array
{
    if (PHP_OS_FAMILY !== 'Windows' || !extension_loaded('FFI')) {
        $why = 'this PHP cannot ask Windows';
        return null;
    }
    try {
        $u = FFI::cdef('
            typedef struct { void* dev; uint32_t kind; } XS_RID_ROW;
            typedef struct { uint32_t size; uint32_t kind; uint32_t vendor; uint32_t product; uint32_t version;
                             uint16_t page; uint16_t usage; uint32_t rest[2]; } XS_RID_INFO;
            uint32_t GetRawInputDeviceList(XS_RID_ROW* rows, uint32_t* count, uint32_t rowSize);
            uint32_t GetRawInputDeviceInfoW(void* dev, uint32_t what, void* into, uint32_t* size);
        ', 'user32.dll');
        $rowSize = FFI::sizeof($u->type('XS_RID_ROW'));
        $count   = $u->new('uint32_t');
        if ($u->GetRawInputDeviceList(null, FFI::addr($count), $rowSize) !== 0 || $count->cdata > 4096) {
            $why = 'Windows gave no count of its input devices';
            return null;
        }
        if ($count->cdata === 0) {
            return [];
        }
        $rows = $u->new('XS_RID_ROW[' . $count->cdata . ']');
        $n    = $u->GetRawInputDeviceList($rows, FFI::addr($count), $rowSize);
        if ($n > 4096) {                                  // (UINT)-1: the list changed between the two calls
            $why = 'Windows gave no list of its input devices';
            return null;
        }
        $pads = [];
        for ($i = 0; $i < $n; $i++) {
            if ($rows[$i]->kind !== 2) {                  // 2 is neither a mouse nor a keyboard
                continue;
            }
            $info = $u->new('XS_RID_INFO');
            $info->size = FFI::sizeof($info);
            $size = $u->new('uint32_t');
            $size->cdata = FFI::sizeof($info);
            $got = $u->GetRawInputDeviceInfoW($rows[$i]->dev, 0x2000000b, FFI::addr($info), FFI::addr($size));
            // Page 1 is the desktop's own kinds; 4, 5 and 8 on it are a joystick, a gamepad and a many-axis controller.
            if ($got === 0 || $got > 4096 || $info->page !== 1 || !in_array($info->usage, [4, 5, 8], true)) {
                continue;
            }
            $vendor  = sprintf('%04x', $info->vendor & 0xffff);
            $product = sprintf('%04x', $info->product & 0xffff);
            // A controller read the Xbox way carries IG_ in the name Windows keeps for it.
            $chars = $u->new('uint32_t');
            $path  = '';
            if ($u->GetRawInputDeviceInfoW($rows[$i]->dev, 0x20000007, null, FFI::addr($chars)) === 0 && $chars->cdata > 0 && $chars->cdata < 2048) {
                $buf = $u->new('uint16_t[' . ($chars->cdata + 1) . ']');
                $len = $u->GetRawInputDeviceInfoW($rows[$i]->dev, 0x20000007, $buf, FFI::addr($chars));
                if ($len > 0 && $len < 2048) {
                    $path = (string) mb_convert_encoding(FFI::string($buf, $len * 2), 'UTF-8', 'UTF-16LE');
                }
            }
            $key = $vendor . ':' . $product . ':' . strtolower(rtrim($path, "\0"));
            $pads[$key] = ['vendor' => $vendor, 'product' => $product, 'xbox' => stripos($path, 'IG_') !== false,
                           'name' => (string) (xs_padlist_find($vendor, $product)['name'] ?? '')];
        }
        return array_values($pads);
    } catch (Throwable $e) {
        $why = $e->getMessage();
        return null;
    }
}

/**
 * The same asked through a PHP of a moment's life (bin\padplugged.php), for a
 * server started without what asking Windows needs: the piece is named on
 * that one process's command line, so no php.ini is touched. Null, with $why,
 * when it cannot be started or has not answered in three seconds.
 */
function xs_pads_plugged_helper(?string &$why = null): ?array
{
    require_once __DIR__ . '/gamesdb.php';
    $dir  = xs_gamesdb_php_ext_dir();
    $have = extension_loaded('FFI');
    if (PHP_OS_FAMILY !== 'Windows' || (!$have && !is_file($dir . DIRECTORY_SEPARATOR . 'php_ffi.dll'))) {
        $why = 'this PHP cannot ask Windows';
        return null;
    }
    $cmd = array_merge([xs_php_exe(), '-d', 'display_errors=0', '-d', 'display_startup_errors=0', '-d', 'extension_dir=' . $dir],
                       $have ? [] : ['-d', 'extension=ffi'],
                       ['-d', 'ffi.enable=1', XS_ROOT . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'padplugged.php']);
    // Its answer goes to a file: on Windows PHP cannot read a pipe without waiting for the end.
    $out  = tempnam(sys_get_temp_dir(), 'xspad');
    $proc = $out === false ? false
          : @proc_open($cmd, [0 => ['file', 'NUL', 'r'], 1 => ['file', $out, 'w'], 2 => ['file', 'NUL', 'w']], $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) {
        if ($out !== false) {
            @unlink($out);
        }
        $why = 'the helper that asks Windows could not be started';
        return null;
    }
    $deadline = microtime(true) + 3;
    while (proc_get_status($proc)['running']) {
        if (microtime(true) > $deadline) {
            proc_terminate($proc);
            proc_close($proc);
            @unlink($out);
            $why = 'the helper that asks Windows did not answer in three seconds';
            return null;
        }
        usleep(5000);
    }
    proc_close($proc);
    $said = json_decode((string) @file_get_contents($out), true);
    @unlink($out);
    if (!is_array($said) || !array_key_exists('pads', $said)) {
        $why = 'the helper that asks Windows gave no answer';
        return null;
    }
    if (!is_array($said['pads'])) {
        $why = (string) ($said['why'] ?? 'Windows did not answer');
        return null;
    }
    return array_values(array_filter($said['pads'], static fn ($p): bool => is_array($p) && isset($p['vendor'], $p['product'], $p['xbox'], $p['name'])));
}

/** Asked here where this PHP can, through the helper where it cannot. */
function xs_pads_plugged_ask(?string &$why = null): ?array
{
    return xs_pads_plugged($why) ?? xs_pads_plugged_helper($why);
}

/** That answer as one line for the log and the report. */
function xs_pads_plugged_words(?array $pads, ?string $why = null): string
{
    if ($pads === null) {
        return 'Windows could not be asked which game controllers are plugged in' . ($why !== null && $why !== '' ? ' (' . $why . ')' : '');
    }
    if (!$pads) {
        return 'Windows lists no game controller plugged in';
    }
    $said = array_map(static fn(array $p): string => ($p['name'] !== '' ? $p['name'] . ', ' : '') . $p['vendor'] . ':' . $p['product']
        . ($p['xbox'] ? ', read the Xbox way' : ''), $pads);
    return 'Windows lists ' . count($pads) . (count($pads) === 1 ? ' game controller' : ' game controllers') . ' plugged in: ' . implode('; ', $said);
}
