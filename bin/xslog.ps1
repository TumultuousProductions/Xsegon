<#  bin\xslog.ps1 - whether logging is on, for the scripts that write their own
    lines into data\log. Dot-sourced. Settings > Debug > Logging switched off
    means no line from anywhere, these scripts included.                     #>

# Read at every line, so switching it off takes hold on a script already running.
# A settings file that is not there or will not read counts as on, as the server counts it.
function Test-XsegonLogging([string]$dataDir) {
    try {
        $file = Join-Path $dataDir 'settings.json'
        if (-not (Test-Path -LiteralPath $file)) { return $true }
        $debug = ([IO.File]::ReadAllText($file) | ConvertFrom-Json).PSObject.Properties['debug']
        if (-not $debug -or -not $debug.Value) { return $true }
        $logging = $debug.Value.PSObject.Properties['logging']
        return -not ($logging -and $logging.Value -eq $false)
    } catch { return $true }
}
