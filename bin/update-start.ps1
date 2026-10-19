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
#>

function Invoke-XsegonUpdate([string]$root, [string]$php) {
    $ErrorActionPreference = 'Continue'
    $up = Join-Path $root 'data\update'
    $switcher = Join-Path $up 'updater.php'
    if (-not (Test-Path -LiteralPath $switcher)) { return '' }
    try {
        if (Test-Path -LiteralPath (Join-Path $up 'switch.json')) { $null = & $php $switcher recover }
        foreach ($press in @(@('go.json', 'switch', 'switched'), @('back.json', 'back', 'back'))) {
            $file = Join-Path $up $press[0]
            if (-not (Test-Path -LiteralPath $file)) { continue }
            $null = & $php $switcher $press[1]
            $done = $LASTEXITCODE -eq 0
            # Asked once: a press that did not work is not tried again at every start.
            Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
            if ($done) { return $press[2] }
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
        return $LASTEXITCODE -eq 0
    } catch { return $false }
}
