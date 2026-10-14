<#
    What scale Xsegon's window would be started at, asked with no window and
    no server (tests\t-writes.js).

        powershell -File tests\scale-probe.ps1 <a folder of the check's own>

    The folder stands in for Xsegon's own: its data\settings.json is the one
    read, and the lines the rule writes go to its data\log. The screens are
    made up, except the last answer, which is this PC's own as Windows says it.
    Prints one line of JSON.
#>
param([Parameter(Mandatory = $true)][string]$Root)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'bin\xsbrowser.ps1')

$data = Join-Path $Root 'data'
if (-not (Test-Path -LiteralPath $data)) { New-Item -ItemType Directory -Path $data -Force | Out-Null }
$settings = Join-Path $data 'settings.json'
function Set-Switch($on) {
    if ($null -eq $on) { if (Test-Path -LiteralPath $settings) { Remove-Item -LiteralPath $settings -Force }; return }
    [IO.File]::WriteAllText($settings, (@{ window = @{ fillBigScreen = [bool]$on } } | ConvertTo-Json -Compress))
}
function Screen($w, $h, $scale) { @{ w = $w; h = $h; scale = $scale } }

# The rule alone: a screen and Windows' scaling of it, and the scale that comes out (0 is "as Windows has it").
$fits = @()
foreach ($t in @(@(1280, 720, 1), @(1920, 1080, 1), @(1920, 1200, 1), @(2560, 1440, 1), @(2560, 1440, 1.25), @(3440, 1440, 1),
                 @(2560, 1600, 1), @(3840, 2160, 1), @(3840, 2160, 1.5), @(3840, 2160, 1.75), @(3840, 2160, 3), @(5120, 2880, 2), @(1440, 2560, 1))) {
    $fits += ("" + $t[0] + "x" + $t[1] + "@" + $t[2] + "=" + (Get-XsegonFit $t[0] $t[1] $t[2]))
}

# The flag the browser would be given.
Set-Switch $null
$none  = Get-XsegonScaleFlag $Root -Screen (Screen 3840 2160 1.5)       # no settings file: the switch is on
Set-Switch $true
$on    = Get-XsegonScaleFlag $Root -Screen (Screen 3840 2160 1.5)
$small = Get-XsegonScaleFlag $Root -Screen (Screen 1920 1200 1)
Set-Switch $false
$off   = Get-XsegonScaleFlag $Root -Screen (Screen 3840 2160 1.5)
$hand  = Get-XsegonScaleFlag $Root -Scale 1.5 -Screen (Screen 1920 1200 1)
$quiet = Get-XsegonScaleFlag $Root -Screen (Screen 3840 2160 1.5) -Quiet

$log = ''
$logDir = Join-Path $data 'log'
if (Test-Path -LiteralPath $logDir) { $log = (Get-ChildItem -LiteralPath $logDir -Filter '*.log' | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join '' }

# The open window and the screen it is on now: is it opened again? A record of the check's own stands in
# for the window ($null is one written before a window's scale was written down).
function Set-Window($scale, $byHand = $false, $refit = 0) {
    $rec = @{ pid = 1; started = '0' }
    if ($null -ne $scale) { $rec.scale = [string]$scale; $rec.hand = [bool]$byHand; $rec.refit = [int]$refit }
    [IO.File]::WriteAllText((Join-Path $data 'browser.json'), ($rec | ConvertTo-Json -Compress))
}
function Misfit($screen, $age = 3600) {
    $m = Get-XsegonMisfit $Root -Screen $screen -Age $age
    "" + $(if ($m.again) { 'again ' + $m.refit } else { 'stays' }) + ": " + $m.say
}
$tv = Screen 3840 2160 1.25
$own = Screen 1920 1200 1.25
$misfit = @()
Set-Switch $true
Set-Window $null;       $misfit += Misfit $tv            # opened on the small screen, a TV plugged in
Set-Window 1.8;         $misfit += Misfit $tv            # opened for the TV, still on it
Set-Window 1.8;         $misfit += Misfit $own           # the TV taken away
Set-Window 0;           $misfit += Misfit $own
Set-Window 1.5 $true;   $misfit += Misfit $tv            # a size asked for by hand stays
Set-Window 0 $false 2;  $misfit += Misfit $tv 20         # twice in a minute already
Set-Window 0 $false 2;  $misfit += Misfit $tv 300
Set-Window 0 $false 1;  $misfit += Misfit $tv 20
Set-Switch $false
Set-Window 1.8;         $misfit += Misfit $tv            # the switch turned off since
Set-Window 0;           $misfit += Misfit $tv

# What is written down for a window, and kept for the same window found again.
Save-XsegonBrowser $Root (Get-Process -Id $PID) @{ by = 1.8; hand = $false; refit = 1 }
Save-XsegonBrowser $Root (Get-Process -Id $PID)
$kept = Get-XsegonWindowScale $Root
$record = "" + $kept.by + " " + $kept.hand + " " + $kept.refit

$here = Get-XsegonScreen
@{ fits = $fits; none = $none; on = $on; small = $small; off = $off; hand = $hand; quiet = $quiet; misfit = $misfit; record = $record
   said = @(($log -split "`n") | Where-Object { $_ } | ForEach-Object { ($_ -replace '^\S+ S WIN\s+', '') })
   here = if ($here) { "" + $here.w + "x" + $here.h + "@" + $here.scale } else { $null }
   hereFlag = if ($here) { Get-XsegonScaleFlag $Root -Screen $here -Quiet } else { $null } } | ConvertTo-Json -Compress
