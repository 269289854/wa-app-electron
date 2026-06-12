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
const expectedBaseUrl = process.argv[4];

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

function connectDebugger(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let seq = 0;
    socket.onopen = () => {
      const client = {
        send(method, params = {}, timeoutMs = 15000) {
          const id = ++seq;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((sendResolve, sendReject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              sendReject(new Error(`${method} timed out`));
            }, timeoutMs);
            pending.set(id, { resolve: sendResolve, reject: sendReject, timer, method });
          });
        },
        close() {
          socket.close();
        }
      };
      resolve(client);
    };
    socket.onerror = () => reject(new Error('debug websocket failed'));
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !pending.has(payload.id)) return;
      const item = pending.get(payload.id);
      pending.delete(payload.id);
      clearTimeout(item.timer);
      if (payload.error) {
        item.reject(new Error(`${item.method} failed: ${payload.error.message || JSON.stringify(payload.error)}`));
        return;
      }
      item.resolve(payload.result);
    };
  });
}

async function evaluate(client, expression, timeoutMs = 15000) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  }, timeoutMs + 2000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result ? result.result.value : undefined;
}

async function waitForExpression(client, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, expression, 5000);
    if (lastValue) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return Boolean(lastValue);
}

async function main() {
  const tabs = await getJson('/json');
  const page = tabs.find((item) => item.type === 'page' && item.title === 'WA App') || tabs.find((item) => item.type === 'page');
  if (!page) throw new Error('No Electron page found');
  if (page.title !== 'WA App') throw new Error(`Unexpected title: ${page.title}`);
  if (!String(page.url || '').startsWith('file://')) throw new Error(`Expected production file URL, got ${page.url}`);
  if (!page.webSocketDebuggerUrl) throw new Error('Electron page has no debugger URL');
  const client = await connectDebugger(page.webSocketDebuggerUrl);
  const renderer = {};
  try {
    renderer.domReady = await waitForExpression(client, 'document.readyState === "complete" || document.readyState === "interactive"');
    renderer.title = await evaluate(client, 'document.title');
    renderer.hasDesktopShell = await waitForExpression(client, 'Boolean(document.querySelector(".app-shell") && document.querySelector(".account-rail") && document.querySelector(".workspace"))');
    renderer.hasPreloadBridge = await evaluate(client, 'Boolean(window.waConfig && window.waApi && window.waService)');
    renderer.config = await evaluate(client, 'window.waConfig.get().then((config) => ({ mode: config.mode, remoteBaseUrl: config.remoteBaseUrl, hasPassword: config.hasPassword, hasPasswordRef: Boolean(config.authPasswordRef) }))');
    renderer.connection = await evaluate(client, 'window.waConfig.testConnection().then((result) => ({ ok: result.ok === true, hasHealth: Boolean(result.health), error: result.error || "" }))', 20000);
  } finally {
    client.close();
  }
  if (!renderer.domReady) throw new Error('Renderer DOM is not ready');
  if (renderer.title !== 'WA App') throw new Error(`Renderer title mismatch: ${renderer.title}`);
  if (!renderer.hasDesktopShell) throw new Error('Renderer desktop shell is missing');
  if (!renderer.hasPreloadBridge) throw new Error('Preload bridge is missing');
  if (renderer.config?.mode !== 'remote') throw new Error(`Unexpected config mode: ${renderer.config?.mode}`);
  if (renderer.config?.remoteBaseUrl !== expectedBaseUrl) throw new Error(`Unexpected remote base URL: ${renderer.config?.remoteBaseUrl}`);
  if (!renderer.config?.hasPassword || !renderer.config?.hasPasswordRef) throw new Error('Renderer config does not report a secure password reference');
  if (!renderer.connection?.ok) throw new Error(`Renderer connection test failed: ${renderer.connection?.error || 'unknown error'}`);
  fs.writeFileSync(outPath, JSON.stringify({
    title: page.title,
    urlProtocol: 'file',
    devtoolsVisible: tabs.some((item) => item.type === 'page' && String(item.url || '').startsWith('devtools://')),
    renderer
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
  & node $scriptPath $DebugPort $uiSummaryPath $BaseUrl
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
