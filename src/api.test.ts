import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupFailedRegistration,
  isTransientOTPSubmitError,
  messageText,
  normalizeTwoFactorStatus,
  persistLoginState,
  pollAccountTransferRegistration,
  refreshAccountTransferChallenge,
  submitRegistrationOTP,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('messageText', () => {
  it('returns plain string text', () => {
    expect(messageText({ text: 'hello' })).toBe('hello');
  });

  it('extracts the production encrypted text value shape', () => {
    expect(messageText({ text: { value: '[模板] *716386* 是你的验证码。', redacted_value: '[模********' } })).toBe('[模板] *716386* 是你的验证码。');
  });

  it('extracts common nested text fields', () => {
    expect(messageText({ text: { extendedTextMessage: { text: 'nested body' } } })).toBe('nested body');
    expect(messageText({ text: { conversation: 'conversation body' } })).toBe('conversation body');
  });

  it('does not stringify unknown objects', () => {
    expect(messageText({ text: { unknown: { value: {} } } })).toBe('');
  });
});

describe('normalizeTwoFactorStatus', () => {
  it('uses account projection before a status sync finishes', () => {
    expect(normalizeTwoFactorStatus({ configured: true, email_configured: true, email_address: 'mock@example.com' })).toEqual({
      configured: true,
      emailConfigured: true,
      emailVerified: null,
      emailAddress: 'mock@example.com',
      emailLabel: '待验证邮箱',
    });
  });

  it('lets synced status override the account projection', () => {
    expect(normalizeTwoFactorStatus(
      { configured: false, email_address: '' },
      { configured: true, email_configured: true, email_verified: true, email_address: 'synced@example.com' },
    )).toMatchObject({
      configured: true,
      emailConfigured: true,
      emailVerified: true,
      emailAddress: 'synced@example.com',
      emailLabel: '已验证',
    });
  });

  it('labels missing email clearly', () => {
    expect(normalizeTwoFactorStatus({ configured: false })).toMatchObject({
      configured: false,
      emailConfigured: false,
      emailAddress: '',
      emailLabel: '未配置邮箱',
    });
  });
});

describe('submitRegistrationOTP', () => {
  it('includes verification_request_id when available', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      waApi: { request },
    });

    await submitRegistrationOTP('waacc_1', '123456', { verificationRequestID: 'wavrf_1' });

    expect(request).toHaveBeenCalledWith({
      path: '/api/wa/actions/registration/resume-otp',
      method: 'POST',
      timeoutMs: 70000,
      body: {
        wa_account_id: 'waacc_1',
        verification_request_id: 'wavrf_1',
        otp: '123456',
      },
    });
  });
});

describe('registration recovery actions', () => {
  it('refreshes an account transfer challenge', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      waApi: { request },
    });

    await refreshAccountTransferChallenge('wavrf_1');

    expect(request).toHaveBeenCalledWith({
      path: '/api/wa/actions/registration/account-transfer/refresh',
      method: 'POST',
      timeoutMs: 70000,
      body: { verification_request_id: 'wavrf_1' },
    });
  });

  it('polls an account transfer registration with account context', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      waApi: { request },
    });

    await pollAccountTransferRegistration('wavrf_1', 'waacc_1', 5);

    expect(request).toHaveBeenCalledWith({
      path: '/api/wa/actions/registration/account-transfer/poll',
      method: 'POST',
      timeoutMs: 70000,
      body: {
        verification_request_id: 'wavrf_1',
        wa_account_id: 'waacc_1',
        max_attempts: 5,
      },
    });
  });

  it('cleans up failed registration attempts without undefined payload fields', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      waApi: { request },
    });

    await cleanupFailedRegistration({ accountID: 'waacc_1', verificationRequestID: 'wavrf_1' });

    expect(request).toHaveBeenCalledWith({
      path: '/api/wa/actions/registration/cleanup-failed-account',
      method: 'POST',
      timeoutMs: 70000,
      body: {
        wa_account_id: 'waacc_1',
        verification_request_id: 'wavrf_1',
      },
    });
  });

  it('persists a login state by registration id or client profile id', async () => {
    const request = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      waApi: { request },
    });

    await persistLoginState({ registrationID: 'wareg_1', clientProfileID: 'wacp_1' });

    expect(request).toHaveBeenCalledWith({
      path: '/api/wa/actions/registration/persist-login-state',
      method: 'POST',
      timeoutMs: 70000,
      body: {
        registration_id: 'wareg_1',
        client_profile_id: 'wacp_1',
      },
    });
  });
});

describe('isTransientOTPSubmitError', () => {
  it('recognizes temporary upstream failures', () => {
    expect(isTransientOTPSubmitError(new Error('wasafe upstream http 502: internal'))).toBe(true);
    expect(isTransientOTPSubmitError(new Error('HTTP 503'))).toBe(true);
    expect(isTransientOTPSubmitError(new Error('request timed out'))).toBe(true);
  });

  it('does not classify business validation failures as transient', () => {
    expect(isTransientOTPSubmitError(new Error('otp is invalid'))).toBe(false);
  });
});
