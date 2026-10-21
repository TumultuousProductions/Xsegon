<#
    Xsegon - fetch video snaps from ScreenScraper, in the background.

        powershell -File bin\screenscraper.ps1 -Job data\screenscraper-job.json -Account data\screenscraper.json
                                               [-Shared data\screenscraper-shared.dat]

    Started by api\screenscraper.php. Each game is asked for by name on its
    console, else by ROM file name, else by its name as a file name (as ES-DE
    asks), else by the longest word of its name, and taken only when the names
    agree (a wrong snap is worse than none); its video is saved as <dir>\<game id>.mp4.
    A game the job asks a manual for gets it from the same answer, in English or its own
    region, as <docs>\<docid>\Manual.pdf; one there for its manual alone has "video" false.
    A cover asked for (Get everything missing) lands as <boxes>\<game id>.<ext>, and
    Xsegon stores it as the game's box once the job has ended (xs_ss_keep_boxes).
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
# Written beside and swapped in, so the page never reads it half written; a swap Windows refuses
# while the server reads is tried again, and at the last it is written in place as before.
function Save-Job($j) {
    # A compare closed meanwhile took its job file away: nothing is written for nobody.
    if (($j.look -or $j.fetch) -and -not [IO.File]::Exists($Job)) { return }
    $text = $j | ConvertTo-Json -Depth 6
    $tmp = $Job + '.part'
    [IO.File]::WriteAllText($tmp, $text, $utf8)
    for ($try = 0; $try -lt 20; $try++) {
        try {
            # [NullString]: PowerShell would pass $null as "", which Replace refuses as a path.
            if ([IO.File]::Exists($Job)) { [IO.File]::Replace($tmp, $Job, [NullString]::Value) } else { [IO.File]::Move($tmp, $Job) }
            return
        } catch { Start-Sleep -Milliseconds 50 }
    }
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    [IO.File]::WriteAllText($Job, $text, $utf8)
}
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
# The same words in any order: "The Lost World: Jurassic Park" is "Jurassic Park - The Lost World".
function Words([string] $s) {
    $words = (($s.ToLowerInvariant() -replace '&', ' and ') -split '[^a-z0-9]+') |
        Where-Object { $_ -and @('the', 'a', 'an', 'and') -notcontains $_ } | Sort-Object
    return (@($words) -join ' ')
}
# The longest word of a name that says something: not a small word nor a number.
# One word never straddles ScreenScraper's punctuation, which its search needs word for word.
function Longest-Word([string] $s) {
    $best = ''
    foreach ($w in ($s -split '[^\p{L}\p{N}]+')) {
        if ($w.Length -lt 3 -or $w -match '^\d+$' -or @('the', 'and') -contains $w.ToLowerInvariant()) { continue }
        if ($w.Length -gt $best.Length) { $best = $w }
    }
    return $best
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
# $anyOrder: the same words in another order count too (the one-word search only).
function Is-Game($jeu, [string[]] $ours, [bool] $anyOrder = $false) {
    if (-not $jeu -or -not $jeu.noms) { return $false }
    foreach ($n in @($jeu.noms)) {
        $text = [string] $n.text
        if (-not $text) { continue }
        foreach ($o in $ours) {
            if (-not $o) { continue }
            if ((Key $text) -eq (Key $o) -or ((Loose $text) -and (Loose $text) -eq (Loose $o))) { return $true }
            if ($anyOrder -and (Words $text) -and (Words $text) -eq (Words $o)) { return $true }
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

# A PDF says "%PDF-" near its start; an error page does not.
function Is-Pdf([string] $file) {
    try {
        $fs = [IO.File]::OpenRead($file)
        try { $b = New-Object byte[] 1024; $n = $fs.Read($b, 0, 1024) } finally { $fs.Dispose() }
        return ($n -gt 0 -and [Text.Encoding]::ASCII.GetString($b, 0, $n).Contains('%PDF-'))
    } catch { return $false }
}

# Whether a game has a manual: a document of its own whose name starts with "Manual" (includes\archivedoc.php).
function Has-Manual([string] $id) {
    $dir = Join-Path $j.docs $id
    if (-not (Test-Path -LiteralPath $dir)) { return $false }
    return [bool] (Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'manual*' -and @('.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif') -contains $_.Extension.ToLowerInvariant() } |
        Select-Object -First 1)
}

# ScreenScraper's region words a ROM's name stands for: "(USA, Europe)" is us and eu.
function Regions-Of([string] $file) {
    $map = @{ usa = 'us'; europe = 'eu'; world = 'wor'; japan = 'jp'; france = 'fr'; germany = 'de'; spain = 'sp'; italy = 'it';
              australia = 'au'; brazil = 'br'; korea = 'kr'; uk = 'uk'; canada = 'ca'; netherlands = 'nl'; sweden = 'se'; china = 'cn' }
    $out = @()
    foreach ($m in [regex]::Matches($file.ToLowerInvariant(), '\(([^)]*)\)')) {
        foreach ($w in ($m.Groups[1].Value -split '[,\s]+')) { if ($map.ContainsKey($w)) { $out += $map[$w] } }
    }
    return $out
}

<#  A game's manual: a PDF in English (a US, World, European, British, Australian or Canadian
    one, in that order), else one of the game's own region. @{ url; md5; region }, or $null.  #>
function Manual-Of($jeu, [string[]] $own) {
    $all = @($jeu.medias | Where-Object { $_.type -eq 'manuel' -and $_.url -and (-not $_.format -or $_.format -eq 'pdf') })
    foreach ($r in (@('us', 'wor', 'eu', 'uk', 'au', 'ca') + $own)) {
        $m = $all | Where-Object { [string] $_.region -eq $r } | Select-Object -First 1
        if ($m) { return @{ url = [string] $m.url; md5 = ([string] $m.md5).ToLowerInvariant(); region = $r } }
    }
    return $null
}
function Any-Manual($jeu) { return (@($jeu.medias | Where-Object { $_.type -eq 'manuel' -and $_.url }).Count -gt 0) }

<#  A game's front cover: of the game's own region first (a box says the region it was sold in), then
    a US, World, European, British, Australian or Canadian one, then ScreenScraper's own, then any.
    @{ url; region }, or $null.  #>
function Box-Of($jeu, [string[]] $own) {
    $all = @($jeu.medias | Where-Object { $_.type -eq 'box-2D' -and $_.url })
    foreach ($r in (@($own) + @('us', 'wor', 'eu', 'uk', 'au', 'ca', 'ss'))) {
        $m = $all | Where-Object { [string] $_.region -eq $r } | Select-Object -First 1
        if ($m) { return @{ url = [string] $m.url; region = $r } }
    }
    $m = $all | Select-Object -First 1
    if ($m) { return @{ url = [string] $m.url; region = [string] $m.region } }
    return $null
}

# A picture's first bytes name its kind; an error page's do not. The ending it is kept under, or ''.
function Image-Ext([string] $file) {
    try {
        $fs = [IO.File]::OpenRead($file)
        try { $b = New-Object byte[] 12; $n = $fs.Read($b, 0, 12) } finally { $fs.Dispose() }
        if ($n -ge 8 -and $b[0] -eq 0x89 -and [Text.Encoding]::ASCII.GetString($b, 1, 3) -eq 'PNG') { return 'png' }
        if ($n -ge 3 -and $b[0] -eq 0xFF -and $b[1] -eq 0xD8 -and $b[2] -eq 0xFF) { return 'jpg' }
        if ($n -ge 12 -and [Text.Encoding]::ASCII.GetString($b, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($b, 8, 4) -eq 'WEBP') { return 'webp' }
        if ($n -ge 6 -and [Text.Encoding]::ASCII.GetString($b, 0, 4) -eq 'GIF8') { return 'gif' }
    } catch { }
    return ''
}

# A cover this job fetched before (a stopped job carries on), as its path, or ''.
function Staged-Box([string] $id) {
    $f = Get-ChildItem -LiteralPath $j.boxes -File -Filter ($id + '.*') -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f.FullName }
    return ''
}
# Whether a game has a cover of its own in data\art now (one stored since the job was made).
function Has-Own-Box([string] $id) {
    if (-not $j.art -or -not (Test-Path -LiteralPath $j.art)) { return $false }
    return [bool] (Get-ChildItem -LiteralPath $j.art -File -Filter ($id + '-box.*') -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# An address with the logins taken out, for a look's answer (includes\mediachoice.php keeps no login),
# and put back only here as it is fetched.
function Strip-Auth([string] $url) {
    $u = $url -replace '([?&])(devid|devpassword|softname|ssid|sspassword)=[^&]*', '$1'
    return (($u -replace '&{2,}', '&') -replace '\?&', '?') -replace '[?&]$', ''
}
# The logins go to ScreenScraper alone: its own servers, or the address its job was given to ask (a test's stand-in).
function Is-SS([string] $url) {
    try { $h = ([Uri] $url).Host } catch { return $false }
    return ($h -match '(^|\.)screenscraper\.fr$') -or ($script:ssHost -and $h -eq $script:ssHost)
}
function Add-Auth([string] $url) {
    if (-not (Is-SS $url)) { throw 'an address that is not ScreenScraper''s was not sent the logins' }
    return $url + $(if ($url.Contains('?')) { '&' } else { '?' }) + $auth
}

<#  A look at one game (the Media tab's compare, -Job data\mediachoice\<ticket>\ss.json): every picture,
    video and manual ScreenScraper has for it, each address without the logins, and the pictures of the
    kinds asked brought down into the ticket's folder, the game's own region first.  #>
function Look-At($jeu, $g) {
    $types = @('box-2D', 'box-3D', 'wheel-hd', 'wheel', 'ss', 'fanart', 'video-normalized', 'video', 'manuel')
    $own = @(Regions-Of ([string] $g.rom))
    Set-Field $g 'own' $own
    $list = @()
    foreach ($m in @($jeu.medias)) {
        if (-not $m.url -or $types -notcontains [string] $m.type) { continue }
        # Kept only when it is ScreenScraper's and no login is left in it (one written another way, &amp; and the like).
        $u = Strip-Auth ([string] $m.url)
        if (-not (Is-SS $u) -or $u -match 'password=|ssid=[^&]') { continue }
        $size = [long] 0
        [void][long]::TryParse([string] $m.size, [ref] $size)
        $list += [ordered]@{ type = [string] $m.type; region = [string] $m.region; format = [string] $m.format; size = $size
                             md5 = ([string] $m.md5).ToLowerInvariant(); url = $u; file = '' }
    }
    Set-Field $g 'medias' $list
    $g.state = 'listed'; Save-Job $j
    $order = @($own) + @('us', 'wor', 'eu', 'uk', 'au', 'ca', 'ss', 'jp')
    foreach ($type in @($j.lookTypes)) {
        $mine = @(for ($i = 0; $i -lt $list.Count; $i++) { if ($list[$i].type -eq $type) { $i } })
        $mine = @($mine | Sort-Object { $r = [array]::IndexOf($order, $list[$_].region); if ($r -lt 0) { 99 } else { $r } }, { $_ })
        foreach ($i in ($mine | Select-Object -First ([int] $j.lookMax))) {
            # The compare closed: no more of its pictures are fetched, and none of the day's requests spent on them.
            if (-not [IO.File]::Exists($Job)) { return }
            $part = Join-Path $j.dir ('ss-' + $i + '.part')
            $got = Meaning (Get-Url (Add-Auth $list[$i].url) $part) $part
            if ($Halts.ContainsKey($got) -and $got -ne 'busy') {
                Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
                $script:halt = $Halts[$got]; return
            }
            $ext = $(if ($got -eq 'ok') { Image-Ext $part } else { '' })
            if (-not $ext) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue; continue }
            $name = 'ss-' + $i + '.' + $ext
            Move-Item -LiteralPath $part -Destination (Join-Path $j.dir $name) -Force
            $list[$i].file = $name
            Set-Field $g 'medias' $list; Save-Job $j
            if ($script:pause -gt 0) { Start-Sleep -Milliseconds $script:pause }
        }
    }
    $g.state = 'done'
    Save-Job $j
}

# Two answers of the same name (a hack, a re-release): the one with what this game is asked for.
function Has-Wanted($x) {
    if ($script:needV) { return [bool] (Video-Of $x) }
    if ($script:needM) { return (Any-Manual $x) }
    return [bool] (Box-Of $x @())
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
    if ($j.boxes) { New-Item -ItemType Directory -Force -Path $j.boxes | Out-Null }
    # A fetch ended by a crash or a shutdown leaves its folder, logins and all. One untouched for an
    # hour is gone; a live fetch writes in its own at every ask, so another copy's is never taken.
    $stale = (Get-Date).AddHours(-1)
    Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'xsegon-screenscraper-*' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $stale } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    $tmp = Join-Path $env:TEMP ('xsegon-screenscraper-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    Add-Type -AssemblyName System.Web.Extensions
    $script:reader = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $script:reader.MaxJsonLength = [int]::MaxValue
} catch {
    try {
        if ($j) { Set-Field $j 'state' 'failed'; Set-Field $j 'error' ('could not start: ' + $_.Exception.Message); Save-Job $j }
        # A job file that is not there has nobody waiting on it (a compare closed before this began): nothing is written.
        elseif ([IO.File]::Exists($Job)) { [IO.File]::WriteAllText($Job, ('{"state":"failed","error":"the job file could not be read: ' + ($_.Exception.Message -replace '["\\]', "'") + '"}'), $utf8) }
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
# The same with other words in the name's or file name's place.
function Fill-As([string] $template, $g, [string] $text) {
    $u = $template.Replace('{auth}', $auth).Replace('{system}', [string] $g.system)
    return $u.Replace('{title}', (& $enc $text)).Replace('{rom}', (& $enc $text))
}

# The host this job asks ScreenScraper at (its own, or a test's stand-in): only there do the logins go (Is-SS).
$ssHost = ''
try {
    if ($j.search) { $ssHost = ([Uri] ([string] $j.search).Replace('{auth}', '').Replace('{system}', '0').Replace('{title}', 'x')).Host }
    elseif ($j.host) { $ssHost = [string] $j.host }
} catch { $ssHost = '' }
$part = $null
try {
    # One file brought down for the Media tab's compare (a video or manual chosen there): its address
    # has no logins until here (Strip-Auth). -Job is that file's prep-*.json in the ticket's folder.
    if ($j.fetch) {
        $to = Join-Path $j.dir ([string] $j.to)
        $part = $to + '.part'
        $got = Meaning (Get-Url (Add-Auth ([string] $j.url)) $part) $part
        $ok = $got -eq 'ok' -and $(switch ([string] $j.type) { 'video' { Is-Mp4 $part } 'pdf' { Is-Pdf $part } default { [bool] (Image-Ext $part) } })
        if ($ok -and $j.md5 -and (Get-FileHash -LiteralPath $part -Algorithm MD5).Hash.ToLowerInvariant() -ne ([string] $j.md5).ToLowerInvariant()) { $ok = $false }
        if ($ok) {
            Move-Item -LiteralPath $part -Destination $to -Force
            Set-Field $j 'size' (Get-Item -LiteralPath $to).Length
            Set-Field $j 'got' $j.size
            $j.state = 'done'
        } else {
            Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue
            $j.state = 'failed'
            Set-Field $j 'why' $(if ($Halts.ContainsKey($got)) { $Halts[$got] } elseif ($got -ne 'ok') { 'ScreenScraper did not send it (' + $got + ')' } else { 'what came is not what was asked, or it came damaged' })
        }
    }
    $answer = Join-Path $tmp 'answer.json'
    # Versions of one game on one console share a name: the first one's snap
    # and cover are copied to the rest, and ScreenScraper is asked once.
    $snaps = @{}
    $covers = @{}
    foreach ($g in $j.games) {
        # A job made before manuals has no "video": each of its games is there for its video.
        # A manual is asked for in the same answer, and kept in its card's documents (docid); a cover too.
        $wantV = ($null -eq $g.video) -or [bool] $g.video
        $wantM = [bool] $g.manual -and [bool] $j.docs
        $wantB = [bool] $g.box -and [bool] $j.boxes
        $docid = if ($g.docid) { [string] $g.docid } else { [string] $g.id }
        $out  = Join-Path $j.dir ($g.id + '.mp4')
        $part = $out + '.part'
        $same = ([string] $g.system) + '-' + (Key ([string] $g.title))
        $needV = $false
        if ($wantV) {
            if (Test-Path -LiteralPath $out) { $g.state = 'done'; $snaps[$same] = $out }
            elseif ($snaps.ContainsKey($same)) {
                Copy-Item -LiteralPath $snaps[$same] -Destination $out -Force
                $g.state = 'done'
                Set-Field $g 'bytes' (Get-Item -LiteralPath $out).Length
                Save-Job $j
            } else { $needV = $true }
        }
        $needM = $wantM -and -not (Has-Manual $docid)
        if ($wantM -and -not $needM) { Set-Field $g 'mstate' 'done' }
        $needB = $false
        if ($wantB) {
            $staged = Staged-Box ([string] $g.id)
            if ($staged) { Set-Field $g 'bstate' 'got'; Set-Field $g 'bfile' (Split-Path -Leaf $staged); $covers[$same] = $staged }
            elseif (Has-Own-Box ([string] $g.id)) { Set-Field $g 'bstate' 'had' }
            elseif ($covers.ContainsKey($same)) {
                $to = Join-Path $j.boxes ([string] $g.id + [IO.Path]::GetExtension($covers[$same]))
                Copy-Item -LiteralPath $covers[$same] -Destination $to -Force
                Set-Field $g 'bstate' 'got'; Set-Field $g 'bfile' (Split-Path -Leaf $to)
            } else { $needB = $true }
        }
        # A look (the Media tab's compare) brings nothing down by these rules: it asks for what its kinds are.
        if ($j.look) { $needV = [bool] $g.video; $needM = [bool] $g.manual; $needB = [bool] $g.box }
        if (-not $needV -and -not $needM -and -not $needB) {
            # "manual": a game there for its manual or its cover alone, through with
            if (-not $wantV) { $g.state = 'manual' }
            Save-Job $j
            continue
        }
        # A game whose video is in already (another version's) asks for its manual or cover alone, and keeps "done" after.
        $was = $g.state
        $g.state = 'asking'; Save-Job $j

        $ours = @([string] $g.title, (Rom-Title ([string] $g.rom)))
        $jeu = $null
        $by = 'name'
        $unreadable = $false

        # 1. by the game's name
        $json = Ask (Fill $j.search $g) $answer
        if ($script:halt) { $g.state = 'waiting'; break }
        if ($script:asked -eq 'failed') { $unreadable = $true }
        if ($json -and $json.response -and $json.response.jeux) {
            $named = @(@($json.response.jeux) | Where-Object { Is-Game $_ $ours })
            # two of the same name (a hack, a re-release): the one with what is asked for
            $jeu = @($named | Where-Object { Has-Wanted $_ }) + $named | Select-Object -First 1
        }

        # 2. by the ROM file's name, believed only when the names agree
        if (-not $jeu -and $g.rom) {
            $by = 'file'
            $json = Ask (Fill $j.rom $g) $answer
            if ($script:halt) { $g.state = 'waiting'; break }
            if ($script:asked -eq 'failed') { $unreadable = $true }
            if ($json -and $json.response -and (Is-Game $json.response.jeu $ours)) { $jeu = $json.response.jeu }
        }

        # 3. by the game's name as a file name, as ES-DE asks: ScreenScraper's own matching
        #    gets past punctuation its search needs word for word ("Zelda : Breath of the Wild")
        if (-not $jeu -and $g.title) {
            $by = 'title as a file name'
            $json = Ask (Fill-As $j.rom $g ([string] $g.title)) $answer
            if ($script:halt) { $g.state = 'waiting'; break }
            if ($script:asked -eq 'failed') { $unreadable = $true }
            if ($json -and $json.response -and (Is-Game $json.response.jeu $ours)) { $jeu = $json.response.jeu }
        }

        # 4. by the longest word of its name (at most 30 answers), the same words in any order taken
        $word = Longest-Word ([string] $g.title)
        if (-not $jeu -and $word -and (Key $word) -ne (Key ([string] $g.title))) {
            $by = 'one word'
            $json = Ask (Fill-As $j.search $g $word) $answer
            if ($script:halt) { $g.state = 'waiting'; break }
            if ($script:asked -eq 'failed') { $unreadable = $true }
            if ($json -and $json.response -and $json.response.jeux) {
                $named = @(@($json.response.jeux) | Where-Object { Is-Game $_ $ours $true })
                $jeu = @($named | Where-Object { Has-Wanted $_ }) + $named | Select-Object -First 1
            }
        }
        if ($jeu) { Set-Field $g 'by' $by }

        # how much of the day's allowance is gone, as ScreenScraper counts it
        if ($json -and $json.response -and $json.response.ssuser -and $json.response.ssuser.maxrequestsperday) {
            Set-Field $j 'used' ([int] $json.response.ssuser.requeststoday)
            Set-Field $j 'allowed' ([int] $json.response.ssuser.maxrequestsperday)
        }

        if ($j.look) {
            if (-not $jeu) { $g.state = $(if ($unreadable) { 'failed' } else { 'none' }); Save-Job $j; continue }
            Look-At $jeu $g
            if ($script:halt) { break }
            continue
        }

        if (-not $jeu) {
            $miss = $(if ($unreadable) { 'failed' } else { 'none' })
            if ($needV) { $g.state = $miss } elseif (-not $wantV) { $g.state = 'manual' } else { $g.state = $was }
            if ($needM) { Set-Field $g 'mstate' $miss }
            if ($needB) { Set-Field $g 'bstate' $miss }
            Save-Job $j
            continue
        }

        if ($needV) {
            $url = Video-Of $jeu
            if (-not $url) { $g.state = 'novideo'; Save-Job $j }
            else {
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
                    $g.state = 'failed'
                } else {
                    Move-Item -LiteralPath $part -Destination $out -Force
                    $snaps[$same] = $out
                    $g.state = 'done'
                    Set-Field $g 'bytes' (Get-Item -LiteralPath $out).Length
                }
                Save-Job $j
                if ($script:pause -gt 0) { Start-Sleep -Milliseconds $script:pause }
            }
        }
        if (-not $wantV) { $g.state = 'manual' } elseif (-not $needV) { $g.state = $was }

        # The manual: downloaded into the job's own temp folder, so a documents folder is a game's
        # only once its manual is whole and a PDF, checked against ScreenScraper's checksum.
        if ($needM) {
            $man = Manual-Of $jeu (Regions-Of ([string] $g.rom))
            if (-not $man) {
                Set-Field $g 'mstate' $(if (Any-Manual $jeu) { 'other' } else { 'nomanual' })
            } else {
                $mpart = Join-Path $tmp 'manual.part'
                $got = Meaning (Get-Url ($man.url.Replace('ssid=&sspassword=', $mine)) $mpart) $mpart
                if ($Halts.ContainsKey($got) -and $got -ne 'busy') {
                    Remove-Item -LiteralPath $mpart -Force -ErrorAction SilentlyContinue
                    $script:halt = $Halts[$got]; Set-Field $g 'mstate' 'waiting'; break
                }
                $ok = $got -eq 'ok' -and (Is-Pdf $mpart)
                if ($ok -and $man.md5 -and (Get-FileHash -LiteralPath $mpart -Algorithm MD5).Hash.ToLowerInvariant() -ne $man.md5) { $ok = $false }
                if (-not $ok) {
                    Remove-Item -LiteralPath $mpart -Force -ErrorAction SilentlyContinue
                    Set-Field $g 'mstate' 'failed'
                } elseif (Has-Manual $docid) {
                    # One came meanwhile: it stays.
                    Remove-Item -LiteralPath $mpart -Force -ErrorAction SilentlyContinue
                    Set-Field $g 'mstate' 'done'
                } else {
                    $dir = Join-Path $j.docs $docid
                    New-Item -ItemType Directory -Force -Path $dir | Out-Null
                    $to = Join-Path $dir 'Manual.pdf'
                    Move-Item -LiteralPath $mpart -Destination $to -Force
                    Set-Field $g 'mstate' 'done'
                    Set-Field $g 'mregion' $man.region
                    Set-Field $g 'mbytes' (Get-Item -LiteralPath $to).Length
                }
                if ($script:pause -gt 0) { Start-Sleep -Milliseconds $script:pause }
            }
        }

        # The cover: downloaded into the job's own temp folder, and kept as <boxes>\<id>.<ext> once it is a picture.
        if ($needB) {
            $box = Box-Of $jeu (Regions-Of ([string] $g.rom))
            if (-not $box) { Set-Field $g 'bstate' 'nobox' }
            else {
                $bpart = Join-Path $tmp 'box.part'
                $got = Meaning (Get-Url ($box.url.Replace('ssid=&sspassword=', $mine)) $bpart) $bpart
                if ($Halts.ContainsKey($got) -and $got -ne 'busy') {
                    Remove-Item -LiteralPath $bpart -Force -ErrorAction SilentlyContinue
                    $script:halt = $Halts[$got]; Set-Field $g 'bstate' 'waiting'; break
                }
                $ext = $(if ($got -eq 'ok') { Image-Ext $bpart } else { '' })
                if (-not $ext) {
                    Remove-Item -LiteralPath $bpart -Force -ErrorAction SilentlyContinue
                    Set-Field $g 'bstate' 'failed'
                } else {
                    $to = Join-Path $j.boxes ([string] $g.id + '.' + $ext)
                    Move-Item -LiteralPath $bpart -Destination $to -Force
                    $covers[$same] = $to
                    Set-Field $g 'bstate' 'got'
                    Set-Field $g 'bfile' (Split-Path -Leaf $to)
                    Set-Field $g 'bregion' $box.region
                }
                if ($script:pause -gt 0) { Start-Sleep -Milliseconds $script:pause }
            }
        }
        Save-Job $j
    }
    if ($script:halt) {
        $j.state = 'failed'
        Set-Field $j 'error' $script:halt
    } elseif (-not $j.fetch) {
        $j.state = 'done'
    }
}
catch {
    $j.state = 'failed'
    Set-Field $j 'error' ('stopped: ' + $_.Exception.Message)
    # A compare's download says why where the compare reads it, and leaves no half file behind.
    if ($j.fetch) {
        Set-Field $j 'why' ('it stopped: ' + $_.Exception.Message)
        if ($part) { Remove-Item -LiteralPath $part -Force -ErrorAction SilentlyContinue }
    }
}
finally {
    # the answers in here carry the logins in their addresses
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Set-Field $j 'ended' ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
Save-Job $j
