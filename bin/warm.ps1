<#
    Xsegon - read the page's scripts and the server's code while the app window starts.

    Dot-sourced by bin\open.ps1: Start-XsegonWarm just after the browser is
    started, Wait-XsegonWarm before it ends. Windows Defender checks a file the
    first time it is opened in a while, about 13 ms a script, and index.php
    reads its 165 scripts one after another, so the first open of a day waited
    2 to 3 s on those checks. Read here eight at a time they take about 0.3 s,
    while the browser is still starting. Nothing is kept: the page reads every
    file itself, as before, only no longer waits on the checks.
#>

# The readers, started; $null when they could not be (the page then reads as before).
function Start-XsegonWarm([string]$root, [int]$readers = 8) {
    try {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        # The page's scripts first: the browser asks for the page before the rest is needed.
        $files = New-Object System.Collections.Generic.List[string]
        foreach ($part in @(@('js', '*.js', $false), @('css', '*.css', $false), @('includes', '*.php', $true), @('api', '*.php', $false),
                            @('private\web', '*.js', $false), @('private\api', '*.php', $false))) {
            $dir = Join-Path $root $part[0]
            if (Test-Path -LiteralPath $dir) {
                foreach ($f in @(Get-ChildItem -LiteralPath $dir -Filter $part[1] -File -Recurse:([bool]$part[2]) -ErrorAction SilentlyContinue)) { $files.Add($f.FullName) }
            }
        }
        foreach ($name in 'index.php', 'router.php') { $f = Join-Path $root $name; if (Test-Path -LiteralPath $f) { $files.Add($f) } }
        $pool = [runspacefactory]::CreateRunspacePool(1, $readers)
        $pool.Open()
        $jobs = for ($i = 0; $i -lt $readers; $i++) {
            $slice = [string[]]@(for ($j = $i; $j -lt $files.Count; $j += $readers) { $files[$j] })
            $ps = [powershell]::Create()
            $ps.RunspacePool = $pool
            [void]$ps.AddScript({ param($list) foreach ($f in $list) { try { [void][IO.File]::ReadAllBytes($f) } catch { } } }).AddArgument($slice)
            @{ ps = $ps; h = $ps.BeginInvoke() }
        }
        return @{ sw = $sw; pool = $pool; jobs = @($jobs); count = $files.Count; readers = $readers }
    } catch {
        Write-XsegonLine $root 'WARM' ("reading ahead of the window did not start: " + $_.Exception.Message + "; the page reads its files itself, as before")
        return $null
    }
}

# Waits for the readers, at most $sec in all, and says how it went. What is left then is read by the page.
function Wait-XsegonWarm([string]$root, $warm, [int]$sec = 15) {
    if (-not $warm) { return }
    try {
        $until = [DateTime]::UtcNow.AddSeconds($sec)
        $done = $true
        foreach ($j in $warm.jobs) {
            $left = [int][Math]::Max(0, ($until - [DateTime]::UtcNow).TotalMilliseconds)
            if (-not $j.h.AsyncWaitHandle.WaitOne($left)) { $done = $false }
        }
        if ($done) { foreach ($j in $warm.jobs) { $j.ps.Dispose() }; $warm.pool.Close() }
        $warm.sw.Stop()
        Write-XsegonLine $root 'WARM' ("read the page's scripts and the server's code while the window started: " + $warm.count + " files, " +
            $warm.readers + " at a time, in " + $warm.sw.ElapsedMilliseconds + " ms" + $(if ($done) { '' } else { " (some still unread after ${sec} s, left to the page)" }))
    } catch {
        Write-XsegonLine $root 'WARM' ("reading ahead of the window stopped: " + $_.Exception.Message + "; the page reads its files itself, as before")
    }
}
