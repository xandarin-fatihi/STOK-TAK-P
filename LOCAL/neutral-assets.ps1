$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$packageRoot = Split-Path -Parent $PSScriptRoot
$iconRoot = Join-Path $packageRoot 'ORTAK\ASSETS\APP-ICONS'

function New-RoundedPath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-NeutralIcon([string]$path, [int]$size, [switch]$Badge) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $margin = if ($Badge) { [int]($size * .08) } else { [int]($size * .04) }
  $radius = [single]($size * .21)
  $background = New-RoundedPath $margin $margin ($size - 2 * $margin) ($size - 2 * $margin) $radius
  $graphics.FillPath([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 48, 54, 65)), $background)
  $cell = [single]($size * .19)
  $gap = [single]($size * .09)
  $total = 2 * $cell + $gap
  $start = [single](($size - $total) / 2)
  $cellRadius = [single]($size * .045)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 247, 244, 239))
  foreach ($row in 0..1) {
    foreach ($column in 0..1) {
      $cellPath = New-RoundedPath ($start + $column * ($cell + $gap)) ($start + $row * ($cell + $gap)) $cell $cell $cellRadius
      $graphics.FillPath($brush, $cellPath)
      $cellPath.Dispose()
    }
  }
  $brush.Dispose()
  $background.Dispose()
  $graphics.Dispose()
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

$targets = @(
  @{ Name = 'favicon-32.png'; Size = 32 },
  @{ Name = 'favicon-48.png'; Size = 48 },
  @{ Name = 'apple-touch-icon-180.png'; Size = 180 },
  @{ Name = 'icon-192.png'; Size = 192 },
  @{ Name = 'icon-512.png'; Size = 512 },
  @{ Name = 'icon-maskable-192.png'; Size = 192 },
  @{ Name = 'icon-maskable-512.png'; Size = 512 },
  @{ Name = 'master-1024.png'; Size = 1024 },
  @{ Name = 'notification-badge-96.png'; Size = 96; Badge = $true }
)

foreach ($app in @('menu', 'yonetici', 'personel')) {
  $directory = Join-Path $iconRoot $app
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  foreach ($target in $targets) {
    $arguments = @{ Path = (Join-Path $directory $target.Name); Size = $target.Size }
    if ($target.Badge) { $arguments.Badge = $true }
    New-NeutralIcon @arguments
  }
}
