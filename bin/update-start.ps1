<#
    Xsegon - a new version put in place, or taken out, while no server runs
    (roadmap BD4). Dot-sourced by start.ps1; nothing here starts a server.

    Invoke-XsegonUpdate <root> <php.exe>
        A switch cut off halfway (the power went) is undone first. Then Update
        now or Go back, when one was pressed (data\update\go.json, back.json),
        is done by data\update\updater.php, the copy of bin\update-switch.php
        made when the version was got ready. Returns 'switched', 'back' or ''.
        Never stops the start: a switch that does not work leaves the copy as
        it was, and says why in the log.

    Undo-XsegonUpdate <root> <php.exe>
        The new version did not answer at its first start: the one before is
        put back, and the mailbox says so. True when it was.

    A newer PHP comes only when the person ticked it in the Update now window:
    then data\update\next-php is there, checked and tried. It goes in place of
    runtime\php here, after the switcher (itself run by that PHP) has ended, as
    Windows locks a running php.exe; the old one waits in data\update\previous-php
    for Go back, and php-switch.json lets a swap cut off halfway be undone.
#>

function Invoke-XsegonUpdate([string]$root, [string]$php) {
    $ErrorActionPreference = 'Continue'
    $up = Join-Path $root 'data\update'
    $switcher = Join-Path $up 'updater.php'
    if (-not (Test-Path -LiteralPath $switcher)) { return '' }
    try {
        Restore-XsegonPhpCut $root
        if (Test-Path -LiteralPath (Join-Path $up 'switch.json')) { $null = & $php $switcher recover }
        foreach ($press in @(@('go.json', 'switch', 'switched'), @('back.json', 'back', 'back'))) {
            $file = Join-Path $up $press[0]
            if (-not (Test-Path -LiteralPath $file)) { continue }
            $null = & $php $switcher $press[1]
            $done = $LASTEXITCODE -eq 0
            # Asked once: a press that did not work is not tried again at every start.
            Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
            if ($done) {
                if ($press[1] -eq 'switch') { Switch-XsegonPhp $root } else { Undo-XsegonPhp $root 'as asked' }
                return $press[2]
            }
            return ''
        }
    } catch { }
    return ''
}

function Undo-XsegonUpdate([string]$root, [string]$php) {
    $ErrorActionPreference = 'Continue'
    $switcher = Join-Path $root 'data\update\updater.php'
    if (-not (Test-Path -LiteralPath $switcher)) { return $false }
    try {
        $null = & $php $switcher back --why=nostart
        $done = $LASTEXITCODE -eq 0
        if ($done) { Undo-XsegonPhp $root 'the new version did not start' }
        return $done
    } catch { return $false }
}

# One line in data\log\<day>.log as the server writes them; none with logging off in Settings.
function Write-XsegonUpdLog([string]$root, [string]$msg) {
    try {
        $settings = Join-Path $root 'data\settings.json'
        if ((Test-Path -LiteralPath $settings) -and ((Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json).debug.logging -eq $false)) { return }
    } catch { }
    $dir = Join-Path $root 'data\log'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $now = Get-Date
    [IO.File]::AppendAllText((Join-Path $dir ($now.ToString('yyyy-MM-dd') + '.log')), $now.ToString('HH:mm:ss.fff') + ' S UPD  ' + $msg + "`n")
}

