# Generates the app icon + splash + adaptive-icon foreground PNGs from
# pure code (no design tool needed). Re-run any time the brand changes.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-assets.ps1

Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '..\assets'
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }

function New-IconPng {
    param(
        [string]$Path,
        [int]$Size = 1024,
        [string]$Bg = '#0b0d0c',
        [string]$Accent = '#c5fc4b',
        [bool]$Transparent = $false
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    if ($Transparent) {
        $g.Clear([System.Drawing.Color]::Transparent)
    } else {
        $bgColor = [System.Drawing.ColorTranslator]::FromHtml($Bg)
        $g.Clear($bgColor)
    }

    $accentColor = [System.Drawing.ColorTranslator]::FromHtml($Accent)
    $accentBrush = New-Object System.Drawing.SolidBrush($accentColor)

    # Stroke ring representing a closed running loop.
    $strokeWidth = [int]($Size * 0.07)
    $accentPen = New-Object System.Drawing.Pen($accentColor, $strokeWidth)
    $accentPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    # Build a rounded polygon: 5-sided "loop" centred on canvas.
    $cx = $Size / 2
    $cy = $Size / 2
    $r = $Size * 0.30
    $points = New-Object System.Collections.Generic.List[System.Drawing.PointF]
    for ($i = 0; $i -lt 5; $i++) {
        $angle = ($i * 72.0 - 90.0) * [Math]::PI / 180.0
        $px = $cx + [Math]::Cos($angle) * $r
        $py = $cy + [Math]::Sin($angle) * $r
        $points.Add((New-Object System.Drawing.PointF($px, $py))) | Out-Null
    }

    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddPolygon($points.ToArray())

    # Fill with translucent accent then stroke.
    $fillColor = [System.Drawing.Color]::FromArgb(60, $accentColor.R, $accentColor.G, $accentColor.B)
    $fillBrush = New-Object System.Drawing.SolidBrush($fillColor)
    $g.FillPath($fillBrush, $gp)
    $g.DrawPath($accentPen, $gp)

    # Filled circle "start point" at the top vertex.
    $dotR = $Size * 0.06
    $dot = $points[0]
    $g.FillEllipse(
        $accentBrush,
        ($dot.X - $dotR), ($dot.Y - $dotR), ($dotR * 2), ($dotR * 2)
    )

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $accentPen.Dispose(); $accentBrush.Dispose(); $fillBrush.Dispose()
    Write-Output "wrote $Path"
}

function New-SplashPng {
    param(
        [string]$Path,
        [int]$Width = 1242,
        [int]$Height = 2436,
        [string]$Bg = '#0b0d0c',
        [string]$Accent = '#c5fc4b'
    )

    $bmp = New-Object System.Drawing.Bitmap($Width, $Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml($Bg))

    $accentColor = [System.Drawing.ColorTranslator]::FromHtml($Accent)
    $accentBrush = New-Object System.Drawing.SolidBrush($accentColor)
    $strokeWidth = [int]([Math]::Min($Width, $Height) * 0.025)
    $accentPen = New-Object System.Drawing.Pen($accentColor, $strokeWidth)
    $accentPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $cx = $Width / 2
    $cy = $Height * 0.42
    $r = [Math]::Min($Width, $Height) * 0.18

    $points = New-Object System.Collections.Generic.List[System.Drawing.PointF]
    for ($i = 0; $i -lt 5; $i++) {
        $angle = ($i * 72.0 - 90.0) * [Math]::PI / 180.0
        $px = $cx + [Math]::Cos($angle) * $r
        $py = $cy + [Math]::Sin($angle) * $r
        $points.Add((New-Object System.Drawing.PointF($px, $py))) | Out-Null
    }

    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddPolygon($points.ToArray())

    $fillColor = [System.Drawing.Color]::FromArgb(60, $accentColor.R, $accentColor.G, $accentColor.B)
    $fillBrush = New-Object System.Drawing.SolidBrush($fillColor)
    $g.FillPath($fillBrush, $gp)
    $g.DrawPath($accentPen, $gp)

    $dotR = $r * 0.18
    $dot = $points[0]
    $g.FillEllipse($accentBrush, ($dot.X - $dotR), ($dot.Y - $dotR), ($dotR * 2), ($dotR * 2))

    # Wordmark.
    $titleFont = New-Object System.Drawing.Font('Segoe UI Black', 64, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('TERRITORY RUN', $titleFont, $textBrush, $cx, $cy + $r + 120, $sf)

    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    $accentPen.Dispose(); $accentBrush.Dispose(); $fillBrush.Dispose()
    $titleFont.Dispose(); $textBrush.Dispose()
    Write-Output "wrote $Path"
}

New-IconPng -Path (Join-Path $assets 'icon.png') -Size 1024
New-IconPng -Path (Join-Path $assets 'adaptive-icon.png') -Size 1024 -Transparent $true
New-IconPng -Path (Join-Path $assets 'favicon.png') -Size 64
New-SplashPng -Path (Join-Path $assets 'splash.png') -Width 1242 -Height 2436
