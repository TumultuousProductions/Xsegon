<#
    Xsegon - fetch Steam trailers as video snaps, in the background.

        powershell -File bin\steamvid.ps1 -Job data\steamvid-job.json

    Started by api\steamvid.php. Each game's highlighted trailer (else the
    first) is saved as <dir>\<game id>.mp4: the plain mp4 where Steam still
    serves it, else the HLS stream through ffmpeg when the job names one.
    "none" and "stream" (needs ffmpeg) are only ever Steam's own answer; an
    answer that cannot be read or a file that would not come is "failed",
    which is asked again at the next fetch.

    A game already saved is skipped, so a stopped job carries on. One Steam
    API call about every half second, well inside what the store allows.
#>

param([Parameter(Mandatory = $true)][string] $Job)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'

function Read-Job { ConvertFrom-Json ([IO.File]::ReadAllText($Job, $utf8)) }
function Save-Job($j) { [IO.File]::WriteAllText($Job, ($j | ConvertTo-Json -Depth 6), $utf8) }
function Set-Field($o, $name, $value) { $o | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }

# Native tools never stop the script: in Windows PowerShell 5.1 stderr
# becomes an error record, and one 404 must mark one game, not end the job.
function Run-Native($exe, [string[]] $argv) {
    $ErrorActionPreference = 'Continue'
    & $exe @argv 2>&1 | Out-Null
    return $LASTEXITCODE
}
function Fetch($url, $to) {
    # Given up only when stalled, as in setup.ps1. The code is kept: a refusal is told from a lost connection.
    $script:fetchCode = Run-Native $curl @('-L', '--fail', '--silent', '--retry', '2',
                               '--connect-timeout', '20', '--speed-limit', '1024', '--speed-time', '60', '-o', $to, $url)
    return ($script:fetchCode -eq 0 -and (Test-Path -LiteralPath $to) -and (Get-Item -LiteralPath $to).Length -gt 0)
}

# The first steps in a try of their own: a job file this cannot read, or a
# folder that cannot be made, must end as "failed", not "running" for hours.
try {
    $j = Read-Job
    Set-Field $j 'pid' $PID; Save-Job $j      # so the server can ask Windows if this is alive
    New-Item -ItemType Directory -Force -Path $j.dir | Out-Null
    $tmp = Join-Path $env:TEMP ('xsegon-steamvid-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
} catch {
    try {
        if ($j) { Set-Field $j 'state' 'failed'; Set-Field $j 'error' ("could not start: " + $_.Exception.Message); Save-Job $j }
        else { [IO.File]::WriteAllText($Job, ('{"state":"failed","error":"the job file could not be read: ' + ($_.Exception.Message -replace '["\\]', "'") + '"}'), $utf8) }
    } catch { }
    exit 1
}

try {
    foreach ($g in $j.games) {
        $out  = Join-Path $j.dir ($g.id + '.mp4')
        $part = $out + '.part'
        if (Test-Path -LiteralPath $out) { $g.state = 'done'; continue }
        $g.state = 'asking'; Save-Job $j

        $jsonFile = Join-Path $tmp ($g.appid + '.json')
        if (-not (Fetch ($j.api -replace '\{appid\}', $g.appid) $jsonFile)) { $g.state = 'failed'; Save-Job $j; continue }
        $movie = $null
        try {
            $info = ([IO.File]::ReadAllText($jsonFile, $utf8) | ConvertFrom-Json).($g.appid)
            if ($null -eq $info) { throw 'not an answer about this game' }
            if ($info.success -and $info.data.movies) {
                $movie = @($info.data.movies | Where-Object { $_.highlight }) + @($info.data.movies) | Select-Object -First 1
            }
        } catch {
            # Not Steam's answer (a Wi-Fi sign-in page, a busy page): nothing is known of its trailers.
            $g.state = 'failed'; Save-Job $j; Start-Sleep -Milliseconds 400; continue
        }
        if (-not $movie) { $g.state = 'none'; Save-Job $j; Start-Sleep -Milliseconds 400; continue }

        $g.state = 'fetching'; Save-Job $j
        if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force }
        $urls = @()
        if ($movie.mp4 -and $movie.mp4.max) { $urls += $movie.mp4.max }
        $urls += ($j.cdn -replace '\{movie\}', [string]$movie.id)
        $got = $false
        foreach ($u in $urls) { if (Fetch $u $part) { $got = $true; break } }
        # Steam named no file and its usual address has none: 22 is a server's no, 37 no file at the tests' file:// stand-in.
        $noFile = -not ($movie.mp4 -and $movie.mp4.max) -and ($script:fetchCode -eq 22 -or $script:fetchCode -eq 37)
        if (-not $got -and $movie.hls_h264) {
            if ($j.ffmpeg) {
                # -rw_timeout: 30 s with nothing from the stream ends it (microseconds)
                $code = Run-Native $j.ffmpeg @('-y', '-loglevel', 'error', '-rw_timeout', '30000000', '-i', $movie.hls_h264, '-map', '0:v:0', '-map', '0:a:0?',
                                                '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', $part)
                $got = ($code -eq 0 -and (Test-Path -LiteralPath $part))
                if (-not $got) { $g.state = 'failed'; Save-Job $j; continue }
            } elseif ($noFile) {
                $g.state = 'stream'; Save-Job $j; continue
            }
        }
        if (-not $got -and $noFile) { $g.state = 'none'; Save-Job $j; continue }
        # A file that would not come down is a failed fetch, never "no trailer".
        if (-not $got) { $g.state = 'failed'; Save-Job $j; continue }
        Move-Item -LiteralPath $part -Destination $out -Force
        $g.state = 'done'
        $g | Add-Member -NotePropertyName bytes -NotePropertyValue (Get-Item -LiteralPath $out).Length -Force
        Save-Job $j
        Start-Sleep -Milliseconds 400
    }
    $j.state = 'done'
}
catch {
    $j.state = 'failed'
    $j | Add-Member -NotePropertyName error -NotePropertyValue ("stopped: " + $_.Exception.Message) -Force
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
$j | Add-Member -NotePropertyName ended -NotePropertyValue ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Force
Save-Job $j
