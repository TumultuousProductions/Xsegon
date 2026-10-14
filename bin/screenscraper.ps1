<#
    Xsegon - fetch video snaps from ScreenScraper, in the background.

        powershell -File bin\screenscraper.ps1 -Job data\screenscraper-job.json -Account data\screenscraper.json
                                               [-Shared data\screenscraper-shared.dat]

    Started by api\screenscraper.php. Each game is asked for by name on its
    console, else by ROM file name, and taken only when the names agree (a
    wrong snap is worse than none); its video is saved as <dir>\<game id>.mp4.
    A game already saved is skipped, so a stopped job carries on. One question
    at a time with a pause between: a free account is allowed one thread.
    -Shared is Xsegon's own developer ID as includes\screenscraper.php keeps it.

    The logins reach curl in a file in the job's own temp folder, deleted once
    curl has read it, never on its command line, where any program on the PC
    could read them; never in the job file or the log either. A refused login
    or a spent quota ends the whole job.
#>

param(
    [Parameter(Mandatory = $true)][string] $Job,
    [Parameter(Mandatory = $true)][string] $Account,
    [string] $Shared = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'

function Read-Job { ConvertFrom-Json ([IO.File]::ReadAllText($Job, $utf8)) }
function Save-Job($j) { [IO.File]::WriteAllText($Job, ($j | ConvertTo-Json -Depth 6), $utf8) }
function Set-Field($o, $name, $value) { $o | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }

# "Demon's Crest" and "Demon_s Crest" are both "demonscrest" (includes\art.php).
function Key([string] $s) { return ($s.ToLowerInvariant() -replace '[^a-z0-9]+', '') }
# The same with the small words gone, so "The Legend of Zelda" is also
# "Legend of Zelda, The", and "&" is "and".
function Loose([string] $s) {
    $words = (($s.ToLowerInvariant() -replace '&', ' and ') -split '[^a-z0-9]+') |
        Where-Object { $_ -and @('the', 'a', 'an', 'and') -notcontains $_ }
    return ($words -join '')
}
# A ROM's name without its extension and its notes: "Fable (USA) [!].iso" is "Fable".
function Rom-Title([string] $file) {
    if (-not $file) { return '' }
    return (([IO.Path]::GetFileNameWithoutExtension($file)) -replace '\([^)]*\)|\[[^\]]*\]', ' ').Trim()
}

<#  One address fetched into a file. The address goes to curl as a config
    line in a file, so no login is ever on a command line. Answers
    @{ exit; http }: curl's own exit code, and the status the server gave.  #>
function Get-Url([string] $url, [string] $to) {
    $ErrorActionPreference = 'Continue'
    if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Force }
    # Not piped: on a UTF-8 console PowerShell puts a byte order mark first, and curl refuses the line.
    $cfg = Join-Path $tmp 'ask.cfg'
    [IO.File]::WriteAllText($cfg, 'url = "' + ($url.Replace('\', '\\').Replace('"', '\"')) + '"', $utf8)
    $said = & $curl '-K' $cfg '-g' '-L' '--silent' '--retry' '2' '--connect-timeout' '20' `
                    '--speed-limit' '1024' '--speed-time' '60' '-o' $to '-w' '%{http_code}' 2>$null
    $code = $LASTEXITCODE
    Remove-Item -LiteralPath $cfg -Force -ErrorAction SilentlyContinue
    $http = 0
    [void][int]::TryParse(("$said").Trim(), [ref] $http)
    return @{ exit = $code; http = $http }
}

<#  Xsegon's own developer ID as includes\screenscraper.php keeps it: AES-256-CBC
    under an HMAC, keyed to this computer and Windows user. $null when it does not open.  #>
function Open-Kept([string] $path) {
    try {
        $sha   = [Security.Cryptography.SHA256]::Create()
        $bytes = { param([string] $s) [Text.Encoding]::UTF8.GetBytes($s) }
        $ascii = { param([string] $s) $s -replace '[^\x20-\x7E]', '' }
        $hex   = 'f63807d197f8ad93' + 'bab30783da0dd9f8' + 'c1b59077910be438' + '6732257fcc4def84'
        $raw   = [byte[]] (0..31 | ForEach-Object { [Convert]::ToByte($hex.Substring($_ * 2, 2), 16) })
        $site  = $sha.ComputeHash([byte[]] ($raw + (& $bytes 'xs-ss-1')))
        $key   = $sha.ComputeHash([byte[]] ($site + (& $bytes ('|' + (& $ascii $env:COMPUTERNAME) + '|' + (& $ascii $env:USERNAME)))))
        $all   = [Convert]::FromBase64String(([string] (ConvertFrom-Json ([IO.File]::ReadAllText($path, $utf8))).sealed).Trim())
        if ($all.Length -lt 64) { return $null }
        $body  = [byte[]] $all[0..($all.Length - 33)]
        $mac   = New-Object Security.Cryptography.HMACSHA256 (, $sha.ComputeHash([byte[]] ((& $bytes 'mac|') + $key)))
        if ([Convert]::ToBase64String($mac.ComputeHash($body)) -ne [Convert]::ToBase64String([byte[]] $all[($all.Length - 32)..($all.Length - 1)])) { return $null }
        $aes   = [Security.Cryptography.Aes]::Create()
        $aes.Key = $sha.ComputeHash([byte[]] ((& $bytes 'enc|') + $key))
        $aes.IV  = [byte[]] $body[0..15]
        $d     = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($aes.CreateDecryptor().TransformFinalBlock($body, 16, $body.Length - 16)))
        if (-not $d.devid -or -not $d.devpassword) { return $null }
        return $d
    } catch { return $null }
}

# What an answer means: ScreenScraper says each refusal with a status of its own.
function Meaning($r, [string] $file) {
    if ($r.exit -eq 0 -and $r.http -eq 200) { return 'ok' }
    if ($r.http -eq 404) { return 'notfound' }
    if ($r.http -eq 403) {
        $body = ''
        try { $body = [IO.File]::ReadAllText($file, $utf8).ToLowerInvariant() } catch { }
        if ($body -match 'veloppeur|developer') { return 'devlogin' }
        return 'login'
    }
    if ($r.http -eq 430 -or $r.http -eq 431) { return 'quota' }
    if ($r.http -eq 401 -or $r.http -eq 423) { return 'closed' }
    if ($r.http -eq 426) { return 'blocked' }
    if ($r.http -eq 429) { return 'busy' }
    return 'failed'
}

# The sentences api\screenscraper.php's own check uses (xs_ss_refusal).
$Halts = @{
    devlogin = 'ScreenScraper refused the developer ID and its password'
    login    = 'ScreenScraper refused the member name and password'
    quota    = "today's ScreenScraper quota is used up; start it again tomorrow and it carries on"
    closed   = 'ScreenScraper is closed to free accounts right now (it does that when it is busy); try again later'
    blocked  = 'ScreenScraper says this developer ID may not be used any more'
    busy     = 'ScreenScraper kept saying too many requests; try again in a while'
}
$script:halt = $null

<#  One question of the API. Answers the parsed JSON, $null for "not found"
    or an answer that will not read, and sets $script:halt when the reason
    is one that would be the same for every game after this one.            #>
function Ask([string] $url, [string] $file) {
    $what = 'failed'
    for ($try = 0; $try -lt 3; $try++) {
        $what = Meaning (Get-Url $url $file) $file
        if ($what -ne 'busy') { break }
        Start-Sleep -Seconds 15
    }
    if ($script:pause -gt 0) { Start-Sleep -Milliseconds $script:pause }
    if ($Halts.ContainsKey($what)) { $script:halt = $Halts[$what]; return $null }
    if ($what -ne 'ok') { $script:asked = $what; return $null }
    try {
        # Not ConvertFrom-Json: Windows PowerShell's stops at 2 MB, and thirty
        # games with every picture and every language listed can pass that.
        $json = $script:reader.DeserializeObject([IO.File]::ReadAllText($file, $utf8))
    } catch { $json = $null }
    # Every address in an answer carries both logins, so it is not left lying for the run.
    Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
    if ($null -eq $json) { $script:asked = 'failed'; return $null }
    $script:asked = 'ok'
    return $json
}

# Does this answer name the game? Any of its names against the title or the ROM's.
function Is-Game($jeu, [string[]] $ours) {
    if (-not $jeu -or -not $jeu.noms) { return $false }
    foreach ($n in @($jeu.noms)) {
        $text = [string] $n.text
        if (-not $text) { continue }
        foreach ($o in $ours) {
            if (-not $o) { continue }
            if ((Key $text) -eq (Key $o) -or ((Loose $text) -and (Loose $text) -eq (Loose $o))) { return $true }
        }
    }
    return $false
}

# The address of a game's video: normalised first, then as it was uploaded.
function Video-Of($jeu) {
    foreach ($type in @('video-normalized', 'video')) {
        $m = @($jeu.medias | Where-Object { $_.type -eq $type -and $_.url }) | Select-Object -First 1
        if ($m) { return [string] $m.url }
    }
    return ''
}

# An mp4 says "ftyp" in its first bytes; "NOMEDIA" and an error page do not.
function Is-Mp4([string] $file) {
    try {
        $fs = [IO.File]::OpenRead($file)
        try { $b = New-Object byte[] 12; $n = $fs.Read($b, 0, 12) } finally { $fs.Dispose() }
        return ($n -eq 12 -and [Text.Encoding]::ASCII.GetString($b, 4, 4) -eq 'ftyp')
    } catch { return $false }
}

# The first steps inside a try of their own: a job file this cannot read, or
# a folder that cannot be made, must end as "failed", not "running" for hours.
$j = $null
try {
    $j = Read-Job
    Set-Field $j 'pid' $PID; Save-Job $j      # so the server can ask Windows if this is alive
    $acc = ConvertFrom-Json ([IO.File]::ReadAllText($Account, $utf8))
    if ($Shared) {
        $dev = Open-Kept $Shared
        if (-not $dev) { throw "Xsegon's own developer ID did not open on this computer; press Check the login in the ScreenScraper window, then start it again" }
        foreach ($f in 'devid', 'devpassword', 'softname') { Set-Field $acc $f ([string] $dev.$f) }
        $Halts.devlogin = "ScreenScraper refused Xsegon's own developer ID and its password"
        $Halts.blocked  = "ScreenScraper says Xsegon's own developer ID may not be used any more"
    }
    New-Item -ItemType Directory -Force -Path $j.dir | Out-Null
    $tmp = Join-Path $env:TEMP ('xsegon-screenscraper-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Add-Type -AssemblyName System.Web.Extensions
    $script:reader = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $script:reader.MaxJsonLength = [int]::MaxValue
} catch {
    try {
        if ($j) { Set-Field $j 'state' 'failed'; Set-Field $j 'error' ('could not start: ' + $_.Exception.Message); Save-Job $j }
        else { [IO.File]::WriteAllText($Job, ('{"state":"failed","error":"the job file could not be read: ' + ($_.Exception.Message -replace '["\\]', "'") + '"}'), $utf8) }
    } catch { }
    exit 1
}

$enc  = { param($v) [uri]::EscapeDataString([string] $v) }
$soft = if ($acc.softname) { [string] $acc.softname } else { 'Xsegon' }
$auth = 'devid=' + (& $enc $acc.devid) + '&devpassword=' + (& $enc $acc.devpassword) + '&softname=' + (& $enc $soft) +
        '&ssid=' + (& $enc $acc.user) + '&sspassword=' + (& $enc $acc.password)
$mine = 'ssid=' + (& $enc $acc.user) + '&sspassword=' + (& $enc $acc.password)
$script:pause = [int] $j.pause
$script:asked = ''

function Fill([string] $template, $g) {
    $u = $template.Replace('{auth}', $auth).Replace('{system}', [string] $g.system)
    return $u.Replace('{title}', (& $enc $g.title)).Replace('{rom}', (& $enc $g.rom))
}

try {
    $answer = Join-Path $tmp 'answer.json'
    # Versions of one game on one console share a name: the first one's snap
    # is copied to the rest, and ScreenScraper is asked once.
    $snaps = @{}
    foreach ($g in $j.games) {
        $out  = Join-Path $j.dir ($g.id + '.mp4')
        $part = $out + '.part'
        $same = ([string] $g.system) + '-' + (Key ([string] $g.title))
        if (Test-Path -LiteralPath $out) { $g.state = 'done'; $snaps[$same] = $out; continue }
        if ($snaps.ContainsKey($same)) {
            Copy-Item -LiteralPath $snaps[$same] -Destination $out -Force
            $g.state = 'done'
            Set-Field $g 'bytes' (Get-Item -LiteralPath $out).Length
            Save-Job $j
            continue
        }
        $g.state = 'asking'; Save-Job $j

        $ours = @([string] $g.title, (Rom-Title ([string] $g.rom)))
        $jeu = $null
        $unreadable = $false

        # 1. by the game's name
        $json = Ask (Fill $j.search $g) $answer
        if ($script:halt) { $g.state = 'waiting'; break }
        if ($script:asked -eq 'failed') { $unreadable = $true }
        if ($json -and $json.response -and $json.response.jeux) {
            $named = @(@($json.response.jeux) | Where-Object { Is-Game $_ $ours })
            # two of the same name (a hack, a re-release): the one with a video
            $jeu = @($named | Where-Object { Video-Of $_ }) + $named | Select-Object -First 1
        }

        # 2. by the ROM file's name, believed only when the names agree
        if (-not $jeu -and $g.rom) {
            $json = Ask (Fill $j.rom $g) $answer
            if ($script:halt) { $g.state = 'waiting'; break }
            if ($script:asked -eq 'failed') { $unreadable = $true }
            if ($json -and $json.response -and (Is-Game $json.response.jeu $ours)) { $jeu = $json.response.jeu }
        }

        # how much of the day's allowance is gone, as ScreenScraper counts it
        if ($json -and $json.response -and $json.response.ssuser -and $json.response.ssuser.maxrequestsperday) {
            Set-Field $j 'used' ([int] $json.response.ssuser.requeststoday)
            Set-Field $j 'allowed' ([int] $json.response.ssuser.maxrequestsperday)
        }

        if (-not $jeu) { $g.state = $(if ($unreadable) { 'failed' } else { 'none' }); Save-Job $j; continue }
        $url = Video-Of $jeu
        if (-not $url) { $g.state = 'novideo'; Save-Job $j; continue }

        $g.state = 'fetching'; Save-Job $j
        # An address that comes back with the member login blank gets it filled
        # in, so the download counts as this person's and runs at their speed.
        $url = $url.Replace('ssid=&sspassword=', $mine)
        $got = Meaning (Get-Url $url $part) $part
        if ($Halts.ContainsKey($got) -and $got -ne 'busy') {
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            $script:halt = $Halts[$got]; $g.state = 'waiting'; break
        }
        if ($got -ne 'ok' -or -not (Is-Mp4 $part)) {
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            $g.state = 'failed'; Save-Job $j
            if ($script:pause -gt 0) { Start-Sleep -Milliseconds $script:pause }
            continue
        }
        Move-Item -LiteralPath $part -Destination $out -Force
        $snaps[$same] = $out
        $g.state = 'done'
        Set-Field $g 'bytes' (Get-Item -LiteralPath $out).Length
        Save-Job $j
        if ($script:pause -gt 0) { Start-Sleep -Milliseconds $script:pause }
    }
    if ($script:halt) {
        $j.state = 'failed'
        Set-Field $j 'error' $script:halt
    } else {
        $j.state = 'done'
    }
}
catch {
    $j.state = 'failed'
    Set-Field $j 'error' ('stopped: ' + $_.Exception.Message)
}
finally {
    # the answers in here carry the logins in their addresses
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Set-Field $j 'ended' ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
Save-Job $j
