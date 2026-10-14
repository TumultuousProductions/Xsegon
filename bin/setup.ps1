<#
    Xsegon - fetch RetroArch or cores in the background.

        powershell -File bin\setup.ps1 -Job data\setup-job.json

    Started by api\setup.php after a confirmation. It writes only into the
    folder the job names, and reports back into the job file, which the page reads.

    curl.exe and tar.exe (bsdtar, which opens .7z and .zip) ship with Windows
    10 and 11. The bundled 7zr.exe unpacks RetroArch first because it reports
    progress; tar does it when 7zr is missing or fails. RetroArch's download is
    checked against the SHA-256 in includes\setup.php before it is unpacked.
#>

param([Parameter(Mandatory = $true)][string] $Job)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
$tar  = Join-Path $env:SystemRoot 'System32\tar.exe'    # the job may name another: see below

function Read-Job { ConvertFrom-Json ([IO.File]::ReadAllText($Job, $utf8)) }
function Save-Job($j) { [IO.File]::WriteAllText($Job, ($j | ConvertTo-Json -Depth 6), $utf8) }
function Now { [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
function Set-Field($j, $name, $value) {
    if ($j.PSObject.Properties[$name]) { $j.$name = $value } else { $j | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}

# A job file this cannot read must end as failed, not "running" for hours.
# Written by hand, since Fail leans on the object that could not be read.
try { $j = Read-Job } catch {
    try { [IO.File]::WriteAllText($Job, ('{"state":"failed","error":"the job file could not be read: ' + ($_.Exception.Message -replace '["\\]', "'") + '"}'), $utf8) } catch { }
    exit 1
}

# The server asks Windows whether this process is still alive, instead of
# waiting hours to give up on it.
try { Set-Field $j 'pid' $PID; Save-Job $j } catch { }

# A job may say which tar to run: only the tests' job files do, to stand in a
# failing tar; api\setup.php never writes it.
if ($j.PSObject.Properties['tar'] -and $j.tar) { $tar = [string]$j.tar }

# $detail is for the log (includes\setup.php writes it after the reason): the
# program's own words, which the screen has no room for.
function Fail($why, $detail = '') {
    Set-Field $j 'state' 'failed'
    Set-Field $j 'error' $why
    if ($detail) { Set-Field $j 'detail' $detail }
    Set-Field $j 'ended' ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    Save-Job $j
    if ($prog) { Remove-Item -LiteralPath $prog -Force -ErrorAction SilentlyContinue }   # the unpack's percentage file
    exit 1
}

<# Native tools are run with errors NOT stopping the script: in Windows
   PowerShell 5.1 stderr becomes an error record, and with 'Stop' one core
   that 404s would end the whole job. The exit code is what is trusted. #>
function Run-Native($exe, [string[]] $argv) {
    $ErrorActionPreference = 'Continue'
    & $exe @argv 2>&1 | Out-Null
    return $LASTEXITCODE
}

<# The same, keeping the last 600 characters of what the program said, on one
   line, so a failed unpack's log says why. #>
function Run-NativeSaid($exe, [string[]] $argv) {
    $ErrorActionPreference = 'Continue'
    $said = ''
    try { $said = ((& $exe @argv 2>&1 | ForEach-Object { "$_" }) -join ' | ') } catch { $said = "could not be run: $($_.Exception.Message)" }
    $code = $LASTEXITCODE
    $said = ($said -replace '\s+', ' ').Trim()
    if ($said.Length -gt 600) { $said = $said.Substring($said.Length - 600) }
    return @{ code = $code; said = $said }
}

<# 7-Zip's extractor, its percentage going into $prog as it works (-bsp1),
   for the page's unpack bar. Never throws: a 7zr that cannot be started is
   a first road that failed, and tar takes over. What it said on the way
   out comes back as Run-NativeSaid gives it. #>
function Run-Seven($exe, $archive, $into, $prog) {
    $errf = $prog + '.err'
    $code = -1
    $said = ''
    try {
        $p = Start-Process -FilePath $exe -NoNewWindow -Wait -PassThru -RedirectStandardOutput $prog -RedirectStandardError $errf `
                 -ArgumentList @('x', '-t7z', ('"' + $archive + '"'), ('"-o' + $into + '"'), '-y', '-bso0', '-bsp1')
        if ($null -ne $p.ExitCode) { $code = $p.ExitCode }
        try { $said = [IO.File]::ReadAllText($errf) } catch { }
    } catch { $said = "could not be run: $($_.Exception.Message)" }
    Remove-Item -LiteralPath $errf -Force -ErrorAction SilentlyContinue
    $said = ($said -replace '\s+', ' ').Trim()
    if ($said.Length -gt 600) { $said = $said.Substring($said.Length - 600) }
    return @{ code = $code; said = $said }
}

<# A folder and all in it, whatever the length of the names: RetroArch's
   archive unpacked under a deep folder passes Windows' 260, and Remove-Item
   in Windows PowerShell 5.1 then leaves the folder behind. The \\?\ form has
   no such limit; rd is the second try, for a file marked read-only. #>
function Remove-Tree($path) {
    # Never a drive or a blank: only ever the job's own staging folder.
    if (-not $path -or ([string]$path).TrimEnd('\').Length -lt 8) { return }
    if (-not (Test-Path -LiteralPath $path)) { return }
    try { [IO.Directory]::Delete('\\?\' + [IO.Path]::GetFullPath($path), $true) } catch { }
    if (Test-Path -LiteralPath $path) { $null = Run-Native $env:ComSpec @('/c', 'rd', '/s', '/q', ('\\?\' + [IO.Path]::GetFullPath($path))) }
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue }
}

function Fetch($url, $to) {
    # --fail: a 404 page is an error, not a 1 KB "download". Given up only
    # when stalled (no connection in 20 s, or under 1 KB/s for a minute), so a
    # slow download that is moving is never cut off.
    $code = Run-Native $curl @('-L', '--fail', '--silent', '--show-error', '--retry', '2',
                               '--connect-timeout', '20', '--speed-limit', '1024', '--speed-time', '60', '-o', $to, $url)
    return ($code -eq 0 -and (Test-Path -LiteralPath $to))
}

try {
    if ($j.kind -eq 'retroarch') {
        # The package's own copy (runtime\RetroArch) is unpacked where it is, checked the same and kept.
        $carried = [bool]($j.PSObject.Properties['local'] -and $j.local)
        $archive = if ($carried) { [string]$j.local } else { [string]$j.part }
        if (-not $carried) {
            Set-Field $j 'step' 'download'; Set-Field $j 'tDownload' (Now); Save-Job $j
            if (Test-Path -LiteralPath $j.part) { Remove-Item -LiteralPath $j.part -Force }
            if (-not (Fetch $j.url $j.part)) { Fail "the download did not finish (is the internet on?)" }
        }

        Set-Field $j 'step' 'check'; Set-Field $j 'tCheck' (Now); Save-Job $j
        $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower()
        if ($hash -ne $j.sha256) {
            if ($carried) { Fail "the RetroArch that came with Xsegon is not the one it was tested with (a damaged download?): unzip Xsegon again, or install RetroArch from retroarch.com" }
            Remove-Item -LiteralPath $j.part -Force
            Fail "the file from libretro is not the one Xsegon was tested with, so it was thrown away (it may have changed on their site)"
        }

        Set-Field $j 'step' 'unpack'; Set-Field $j 'tUnpack' (Now); Save-Job $j
        Remove-Tree $j.stage
        if (Test-Path -LiteralPath $j.stage) { Fail "the folder $($j.stage), left by an earlier try, could not be cleared. Delete it and try again" }
        New-Item -ItemType Directory -Path $j.stage | Out-Null

        <# The first road: bin\7zr.exe (tools\get-7zr.js), slower than tar but
           it reports a percentage for the unpack bar. Missing, unstartable or
           a bad exit, and tar unpacks into a clean folder with no percentage. #>
        $seven = [string]$j.sevenzip
        $prog  = if ($j.PSObject.Properties['prog'] -and $j.prog) { [string]$j.prog } else { [string]$j.part + '.percent' }
        Remove-Item -LiteralPath $prog -Force -ErrorAction SilentlyContinue
        $first = ''
        $with  = ''
        if ($seven -and (Test-Path -LiteralPath $seven)) {
            $z = Run-Seven $seven $archive $j.stage $prog
            if ($z.code -eq 0) {
                $with = '7zr'
                try { [IO.File]::AppendAllText($prog, "`r100%`r") } catch { }      # its own last word is in the nineties
            } else {
                $first = "7zr exit " + $z.code + ", said: " + $(if ($z.said) { $z.said } else { '(nothing)' })
                Remove-Item -LiteralPath $prog -Force -ErrorAction SilentlyContinue
                Remove-Tree $j.stage                       # it may have left half of RetroArch behind
                if (Test-Path -LiteralPath $j.stage) { Fail "the folder $($j.stage) could not be cleared after the first try at unpacking. Delete it and try again" $first }
                New-Item -ItemType Directory -Path $j.stage | Out-Null
            }
        } else { $first = 'there is no bin\7zr.exe' }
        if (-not $with) {
            $un = Run-NativeSaid $tar @('-xf', $archive, '-C', $j.stage)
            if ($un.code -ne 0) {
                <# Enough to tell the suspects apart (a tar with no LZMA, or
                   names too long for the folder): what 7zr said, tar's words
                   and exit code, its version, and the folder's path length. #>
                $which = Run-NativeSaid $tar @('--version')
                Fail ("the download would not unpack on this PC. You can install RetroArch yourself from retroarch.com " +
                      "and Getting started will offer to use it") ($first + "; then tar exit " + $un.code + ", said: " +
                      $(if ($un.said) { $un.said } else { '(nothing)' }) +
                      "; " + $(if ($which.said) { $which.said } else { 'tar --version said nothing' }) +
                      "; unpacking into a path of " + ([string]$j.stage).Length + " characters; the download is " +
                      $(try { (Get-Item -LiteralPath $archive).Length } catch { '?' }) + " bytes")
            }
            $with = 'tar'
            Set-Field $j 'detail' $first               # why there was no percentage, for the log
        }
        Set-Field $j 'unpackedWith' $with
        Save-Job $j
        $exe = Get-ChildItem -LiteralPath $j.stage -Filter 'retroarch.exe' -Recurse -Depth 2 | Select-Object -First 1
        if (-not $exe) { Fail "there was no retroarch.exe inside the download" }
        if (Test-Path -LiteralPath $j.dest) { Fail "the folder $($j.dest) is already there, so nothing was moved into it" }
        Move-Item -LiteralPath $exe.Directory.FullName -Destination $j.dest
        New-Item -ItemType Directory -Force -Path (Join-Path $j.dest 'cores') | Out-Null
        Remove-Tree $j.stage
        if (-not $carried) { Remove-Item -LiteralPath $j.part -Force -ErrorAction SilentlyContinue }
    }
    elseif ($j.kind -eq 'cores') {
        New-Item -ItemType Directory -Force -Path $j.dest | Out-Null
        $tmp = Join-Path $env:TEMP ('xsegon-core-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp | Out-Null
        foreach ($c in $j.cores) {
            $c.state = 'fetching'; Save-Job $j
            $zip = Join-Path $tmp ($c.core + '_libretro.dll.zip')
            $dll = Join-Path $j.dest ($c.core + '_libretro.dll')
            if (Test-Path -LiteralPath $dll) { $c.state = 'done'; continue }   # arrived since it was asked for
            if (-not (Fetch ($j.base + $c.core + '_libretro.dll.zip') $zip)) { $c.state = 'failed'; Save-Job $j; continue }
            $code = Run-Native $tar @('-xf', $zip, '-C', $j.dest)
            $c.state = if ($code -eq 0 -and (Test-Path -LiteralPath $dll)) { 'done' } else { 'failed' }
            Save-Job $j
        }
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    else {
        Fail "unknown job"
    }
}
catch {
    Fail ("stopped: " + $_.Exception.Message)
}

Set-Field $j 'step' 'finish'
Set-Field $j 'state' 'done'
Set-Field $j 'ended' ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
Save-Job $j
# The unpack's percentage file goes last: any sooner and the bar loses its
# number while the job still says it is unpacking.
if ($prog) { Remove-Item -LiteralPath $prog -Force -ErrorAction SilentlyContinue }
