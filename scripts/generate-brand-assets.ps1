Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$buildDir = Join-Path $root "build"
$publicDir = Join-Path $root "public"
$resourceDir = Join-Path $root "resources\brand"
$srcAssetDir = Join-Path $root "src\assets"

New-Item -ItemType Directory -Force -Path $buildDir, $publicDir, $resourceDir, $srcAssetDir | Out-Null

function Save-ResizedPng($sourcePath, $targetPath, [int]$width, [int]$height) {
  $source = [System.Drawing.Bitmap]::FromFile($sourcePath)
  $target = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($source, 0, 0, $width, $height)
  $target.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $target.Dispose()
  $source.Dispose()
}

function Write-Ico($pngPath, $icoPath) {
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $source = [System.Drawing.Bitmap]::FromFile($pngPath)
  $pngBytes = @()

  foreach ($size in $sizes) {
    $resized = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($resized)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($source, 0, 0, $size, $size)
    $stream = New-Object System.IO.MemoryStream
    $resized.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes += ,$stream.ToArray()
    $stream.Dispose()
    $graphics.Dispose()
    $resized.Dispose()
  }

  $out = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter $out
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$sizes.Count)
  $offset = 6 + (16 * $sizes.Count)
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $size = $sizes[$i]
    $bytes = $pngBytes[$i]
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $bytes.Length
  }
  foreach ($bytes in $pngBytes) {
    $writer.Write($bytes)
  }
  $writer.Flush()
  [System.IO.File]::WriteAllBytes($icoPath, $out.ToArray())
  $writer.Dispose()
  $out.Dispose()
  $source.Dispose()
}

$sourceIcon = Join-Path $resourceDir "app-icon-source.png"
$sourceSplash = Join-Path $resourceDir "launch-splash-source.png"
$iconPng = Join-Path $buildDir "icon.png"
$iconIco = Join-Path $buildDir "icon.ico"
$srcIcon = Join-Path $srcAssetDir "app-icon.png"
$srcSplash = Join-Path $srcAssetDir "launch-splash.png"

if (!(Test-Path $sourceIcon)) {
  throw "Missing source icon: $sourceIcon"
}
if (!(Test-Path $sourceSplash)) {
  throw "Missing source splash: $sourceSplash"
}

Save-ResizedPng $sourceIcon $iconPng 512 512
Save-ResizedPng $sourceIcon $srcIcon 512 512
Copy-Item -Force $srcIcon (Join-Path $resourceDir "app-icon.png")
Copy-Item -Force $srcIcon (Join-Path $publicDir "app-icon.png")

Write-Ico $iconPng $iconIco
Copy-Item -Force $iconIco (Join-Path $resourceDir "icon.ico")
Copy-Item -Force $iconIco (Join-Path $publicDir "favicon.ico")

Save-ResizedPng $sourceSplash $srcSplash 1920 1080
Copy-Item -Force $srcSplash (Join-Path $resourceDir "launch-splash.png")

Write-Host "Synced brand assets:"
Write-Host "  $srcIcon"
Write-Host "  $srcSplash"
Write-Host "  $iconIco"
