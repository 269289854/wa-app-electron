import React from 'react';
import {
  accountID,
  getAccounts,
  isTransientOTPSubmitError,
  probePhoneSMS,
  registerPhone,
  submitRegistrationOTP,
  type PhoneInput,
} from '../../api';
import { normalizeOpenAIPhoneCheckResult } from '../../openai-phone-check';
import { normalizePhoneInput } from '../../phone-input';
import { probeStatus, statusReason } from '../../result-model';
import type { WorkflowResponse } from '../../types';
import { errorMessage } from '../../shared/errors';
import {
  appendDebugExchange,
  debugError,
  debugInfo,
  debugRequest,
  patchDebugExchange,
  sanitizeDebugValue,
  type DebugExchange,
} from './debug';

export type SMSBowerStage = 'idle' | 'price' | 'number' | 'probe' | 'register' | 'otp' | 'submit';

export type SMSBowerRunState = {
  running: boolean;
  stopping: boolean;
  stage: SMSBowerStage;
  successes: number;
  orders: number;
  currentPhone: string;
  activationId: string;
  message: string;
};

export type SMSBowerRegistrationTaskResult = {
  successes: number;
  orders: number;
  stopped: boolean;
};

export async function probeAndRegisterForSMSBower(
  phoneInput: PhoneInput,
  openAIPhoneCheckEnabled: boolean,
  setStage: React.Dispatch<React.SetStateAction<'idle' | 'probe' | 'register'>>,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
  setProbe: React.Dispatch<React.SetStateAction<WorkflowResponse | null>>,
) {
  const probeExchange = debugRequest('探测号码', '/api/wa/phone/sms-probe', phoneInput);
  setStage('probe');
  appendDebugExchange(setDebugExchanges, probeExchange);
  let probeResponse: WorkflowResponse;
  try {
    probeResponse = await probePhoneSMS(phoneInput);
    setProbe(probeResponse);
    patchDebugExchange(setDebugExchanges, probeExchange, { ...probeExchange, response: sanitizeDebugValue(probeResponse) });
  } catch (error) {
    patchDebugExchange(setDebugExchanges, probeExchange, { ...probeExchange, error: debugError(error) });
    return { ok: false as const, reason: errorMessage(error) };
  }
  const currentStatus = probeStatus(probeResponse);
  if (!currentStatus.canRegister) return { ok: false as const, reason: statusReason(currentStatus) || '号码探测未通过' };

  const openAIResult = await checkOpenAIPhoneForSMSBower(phoneInput, setDebugExchanges, openAIPhoneCheckEnabled);
  if (openAIResult.status === 'used') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check blocked registration', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: 'openai \u624b\u673a\u53f7\u5df2\u88ab\u4f7f\u7528' };
  }
  if (openAIResult.status === 'rate_limited') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check rate limited', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: openAIResult.message, stopTask: true };
  }
  if (openAIResult.status === 'session_expired') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check session expired', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: openAIResult.message, stopTask: true };
  }
  if (openAIResult.status === 'error') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check failed', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: openAIResult.message || 'OpenAI phone check failed' };
  }

  const registerBody = { ...phoneInput, delivery_method: 'sms' };
  const registerExchange = debugRequest('发起注册', '/api/wa/register', registerBody);
  setStage('register');
  appendDebugExchange(setDebugExchanges, registerExchange);
  try {
    const response = await registerPhone(phoneInput, 'sms');
    setProbe(response);
    patchDebugExchange(setDebugExchanges, registerExchange, { ...registerExchange, response: sanitizeDebugValue(response) });
    return { ok: true as const, response };
  } catch (error) {
    patchDebugExchange(setDebugExchanges, registerExchange, { ...registerExchange, error: debugError(error) });
    return { ok: false as const, reason: errorMessage(error) };
  }
}

