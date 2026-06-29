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
const platformAccountID = 'wa-account-platform';
const verificationRequestID = 'wavrf-smoke-1';
const contactID = 'contact-1';
const operations = [];
let platformOtpSubmitCount = 0;

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
  if (path === '/api/wa/health') return json(res, {
    ok: true,
    capabilities: { play_integrity_api: true },
    registration: { integrity_modes: ['error_code', 'play_integrity_api'] },
  });
  if (path === '/__operations') return json(res, { operations });
  if (path === '/api/wa/accounts') {
    if (url.searchParams.get('cursor') === 'page-2') return json(res, {
      accounts: [{
        wa_account_id: pendingAccountID,
        display_name: 'Pending Account',
        status: 'WA_ACCOUNT_STATUS_PENDING_REGISTRATION',
        phone: { e164_number: '+15550100009' },
        audit: { updated_at: '2026-06-12T00:05:00Z' },
      }, {
        wa_account_id: platformAccountID,
        display_name: 'Platform Account',
        status: 'ACTIVE',
        phone: { e164_number: '+573145865572' },
        audit: { updated_at: '2026-06-12T00:06:00Z' },
      }],
    });
    return json(res, {
      accounts: [{
      wa_account_id: accountID,
      display_name: 'Mock Account',
      status: 'ACTIVE',
      phone: { e164_number: '+15550100001', country_iso2: 'US', country_calling_code: '1' },
      two_factor_auth: { configured: true, email_configured: true, email_address: 'mock@example.com' },
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
      { account_message_id: 'msg-1', wa_account_id: accountID, contact_ref: contactID, direction: 'inbound', text: { value: 'Mock hello from object text', redacted_value: 'Mock h****************' }, received_at: '2026-06-12T00:01:00Z', read: false },
      { account_message_id: 'msg-2', wa_account_id: accountID, contact_ref: contactID, direction: 'outbound', display_text: 'Mock reply', sent_at: '2026-06-12T00:02:00Z', ack_status: 'sent' },
    ],
  });
  if (path === '/api/wa/account-otp-messages') return json(res, {
    otp_messages: [{ account_message_id: 'otp-1', display_text: '123456', otp: { value: '123456' }, received_at: '2026-06-12T00:03:00Z', expires_at: '2099-06-12T00:13:00Z' }],
  });
  if (path === '/api/wa/long-connections') return json(res, {
    states: [
      { wa_account_id: accountID, status: 'connected', connected: true },
      { wa_account_id: pendingAccountID, status: 'LONG_CONNECTION_STATUS_STOPPED', connected: false, last_error: { code: 'WA_ERROR_CODE_CONFLICT', message: 'account_takeover' } },
    ],
  });
  if (path === '/api/wa/account-settings/2fa/status') return json(res, {
    status: { configured: true, email_configured: true, email_address: 'mock@example.com' },
  });
  if (path === '/api/wa/play-integrity/status') {
    operations.push({ method: req.method, path, body: {} });
    return json(res, {
      configured: true,
      ok: true,
      available: true,
      dgRunnerMode: 'vm',
      totalRequests: 4,
      successRequests: 3,
      failedRequests: 1,
      vm: { enabled: true, state: 'ready', busy: false, requestCount: 4 },
    });
  }
  if (path.includes('/profile-picture')) return text(res, '');
  if (req.method === 'POST' || req.method === 'DELETE') {
    const body = await readBody(req);
    operations.push({ method: req.method, path, body });
    if (path === '/api/wa/phone/sms-probe') return json(res, {
      success: true,
      passed: true,
      status: 'ok',
      method_statuses: [
        { method: 'sms', available: true },
        { method: 'voice', available: false },
        { method: 'wa_old', available: true, cooldown_seconds: 30 },
      ],
      phone_status: { sms_available: true },
    });
    if (path === '/api/wa/accounts/cleanup-pending-registration') return json(res, { deleted_count: 1 });
    if (path === '/api/wa/register') return json(res, { success: true, status: 'otp_required', wa_account_id: body.e164_number === '+573145865572' ? platformAccountID : accountID, verification_request_id: verificationRequestID, delivery_method: body.delivery_method || 'sms', retry_after_seconds: 12, account_transfer_challenge: body.delivery_method === 'wa_old' ? { type: 'wa_old' } : undefined });
    if (path === '/api/wa/actions/registration/account-transfer/refresh') return json(res, { success: true, verification_request_id: body.verification_request_id, account_transfer_challenge: { type: 'wa_old', refreshed: true } });
    if (path === '/api/wa/actions/registration/account-transfer/poll') return json(res, { success: true, status: 'pending', verification_request_id: body.verification_request_id, wa_account_id: body.wa_account_id });
    if (path === '/api/wa/actions/registration/resume-otp') {
      if (body.wa_account_id === platformAccountID) {
        platformOtpSubmitCount += 1;
        if (platformOtpSubmitCount < 3) {
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: { message: 'wasafe upstream http 502: {"message":"Internal server error"}' } }));
          return;
        }
      }
      return json(res, { success: true, status: 'registered', wa_account_id: body.wa_account_id || accountID });
    }
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

