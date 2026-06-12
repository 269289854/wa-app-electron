param(
  [string]$BaseUrl = "https://wa.yizhimeng.uk",
  [string]$Password = $env:WA_APP_ELECTRON_SMOKE_PASSWORD,
  [int]$DebugPort = 9339
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
$process = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$DebugPort" -WorkingDirectory $root -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
$started = -not $process.HasExited
$uiSummary = $null
if ($started) {
  $inspectScript = @'
const fs = require('fs');
const http = require('http');
const port = Number(process.argv[2]);
const outPath = process.argv[3];

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('debug endpoint timeout')));
  });
}

async function main() {
  const tabs = await getJson('/json');
  const page = tabs.find((item) => item.type === 'page' && item.title === 'WA App') || tabs.find((item) => item.type === 'page');
  if (!page) throw new Error('No Electron page found');
  if (page.title !== 'WA App') throw new Error(`Unexpected title: ${page.title}`);
  if (!String(page.url || '').startsWith('file://')) throw new Error(`Expected production file URL, got ${page.url}`);
  fs.writeFileSync(outPath, JSON.stringify({
    title: page.title,
    urlProtocol: 'file',
    devtoolsVisible: tabs.some((item) => item.type === 'page' && String(item.url || '').startsWith('devtools://'))
  }), 'utf8');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
'@
  $scriptPath = Join-Path $userData "inspect-electron.cjs"
  $uiSummaryPath = Join-Path $userData "ui-summary.json"
  Set-Content -LiteralPath $scriptPath -Value $inspectScript -Encoding UTF8
  & node $scriptPath $DebugPort $uiSummaryPath
  if ($LASTEXITCODE -ne 0) {
    Get-Process | Where-Object { $_.Path -like "*wa-app-electron*WA App.exe*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    throw "Electron UI inspection failed"
  }
  if (!(Test-Path $uiSummaryPath)) {
    Get-Process | Where-Object { $_.Path -like "*wa-app-electron*WA App.exe*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    throw "Electron UI inspection did not write summary"
  }
  $uiSummary = Get-Content $uiSummaryPath -Raw
}
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
Write-Output "electron_smoke=ok ui=$uiSummary"