export async function checkOpenAIPhoneForSMSBower(
  phoneInput: PhoneInput,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
  enabled: boolean,
) {
  if (!enabled) {
    return { status: 'available' as const, message: 'OpenAI phone check disabled' };
  }
  const requestId = `openai-phone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = {
    requestId,
    phoneNumber: phoneInput.e164_number,
    countryCallingCode: phoneInput.country_calling_code,
    nationalNumber: phoneInput.phone,
    countryIso2: phoneInput.country_iso2,
    mode: 'api' as const,
    timeoutMs: 120000,
  };
  const exchange = debugRequest('OpenAI phone check start', 'openai-phone:check', body);
  appendDebugExchange(setDebugExchanges, exchange);
  try {
    await window.openAIPhone.bridgeStatus();
    const result = normalizeOpenAIPhoneCheckResult(await window.openAIPhone.check(body));
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, response: sanitizeDebugValue(result) });
    return result;
  } catch (error) {
    const result = normalizeOpenAIPhoneCheckResult({ status: 'error', message: errorMessage(error) });
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, error: debugError(error) });
    return result;
  }
}

export function selectSMSBowerPrice(prices: SMSBowerPrice[], config: SMSBowerPublicConfig) {
  return filterSMSBowerPrices(prices, config)
    .sort((left, right) => left.cost - right.cost)[0] || null;
}

export function filterSMSBowerPrices(prices: SMSBowerPrice[], config: SMSBowerPublicConfig) {
  return prices.filter((item) => item.count > 0 && item.cost >= config.minPrice && item.cost <= config.maxPrice);
}

export function smsbowerPriceErrorMessage(prices: SMSBowerPrice[], config: SMSBowerPublicConfig) {
  if (!prices.length) return 'SMSBower 没有返回 WhatsApp 价格数据，请确认国家 ID 是否正确，或稍后重试。';
  const stocked = prices.filter((item) => item.count > 0);
  if (!stocked.length) return 'SMSBower 当前国家的 WhatsApp 号码库存为 0，请更换国家或稍后重试。';
  const cheapest = stocked.sort((left, right) => left.cost - right.cost)[0];
  const summary = stocked.slice(0, 5).map((item) => `${item.cost}(${item.count})`).join(', ');
  if (cheapest && cheapest.cost > config.maxPrice) {
    return `SMSBower 有库存，但最低价格 ${cheapest.cost} 高于当前最高价 ${config.maxPrice}，请提高最高价格后再试。可用价格：${summary}`;
  }
  return `SMSBower 没有符合 ${config.minPrice}-${config.maxPrice} 的 WhatsApp 号码，请调整价格范围或更换国家。可用价格：${summary}`;
}

export async function enqueueSMSCancelOrder(
  activationId: string,
  phone: string,
  reason: string,
  provider: SMSProvider,
  platformName: string,
  orderedAtMs: number,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
) {
  const exchange = debugRequest(`${platformName} enqueue cancel`, 'sms-cancel-queue:enqueue', {
    provider,
    activationId,
    phone,
    reason,
    orderedAtMs,
  });
  appendDebugExchange(setDebugExchanges, exchange);
  try {
    const item = await window.smsCancelQueue.enqueue({ provider, activationId, phone, reason, orderedAtMs });
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, response: sanitizeDebugValue(item) });
    return item;
  } catch (error) {
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, error: debugError(error) });
    throw error;
  }
}

const otpSubmitMaxAttempts = 3;
const otpSubmitRetryDelayMs = 3000;

type SubmitRegistrationOTPWithRetryInput = {
  accountID: string;
  verificationRequestID?: string;
  otp: string;
  label: string;
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>;
  stopRef?: React.MutableRefObject<boolean>;
  onRetry?: (attempt: number, error: unknown) => void;
};

export async function submitRegistrationOTPWithRetry(input: SubmitRegistrationOTPWithRetryInput) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= otpSubmitMaxAttempts; attempt += 1) {
    if (input.stopRef?.current) throw new Error('SMSBower task was stopped by user');
    const body: Record<string, string | number> = {
      wa_account_id: input.accountID,
      otp: input.otp,
      attempt,
    };
    if (input.verificationRequestID) body.verification_request_id = input.verificationRequestID;
    const exchange = debugRequest(input.label, '/api/wa/actions/registration/resume-otp', body);
    appendDebugExchange(input.setDebugExchanges, exchange);
    try {
      const response = await submitRegistrationOTP(input.accountID, input.otp, {
        verificationRequestID: input.verificationRequestID,
      });
      patchDebugExchange(input.setDebugExchanges, exchange, { ...exchange, response: sanitizeDebugValue(response) });
      return response;
    } catch (error) {
      lastError = error;
      patchDebugExchange(input.setDebugExchanges, exchange, { ...exchange, error: debugError(error) });
      if (!isTransientOTPSubmitError(error) || attempt >= otpSubmitMaxAttempts) throw error;
      input.onRetry?.(attempt, error);
      appendDebugExchange(input.setDebugExchanges, debugInfo('OTP submit retry wait', {
        attempt,
        nextAttempt: attempt + 1,
        waitMs: otpSubmitRetryDelayMs,
        error: errorMessage(error),
      }));
      if (input.stopRef) await delayWithStop(otpSubmitRetryDelayMs, input.stopRef);
      else await delay(otpSubmitRetryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
}

export async function waitForSMSBowerCode(
  activationId: string,
  config: SMSBowerPublicConfig,
  platformName: string,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
  stopRef: React.MutableRefObject<boolean>,
) {
  const started = Date.now();
  const timeoutMs = config.otpTimeoutSeconds * 1000;
  const intervalMs = config.pollIntervalSeconds * 1000;
  while (Date.now() - started < timeoutMs) {
    if (stopRef.current) return { code: '', reason: `${platformName} task was stopped by user` };
    await delay(intervalMs);
    if (stopRef.current) return { code: '', reason: `${platformName} task was stopped by user` };
    const statusExchange = debugRequest(`${platformName} getStatus`, 'sms-platform:getStatus', { id: activationId });
    appendDebugExchange(setDebugExchanges, statusExchange);
    try {
      const status = await window.smsPlatform.getStatus(activationId);
      patchDebugExchange(setDebugExchanges, statusExchange, { ...statusExchange, response: sanitizeDebugValue(status) });
      if (status.status === 'ok' && status.code) return { code: status.code, reason: '' };
      if (status.status === 'cancelled') return { code: '', reason: `${platformName} activation was already cancelled` };
      if (status.status === 'error') return { code: '', reason: status.error || status.raw || `${platformName} status returned an error` };
    } catch (error) {
      patchDebugExchange(setDebugExchanges, statusExchange, { ...statusExchange, error: debugError(error) });
      return { code: '', reason: errorMessage(error) };
    }
  }
  return { code: '', reason: `${platformName} OTP timed out` };
}

export async function confirmAccountAppears(accountId: string) {
  let cursor = '';
  try {
    for (let page = 0; page < 20; page += 1) {
      const response = await getAccounts(cursor);
      if (response.accounts.some((account) => accountID(account) === accountId)) return true;
      if (!response.next_cursor) return false;
      cursor = response.next_cursor;
    }
    return false;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function delayWithStop(ms: number, stopRef: React.MutableRefObject<boolean>) {
  const started = Date.now();
  while (Date.now() - started < ms && !stopRef.current) {
    await delay(Math.min(250, ms - (Date.now() - started)));
  }
}

export function platformStageLabel(stage: SMSBowerStage) {
  const labels: Record<SMSBowerStage, string> = {
    idle: '空闲',
    price: '检查价格',
    number: '下单取号',
    probe: '探测号码',
    register: '发起注册',
    otp: '等待验证码',
    submit: '提交 OTP',
  };
  return labels[stage];
}

export function resolvePhoneInput(phone: string, countryCallingCode: string): PhoneInput | null {
  return normalizePhoneInput(phone, countryCallingCode);
}

export function requirePhone(input: PhoneInput | null) {
  if (!input) throw new Error('请输入手机号和国家拨号码');
  return input;
}
