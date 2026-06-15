const BRIDGE_BASE_URL = 'http://127.0.0.1:17391';
const DEFAULT_MODE = 'api';
let lastState = { status: 'idle', message: 'Waiting for WA App task', task: null, result: null, at: '' };

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ mode: DEFAULT_MODE });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-state') {
    sendResponse(lastState);
    return false;
  }
  if (message?.type === 'set-mode') {
    chrome.storage.local.set({ mode: message.mode === 'page' ? 'page' : 'api' }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === 'retry-now') {
    pollTask().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  return false;
});

chrome.alarms?.create?.('poll-openai-phone-task', { periodInMinutes: 0.05 });
chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === 'poll-openai-phone-task') void pollTask();
});
setInterval(() => void pollTask(), 3000);
void pollTask();

async function pollTask() {
  const response = await fetch(`${BRIDGE_BASE_URL}/openai-phone-check/task`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
  const data = await response.json();
  if (!data.task?.requestId) {
    updateState({ status: 'idle', message: 'Waiting for WA App task', task: null });
    return;
  }
  const mode = (await chrome.storage.local.get({ mode: DEFAULT_MODE })).mode;
  const task = { ...data.task, mode: data.task.mode || mode };
  updateState({ status: 'checking', message: `Checking ${task.phoneNumber}`, task });
  const result = await runTask(task);
  await reportResult({ ...result, requestId: task.requestId, phoneNumber: task.phoneNumber });
  updateState({ status: result.status, message: result.message, task, result });
}

async function runTask(task) {
  const tab = await findOrCreateAddPhoneTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'openai-phone-check', task });
    return normalizeResult(response);
  } catch (error) {
    return { status: 'error', message: String(error?.message || error), raw: { extensionError: String(error?.message || error) } };
  }
}

async function findOrCreateAddPhoneTab() {
  const tabs = await chrome.tabs.query({ url: 'https://auth.openai.com/add-phone*' });
  if (tabs[0]?.id) return tabs[0];
  return chrome.tabs.create({ url: 'https://auth.openai.com/add-phone', active: true });
}

async function reportResult(result) {
  await fetch(`${BRIDGE_BASE_URL}/openai-phone-check/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  });
}

function normalizeResult(input) {
  const raw = input?.raw ?? input;
  const text = `${input?.status || ''} ${input?.code || raw?.code || ''} ${input?.message || raw?.message || ''} ${JSON.stringify(raw || '')}`.toLowerCase();
  if (text.includes('phone_number_in_use') || text.includes('phone number already in use') || text.includes('电话号码已被使用') || text.includes('该电话号码已被使用')) {
    return { status: 'used', message: 'openai 手机号已被使用', code: input?.code || raw?.code || 'phone_number_in_use', raw };
  }
  if (input?.status === 'sent' || input?.status === 'available') return input;
  if (input?.status === 'used') return { ...input, message: input.message || 'openai 手机号已被使用' };
  return { status: input?.status || 'error', message: input?.message || raw?.message || 'OpenAI phone check failed', code: input?.code || raw?.code, raw };
}

function updateState(patch) {
  lastState = { ...lastState, ...patch, at: new Date().toISOString() };
}
