/* global clearTimeout */

const queryInput = document.querySelector('#query');
const refreshButton = document.querySelector('#refresh');
const statusBox = document.querySelector('#status');
const accountsBox = document.querySelector('#accounts');

let accounts = [];
let searchTimer = 0;

queryInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refreshAccounts(), 250);
});

refreshButton.addEventListener('click', () => refreshAccounts());

async function refreshAccounts() {
  setStatus('Loading WA App phones...');
  refreshButton.disabled = true;
  try {
    const response = await sendMessage({ type: 'openai-phone-picker-search', query: queryInput.value, limit: 200 });
    if (!response?.ok) throw new Error(response?.error || 'Failed to load WA App phones');
    accounts = response.accounts || [];
    renderAccounts();
    setStatus(accounts.length ? `${accounts.length} phone(s)` : 'No matching phone numbers');
  } catch (error) {
    accounts = [];
    renderAccounts();
    setStatus(errorMessage(error), true);
  } finally {
    refreshButton.disabled = false;
  }
}

function renderAccounts() {
  accountsBox.textContent = '';
  for (const account of accounts) {
    const item = document.createElement('article');
    item.className = 'account';

    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = account.displayName || account.nationalNumber || account.e164Number || account.accountId;
    const detail = document.createElement('small');
    detail.textContent = [
      account.e164Number,
      account.countryIso2 ? `${account.countryIso2} +${account.countryCallingCode}` : `+${account.countryCallingCode}`,
      account.status,
    ].filter(Boolean).join(' / ');
    text.append(title, detail);

    const button = document.createElement('button');
    button.className = 'apply';
    button.type = 'button';
    button.textContent = 'Apply';
    button.addEventListener('click', () => applyAccount(account, button));

    item.append(text, button);
    accountsBox.append(item);
  }
}

async function applyAccount(account, button) {
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = 'Applying';
  setStatus(`Applying ${account.e164Number || account.displayName || 'phone'}...`);
  try {
    const response = await sendMessage({ type: 'openai-phone-picker-apply', account });
    if (!response?.ok) throw new Error(response?.error || 'Failed to apply phone number');
    setStatus(response.message || 'Filled phone number');
  } catch (error) {
    setStatus(errorMessage(error), true);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function setStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('error', isError);
}

function errorMessage(error) {
  return String(error?.message || error);
}

refreshAccounts();
