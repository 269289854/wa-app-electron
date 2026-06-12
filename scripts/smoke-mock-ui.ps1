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
const pendingAccountID = 'wa-account-pending';
const contactID = 'contact-1';
const operations = [];

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({ raw: body }); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const path = url.pathname;
  if (path === '/healthz') return json(res, { ok: true, service: 'mock-wa-app', path: '/healthz' });
  if (path === '/__operations') return json(res, { operations });
  if (path === '/api/wa/accounts') {
    if (url.searchParams.get('cursor') === 'page-2') return json(res, {
      accounts: [{
        wa_account_id: pendingAccountID,
        display_name: 'Pending Account',
        status: 'WA_ACCOUNT_STATUS_PENDING_REGISTRATION',
        phone: { e164_number: '+15550100009' },
        audit: { updated_at: '2026-06-12T00:05:00Z' },
      }],
    });
    return json(res, {
      accounts: [{
      wa_account_id: accountID,
      display_name: 'Mock Account',
      status: 'ACTIVE',
      phone: { e164_number: '+15550100001', country_iso2: 'US', country_calling_code: '1' },
      audit: { created_at: '2026-06-11T23:00:00Z', updated_at: '2026-06-12T00:00:00Z' },
    }],
      next_cursor: 'page-2',
    });
  }
  if (path === '/api/wa/client-profiles') return json(res, {
    client_profiles: [{
      client_profile_id: 'profile-1',
      status: 'CLIENT_PROFILE_STATUS_ACTIVE',
      app_version: '2.25.1',
      locale_language: 'en',
      locale_country: 'US',
      device: { platform: 'desktop-smoke' },
      device_fingerprint: {
        fingerprint_id: 'fp-1',
        fdid: 'fdid-1',
        device_vendor: 'SmokeVendor',
        device_model: 'SmokePhone',
        android_version: '14',
        device_ram_gib: '8',
        network_radio_type: '13',
        mcc: '310',
        mnc: '260',
        sim_mcc: '310',
        sim_mnc: '260',
        phone_sha256_prefix: 'abcdef123456',
        created_at: '2026-06-12T00:04:00Z',
      },
    }],
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
    states: [
      { wa_account_id: accountID, status: 'connected', connected: true },
      { wa_account_id: pendingAccountID, status: 'starting', connected: false },
    ],
  });
  if (path === '/api/wa/account-settings/2fa/status') return json(res, {
    status: { configured: true, email_configured: true, email_verified: true, email_address: 'mock@example.com' },
  });
  if (path.includes('/profile-picture')) return text(res, '');
  if (req.method === 'POST' || req.method === 'DELETE') {
    const body = await readBody(req);
    operations.push({ method: req.method, path, body });
    if (path === '/api/wa/phone/sms-probe') return json(res, {
      success: true,
      passed: true,
      status: 'ok',
      method_statuses: [{ method: 'sms', available: true }],
      phone_status: { sms_available: true },
    });
    if (path === '/api/wa/register') return json(res, { success: true, status: 'otp_required', wa_account_id: accountID, delivery_method: body.delivery_method || 'sms' });
    if (path === '/api/wa/actions/registration/resume-otp') return json(res, { success: true, status: 'registered', wa_account_id: body.wa_account_id || accountID });
    if (path === '/api/wa/messages/send') return json(res, { success: true, message_id: 'msg-sent' });
    return json(res, { success: true, operation: { status: 'ok' } });
  }
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

async function evaluate(client, expression, timeoutMs = 30000) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }, timeoutMs + 2000);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails;
    const lines = [detail.exception?.description, detail.exception?.value, detail.text].filter(Boolean);
    throw new Error(lines.join('\n') || 'Runtime evaluation failed');
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

async function route(client, hash, expression, timeoutMs = 15000) {
  await evaluate(client, `window.location.hash = ${JSON.stringify(hash)}; true`);
  const ok = await waitForExpression(client, expression, timeoutMs);
  if (!ok) throw new Error(`Route ${hash} did not render expected content`);
}

async function getOperations() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${expectedBaseUrl}/__operations`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body).operations || []); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('operation poll timeout')));
  });
}

async function waitForOperation(path, method = 'POST', timeoutMs = 15000, afterIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const operations = await getOperations();
    const match = operations.slice(afterIndex).find((operation) => operation.path === path && operation.method === method);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Operation ${method} ${path} was not recorded`);
}

