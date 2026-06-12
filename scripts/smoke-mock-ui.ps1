param(
  [int]$DebugPort = 9349
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "release\win-unpacked\WA App.exe"
if (!(Test-Path $exe)) {
  throw "Missing unpacked executable. Run npx electron-builder --dir first."
}

$workDir = Join-Path $env:TEMP ("wa-app-electron-mock-ui-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$mockScript = Join-Path $workDir "mock-api.cjs"
$inspectScript = Join-Path $workDir "inspect-ui.cjs"
$serverInfoPath = Join-Path $workDir "server-info.json"
$summaryPath = Join-Path $workDir "summary.json"
$userData = Join-Path $workDir "user-data"

$mockApi = @'
const fs = require('fs');
const http = require('http');
const outPath = process.argv[2];

const json = (res, value) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
};

const text = (res, value) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(value);
};

const accountID = 'wa-account-1';
const contactID = 'contact-1';

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const path = url.pathname;
  if (path === '/api/wa/health') return json(res, { ok: true, service: 'mock-wa-app' });
  if (path === '/api/wa/accounts') return json(res, {
    accounts: [{
      wa_account_id: accountID,
      display_name: 'Mock Account',
      status: 'ACTIVE',
      phone: { e164_number: '+15550100001' },
      audit: { updated_at: '2026-06-12T00:00:00Z' },
    }],
  });
  if (path === '/api/wa/client-profiles') return json(res, {
    client_profiles: [{ client_profile_id: 'profile-1', app_version: '2.25.1', locale_country: 'US', device: { platform: 'desktop-smoke' } }],
  });
  if (path === '/api/wa/contacts') return json(res, {
    contacts: [{
      contact_id: contactID,
      wa_account_id: accountID,
      jid: '15550100002@s.whatsapp.net',
      number: '+15550100002',
      display_name: 'Mock Contact',
      unread_count: 2,
      last_message_at: '2026-06-12T00:01:00Z',
      last_message_preview: 'Mock hello',
    }],
  });
  if (path === '/api/wa/messages') return json(res, {
    messages: [
      { account_message_id: 'msg-1', wa_account_id: accountID, contact_ref: contactID, direction: 'inbound', display_text: 'Mock hello', received_at: '2026-06-12T00:01:00Z', read: false },
      { account_message_id: 'msg-2', wa_account_id: accountID, contact_ref: contactID, direction: 'outbound', display_text: 'Mock reply', sent_at: '2026-06-12T00:02:00Z', ack_status: 'sent' },
    ],
  });
  if (path === '/api/wa/account-otp-messages') return json(res, {
    otp_messages: [{ account_message_id: 'otp-1', display_text: '123456', received_at: '2026-06-12T00:03:00Z' }],
  });
  if (path === '/api/wa/long-connections') return json(res, {
    states: [{ wa_account_id: accountID, status: 'connected', connected: true }],
  });
  if (path === '/api/wa/account-settings/2fa/status') return json(res, {
    status: { configured: true, email_configured: true, email_verified: true, email_address: 'mock@example.com' },
  });
  if (path.includes('/profile-picture')) return text(res, '');
  if (req.method === 'POST' || req.method === 'DELETE') return json(res, { success: true, operation: { status: 'ok' } });
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `Unhandled mock path ${req.method} ${path}` } }));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  fs.writeFileSync(outPath, JSON.stringify({ port: address.port, baseUrl: `http://127.0.0.1:${address.port}` }), 'utf8');
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
'@

$inspectUi = @'
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
      resolve({
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
      });
    };
    socket.onerror = () => reject(new Error('debug websocket failed'));
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (!payload.id || !pending.has(payload.id)) return;
      const item = pending.get(payload.id);
      pending.delete(payload.id);
      clearTimeout(item.timer);
      payload.error ? item.reject(new Error(`${item.method} failed: ${payload.error.message || JSON.stringify(payload.error)}`)) : item.resolve(payload.result);
    };
  });
}

