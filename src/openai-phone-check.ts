export type OpenAIPhoneCheckStatus = 'used' | 'sent' | 'available' | 'error' | 'rate_limited' | 'session_expired';

export type OpenAIPhoneCheckResult = {
  requestId?: string;
  phoneNumber?: string;
  status: OpenAIPhoneCheckStatus;
  message: string;
  code?: string;
  raw?: unknown;
};

const PHONE_USED_MESSAGE = 'openai \u624b\u673a\u53f7\u5df2\u88ab\u4f7f\u7528';
export const OPENAI_PHONE_RATE_LIMIT_MESSAGE = 'OpenAI 已超过请求手机号次数，请稍后再试或关闭 OpenAI 手机号检查';
export const OPENAI_PHONE_SESSION_EXPIRED_MESSAGE = 'OpenAI 登录已过期，请在插件打开的 OpenAI 页面重新登录后再继续';

export function normalizeOpenAIPhoneCheckResult(input: unknown): OpenAIPhoneCheckResult {
  const record = asRecord(input);
  const raw = record.raw ?? input;
  const rawRecord = asRecord(raw);
  const errorRecord = asRecord(record.error || rawRecord.error);
  const status = stringValue(record.status);
  const code = stringValue(record.code || rawRecord.code || errorRecord.code);
  const message = stringValue(record.message || rawRecord.message || errorRecord.message || rawRecord.error);
  const combined = `${status} ${code} ${message} ${JSON.stringify(raw || '')}`.toLowerCase();

  if (
    code === 'phone_number_in_use'
    || combined.includes('phone_number_in_use')
    || combined.includes('phone number already in use')
    || combined.includes('\u7535\u8bdd\u53f7\u7801\u5df2\u88ab\u4f7f\u7528')
    || combined.includes('\u7535\u8bdd\u53f7\u7801\u5df2\u7ecf\u88ab\u4f7f\u7528')
    || combined.includes('\u8be5\u7535\u8bdd\u53f7\u7801\u5df2\u88ab\u4f7f\u7528')
    || combined.includes('\u8be5\u7535\u8bdd\u53f7\u7801\u5df2\u7ecf\u88ab\u4f7f\u7528')
  ) {
    return {
      requestId: stringValue(record.requestId),
      phoneNumber: stringValue(record.phoneNumber || rawRecord.phoneNumber || rawRecord.phone_number),
      status: 'used',
      message: PHONE_USED_MESSAGE,
      code: code || 'phone_number_in_use',
      raw,
    };
  }

  if (
    code === 'rate_limit_exceeded'
    || combined.includes('rate_limit_exceeded')
    || combined.includes('too many phone verification requests')
    || combined.includes('help.openai.com')
  ) {
    return {
      requestId: stringValue(record.requestId),
      phoneNumber: stringValue(record.phoneNumber || rawRecord.phoneNumber || rawRecord.phone_number),
      status: 'rate_limited',
      message: OPENAI_PHONE_RATE_LIMIT_MESSAGE,
      code: code || 'rate_limit_exceeded',
      raw,
    };
  }

  if (
    code === 'invalid_state'
    || combined.includes('invalid_state')
    || combined.includes('sign-in session is no longer valid')
    || combined.includes('please start over to continue')
  ) {
    return {
      requestId: stringValue(record.requestId),
      phoneNumber: stringValue(record.phoneNumber || rawRecord.phoneNumber || rawRecord.phone_number),
      status: 'session_expired',
      message: OPENAI_PHONE_SESSION_EXPIRED_MESSAGE,
      code: code || 'invalid_state',
      raw,
    };
  }

  if ((status === 'sent' || status === 'available') && isOpenAIPhoneOTPSuccess(raw)) {
    return {
      requestId: stringValue(record.requestId),
      phoneNumber: stringValue(record.phoneNumber || rawRecord.phoneNumber || rawRecord.phone_number),
      status: 'sent',
      message: message || 'OpenAI verification code sent',
      code,
      raw,
    };
  }

  if (isOpenAIPhoneOTPSuccess(rawRecord)) {
    return {
      requestId: stringValue(record.requestId),
      phoneNumber: stringValue(record.phoneNumber || rawRecord.phoneNumber || rawRecord.phone_number),
      status: 'sent',
      message: message || 'OpenAI verification code sent',
      code,
      raw,
    };
  }

  return {
    requestId: stringValue(record.requestId),
    phoneNumber: stringValue(record.phoneNumber || rawRecord.phoneNumber || rawRecord.phone_number),
    status: 'error',
    message: message || 'OpenAI phone check failed',
    code,
    raw,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function isOpenAIPhoneOTPSuccess(value: unknown) {
  const record = asRecord(value);
  const page = asRecord(record.page);
  return page.type === 'phone_otp_verification' && Boolean(record.continue_url || record['oai-client-auth-session']);
}