async function runInPage(client, source, timeoutMs = 30000) {
  try {
    new Function(`return (async () => { ${source} })()`);
  } catch (error) {
    throw new Error(`Invalid injected page script:\n${source}\n${error.message}`);
  }
  return evaluate(client, `(new Function('return (async () => { ' + ${JSON.stringify(source)} + ' })()'))()`, timeoutMs);
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
    checks.connectionDot = await waitForExpression(client, 'Boolean(document.querySelector(".connection-dot.ok"))');
    const operationsBeforeManualOtp = (await getOperations()).length;
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const search = document.querySelector('.rail-search input');
      if (!search) throw new Error('Account rail search input not found');
      setValue(search, 'does-not-exist');
      await new Promise((resolve) => setTimeout(resolve, 100));
      if ([...document.querySelectorAll('.account-row')].some((row) => row.innerText.includes('Mock Account'))) throw new Error('Account rail search did not filter accounts');
      setValue(search, '');
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    `);
    const loadedMore = await runInPage(client, `
      const button = document.querySelector('.load-more-button');
      if (!button) throw new Error('Load more accounts button not found');
      button.click();
      return true;
    `);
    if (!loadedMore) throw new Error('Load more accounts action failed');
    checks.accountPagination = await waitForExpression(client, 'document.body.innerText.includes("Pending Account") && Boolean(document.querySelector(".connection-dot.warn"))');
    checks.chatThread = await waitForExpression(client, 'document.body.innerText.includes("Mock Contact") && document.body.innerText.includes("Mock hello") && document.body.innerText.includes("Mock reply")');
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const input = document.querySelector('.composer input');
      const button = document.querySelector('.composer button');
      setValue(input, 'Smoke send message');
      await new Promise((resolve) => setTimeout(resolve, 100));
      button.click();
      return true;
    `);
    const sentMessage = await waitForOperation('/api/wa/messages/send');
    if (sentMessage.body.text !== 'Smoke send message') throw new Error('Send message payload was not recorded');
    checks.sendMessage = true;
    await runInPage(client, `
      const rows = [...document.querySelectorAll('.account-row')];
      const pending = rows.find((row) => row.innerText.includes('Pending Account'));
      if (!pending) throw new Error('Pending account row not found');
      pending.click();
      return true;
    `);
    await route(client, '#/account', 'document.body.innerText.includes("Pending Account") && Boolean(document.querySelector("input[autocomplete=one-time-code]"))');
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const manualCard = [...document.querySelectorAll('.info-card')].find((card) => card.querySelector('input[autocomplete="one-time-code"]'));
      if (!manualCard) throw new Error('Manual OTP card not found');
      const otp = manualCard.querySelector('input[type="password"]');
      const button = manualCard.querySelector('.primary-button');
      setValue(otp, '222333');
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!button || button.disabled) throw new Error('Manual OTP button is not ready');
      button.click();
      return true;
    `);
    const manualOtp = await waitForOperation('/api/wa/actions/registration/resume-otp', 'POST', 15000, operationsBeforeManualOtp);
    if (manualOtp.body.wa_account_id !== 'wa-account-pending' || manualOtp.body.otp !== '222333') throw new Error('Manual pending-account OTP payload was not recorded');
    checks.pendingAccountOtp = true;
    await runInPage(client, `
      const rows = [...document.querySelectorAll('.account-row')];
      const account = rows.find((row) => row.innerText.includes('Mock Account'));
      if (!account) throw new Error('Mock account row not found after pending OTP');
      account.click();
      return true;
    `);
    await route(client, '#/account', 'document.body.innerText.includes("Mock Account") && document.body.innerText.includes("profile-1") && document.body.innerText.includes("SmokeVendor SmokePhone") && document.body.innerText.includes("fdid-1") && document.body.innerText.includes("LTE") && document.body.innerText.includes("123456") && document.body.innerText.includes("connected") && document.body.innerText.includes("US") && Boolean([...document.querySelectorAll(".info-card")].find((card) => card.querySelector(".info-grid"))) && Boolean(document.querySelector("[data-action=refresh-avatar]"))');
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const textInputs = [...document.querySelectorAll('input:not([type]), input[type="text"]')];
      const displayName = textInputs.find((input) => input.value === 'Mock Account');
      if (!displayName) throw new Error('Display name input not found');
      setValue(displayName, 'Mock Renamed');
      await new Promise((resolve) => setTimeout(resolve, 100));
      displayName.closest('.form-grid').querySelector('.primary-button')?.click();
      return true;
    `);
    await waitForOperation('/api/wa/account-settings/profile/name');
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const passwordInputs = [...document.querySelectorAll('input[type="password"]')].filter((input) => input.offsetParent !== null);
      const pin = passwordInputs.find((input) => input.closest('.form-grid.two'));
      if (!pin) throw new Error('PIN input not found');
      setValue(pin, '123456');
      let button = pin.closest('label')?.nextElementSibling;
      for (let index = 0; index < 20 && (!button || button.disabled); index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        button = pin.closest('label')?.nextElementSibling;
      }
      if (!button || button.disabled) throw new Error('PIN button is not ready');
      button.click();
      return true;
    `);
    await waitForOperation('/api/wa/account-settings/2fa');
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const email = [...document.querySelectorAll('input[type="email"]')][0];
      if (!email) throw new Error('Email input not found');
      setValue(email, 'desktop-smoke@example.com');
      let button = email.closest('label')?.nextElementSibling;
      for (let index = 0; index < 20 && (!button || button.disabled); index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        button = email.closest('label')?.nextElementSibling;
      }
      if (!button || button.disabled) throw new Error('Email button is not ready');
      button.click();
      return true;
    `);
    await waitForOperation('/api/wa/account-settings/email');
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const passwordInputs = [...document.querySelectorAll('input[type="password"]')];
      const otp = passwordInputs[1];
      if (!otp) throw new Error('Email OTP input not found');
      const actions = otp.closest('.form-grid.two').querySelector('.inline-actions');
      const buttons = [...actions.querySelectorAll('button')];
      buttons[0]?.click();
      setValue(otp, '654321');
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!buttons[1] || buttons[1].disabled) throw new Error('Email OTP verify button is not ready');
      buttons[1].click();
      return true;
    `);
    await waitForOperation('/api/wa/account-settings/email/otp/request');
    await waitForOperation('/api/wa/account-settings/email/otp/verify');
    checks.accountPage = true;
    checks.accountActions = true;
    await route(client, '#/add', 'Boolean(document.querySelector(".add-page"))');
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = [...document.querySelectorAll('.add-page input')];
      setValue(inputs[0], '+1');
      setValue(inputs[1], '5550100003');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const actions = document.querySelector('.add-page .inline-actions');
      const buttons = [...actions.querySelectorAll('button')];
      if (!buttons[0] || buttons[0].disabled || !buttons[0].innerText.includes('探测')) throw new Error('Probe/register button is not ready');
      buttons[0].click();
      return true;
    `);
    await waitForOperation('/api/wa/phone/sms-probe');
    await waitForOperation('/api/wa/register');
    const operationsBeforeRegistrationOtp = (await getOperations()).length;
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const inputs = [...document.querySelectorAll('.add-page input')];
      const accountID = inputs.find((input) => input.placeholder === 'wa_account_id');
      const otp = inputs.find((input) => input.type === 'password');
      if (!accountID || !otp) throw new Error('Registration OTP inputs not found');
      setValue(accountID, 'wa-account-1');
      setValue(otp, '111222');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const buttons = [...document.querySelectorAll('.add-page .primary-button')];
      const button = buttons[buttons.length - 1];
      if (!button || button.disabled) throw new Error('Registration OTP button is not ready');
      button.click();
      return true;
    `);
    await waitForOperation('/api/wa/actions/registration/resume-otp', 'POST', 15000, operationsBeforeRegistrationOtp);
    checks.registrationActions = true;
    await route(client, '#/settings', 'Boolean(document.querySelector(".app-shell[data-view=settings]") && document.querySelector(".settings-page") && document.body.innerText.includes("SMSBower API Key") && document.body.innerText.includes("启用 SMSBower"))');
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