async function evaluate(client, expression, timeoutMs = 15000) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }, timeoutMs + 2000);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
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

async function route(client, hash, expression, timeoutMs = 15000) {
  await evaluate(client, `window.location.hash = ${JSON.stringify(hash)}; true`);
  const ok = await waitForExpression(client, expression, timeoutMs);
  if (!ok) throw new Error(`Route ${hash} did not render expected content`);
}

async function main() {
  const tabs = await getJson('/json');
  const page = tabs.find((item) => item.type === 'page' && item.title === 'WA App') || tabs.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No Electron page debugger URL');
  const client = await connectDebugger(page.webSocketDebuggerUrl);
  const checks = {};
  try {
    checks.shell = await waitForExpression(client, 'Boolean(document.querySelector(".app-shell"))');
    checks.config = await evaluate(client, 'window.waConfig.get().then((config) => ({ remoteBaseUrl: config.remoteBaseUrl, hasPassword: config.hasPassword }))');
    if (checks.config.remoteBaseUrl !== expectedBaseUrl || !checks.config.hasPassword) throw new Error('Mock config was not applied');
    checks.accountRail = await waitForExpression(client, 'document.body.innerText.includes("Mock Account")');
    checks.chatThread = await waitForExpression(client, 'document.body.innerText.includes("Mock Contact") && document.body.innerText.includes("Mock hello") && document.body.innerText.includes("Mock reply")');
    await route(client, '#/account', 'document.body.innerText.includes("Mock Account") && document.body.innerText.includes("profile-1") && document.body.innerText.includes("123456") && document.body.innerText.includes("connected")');
    checks.accountPage = true;
    await route(client, '#/settings', 'Boolean(document.querySelector(".app-shell[data-view=settings]") && document.querySelector(".settings-page") && document.querySelector("input[type=password]"))');
    checks.settingsPage = true;
  } finally {
    client.close();
  }
  fs.writeFileSync(outPath, JSON.stringify({ ok: true, checks }), 'utf8');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
'@

Set-Content -LiteralPath $mockScript -Value $mockApi -Encoding UTF8
Set-Content -LiteralPath $inspectScript -Value $inspectUi -Encoding UTF8
$mockProcess = Start-Process -FilePath "node" -ArgumentList $mockScript, $serverInfoPath -PassThru -WindowStyle Hidden
try {
  $deadline = (Get-Date).AddSeconds(10)
  while (!(Test-Path $serverInfoPath)) {
    if ((Get-Date) -gt $deadline) {
      throw "Mock API did not start"
    }
    Start-Sleep -Milliseconds 200
  }
  $serverInfo = Get-Content $serverInfoPath -Raw | ConvertFrom-Json
  $configJson = @{
    mode = "remote"
    remoteBaseUrl = $serverInfo.baseUrl
    password = "mock-password"
  } | ConvertTo-Json -Compress
  $env:WA_APP_ELECTRON_USER_DATA_DIR = $userData
  $env:WA_APP_ELECTRON_TEST_CONFIG = $configJson
  $process = Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$DebugPort" -WorkingDirectory $root -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 8
  if ($process.HasExited) {
    throw "Electron process exited too early"
  }
  & node $inspectScript $DebugPort $summaryPath $serverInfo.baseUrl
  if ($LASTEXITCODE -ne 0) {
    throw "Mock UI inspection failed"
  }
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  $summary = Get-Content $summaryPath -Raw
  Write-Output "mock_ui_smoke=ok summary=$summary"
} finally {
  Remove-Item Env:\WA_APP_ELECTRON_USER_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:\WA_APP_ELECTRON_TEST_CONFIG -ErrorAction SilentlyContinue
  Get-Process | Where-Object { $_.Path -like "*wa-app-electron*WA App.exe*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($mockProcess -and !$mockProcess.HasExited) {
    Stop-Process -Id $mockProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
