<#
    Xsegon - build the thumbnail cache.

        .\bin\thumbs.ps1              # only what is missing
        .\bin\thumbs.ps1 -Force       # rebuild everything
        .\bin\thumbs.ps1 -Width 320   # a different size

    PowerShell, not PHP: gd may be off in a shared php.ini, and System.Drawing
    is already on the machine. A cache because a full box art PNG can be near
    a megabyte for a tile the size of a playing card.
#>

param(
    [int]    $Width   = 400,
    [int]    $Quality = 82,
    [string] $Kind    = 'box',
    [string] $List    = '',
    [string] $Job     = '',
    [switch] $Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root    = Split-Path $PSScriptRoot -Parent
# The test runner's own copy of data\ when it set one (includes\boot.php).
# Told to use a folder that is gone: stop, never the real one (includes\boot.php).
if ($env:XSEGON_DATA -and -not (Test-Path -LiteralPath $env:XSEGON_DATA)) {
    Write-Host "XSEGON_DATA points at a folder that is gone: $env:XSEGON_DATA" -ForegroundColor Yellow
    exit 1
}
$data    = if ($env:XSEGON_DATA) { $env:XSEGON_DATA } else { Join-Path $root 'data' }
. (Join-Path $PSScriptRoot 'xslog.ps1')          # Test-XsegonLogging

# One line in data\log\<day>.log, the same shape as includes\boot.php writes.
# Best effort and silent: the log never breaks a build.
function Write-Log([string] $code, [string] $msg) {
    try {
        if (-not (Test-XsegonLogging $data)) { return }
        $dir = Join-Path $data 'log'
        if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = (Get-Date).ToString('HH:mm:ss.fff') + ' S ' + $code.PadRight(4) + ' ' + $msg + "`n"
        [System.IO.File]::AppendAllText($file, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}
# -Job: how far along, for the corner bar (includes\jobs.php). Written whole and
# moved into place, so a read never finds half of one. Best effort.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$total = 0; $seen = 0; $made = 0; $failed = 0
$jobStarted = 0
$jobSaid = [DateTime]::MinValue
if ($Job -and (Test-Path -LiteralPath $Job)) {
    try { $jobStarted = [int64](([System.IO.File]::ReadAllText($Job, $utf8).TrimStart([char]0xFEFF) | ConvertFrom-Json).started) } catch { }
}
function Write-Job([string] $state, [string] $why) {
    if (-not $Job) { return }
    try {
        $o = [ordered]@{ kind = $Kind; state = $state; started = $script:jobStarted; done = $script:seen; total = $script:total
                         built = $script:made; failed = $script:failed }
        if ($why) { $o.error = $why }
        $tmp = $Job + '.tmp'
        [System.IO.File]::WriteAllText($tmp, ($o | ConvertTo-Json -Compress), $utf8)
        Move-Item -LiteralPath $tmp -Destination $Job -Force
        $script:jobSaid = Get-Date
    } catch { }
}
# A build that dies outside the per-image try says where, and tells the bar,
# or the status strip stays on "building" for ever.
trap {
    Write-Log 'THM' ("the $Kind build died: " + $_.Exception.Message + ' at ' + $_.InvocationInfo.ScriptLineNumber)
    Write-Job 'failed' $_.Exception.Message
    break
}
$library = Join-Path $data 'library.json'
$outDir  = Join-Path $data "thumbs\$Kind"
$ownArt  = Join-Path $data 'art'

# -List: every game and the picture really shown, written by api\thumbs.php,
# one a line: ID, picture, title, tabs between. library.json holds only a
# LaunchBox import; it stays for a run by hand with no list.
$fromList = ($List -ne '' -and (Test-Path -LiteralPath $List))

if (-not $fromList -and -not (Test-Path -LiteralPath $library)) {
    Write-Log 'THM' "no list of pictures and no library.json, nothing to build ($Kind)"
    Write-Job 'failed' 'there was no list of pictures to build from'
    Write-Host "Nothing to build from. Use Settings > Library > Build thumbs in Xsegon." -ForegroundColor Yellow
    exit 1
}

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

if ($fromList) {
    $games = @()
    foreach ($line in [System.IO.File]::ReadAllLines($List, (New-Object System.Text.UTF8Encoding($false)))) {
        $part = $line.Split("`t", 3)
        if ($part.Count -ge 2 -and $part[0] -and $part[1]) {
            $games += [pscustomobject]@{ id = $part[0]; src = $part[1]; title = $(if ($part.Count -gt 2) { $part[2] } else { $part[0] }) }
        }
    }
    Remove-Item -LiteralPath $List -Force -ErrorAction SilentlyContinue
} else {
    $lib = Get-Content -LiteralPath $library -Raw -Encoding UTF8 | ConvertFrom-Json
    $games = $lib.games
}

# JPEG encoder, so quality is ours to choose rather than whatever the default is.
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
         Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)

# A clear logo is a shape on nothing, and it is drawn over whatever is behind
# it. Flattened into a JPEG it becomes a logo in a dark box, so logos keep their
# transparency as PNG. A 3D box is the same: a rendered box on nothing.
# Everything else is a full rectangle and stays JPEG.
$keepAlpha = ($Kind -eq 'logo' -or $Kind -eq 'box3d')
$ext       = if ($keepAlpha) { '.png' } else { '.jpg' }

$made = 0; $skipped = 0; $failed = 0; $noArt = 0
$started = Get-Date
$total = @($games).Count

foreach ($g in $games) {
    $seen++
    if (((Get-Date) - $jobSaid).TotalMilliseconds -ge 700) { Write-Job 'running' '' }
    if ($fromList) {
        $src = $g.src                   # already the one shown, replacements and all
    } else {
        $src = $g.art.$Kind
        # An image replaced in Xsegon (data\art\<id>-<kind>.<ext>) is the one
        # shown, here exactly as on screen. library.json never holds
        # the replacement, so it has to be looked for.
        $own = Get-ChildItem -LiteralPath $ownArt -Filter "$($g.id)-$Kind.*" -ErrorAction SilentlyContinue |
               Select-Object -First 1
        if ($own) { $src = $own.FullName }
    }
    if (-not $src) { $noArt++; continue }

    $dest = Join-Path $outDir ($g.id + $ext)

    if (-not $Force -and (Test-Path -LiteralPath $dest)) {
        # Only rebuild when the source is newer, so a re-run is nearly free.
        if ((Get-Item -LiteralPath $dest).LastWriteTime -ge (Get-Item -LiteralPath $src -ErrorAction SilentlyContinue).LastWriteTime) {
            $skipped++
            continue
        }
    }

    try {
        $img = [System.Drawing.Image]::FromFile($src)
        try {
            # Never upscale: a small source stays its own size rather than being
            # blown up into something blurrier than the original.
            $scale = [Math]::Min(1.0, $Width / [double]$img.Width)
            $w = [int][Math]::Round($img.Width * $scale)
            $h = [int][Math]::Round($img.Height * $scale)

            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            try {
                $gfx = [System.Drawing.Graphics]::FromImage($bmp)
                try {
                    $gfx.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $gfx.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $gfx.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                    # Box art is often a transparent PNG; flatten onto the panel
                    # colour rather than letting JPEG turn the alpha black.
                    if ($keepAlpha) { $gfx.Clear([System.Drawing.Color]::Transparent) }
                    else { $gfx.Clear([System.Drawing.ColorTranslator]::FromHtml('#0b1220')) }
                    $gfx.DrawImage($img, 0, 0, $w, $h)
                } finally { $gfx.Dispose() }

                if ($keepAlpha) { $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png) }
                else { $bmp.Save($dest, $codec, $params) }
                $made++
            } finally { $bmp.Dispose() }
        } finally { $img.Dispose() }
    } catch {
        $failed++
        Write-Host "  failed: $($g.title) -- $($_.Exception.Message)" -ForegroundColor DarkYellow
    }

    if (($made % 50) -eq 0 -and $made -gt 0) {
        Write-Host "  $made built..." -ForegroundColor DarkGray
    }
}

$seconds = [int]((Get-Date) - $started).TotalSeconds
$size = 0
Get-ChildItem -LiteralPath $outDir -Filter "*$ext" -ErrorAction SilentlyContinue |
    ForEach-Object { $size += $_.Length }

Write-Host ''
Write-Host "  thumbnails ($Kind, ${Width}px)" -ForegroundColor Cyan
Write-Host "  built   : $made"
Write-Host "  skipped : $skipped (already current)"
Write-Host "  no art  : $noArt"
if ($failed) { Write-Host "  failed  : $failed" -ForegroundColor DarkYellow }
Write-Host ("  cache   : {0:N1} MB in {1}s" -f ($size / 1MB), $seconds)

# A receipt the UI can read, so the status strip can say whether the cache is
# built without walking the folder on every request.
@{
    kind    = $Kind
    width   = $Width
    built   = $made
    total   = $made + $skipped
    bytes   = $size
    at      = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data "thumbs-$Kind.json") -Encoding UTF8
Write-Job 'done' ''

# Ends what the THM start line in api\thumbs.php opened.
Write-Log 'THM' ("$Kind done: $made built, $skipped current, $noArt without art" + $(if ($failed) { ", $failed failed" } else { '' }) + ", ${seconds}s")