async function waitForOperationWithDebug(client, path, method = 'POST', timeoutMs = 15000, afterIndex = 0) {
  try {
    return await waitForOperation(path, method, timeoutMs, afterIndex);
  } catch (error) {
    const operations = await getOperations();
    const pageText = await evaluate(client, `(() => {
      const addPage = document.querySelector('.app-shell[data-view=add] .add-page');
      const debug = document.querySelector('.add-page .debug-json')?.innerText || '';
      const buttons = addPage ? [...addPage.querySelectorAll('button')].map((button) => ({ text: button.innerText, disabled: button.disabled, visible: button.offsetParent !== null })) : [];
      const inputs = addPage ? [...addPage.querySelectorAll('input')].map((input) => ({ value: input.value, placeholder: input.placeholder, type: input.type, visible: input.offsetParent !== null })) : [];
      return JSON.stringify({ debug, buttons, inputs, view: document.querySelector('.app-shell')?.dataset.view });
    })()`).catch(() => '');
    throw new Error(`${error.message}\noperations=${JSON.stringify(operations.slice(afterIndex))}\npage=${pageText}`);
  }
}

async function waitForOperationCount(path, count, method = 'POST', timeoutMs = 15000, afterIndex = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const operations = await getOperations();
    const matches = operations.slice(afterIndex).filter((operation) => operation.path === path && operation.method === method);
    if (matches.length >= count) return matches;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const operations = await getOperations();
  throw new Error(`Expected ${count} operations for ${method} ${path}; got ${operations.slice(afterIndex).filter((operation) => operation.path === path && operation.method === method).length}; operations=${JSON.stringify(operations.slice(afterIndex))}`);
}

