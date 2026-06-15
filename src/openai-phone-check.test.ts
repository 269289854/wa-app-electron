import { describe, expect, it } from 'vitest';
import { normalizeOpenAIPhoneCheckResult } from './openai-phone-check';

describe('OpenAI phone check result normalization', () => {
  it('marks phone_number_in_use errors as used', () => {
    expect(normalizeOpenAIPhoneCheckResult({
      message: 'Phone number already in use. Please use a different phone number.',
      type: 'invalid_request_error',
      param: null,
      code: 'phone_number_in_use',
    })).toMatchObject({
      status: 'used',
      message: 'openai 手机号已被使用',
      code: 'phone_number_in_use',
    });
  });

  it('marks English used messages as used', () => {
    expect(normalizeOpenAIPhoneCheckResult({ message: 'Phone number already in use.' })).toMatchObject({
      status: 'used',
    });
  });

  it('marks Chinese used messages as used', () => {
    expect(normalizeOpenAIPhoneCheckResult({ message: '该电话号码已被使用。请使用其他电话号码。' })).toMatchObject({
      status: 'used',
    });
  });

  it('passes through sent and available statuses', () => {
    expect(normalizeOpenAIPhoneCheckResult({ status: 'sent', message: 'ok' })).toMatchObject({ status: 'sent', message: 'ok' });
    expect(normalizeOpenAIPhoneCheckResult({ status: 'available' })).toMatchObject({ status: 'available' });
  });

  it('normalizes other responses as errors', () => {
    expect(normalizeOpenAIPhoneCheckResult({ code: 'rate_limited', message: 'Try later' })).toMatchObject({
      status: 'error',
      message: 'Try later',
      code: 'rate_limited',
    });
  });
});
