# Xsegon's All games picture: img\all-games.png, made from three of the console
# icons in img\consoles laid over each other, two of them tilted.
# Run from the Xsegon folder after the icons change:
#
#     powershell -ExecutionPolicy Bypass -File tools\make-all-games-icon.ps1
#
# The console picker and the sidebar's first row wear it on a copy with no
# picture of its own for All games (api\image.php, the last answer for @all).
# The icons are RetroArch's, CC-BY 4.0: img\consoles\ABOUT.txt credits them
# and says this picture is made from them.
param([string]$Out = '')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$from = Join-Path $root 'img\consoles'
if (-not $Out) { $Out = Join-Path $root 'img\all-games.png' }
$size = 256

# Back to front: the icon, where its middle goes, how wide it is drawn, its tilt in degrees.
$parts = @(
    @{ name = 'Nintendo - Game Boy'; x = 74; y = 112; wide = 172; tilt = -16 },
    @{ name = 'Sony - PlayStation'; x = 178; y = 92; wide = 156; tilt = 14 },
    @{ name = 'Nintendo - Super Nintendo Entertainment System'; x = 150; y = 182; wide = 206; tilt = -5 }
)

$canvas = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

foreach ($p in $parts) {
    $file = Join-Path $from ($p.name + '.png')
    if (-not (Test-Path -LiteralPath $file)) { throw "img\consoles has no $($p.name).png: run node tools\get-console-icons.js first" }
    $icon = [System.Drawing.Image]::FromFile($file)
    try {
        $g.ResetTransform()
        $g.TranslateTransform([single]$p.x, [single]$p.y)
        $g.RotateTransform([single]$p.tilt)
        $half = [single]($p.wide / 2)
        $g.DrawImage($icon, -$half, -$half, [single]$p.wide, [single]$p.wide)
    } finally { $icon.Dispose() }
}
$g.Dispose()
$canvas.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()
"made $Out ($((Get-Item -LiteralPath $Out).Length) bytes) from: $(($parts | ForEach-Object { $_.name }) -join ', ')"
