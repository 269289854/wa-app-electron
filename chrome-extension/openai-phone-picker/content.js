/* global getComputedStyle */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'openai-phone-picker-ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type !== 'openai-phone-picker-apply') return false;
  applyOpenAIPhonePickerAccount(message.account)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

async function applyOpenAIPhonePickerAccount(account) {
  const phone = normalizeAccountPayload(account);
  await selectCountry(phone);
  const input = findPhoneInput();
  setInputValue(input, phone.nationalNumber);
  return {
    ok: true,
    message: `Filled ${phone.e164Number}`,
    account: phone,
  };
}

function normalizeAccountPayload(account) {
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

async function selectCountry(phone) {
  const trigger = findCountryTrigger(phone);
  if (!trigger) throw new Error('OpenAI country selector was not found');
  trigger.click();
  const option = await waitForCountryOption(phone, trigger);
  if (option) {
    option.click();
    await sleep(150);
    return;
  }
  if (textHasCallingCode(elementText(trigger), phone.countryCallingCode)) return;
  throw new Error(`OpenAI country option +${phone.countryCallingCode} was not found`);
}

function findCountryTrigger(phone) {
  const elements = queryAll('button,[role="button"],[role="combobox"]')
    .filter((element) => isVisible(element) && !isDisabled(element));
  const scored = elements
    .map((element) => ({ element, score: countryTriggerScore(element, phone) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.element || null;
}

function countryTriggerScore(element, phone) {
  const text = elementText(element);
  if (/continue|whatsapp|sms|继续|发送|验证码/i.test(text)) return 0;
  let score = 0;
  if (textHasCallingCode(text, phone.countryCallingCode)) score += 30;
  if (/\(\+\d+\)|\+\d+/.test(text)) score += 10;
  if (attrText(element).includes('listbox') || attrText(element).includes('combobox')) score += 8;
  if (String(element.getAttribute?.('role') || '') === 'combobox') score += 8;
  return score;
}

async function waitForCountryOption(phone, trigger) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const option = findCountryOption(phone, trigger);
    if (option) return option;
    await sleep(100);
  }
  return null;
}

function findCountryOption(phone, trigger) {
  const candidates = queryAll('[role="option"],button,[role="button"],li,div[tabindex]')
    .filter((element) => element !== trigger && isVisible(element) && !isDisabled(element));
  const scored = candidates
    .map((element) => ({ element, score: countryOptionScore(element, phone) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.element || null;
}

function countryOptionScore(element, phone) {
  const text = elementText(element);
  if (!textHasCallingCode(text, phone.countryCallingCode)) return 0;
  let score = 10;
  const attributes = attrText(element);
  if (phone.countryIso2 && attributes.includes(phone.countryIso2.toLowerCase())) score += 10;
  if (new RegExp(`\\(\\+${escapeRegExp(phone.countryCallingCode)}\\)`).test(text)) score += 6;
  if (String(element.getAttribute?.('role') || '') === 'option') score += 4;
  return score;
}

function findPhoneInput() {
  const inputs = queryAll('input')
    .filter((input) => isVisible(input) && !isDisabled(input) && !/hidden|checkbox|radio|button|submit/i.test(String(input.type || '')));
  const scored = inputs
    .map((input, index) => ({ input, score: phoneInputScore(input) + index / 1000 }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  const input = scored[0]?.input || inputs[inputs.length - 1];
  if (!input) throw new Error('OpenAI phone input was not found');
  return input;
}

function phoneInputScore(input) {
  const text = [
    input.type,
    input.name,
    input.id,
    input.placeholder,
    input.ariaLabel,
    input.getAttribute?.('aria-label'),
    input.getAttribute?.('autocomplete'),
  ].filter(Boolean).join(' ').toLowerCase();
  let score = 1;
  if (text.includes('tel')) score += 20;
  if (/phone|mobile|number|电话|手机号/.test(text)) score += 15;
  return score;
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function textHasCallingCode(text, callingCode) {
  return new RegExp(`(^|[^\\d])\\+\\(?${escapeRegExp(callingCode)}\\)?([^\\d]|$)`).test(text);
}

function elementText(element) {
  return String(element?.textContent || element?.innerText || '').replace(/\s+/g, ' ').trim();
}

function attrText(element) {
  if (!element?.getAttributeNames) {
    return [
      element?.role,
      element?.ariaLabel,
      element?.id,
      element?.name,
      element?.className,
    ].filter(Boolean).join(' ').toLowerCase();
  }
  return element.getAttributeNames()
    .map((name) => `${name} ${element.getAttribute(name) || ''}`)
    .join(' ')
    .toLowerCase();
}

function isVisible(element) {
  if (!element) return false;
  if (element.hidden) return false;
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  if (typeof element.getClientRects === 'function') return element.getClientRects().length > 0;
  return true;
}

function isDisabled(element) {
  return Boolean(element?.disabled || element?.getAttribute?.('aria-disabled') === 'true');
}

function queryAll(selector) {
  return [...document.querySelectorAll(selector)];
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function errorMessage(error) {
  return String(error?.message || error);
}
