<?php
/**
 * Minimise or close an Xsegon window from inside the server, in about a
 * millisecond, by calling user32.dll through PHP's FFI.
 *
 * The other road, bin\window.ps1, starts a PowerShell and compiles its window
 * calls every time: half a second or more. It is still used whenever this one
 * says no: FFI not loaded (start.ps1 loads it), no record of the app's browser
 * yet, or a window that is not plainly the one asked for.
 *
 * Only ever the window in front, and only when it belongs to the process
 * bin\open.ps1 wrote down as the app's browser (data\browser.json): the
 * press that asked came from that window, so it is the one in front. The
 * class name alone would not do: VS Code and every other Chromium window
 * share it.
 */
declare(strict_types=1);

/** True when it was done here; false means use bin\window.ps1 instead. */
function xs_window_fast(string $op, string $title): bool
{
    // Every "no" says why in the log: a quick road that quietly stops being
    // taken is only ever noticed as "it feels slow again".
    $no = static function (string $why): bool {
        xs_log('WIN', 'quick way not taken: ' . $why);
        return false;
    };
    if (PHP_OS_FAMILY !== 'Windows') {
        return false;
    }
    if (!extension_loaded('FFI')) {
        return $no('FFI is not loaded (start the server with start.ps1)');
    }
    $rec = json_decode((string) @file_get_contents(xs_data_dir() . DIRECTORY_SEPARATOR . 'browser.json'), true);
    $browser = is_array($rec) ? (int) ($rec['pid'] ?? 0) : 0;
    if ($browser <= 0) {
        return $no('no record of the app window yet (data\browser.json)');
    }
    try {
        $u = FFI::cdef('
            typedef void* HWND;
            HWND GetForegroundWindow(void);
            unsigned long GetWindowThreadProcessId(HWND h, unsigned long* pid);
            int GetWindowTextW(HWND h, uint16_t* buf, int n);
            int ShowWindow(HWND h, int cmd);
            int PostMessageW(HWND h, unsigned int msg, uintptr_t w, intptr_t l);
        ', 'user32.dll');
        $h = $u->GetForegroundWindow();
        if ($h === null || FFI::isNull($h)) {
            return $no('no window is in front');
        }
        $owner = $u->new('unsigned long');
        $u->GetWindowThreadProcessId($h, FFI::addr($owner));
        $buf = $u->new('uint16_t[512]');
        $n = $u->GetWindowTextW($h, $buf, 512);
        $have = $n > 0 ? mb_convert_encoding(FFI::string($buf, $n * 2), 'UTF-8', 'UTF-16LE') : '';
        if ((int) $owner->cdata !== $browser) {
            return $no('the window in front ("' . mb_substr($have, 0, 60) . '", process ' . $owner->cdata
                . ') is not the app\'s browser (process ' . $browser . ')');
        }
        // Chrome adds its own suffix to a window's title: a prefix match, as window.ps1 does.
        if ($title !== '' && $have !== $title && !str_starts_with($have, $title)) {
            return $no('the window in front is "' . mb_substr($have, 0, 60) . '", not "' . $title . '"');
        }
        if ($op === 'minimize') {
            $u->ShowWindow($h, 6);                    // SW_MINIMIZE
        } else {
            $u->PostMessageW($h, 0x0010, 0, 0);       // WM_CLOSE, the polite close
        }
        return true;
    } catch (Throwable $e) {
        xs_log('WIN', 'the quick way failed (' . $e->getMessage() . '), using window.ps1');
        return false;
    }
}