function Write-XsegonPhpJournal([string]$root, [hashtable]$j) {
    [IO.File]::WriteAllText((Join-Path $root 'data\update\php-switch.json'), ($j | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
}

# A move tried again for two seconds: a scanner, or a PHP just ending, holds a file a moment.
function Move-XsegonDir([string]$from, [string]$to) {
    for ($i = 0; $i -lt 8; $i++) {
        try { Move-Item -LiteralPath $from -Destination $to -ErrorAction Stop; return $true } catch { Start-Sleep -Milliseconds 250 }
    }
    return $false
}

function Get-XsegonPhpVersion([string]$dir) {
    $exe = Join-Path $dir 'php.exe'
    if (Test-Path -LiteralPath $exe) { return (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion }
    return ''
}

# The ticked PHP into runtime\php, the one before into data\update\previous-php. Nothing changes when it cannot be done.
function Switch-XsegonPhp([string]$root) {
    $up = Join-Path $root 'data\update'
    $new = Join-Path $up 'next-php'; $cur = Join-Path $root 'runtime\php'; $old = Join-Path $up 'previous-php'
    if (-not (Test-Path -LiteralPath (Join-Path $new 'php.exe'))) { return }
    $to = Get-XsegonPhpVersion $new; $from = Get-XsegonPhpVersion $cur
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue }
    Write-XsegonPhpJournal $root @{ state = 'moving'; from = $from; to = $to; at = (Get-Date).ToString('o') }
    $aside = (-not (Test-Path -LiteralPath $cur)) -or (Move-XsegonDir $cur $old)
    if ($aside -and (Move-XsegonDir $new $cur)) {
        Write-XsegonPhpJournal $root @{ state = 'done'; from = $from; to = $to; at = (Get-Date).ToString('o') }
        Write-XsegonUpdLog $root "PHP $to put in place of $from (kept in data\update\previous-php for Go back)"
        return
    }
    if ($aside -and -not (Test-Path -LiteralPath $cur) -and (Test-Path -LiteralPath $old)) { $null = Move-XsegonDir $old $cur }
    Remove-Item -LiteralPath (Join-Path $up 'php-switch.json') -Force -ErrorAction SilentlyContinue
    Write-XsegonUpdLog $root "PHP $to was not put in place (a file of PHP was in use): Xsegon runs on PHP $from as before"
}

# Go back, or a new version that did not start: the PHP before back in runtime\php, when the update brought one.
function Undo-XsegonPhp([string]$root, [string]$why) {
    $up = Join-Path $root 'data\update'
    $jour = Join-Path $up 'php-switch.json'
    if (-not (Test-Path -LiteralPath $jour)) { return }
    $j = Get-Content -LiteralPath $jour -Raw | ConvertFrom-Json
    $cur = Join-Path $root 'runtime\php'; $old = Join-Path $up 'previous-php'; $out = Join-Path $up 'php-taken-out'
    if ($j.state -ne 'done' -or -not (Test-Path -LiteralPath $old)) { return }
    if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue }
    if ((Move-XsegonDir $cur $out) -and (Move-XsegonDir $old $cur)) {
        Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $jour -Force -ErrorAction SilentlyContinue
        Write-XsegonUpdLog $root "PHP $($j.from) back in place of $($j.to): $why"
        return
    }
    if (-not (Test-Path -LiteralPath $cur) -and (Test-Path -LiteralPath $out)) { $null = Move-XsegonDir $out $cur }
    Write-XsegonUpdLog $root "PHP $($j.from) could not be put back ($why): Xsegon stays on PHP $($j.to)"
}

# A PHP swap cut off halfway (the power went): the PHP before is put back where none is in place.
function Restore-XsegonPhpCut([string]$root) {
    $jour = Join-Path $root 'data\update\php-switch.json'
    if (-not (Test-Path -LiteralPath $jour)) { return }
    $j = Get-Content -LiteralPath $jour -Raw | ConvertFrom-Json
    if ($j.state -ne 'moving') { return }
    $cur = Join-Path $root 'runtime\php'; $old = Join-Path $root 'data\update\previous-php'; $new = Join-Path $root 'data\update\next-php'
    # Both moves made, only the note not written: the swap is done, and Go back can still put the one before back.
    if ((Test-Path -LiteralPath (Join-Path $cur 'php.exe')) -and -not (Test-Path -LiteralPath $new) -and (Test-Path -LiteralPath $old)) {
        Write-XsegonPhpJournal $root @{ state = 'done'; from = $j.from; to = $j.to; at = (Get-Date).ToString('o') }
        Write-XsegonUpdLog $root "a PHP swap was cut off as its note was written: PHP $($j.to) is in place"
        return
    }
    if (-not (Test-Path -LiteralPath (Join-Path $cur 'php.exe')) -and (Test-Path -LiteralPath $old)) {
        if (Test-Path -LiteralPath $cur) { Remove-Item -LiteralPath $cur -Recurse -Force -ErrorAction SilentlyContinue }
        $null = Move-XsegonDir $old $cur
    }
    Remove-Item -LiteralPath $jour -Force -ErrorAction SilentlyContinue
    Write-XsegonUpdLog $root "a PHP swap was cut off halfway: PHP $($j.from) is in place as before"
}