async function runInPage(client, source, timeoutMs = 60000) {
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
    checks.config = await evaluate(client, 'window.waConfig.get().then((config) => ({ remoteBaseUrl: config.remoteBaseUrl, hasPassword: config.hasPassword, registrationActionLayout: config.registrationActionLayout }))');
    if (checks.config.remoteBaseUrl !== expectedBaseUrl || !checks.config.hasPassword || checks.config.registrationActionLayout !== 'combined') throw new Error('Mock config was not applied');
    await evaluate(client, 'window.waConfig.set({ smsbower: { openAIPhoneCheckEnabled: false } })');
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
    checks.accountPagination = await waitForExpression(client, 'document.body.innerText.includes("Pending Account") && Boolean(document.querySelector(".connection-dot.bad"))');
    checks.chatThread = await waitForExpression(client, 'document.body.innerText.includes("Mock Contact") && document.body.innerText.includes("Mock hello from object text") && document.body.innerText.includes("Mock reply") && Boolean(document.querySelector(".transfer-otp-banner")) && !document.body.innerText.includes("[object Object]")');
    if (!checks.chatThread) throw new Error('Chat thread or transfer OTP banner did not render');
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
      const text = document.body.innerText;
      const pendingEmail = '\u5f85\u9a8c\u8bc1\u90ae\u7bb1';
      const missingEmail = '\u672a\u663e\u793a\u90ae\u7bb1';
      if (!text.includes('mock@example.com')) throw new Error('Security email address is not visible');
      if (!text.includes(pendingEmail)) throw new Error('Pending email status is not visible');
      if (text.includes(missingEmail)) throw new Error('Security panel still shows missing email fallback');
      return true;
    `);
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const accountPage = [...document.querySelectorAll('.app-shell[data-view=account] .account-page')].find((page) => page.offsetParent !== null);
      const textInputs = [...accountPage.querySelectorAll('input:not([type]), input[type="text"]')].filter((input) => input.offsetParent !== null);
      const displayName = textInputs[0];
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
      const openButton = [...document.querySelectorAll('.security-actions button')].find((button) => button.innerText.includes('PIN'));
      if (!openButton) throw new Error('PIN modal button not found');
      openButton.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const pin = document.querySelector('.modal-panel input[type="password"]');
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
      document.querySelector('.modal-panel [aria-label="关闭"]')?.click();
      let openButton;
      for (let index = 0; index < 30 && !openButton; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        openButton = [...document.querySelectorAll('button')].find((button) => button.innerText.includes('\u8bbe\u7f6e\u8d26\u6237\u90ae\u7bb1'));
      }
      if (!openButton) throw new Error('Email modal button not found; buttons=' + JSON.stringify([...document.querySelectorAll('button')].map((button) => button.innerText)));
      openButton.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const email = document.querySelector('.modal-panel input[type="email"]');
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
      const otp = [...document.querySelectorAll('.modal-panel input[type="password"]')].pop();
      if (!otp) throw new Error('Email OTP input not found');
      const actions = otp.closest('.form-grid').querySelector('.inline-actions');
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
    await runInPage(client, `
      document.querySelector('.modal-panel [aria-label="关闭"]')?.click();
      let openButton;
      for (let index = 0; index < 30 && !openButton; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        openButton = [...document.querySelectorAll('button')].find((button) => button.innerText.includes('\u6362\u7ed1\u624b\u673a\u53f7'));
      }
      if (!openButton) throw new Error('Change number modal button not found; buttons=' + JSON.stringify([...document.querySelectorAll('button')].map((button) => button.innerText)));
      openButton.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!document.body.innerText.includes('Change number')) throw new Error('Change number modal did not open');
      const button = [...document.querySelectorAll('.modal-panel .primary-button')].pop();
      if (!button) throw new Error('Change number placeholder button not found');
      button.click();
      return true;
    `);
    checks.accountPage = true;
    checks.accountActions = true;
    const operationsBeforeCleanup = (await getOperations()).length;
    await route(client, '#/chats', 'Boolean(document.querySelector(".app-shell[data-view=chats]"))');
    await runInPage(client, `
      window.confirm = () => true;
      const button = document.querySelector('[data-action="cleanup-pending-registration"]');
      if (!button || button.disabled) throw new Error('Cleanup pending registration button is not ready');
      button.click();
      return true;
    `);
    const cleanupOperation = await waitForOperation('/api/wa/accounts/cleanup-pending-registration', 'POST', 15000, operationsBeforeCleanup);
    if (!cleanupOperation) throw new Error('Cleanup pending registration endpoint was not called');
    checks.pendingRegistrationCleanup = true;
    await route(client, '#/add', 'Boolean(document.querySelector(".app-shell[data-view=add] .add-page"))');
    const operationsBeforeIntegrityStatus = (await getOperations()).length;
    await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const select = addPage.querySelector('[data-field="integrity-mode"]');
      if (!select) throw new Error('Integrity mode selector was not rendered');
      if (![...select.options].some((option) => option.value === 'play_integrity_api')) throw new Error('Play Integrity API option is missing');
      select.value = 'play_integrity_api';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await waitForOperation('/api/wa/play-integrity/status', 'GET', 15000, operationsBeforeIntegrityStatus);
    checks.playIntegritySelector = true;
    const operationsBeforeIntegrityRegister = (await getOperations()).length;
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const inputs = [...addPage.querySelectorAll('input')].filter((input) => input.offsetParent !== null);
      setValue(inputs[0], '+1');
      setValue(inputs[1], '4155550123');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const firstCard = addPage.querySelector('.info-card');
      const button = firstCard?.querySelector('button.primary-button');
      if (!button || button.disabled) throw new Error('Probe/register button is not ready: ' + addPage.innerText);
      button.click();
      return true;
    `);
    await waitForOperationWithDebug(client, '/api/wa/phone/sms-probe', 'POST', 15000, operationsBeforeIntegrityRegister);
    await waitForOperationWithDebug(client, '/api/wa/register', 'POST', 15000, operationsBeforeIntegrityRegister);
    const integrityRegister = (await getOperations()).slice(operationsBeforeIntegrityRegister).find((operation) => operation.path === '/api/wa/register');
    if (integrityRegister?.body?.integrity_mode !== 'play_integrity_api') throw new Error('Register payload did not include Play Integrity mode');
    await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const channels = Object.fromEntries([...addPage.querySelectorAll('[data-channel]')].map((item) => [item.dataset.channel, item.dataset.state]));
      for (const code of ['sms', 'voice', 'wa_old', 'email_otp', 'send_sms', 'flash']) {
        if (!channels[code]) throw new Error('Missing channel state for ' + code + ': ' + JSON.stringify(channels));
      }
      if (channels.sms !== 'available') throw new Error('SMS should be available: ' + JSON.stringify(channels));
      if (channels.voice !== 'unavailable') throw new Error('Voice should be unavailable: ' + JSON.stringify(channels));
      if (channels.wa_old !== 'cooldown') throw new Error('wa_old should be cooling down: ' + JSON.stringify(channels));
      if (channels.flash !== 'unsupported') throw new Error('flash should be unsupported: ' + JSON.stringify(channels));
      const options = [...addPage.querySelectorAll('select option')].map((option) => ({ value: option.value, disabled: option.disabled }));
      if (options.some((option) => option.value === 'flash')) throw new Error('Unsupported flash option should not be selectable');
      if (!options.find((option) => option.value === 'voice')?.disabled) throw new Error('Unavailable voice option should be disabled');
      return true;
    `);
    checks.combinedRegistrationLayout = true;
    const operationsBeforeRegistrationOtp = (await getOperations()).length;
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const inputs = [...addPage.querySelectorAll('input')].filter((input) => input.offsetParent !== null);
      const accountID = inputs.find((input) => input.placeholder === 'wa_account_id');
      const verificationRequest = inputs.find((input) => input.placeholder === 'verification_request_id');
      const otp = inputs.find((input) => input.type === 'password');
      if (!accountID || !verificationRequest || !otp) throw new Error('Registration OTP inputs not found');
      setValue(accountID, 'wa-account-1');
      setValue(verificationRequest, 'wavrf-manual-1');
      setValue(otp, '111222');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const button = otp.closest('.info-card').querySelector('.primary-button');
      if (!button || button.disabled) throw new Error('Registration OTP button is not ready');
      button.click();
      return true;
    `);
    await waitForOperation('/api/wa/actions/registration/resume-otp', 'POST', 15000, operationsBeforeRegistrationOtp);
    checks.registrationActions = true;
    const manualOtpOperation = (await getOperations()).slice(operationsBeforeRegistrationOtp).find((operation) => operation.path === '/api/wa/actions/registration/resume-otp');
    if (manualOtpOperation?.body?.verification_request_id !== 'wavrf-manual-1') throw new Error('Manual OTP submit did not include verification_request_id');
    await evaluate(client, 'window.waConfig.set({ registrationActionLayout: "split", smsbower: { openAIPhoneCheckEnabled: false } })');
    await evaluate(client, 'window.location.reload()');
    await waitForExpression(client, 'Boolean(document.querySelector(".app-shell"))');
    await route(client, '#/add', 'Boolean(document.querySelector(".app-shell[data-view=add] .add-page"))');
    const operationsBeforeSplitProbe = (await getOperations()).length;
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const inputs = [...addPage.querySelectorAll('input')].filter((input) => input.offsetParent !== null);
      setValue(inputs[0], '+1');
      setValue(inputs[1], '4155550987');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const probeButton = addPage.querySelector('[data-action="probe-phone"]');
      const registerButton = addPage.querySelector('[data-action="register-after-probe"]');
      if (!probeButton || probeButton.disabled) throw new Error('Split probe button is not ready');
      if (!registerButton || !registerButton.disabled) throw new Error('Split register button should be disabled before probing');
      probeButton.click();
      return true;
    `);
    await waitForOperationWithDebug(client, '/api/wa/phone/sms-probe', 'POST', 15000, operationsBeforeSplitProbe);
    const splitProbeOperations = (await getOperations()).slice(operationsBeforeSplitProbe);
    if (splitProbeOperations.some((operation) => operation.path === '/api/wa/register')) throw new Error('Split probe unexpectedly started registration');
    await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      let voice;
      for (let index = 0; index < 40; index += 1) {
        const select = addPage.querySelector('select');
        voice = [...select.options].find((option) => option.value === 'voice');
        if (voice?.disabled && addPage.querySelector('[data-channel="voice"]')?.dataset.state === 'unavailable') break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (!voice || !voice.disabled) throw new Error('Unavailable voice option should be disabled after split probe');
      return true;
    `);
    const operationsBeforeSplitRegister = (await getOperations()).length;
    await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      let registerButton;
      for (let index = 0; index < 40; index += 1) {
        registerButton = addPage.querySelector('[data-action="register-after-probe"]');
        if (registerButton && !registerButton.disabled) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (!registerButton || registerButton.disabled) throw new Error('Split register button did not enable after probe');
      registerButton.click();
      return true;
    `);
    await waitForOperationWithDebug(client, '/api/wa/register', 'POST', 15000, operationsBeforeSplitRegister);
    await runInPage(client, `
      const setValue = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const inputs = [...addPage.querySelectorAll('input')].filter((input) => input.offsetParent !== null);
      const registerButton = addPage.querySelector('[data-action="register-after-probe"]');
      setValue(inputs[1], '4155550000');
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (!registerButton.disabled) throw new Error('Split register button stayed enabled after phone changed');
      return true;
    `);
    await evaluate(client, 'window.waConfig.set({ registrationActionLayout: "combined", smsbower: { openAIPhoneCheckEnabled: false } })');
    checks.splitRegistrationLayout = true;
    const operationsBeforeTransfer = (await getOperations()).length;
    await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      let refresh;
      let poll;
      for (let index = 0; index < 40; index += 1) {
        refresh = addPage.querySelector('[data-action="refresh-transfer"]');
        poll = addPage.querySelector('[data-action="poll-transfer"]');
        if (refresh && !refresh.disabled && poll && !poll.disabled) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (!refresh || refresh.disabled || !poll || poll.disabled) throw new Error('Transfer refresh/poll buttons are not ready');
      refresh.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      poll.click();
      return true;
    `);
    await waitForOperation('/api/wa/actions/registration/account-transfer/refresh', 'POST', 15000, operationsBeforeTransfer);
    await waitForOperation('/api/wa/actions/registration/account-transfer/poll', 'POST', 15000, operationsBeforeTransfer);
    checks.accountTransferActions = true;
    const operationsBeforePlatform = (await getOperations()).length;
    await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const integrity = addPage.querySelector('[data-field="integrity-mode"]');
      if (integrity) {
        integrity.value = 'play_integrity_api';
        integrity.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const platformCard = [...addPage.querySelectorAll('.info-card')].find((card) => card.querySelector('.platform-register'));
      let button = platformCard?.querySelector('.primary-button');
      for (let index = 0; index < 50 && button?.disabled; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        button = platformCard?.querySelector('.primary-button');
      }
      if (!button || button.disabled) throw new Error('Platform registration button is not ready');
      button.click();
      return true;
    `);
    await waitForExpression(client, 'document.querySelector(".add-page .debug-json")?.innerText.includes("SMSBower start")');
    await waitForOperationWithDebug(client, '/api/wa/register', 'POST', 15000, operationsBeforePlatform);
    const platformRegister = (await getOperations()).slice(operationsBeforePlatform).find((operation) => operation.path === '/api/wa/register');
    if (platformRegister?.body?.integrity_mode !== 'play_integrity_api') throw new Error('Platform registration payload did not include Play Integrity mode');
    const platformOtpOperations = await waitForOperationCount('/api/wa/actions/registration/resume-otp', 3, 'POST', 20000, operationsBeforePlatform);
    if (!platformOtpOperations.every((operation) => operation.body?.verification_request_id === 'wavrf-smoke-1')) throw new Error('Platform OTP submit did not include verification_request_id');
    checks.platformOtpRetry = true;
    const cancelledAfterOtp = await evaluate(client, 'Boolean(document.querySelector(".add-page .debug-json")?.innerText.includes(\'"status": 8\'))');
    if (cancelledAfterOtp) throw new Error('Platform registration cancelled SMSBower order after receiving OTP');
    checks.platformNoCancelAfterOtp = true;
    await evaluate(client, 'window.waConfig.set({ smsbower: { openAIPhoneCheckEnabled: true, maxOrders: 2 } })');
    const operationsBeforeRateLimit = (await getOperations()).length;
    await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      const platformCard = [...addPage.querySelectorAll('.info-card')].find((card) => card.querySelector('.platform-register'));
      let button = platformCard?.querySelector('.primary-button');
      for (let index = 0; index < 50 && button?.disabled; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        button = platformCard?.querySelector('.primary-button');
      }
      if (!button || button.disabled) throw new Error('Platform registration button is not ready for OpenAI rate limit scenario');
      button.click();
      return true;
    `);
    await waitForOperationCount('/api/wa/phone/sms-probe', 1, 'POST', 15000, operationsBeforeRateLimit);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const rateLimitOperations = (await getOperations()).slice(operationsBeforeRateLimit);
    const rateLimitRegisters = rateLimitOperations.filter((operation) => operation.path === '/api/wa/register');
    if (rateLimitRegisters.length) throw new Error(`OpenAI rate limit scenario still called register: ${JSON.stringify(rateLimitRegisters)}`);
    checks.platformStopsOnOpenAIRateLimit = true;
    await route(client, '#/cancel-queue', 'Boolean(document.querySelector(".app-shell[data-view=cancel-queue] .cancel-queue-page"))');
    checks.cancelQueueReceivesPlatformFailure = await runInPage(client, `
      let queued = false;
      for (let index = 0; index < 30 && !queued; index += 1) {
        const result = await window.smsCancelQueue.list({ status: 'all', page: 1, pageSize: 20 });
        queued = result.items.some((item) => item.activationId === 'act-smoke-1');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!queued) throw new Error('SMSBower failed order was not added to cancel queue');
      const text = document.body.innerText;
      if (!text.includes('\u5df2\u53d6\u6d88') && !text.includes('\u5f85\u53d6\u6d88')) throw new Error('Cancel queue status is not visible');
      return true;
    `);
    checks.cancelQueueHeroPendingAndActions = await runInPage(client, `
      await window.smsCancelQueue.enqueue({
        provider: 'hero-sms',
        activationId: 'hero-smoke-1',
        phone: '+573244521293',
        reason: 'smoke Hero-SMS minimum cancel window',
        orderedAtMs: Date.now(),
      });
      const pendingTab = [...document.querySelectorAll('.queue-tabs button')].find((button) => button.innerText.includes('\u5f85\u53d6\u6d88'));
      if (!pendingTab) throw new Error('Pending queue tab is not visible');
      pendingTab.click();
      for (let index = 0; index < 30 && !document.body.innerText.includes('hero-smoke-1'); index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!document.body.innerText.includes('Hero-SMS') || !document.body.innerText.includes('hero-smoke-1')) throw new Error('Hero-SMS queued order is not visible');
      if (!document.body.innerText.includes('\u79d2')) throw new Error('Hero-SMS queued order countdown is not visible');
      const heroCard = [...document.querySelectorAll('.queue-item')].find((item) => item.innerText.includes('hero-smoke-1'));
      if (!heroCard) throw new Error('Hero-SMS queue card not found');
      const buttons = [...heroCard.querySelectorAll('button')];
      if (buttons.length < 2 || buttons.some((button) => button.disabled)) throw new Error('Queue retry/remove buttons are not ready');
      buttons[0].click();
      await new Promise((resolve) => setTimeout(resolve, 400));
      buttons[1].click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!document.body.innerText.includes('\u5df2\u79fb\u9664')) throw new Error('Queue remove action did not mark item removed');
      return true;
    `);
    checks.cancelQueueTabsAndPagination = await runInPage(client, `
      const enqueueMany = async () => {
        await Promise.all(Array.from({ length: 22 }, (_, offset) => {
          const index = offset + 1;
          return window.smsCancelQueue.enqueue({
            provider: 'hero-sms',
            activationId: 'hero-page-' + String(index).padStart(2, '0'),
            phone: '+5700000' + String(index).padStart(2, '0'),
            reason: 'pagination pending ' + index,
            orderedAtMs: Date.now() + index,
          });
        }));
      };
      await enqueueMany();
      const pendingResult = await window.smsCancelQueue.list({ status: 'pending', page: 1, pageSize: 20 });
      const pendingPage2 = await window.smsCancelQueue.list({ status: 'pending', page: 2, pageSize: 20 });
      if (pendingResult.total < 22 || pendingResult.items.length > 20 || pendingResult.totalPages < 2) throw new Error('Queue SQL pagination result is invalid: ' + JSON.stringify(pendingResult));
      if (!pendingPage2.items.length) throw new Error('Queue SQL pagination page 2 is empty');
      const queuePage = document.querySelector('.cancel-queue-page');
      if (!queuePage) throw new Error('Cancel queue page missing');
      const tabs = [...queuePage.querySelectorAll('.queue-tabs button')];
      const pendingTab = tabs.find((button) => button.innerText.includes('\u5f85\u53d6\u6d88'));
      const cancelledTab = tabs.find((button) => button.innerText.includes('\u5df2\u53d6\u6d88'));
      if (!pendingTab || !cancelledTab) throw new Error('Cancel queue status tabs are not visible');
      cancelledTab.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      pendingTab.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      let cards = [...queuePage.querySelectorAll('.queue-item')];
      if (cards.length > 20) throw new Error('SQL pagination should not render more than one page');
      if (queuePage.innerText.includes('done-page-1')) throw new Error('Pending tab leaked cancelled records');
      const next = [...queuePage.querySelectorAll('.queue-pagination button')].find((button) => button.innerText.includes('\u4e0b\u4e00\u9875'));
      if (!next || next.disabled) throw new Error('Next page button is not available for pending queue');
      next.click();
      for (let index = 0; index < 30 && !queuePage.innerText.includes('\u7b2c 2 /'); index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!queuePage.innerText.includes('\u7b2c 2 /')) throw new Error('Next page did not change current page');
      const previous = [...queuePage.querySelectorAll('.queue-pagination button')].find((button) => button.innerText.includes('\u4e0a\u4e00\u9875'));
      if (!previous || previous.disabled) throw new Error('Previous page button is not available on page 2');
      previous.click();
      for (let index = 0; index < 30 && !queuePage.innerText.includes('\u7b2c 1 /'); index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      cancelledTab.click();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!queuePage.innerText.includes('\u5df2\u53d6\u6d88')) throw new Error('Cancelled tab did not show cancelled state');
      return true;
    `, 120000);
    await route(client, '#/settings', 'Boolean(document.querySelector(".app-shell[data-view=settings] .settings-page"))');
    checks.smsProviderSelector = await runInPage(client, `
      const text = document.body.innerText;
      if (!text.includes('SMSBower') || !text.includes('Hero-SMS')) throw new Error('SMS provider selector options are not visible');
      if (!document.querySelector('[data-field="local-common-proxy"]') || !document.querySelector('[data-field="local-device-profiles-file"]')) throw new Error('Local service advanced fields are not visible');
      return true;
    `);
    checks.themeToggle = await runInPage(client, `
      const button = document.querySelector('[data-action="toggle-theme"]');
      if (!button) throw new Error('Theme toggle button not found');
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (document.documentElement.dataset.theme !== 'dark') throw new Error('Theme did not switch to dark');
      return true;
    `);
    await evaluate(client, 'window.smsbower.stopRegistrationTask()');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route(client, '#/add', 'Boolean(document.querySelector(".app-shell[data-view=add]") && document.querySelector(".add-page"))');
    checks.platformRegistrationSurvivesNavigation = await waitForExpression(client, 'document.querySelector(".add-page .debug-json")?.innerText.includes("SMSBower start")');
    checks.addPageScroll = await runInPage(client, `
      const addPage = [...document.querySelectorAll('.app-shell[data-view=add] .add-page')].find((page) => page.offsetParent !== null);
      if (!addPage) throw new Error('Visible add page not found');
      if (addPage.scrollHeight <= addPage.clientHeight) throw new Error('Add page does not have scrollable overflow in smoke viewport');
      addPage.scrollTop = addPage.scrollHeight;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (addPage.scrollTop <= 0) throw new Error('Add page scrollTop did not move');
      return true;
    `);
    await route(client, '#/settings', 'Boolean(document.querySelector(".app-shell[data-view=settings] .settings-page"))');
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
    registrationActionLayout = "combined"
    smsProvider = "smsbower"
    smsbowerApiKey = "mock-smsbower-key"
    heroSMSApiKey = "mock-hero-sms-key"
    smsbower = @{
      enabled = $true
      country = "187"
      minPrice = 0
      maxPrice = 1
      targetSuccessCount = 1
      maxOrders = 1
      numberIntervalSeconds = 0
      openAIPhoneCheckEnabled = $false
      pollIntervalSeconds = 2
      otpTimeoutSeconds = 30
    }
  } | ConvertTo-Json -Compress
  $env:WA_APP_ELECTRON_USER_DATA_DIR = $userData
  $env:WA_APP_ELECTRON_TEST_CONFIG = $configJson
  $env:WA_APP_ELECTRON_MOCK_SMSBOWER = "1"
  $env:WA_APP_ELECTRON_MOCK_OPENAI_PHONE = "rate_limit"
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
  Remove-Item Env:\WA_APP_ELECTRON_MOCK_SMSBOWER -ErrorAction SilentlyContinue
  Remove-Item Env:\WA_APP_ELECTRON_MOCK_OPENAI_PHONE -ErrorAction SilentlyContinue
  Get-Process | Where-Object { $_.Path -like "*wa-app-electron*WA App.exe*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($mockProcess -and !$mockProcess.HasExited) {
    Stop-Process -Id $mockProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
}
