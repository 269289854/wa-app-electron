export type OpenAIPhoneCheckStatus = 'used' | 'sent' | 'available' | 'error';

export type OpenAIPhoneCheckResult = {
  requestId?: string;
  phoneNumber?: string;
  status: OpenAIPhoneCheckStatus;
  message: string;
  code?: string;
  raw?: unknown;
};

const PHONE_USED_MESSAGE = 'openai \u624b\u673a\u53f7\u5df2\u88ab\u4f7f\u7528';

export function normalizeOpenAIPhoneCheckResult(input: unknown): OpenAIPhoneCheckResult {
  const record = asRecord(input);
  const raw = record.raw ?? input;
  const rawRecord = asRecord(raw);
  const status = stringValue(record.status);
  const code = stringValue(record.code || rawRecord.code);
  const message = stringValue(record.message || rawRecord.message || rawRecord.error);
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

  if (status === 'sent' || status === 'available') {
    return {
      requestId: stringValue(record.requestId),
      phoneNumber: stringValue(record.phoneNumber || rawRecord.phoneNumber || rawRecord.phone_number),
      status,
      message: message || (status === 'sent' ? 'OpenAI verification code sent' : 'OpenAI phone is available'),
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
