<#  bin\busy.ps1 - what the PC is busy with, as one BUSY line in the day log.

    Started by api\busy.php when a still-alive check of the page took seconds.
    Two looks 1.5 s apart give the top processor and disk users. Read only.

    -DataDir  data\, for the log
    -Why      what was slow, said in the line
    -Log      write the line down (without it the line is only printed)      #>
param(
    [string] $DataDir = '',
    [string] $Why = '',
    [switch] $Log
)

$ErrorActionPreference = 'Stop'
if (-not $DataDir) { $DataDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'data' }
$asked = Get-Date

# One line in data\log\<day>.log, the shape includes\boot.php writes. Best effort and silent.
function Write-Log([string] $msg) {
    $msg
    if (-not $Log) { return }
    try {
        $dir = Join-Path $DataDir 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S BUSY ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

# One look at a time: a second one started while this runs has nothing to add.
$mutex = New-Object System.Threading.Mutex($false, 'Local\XsegonBusyLook')
$mine = $false
try { $mine = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mine = $true }   # the last one died holding it
if (-not $mine) { exit 0 }

try {
    # Every program's processor time and bytes read and written so far, and the disks' idle time so far.
    function Read-Now {
        $procs = @(Get-CimInstance Win32_Process -Property ProcessId, Name, KernelModeTime, UserModeTime, ReadTransferCount, WriteTransferCount)
        $disk = $null
        try { $disk = Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -Property PercentIdleTime, Timestamp_Sys100NS } catch { }
        [pscustomobject]@{ at = Get-Date; procs = $procs; disk = $disk }
    }
    $a = Read-Now
    Start-Sleep -Milliseconds 1500
    $b = Read-Now
    $secs = [Math]::Max(0.2, ($b.at - $a.at).TotalSeconds)
    $cores = [Math]::Max(1, [Environment]::ProcessorCount)

    $was = @{}
    foreach ($p in $a.procs) { $was[[string]$p.ProcessId + '|' + $p.Name] = $p }
    $cpu = @{}; $io = @{}; $all = 0.0
    foreach ($p in $b.procs) {
        $old = $was[[string]$p.ProcessId + '|' + $p.Name]
        if (-not $old -or $p.ProcessId -eq 0) { continue }      # 0 is the idle time itself
        $name = $p.Name -replace '\.exe$', ''
        $used = (([double]$p.KernelModeTime + [double]$p.UserModeTime) - ([double]$old.KernelModeTime + [double]$old.UserModeTime)) / 1e7
        $moved = ([double]$p.ReadTransferCount + [double]$p.WriteTransferCount) - ([double]$old.ReadTransferCount + [double]$old.WriteTransferCount)
        if ($used -gt 0) { $cpu[$name] = [double]$cpu[$name] + $used; $all += $used }
        if ($moved -gt 0) { $io[$name] = [double]$io[$name] + $moved }
    }
    # A program's share is of the whole PC, every core counted: 100% is all of them flat out.
    $share = { param($s) [Math]::Round(100 * $s / ($secs * $cores)) }
    $topCpu = @($cpu.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 3 |
        Where-Object { (& $share $_.Value) -ge 1 } | ForEach-Object { $_.Key + ' ' + (& $share $_.Value) + '%' })
    $topIo = @($io.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 3 |
        Where-Object { $_.Value / $secs -ge 100KB } |
        ForEach-Object { $_.Key + ' ' + ($_.Value / $secs / 1MB).ToString('0.#', [Globalization.CultureInfo]::InvariantCulture) + ' MB/s' })

    $said = @('processor ' + [Math]::Min(100, (& $share $all)) + '% busy' + $(if ($topCpu) { ' (' + ($topCpu -join ', ') + ')' } else { '' }))
    if ($a.disk -and $b.disk) {
        $span = [double]$b.disk.Timestamp_Sys100NS - [double]$a.disk.Timestamp_Sys100NS
        if ($span -gt 0) {
            $idle = ([double]$b.disk.PercentIdleTime - [double]$a.disk.PercentIdleTime) / $span
            $said += 'disks ' + [Math]::Max(0, [Math]::Min(100, [Math]::Round(100 * (1 - $idle)))) + '% busy'
        }
    }
    $said += $(if ($topIo) { 'most read and written: ' + ($topIo -join ', ') } else { 'nothing reading or writing much' })
    try {
        $os = Get-CimInstance Win32_OperatingSystem -Property TotalVisibleMemorySize, FreePhysicalMemory
        if ($os.TotalVisibleMemorySize -gt 0) { $said += 'memory ' + [Math]::Round(100 * (1 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) + '% used' }
    } catch { }

    $took = [Math]::Round(((Get-Date) - $asked).TotalSeconds, 1)
    Write-Log ('the PC' + $(if ($Why) { " while $Why" } else { '' }) + ': ' + ($said -join '; ') + "; the look took ${took}s")
} catch {
    Write-Log ('the PC could not be looked at: ' + $_.Exception.Message)
} finally {
    $mutex.ReleaseMutex()
}
