chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'openai-phone-check-ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type !== 'openai-phone-check') return false;
  runOpenAIPhoneCheck(message.task)
    .then(sendResponse)
    .catch((error) => sendResponse({ status: 'error', message: String(error?.message || error), raw: { extensionError: String(error?.message || error) } }));
  return true;
});

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
  const text = `${raw?.code || ''} ${raw?.message || ''} ${JSON.stringify(raw || '')}`.toLowerCase();
  if (text.includes('phone_number_in_use') || text.includes('phone number already in use') || text.includes('电话号码已被使用') || text.includes('该电话号码已被使用')) {
    return { status: 'used', message: 'openai 手机号已被使用', code: raw?.code || 'phone_number_in_use', raw };
  }
  if (ok) return { status: 'sent', message: 'OpenAI verification request sent', raw };
  return { status: 'error', message: raw?.message || `OpenAI HTTP error`, code: raw?.code, raw };
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
