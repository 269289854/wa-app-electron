param(
  [string]$BaseUrl = "https://wa.yizhimeng.uk",
  [string]$Password = $env:WA_APP_ELECTRON_SMOKE_PASSWORD
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "release\win-unpacked\WA App.exe"
if (!(Test-Path $exe)) {
  throw "Missing unpacked executable. Run npx electron-builder --dir first."
}
if ([string]::IsNullOrWhiteSpace($Password)) {
  throw "WA_APP_ELECTRON_SMOKE_PASSWORD is required"
}

$userData = Join-Path $env:TEMP ("wa-app-electron-smoke-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $userData | Out-Null
$configJson = @{
  mode = "remote"
  remoteBaseUrl = $BaseUrl
  password = $Password
} | ConvertTo-Json -Compress

$env:WA_APP_ELECTRON_USER_DATA_DIR = $userData
$env:WA_APP_ELECTRON_TEST_CONFIG = $configJson
$process = Start-Process -FilePath $exe -WorkingDirectory $root -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
$started = -not $process.HasExited
if ($started) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
Get-Process | Where-Object { $_.Path -like "*wa-app-electron*WA App.exe*" } | Stop-Process -Force -ErrorAction SilentlyContinue

$configPath = Join-Path $userData "config.json"
if (!(Test-Path $configPath)) {
  throw "Smoke config was not created"
}
$configText = Get-Content $configPath -Raw
if ($configText.Contains($Password)) {
  throw "Smoke config leaked plaintext password"
}
if (!$configText.Contains("encryptedPassword")) {
  throw "Smoke config did not persist encrypted password"
}
if (!$started) {
  throw "Electron process exited too early"
}

Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "electron_smoke=ok"
