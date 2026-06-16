import { describe, expect, it } from 'vitest';
import { OPENAI_PHONE_RATE_LIMIT_MESSAGE, OPENAI_PHONE_SESSION_EXPIRED_MESSAGE, normalizeOpenAIPhoneCheckResult } from './openai-phone-check';

describe('OpenAI phone check result normalization', () => {
  it('marks phone_number_in_use errors as used', () => {
    expect(normalizeOpenAIPhoneCheckResult({
      message: 'Phone number already in use. Please use a different phone number.',
      type: 'invalid_request_error',
      param: null,
      code: 'phone_number_in_use',
    })).toMatchObject({
      status: 'used',
      message: 'openai \u624b\u673a\u53f7\u5df2\u88ab\u4f7f\u7528',
      code: 'phone_number_in_use',
    });
  });

  it('marks English used messages as used', () => {
    expect(normalizeOpenAIPhoneCheckResult({ message: 'Phone number already in use.' })).toMatchObject({
      status: 'used',
    });
  });

  it('marks Chinese used messages as used', () => {
    expect(normalizeOpenAIPhoneCheckResult({ message: '\u8be5\u7535\u8bdd\u53f7\u7801\u5df2\u88ab\u4f7f\u7528\u3002\u8bf7\u4f7f\u7528\u5176\u4ed6\u7535\u8bdd\u53f7\u7801\u3002' })).toMatchObject({
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

  it('marks OpenAI phone verification request limits as rate limited', () => {
    expect(normalizeOpenAIPhoneCheckResult({
      message: "You've made too many phone verification requests. Please try again later or contact us through our help center at help.openai.com.",
      type: 'invalid_request_error',
      param: null,
      code: 'rate_limit_exceeded',
    })).toMatchObject({
      status: 'rate_limited',
      message: OPENAI_PHONE_RATE_LIMIT_MESSAGE,
      code: 'rate_limit_exceeded',
    });
  });

  it('recognizes rate limit wording even without a code', () => {
    expect(normalizeOpenAIPhoneCheckResult({ message: 'Too many phone verification requests. See help.openai.com.' })).toMatchObject({
      status: 'rate_limited',
      message: OPENAI_PHONE_RATE_LIMIT_MESSAGE,
      code: 'rate_limit_exceeded',
    });
  });

  it('marks expired OpenAI sign-in sessions as session expired', () => {
    expect(normalizeOpenAIPhoneCheckResult({
      error: {
        message: 'Your sign-in session is no longer valid. Please start over to continue.',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_state',
      },
    })).toMatchObject({
      status: 'session_expired',
      message: OPENAI_PHONE_SESSION_EXPIRED_MESSAGE,
      code: 'invalid_state',
    });
  });

  it('recognizes expired sign-in wording even without a code', () => {
    expect(normalizeOpenAIPhoneCheckResult({ message: 'Your sign-in session is no longer valid. Please start over to continue.' })).toMatchObject({
      status: 'session_expired',
      message: OPENAI_PHONE_SESSION_EXPIRED_MESSAGE,
      code: 'invalid_state',
    });
  });
});
