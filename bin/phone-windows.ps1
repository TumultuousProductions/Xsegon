<#
    Xsegon - the phone page and Windows' firewall: what it allows, and the one thing asked of it.

    With no switch it only reads, and prints one line of JSON:
        { "kind": "Public", "open": true | false | null, "why": "...", "told": "" }
    open is null when Windows would not say; the page then says so and
    changes nothing. told is the name Windows' own list has a No under
    (given to Windows' own question): -Add cannot undo that one.

    -Ask    starts this script again behind Windows' shield question
    -Add    (behind the shield) lets the home network reach one port of this
            PHP, on any kind of network, and nothing else. An older rule of
            the same name is replaced.
    -Remove (behind the shield) takes that rule out again.
#>
param(
    [Parameter(Mandatory = $true)][string]$Php,
    [string]$Address = '',
    [int]$Port = 0,
    [switch]$Ask,
    [switch]$Add,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dataDir = if ($env:XSEGON_DATA) { $env:XSEGON_DATA } else { Join-Path $root 'data' }
$ruleName = 'Xsegon phone page'
. (Join-Path $PSScriptRoot 'xslog.ps1')          # Test-XsegonLogging

function Say([string]$msg) {
    try {
        if (-not (Test-XsegonLogging $dataDir)) { return }
        $file = Join-Path (Join-Path $dataDir 'log') ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S PHONE ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

if ($Ask) {
    $mode = if ($Remove) { '-Remove' } else { '-Add' }
    $again = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" {1} -Php "{2}" -Port {3}' -f $PSCommandPath, $mode, $Php, $Port
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList $again | Out-Null
        Say "Windows was asked, behind its shield question, about port $Port of the phone page ($mode)"
    } catch { Say ('the shield question was answered No, or Windows would not ask: ' + $_.Exception.Message) }
    exit 0
}

if ($Add -or $Remove) {
    try {
        Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
        if ($Add) {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
                -Program $Php -RemoteAddress LocalSubnet -Profile Any -ErrorAction Stop | Out-Null
            Say "Windows said yes: the home network may reach port $Port of this PHP, and nothing else"
        } else {
            Say "Windows' yes for the phone page was taken out of its list"
        }
    } catch { Say ('Windows would not change its list: ' + $_.Exception.Message); exit 1 }
    exit 0
}

# The look. Any error is "cannot say", never a guess.
$kind = 'unknown'
$open = $null
$why  = ''
$told = ''
try {
    $nic = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction Stop | Select-Object -First 1
    $kind = [string](Get-NetConnectionProfile -InterfaceIndex $nic.InterfaceIndex -ErrorAction Stop | Select-Object -First 1).NetworkCategory
    $wall = if ($kind -eq 'DomainAuthenticated') { 'Domain' } else { $kind }
    $fw = Get-NetFirewallProfile -Name $wall -ErrorAction Stop
    if ([string]$fw.Enabled -eq 'False') {
        $open = $true; $why = "Windows' firewall is off for $kind networks"
    } elseif ([string]$fw.AllowInboundRules -eq 'False') {
        $open = $false; $why = "Windows is set to refuse everything coming in on $kind networks"
    } else {
        $rules = @(Get-NetFirewallApplicationFilter -ErrorAction Stop | Where-Object { $_.Program -eq $Php } | Get-NetFirewallRule |
            Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' -and ([string]$_.Profile -eq 'Any' -or [string]$_.Profile -match $wall) })
        # A yes for another port is no yes for this one.
        $fits = @($rules | Where-Object { $p = [string]($_ | Get-NetFirewallPortFilter).LocalPort; $p -eq 'Any' -or (" $p " -replace ',', ' ') -match " $Port " })
        $no = @($rules | Where-Object { [string]$_.Action -eq 'Block' })
        if ($no.Count) {
            $open = $false; $why = "Windows was told No for this program on $kind networks"
            # The name Windows' own list shows it under: only there can a No be taken back.
            $told = @($no | ForEach-Object { [string]$_.DisplayName } | Select-Object -Unique) -join ', '
        }
        elseif (@($fits | Where-Object { [string]$_.Action -eq 'Allow' }).Count) { $open = $true; $why = "Windows lets phones reach the phone page on $kind networks" }
        else { $open = $false; $why = "Windows has no yes for the phone page on $kind networks" }
    }
} catch { $why = 'Windows would not say what it allows: ' + $_.Exception.Message }
@{ kind = $kind; open = $open; why = $why; told = $told } | ConvertTo-Json -Compress
