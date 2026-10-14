<#  bin\ra-jump.ps1 - open RetroArch by itself and walk its menu to one page.
    The caller (api\retroarch.php) has checked the version, the ozone menu and
    network commands on. The walk is only menu presses over those commands, so
    nothing of RetroArch's is written; with no answer it stays on its first screen.

    -Exe      retroarch.exe, the one the library's launches use
    -NetPort  its network commands port
    -Route    the presses, space apart: LEFT DOWN RIGHT DOWN DOWN DOWN OK DOWN DOWN OK
    -Ok       which press OK is: A, or B when RetroArch swaps them
    -DataDir  data\, for the log
    -Log      write the walk down                                           #>
param(
    [Parameter(Mandatory)] [string] $Exe,
    [int] $NetPort = 55355,
    [Parameter(Mandatory)] [string] $Route,
    [ValidateSet('A', 'B')] [string] $Ok = 'A',
    [string] $DataDir = '',
    [switch] $Log
)

$ErrorActionPreference = 'Stop'

if (-not $DataDir) { $DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data' }

# One line in data\log\<day>.log, the same shape bin\launch.ps1 writes, so the
# walk reads beside the RA line the server wrote. Best effort and silent.
function Write-Log([string] $msg) {
    if (-not $Log) { return }
    try {
        $dir = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S RA   ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

# One line to RetroArch's network commands over UDP, and its answer when
# $WaitMs is more than 0 ('' when it gives none). bin\launch.ps1's shape.
function Send-RetroArch([string] $Command, [int] $WaitMs) {
    $udp = New-Object System.Net.Sockets.UdpClient
    try {
        $udp.Client.ReceiveTimeout = [Math]::Max(1, $WaitMs)
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($Command)
        [void] $udp.Send($bytes, $bytes.Length, '127.0.0.1', $NetPort)
        if ($WaitMs -le 0) { return '' }
        $from = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        return [System.Text.Encoding]::ASCII.GetString($udp.Receive([ref] $from))
    } catch { return '' } finally { $udp.Close() }
}

# The route holds only for a RetroArch fresh from its start. One already open
# holds the network port and would take the presses, so then nothing is pressed.
$already = @(Get-Process -Name 'retroarch' -ErrorAction SilentlyContinue).Count -gt 0

try {
    Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe -Parent)
} catch {
    Write-Log ("jump: RetroArch would not start: " + $_.Exception.Message)
    exit 0
}
if ($already) {
    Write-Log 'jump: a RetroArch was open already, so its menu was not walked; opened plain'
    exit 0
}

# Walk only once its network commands answer, then give the first screen time.
# Presses much faster than these gaps are not proven to land.
$up = $false
for ($i = 0; $i -lt 100; $i++) {
    Start-Sleep -Milliseconds 200
    if ((Send-RetroArch 'VERSION' 300) -ne '') { $up = $true; break }
}
if (-not $up) {
    Write-Log "jump: RetroArch never answered on port $NetPort; left on its first screen"
    exit 0
}
Start-Sleep -Milliseconds 2500

$sent = 0
foreach ($step in ($Route -split ' +')) {
    if ($step -eq '') { continue }
    if (@(Get-Process -Name 'retroarch' -ErrorAction SilentlyContinue).Count -eq 0) {
        Write-Log "jump: RetroArch closed after $sent presses; the walk stopped"
        exit 0
    }
    $cmd = if ($step -eq 'OK') { 'MENU_' + $Ok } else { 'MENU_' + $step }
    [void] (Send-RetroArch $cmd 0)
    $sent++
    Start-Sleep -Milliseconds 450
}
Write-Log ("jump: walked RetroArch's menu, $sent presses (" + $Route + ", OK=" + $Ok + ") on port " + $NetPort)
