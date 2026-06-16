const inFlightChecks = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'openai-phone-check-ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type !== 'openai-phone-check') return false;
  const requestKey = taskKey(message.task);
  const promise = inFlightChecks.get(requestKey) || runOpenAIPhoneCheck(message.task).finally(() => {
    inFlightChecks.delete(requestKey);
  });
  inFlightChecks.set(requestKey, promise);
  promise
    .then(sendResponse)
    .catch((error) => sendResponse({ status: 'error', message: String(error?.message || error), raw: { extensionError: String(error?.message || error) } }));
  return true;
});

function taskKey(task) {
  if (task?.requestId) return String(task.requestId);
  return JSON.stringify({
    phoneNumber: task?.phoneNumber,
    countryCallingCode: task?.countryCallingCode,
    mode: task?.mode,
  });
}

async function runOpenAIPhoneCheck(task) {
  if (task.mode === 'page') return runPageCheck(task);
  const apiResult = await runApiCheck(task);
  if (apiResult.status === 'error') {
    const fallback = await runPageCheck(task).catch((error) => ({ status: 'error', message: String(error?.message || error), raw: { apiResult } }));
    return fallback.status === 'error' ? apiResult : fallback;
  }
  return apiResult;
}

async function runApiCheck(task) {
  const response = await fetch('https://auth.openai.com/api/accounts/add-phone/send', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: task.phoneNumber, channel: 'whatsapp' }),
  });
  const raw = await readResponse(response);
  return normalizeOpenAIResponse(raw, response.ok);
}

async function runPageCheck(task) {
  await fillPhone(task);
  await selectWhatsApp();
  const before = document.body.innerText;
  clickContinue();
  await waitForChange(before, 15000);
  return normalizeOpenAIResponse({ message: document.body.innerText }, true);
}

async function fillPhone(task) {
  const inputs = [...document.querySelectorAll('input')];
  const phoneInput = inputs.find((input) => /phone|电话|手机号|number/i.test(`${input.name} ${input.id} ${input.placeholder} ${input.ariaLabel || ''}`)) || inputs[inputs.length - 1];
  if (!phoneInput) throw new Error('OpenAI phone input was not found');
  setInputValue(phoneInput, task.phoneNumber);
  const buttons = [...document.querySelectorAll('button,[role="button"]')];
  const countryButton = buttons.find((button) => button.textContent?.includes(`+${task.countryCallingCode}`));
  countryButton?.click();
}

async function selectWhatsApp() {
  const target = [...document.querySelectorAll('button,[role="button"],label')].find((element) => /whatsapp/i.test(element.textContent || ''));
  if (target instanceof HTMLElement) target.click();
}

function clickContinue() {
  const button = [...document.querySelectorAll('button')].find((item) => /继续|continue/i.test(item.textContent || '')) || [...document.querySelectorAll('button')].at(-1);
  if (!button) throw new Error('OpenAI continue button was not found');
  button.click();
}

function normalizeOpenAIResponse(raw, ok) {
  const error = openAIError(raw);
  const code = error.code || raw?.code || '';
  const message = error.message || raw?.message || '';
  const text = `${code} ${message} ${JSON.stringify(raw || '')}`.toLowerCase();
  if (text.includes('phone_number_in_use') || text.includes('phone number already in use') || text.includes('电话号码已被使用') || text.includes('该电话号码已被使用')) {
    return { status: 'used', message: 'openai 手机号已被使用', code: code || 'phone_number_in_use', raw };
  }
  if (text.includes('rate_limit_exceeded') || text.includes('too many phone verification requests') || text.includes('help.openai.com')) {
    return { status: 'rate_limited', message: message || 'OpenAI phone verification request limit exceeded', code: code || 'rate_limit_exceeded', raw };
  }
  if (text.includes('invalid_state') || text.includes('sign-in session is no longer valid') || text.includes('please start over to continue')) {
    return { status: 'session_expired', message: message || 'OpenAI sign-in session expired', code: code || 'invalid_state', raw };
  }
  if (isOpenAIPhoneOTPSuccess(raw)) return { status: 'sent', message: 'OpenAI verification request sent', raw };
  return { status: 'error', message: message || (ok ? 'OpenAI did not enter phone OTP verification' : 'OpenAI HTTP error'), code, raw };
}

function openAIError(raw) {
  return raw && typeof raw.error === 'object' && raw.error ? raw.error : {};
}

function isOpenAIPhoneOTPSuccess(raw) {
  return Boolean(
    raw
    && typeof raw === 'object'
    && raw.page
    && raw.page.type === 'phone_otp_verification'
    && (raw.continue_url || raw['oai-client-auth-session'])
  );
}

async function readResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function waitForChange(before, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (document.body.innerText !== before || Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve();
      }
    }, 300);
  });
}
