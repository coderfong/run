# Generates the app icon + splash + adaptive-icon foreground from code.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-assets.ps1
#
# v2 identity: a SINGLE closed glowing loop — a night-run light trail — in a
# cool near-white glow on the dark #0B0D10 field. Clan-agnostic (the app icon
# can't be per-user), and it doubles as the wordmark "logo dot" reused in the
# auth header, empty states, and the share-card watermark.

Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\assets'
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }

$BG = '#0b0d10'
$GLOW = '#7dd3fc'   # cool sky glow
$CORE = '#f0f9ff'   # near-white core line

function Draw-Loop {
    param([System.Drawing.Graphics]$g, [double]$cx, [double]$cy, [double]$r, [double]$w)

    $rect = New-Object System.Drawing.RectangleF(($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
    $glow = [System.Drawing.ColorTranslator]::FromHtml($GLOW)
    $core = [System.Drawing.ColorTranslator]::FromHtml($CORE)

    # Layered glow halo (wide, translucent), widest first.
    foreach ($pass in @(@{mul=3.4; a=40}, @{mul=2.2; a=70}, @{mul=1.0; a=255})) {
        $col = if ($pass.a -eq 255) { $core } else {
            [System.Drawing.Color]::FromArgb($pass.a, $glow.R, $glow.G, $glow.B)
        }
        $pen = New-Object System.Drawing.Pen($col, ($w * $pass.mul))
        $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        # Open the loop slightly at the top so the start dot reads as the seam.
        $g.DrawArc($pen, $rect, -80, 340)
        $pen.Dispose()
    }

    # White start dot at 12 o'clock (the loop's start/finish seam).
    $dotR = $w * 0.9
    $white = New-Object System.Drawing.SolidBrush($core)
    $g.FillEllipse($white, ($cx - $dotR), ($cy - $r - $dotR), ($dotR * 2), ($dotR * 2))
    $white.Dispose()
}

function New-IconPng {
    param([string]$Path, [int]$Size = 1024, [bool]$Transparent = $false)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    if ($Transparent) { $g.Clear([System.Drawing.Color]::Transparent) }
    else { $g.Clear([System.Drawing.ColorTranslator]::FromHtml($BG)) }
    Draw-Loop -g $g -cx ($Size / 2) -cy ($Size / 2) -r ($Size * 0.28) -w ($Size * 0.05)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "wrote $Path"
}

function New-SplashPng {
    param([string]$Path, [int]$Width = 1242, [int]$Height = 2436)
    $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml($BG))
    $cx = $Width / 2; $cy = $Height * 0.42
    $r = [Math]::Min($Width, $Height) * 0.16
    Draw-Loop -g $g -cx $cx -cy $cy -r $r -w ([Math]::Min($Width, $Height) * 0.026)

    $titleFont = New-Object System.Drawing.Font('Segoe UI Black', 64, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('TERRITORY RUN', $titleFont, $textBrush, $cx, $cy + $r + 150, $sf)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $titleFont.Dispose(); $textBrush.Dispose()
    Write-Output "wrote $Path"
}

New-IconPng -Path (Join-Path $assets 'icon.png') -Size 1024
New-IconPng -Path (Join-Path $assets 'adaptive-icon.png') -Size 1024 -Transparent $true
New-IconPng -Path (Join-Path $assets 'favicon.png') -Size 64
New-SplashPng -Path (Join-Path $assets 'splash.png') -Width 1242 -Height 2436
