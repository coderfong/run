# Generates the app icon + splash + adaptive-icon foreground PNGs from
# pure code (no design tool needed). Re-run any time the brand changes.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-assets.ps1
#
# Identity: the night-run look — a single glowing loop made of the four
# team colours (there is no 5th brand colour; the teams ARE the brand),
# with a white start dot, on the dark #0b0d10 surface.

Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\assets'
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }

# theme.js darkColors.bg + the four team glow colours.
$BG = '#0b0d10'
$TEAM_GLOWS = @('#c084fc', '#4ade80', '#60a5fa', '#f87171')  # N E S W

function Draw-Loop {
    param(
        [System.Drawing.Graphics]$g,
        [double]$cx, [double]$cy, [double]$r, [double]$strokeWidth
    )
    # Four 90-degree arcs, one per team, drawn twice: a wide translucent
    # halo (the glow) underneath a bright core stroke.
    $rect = New-Object System.Drawing.RectangleF(($cx - $r), ($cy - $r), ($r * 2), ($r * 2))
    for ($pass = 0; $pass -lt 2; $pass++) {
        for ($i = 0; $i -lt 4; $i++) {
            $c = [System.Drawing.ColorTranslator]::FromHtml($TEAM_GLOWS[$i])
            if ($pass -eq 0) {
                $pen = New-Object System.Drawing.Pen(
                    [System.Drawing.Color]::FromArgb(70, $c.R, $c.G, $c.B), ($strokeWidth * 2.6))
            } else {
                $pen = New-Object System.Drawing.Pen($c, $strokeWidth)
            }
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            # small gaps between arcs so the four segments read distinctly
            $g.DrawArc($pen, $rect, ($i * 90.0 - 86.0), 82.0)
            $pen.Dispose()
        }
    }
    # White start dot at the top of the loop (12 o'clock).
    $dotR = $strokeWidth * 0.85
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $g.FillEllipse($white, ($cx - $dotR), ($cy - $r - $dotR), ($dotR * 2), ($dotR * 2))
    $white.Dispose()
}

function New-IconPng {
    param(
        [string]$Path,
        [int]$Size = 1024,
        [bool]$Transparent = $false
    )
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    if ($Transparent) {
        $g.Clear([System.Drawing.Color]::Transparent)
    } else {
        $g.Clear([System.Drawing.ColorTranslator]::FromHtml($BG))
    }

    Draw-Loop -g $g -cx ($Size / 2) -cy ($Size / 2) -r ($Size * 0.29) -strokeWidth ($Size * 0.055)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "wrote $Path"
}

function New-SplashPng {
    param(
        [string]$Path,
        [int]$Width = 1242,
        [int]$Height = 2436
    )
    $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml($BG))

    $cx = $Width / 2
    $cy = $Height * 0.42
    $r = [Math]::Min($Width, $Height) * 0.17

    Draw-Loop -g $g -cx $cx -cy $cy -r $r -strokeWidth ([Math]::Min($Width, $Height) * 0.028)

    # Wordmark.
    $titleFont = New-Object System.Drawing.Font('Segoe UI Black', 64, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('TERRITORY RUN', $titleFont, $textBrush, $cx, $cy + $r + 140, $sf)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $titleFont.Dispose(); $textBrush.Dispose()
    Write-Output "wrote $Path"
}

New-IconPng -Path (Join-Path $assets 'icon.png') -Size 1024
New-IconPng -Path (Join-Path $assets 'adaptive-icon.png') -Size 1024 -Transparent $true
New-IconPng -Path (Join-Path $assets 'favicon.png') -Size 64
New-SplashPng -Path (Join-Path $assets 'splash.png') -Width 1242 -Height 2436
