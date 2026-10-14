<#
    Xsegon - open a web game of your own in a window of its own.

    Usage:  bin\open-game.ps1 -Id xs-0123456789ab [-Port 8099]

    Not kiosk, on purpose: the wall's --kiosk window has no title bar and
    ignores F11, so a game opened into it is a trap. The game gets its own
    --app window (no tabs or address bar) with Windows' title bar.

    The address is this machine's play.php with the game's id; play.php
    frames the game, adding Esc and its own X. --user-data-dir is the wall's
    own profile, so a web game that saves in the browser finds the same saves;
    Chrome hands this to the open instance, which opens the window there.
#>

param(
    [Parameter(Mandatory = $true)][string]$Id,
    [int]$Port = 8099
)

$ErrorActionPreference = 'Stop'

if ($Id -notmatch '^xs-[0-9a-f]{12}$') { 'bad-id'; exit 2 }

$root       = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $root 'data\browser-profile'
. (Join-Path $PSScriptRoot 'xsbrowser.ps1')          # Write-XsegonLine

$browser = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $browser) { Write-XsegonLine $root 'WIN' 'a web game asked to open, but no Chrome or Edge was found'; 'no-browser'; exit 2 }

$flags = @("--app=http://127.0.0.1:$Port/play.php?id=$Id",
           "--user-data-dir=`"$profileDir`"",
           '--no-first-run', '--no-default-browser-check',
           '--autoplay-policy=no-user-gesture-required',
           # Only honoured when this is the first window of the instance; when
           # the wall is already up the running browser places it itself.
           '--window-size=1400,900', '--window-position=120,80')
# The same scale the wall would get, should this be the window that starts the browser.
$scaleFlag = Get-XsegonScaleFlag $root -Quiet
if ($scaleFlag) { $flags += $scaleFlag }

Start-Process -FilePath $browser -ArgumentList $flags
'opened'
