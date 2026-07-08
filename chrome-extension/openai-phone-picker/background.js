/* global URL */

const BRIDGE_BASE_URL = 'http://127.0.0.1:17391';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'openai-phone-picker-search') {
    fetchAccounts(message.query || '', message.limit || 200)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error), accounts: [] }));
    return true;
  }
  if (message?.type === 'openai-phone-picker-apply') {
    applyAccount(message.account)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
    return true;
  }
  return false;
});

async function fetchAccounts(query, limit) {
  const url = new URL('/openai-phone-picker/accounts', BRIDGE_BASE_URL);
  url.searchParams.set('query', String(query || ''));
  url.searchParams.set('limit', String(limit || 200));
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error || `WA App bridge HTTP ${response.status}`);
  return { ok: true, accounts: Array.isArray(data.accounts) ? data.accounts : [] };
}

async function applyAccount(account) {
  const normalized = normalizeAccount(account);
  const tab = await findOrCreateAddPhoneTab();
  await ensureContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'openai-phone-picker-apply', account: normalized });
  if (!response?.ok) throw new Error(response?.error || 'OpenAI phone page did not accept the phone number');
  return response;
}

function normalizeAccount(account) {
  const e164Number = stringValue(account?.e164Number);
  const countryCallingCode = digitsOnly(account?.countryCallingCode);
  const nationalNumber = digitsOnly(account?.nationalNumber) || deriveNationalNumber(e164Number, countryCallingCode);
  if (!e164Number || !countryCallingCode || !nationalNumber) {
    throw new Error('Selected account does not have a complete phone number');
  }
  return {
    accountId: stringValue(account?.accountId),
    displayName: stringValue(account?.displayName) || nationalNumber,
    e164Number,
    nationalNumber,
    countryCallingCode,
    countryIso2: stringValue(account?.countryIso2).toUpperCase(),
  };
}

async function findOrCreateAddPhoneTab() {
  const tabs = await chrome.tabs.query({ url: 'https://auth.openai.com/add-phone*' });
  const tab = tabs[0]?.id ? tabs[0] : await chrome.tabs.create({ url: 'https://auth.openai.com/add-phone', active: true });
  if (!tab.id) throw new Error('OpenAI add-phone tab was not available');
  await waitForTabReady(tab.id);
  return tab;
}

async function waitForTabReady(tabId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && tab.url?.startsWith('https://auth.openai.com/add-phone')) return;
    await sleep(250);
  }
  throw new Error('OpenAI add-phone page did not finish loading');
}

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'openai-phone-picker-ping' });
    if (pong?.ok) return;
  } catch {
    // The content script is not present yet; inject it below.
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { type: 'openai-phone-picker-ping' });
      if (pong?.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('OpenAI phone picker content script is not available');
}

function deriveNationalNumber(e164Number, countryCallingCode) {
  const digits = digitsOnly(e164Number);
  const callingCode = digitsOnly(countryCallingCode);
  if (callingCode && digits.startsWith(callingCode)) return digits.slice(callingCode.length);
  return digits;
}

function digitsOnly(value) {
  return stringValue(value).replace(/\D+/g, '');
}

function stringValue(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return String(error?.message || error);
}
