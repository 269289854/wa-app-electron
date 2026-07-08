export type OpenAIPhonePickerAccount = {
  accountId: string;
  displayName: string;
  status: string;
  e164Number: string;
  nationalNumber: string;
  countryCallingCode: string;
  countryIso2: string;
  updatedAt: string;
};

export function normalizeOpenAIPhonePickerAccount(input: unknown): OpenAIPhonePickerAccount | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const phone = objectRecord(record.phone);
  const accountId = stringValue(record.wa_account_id ?? record.account_id ?? record.id);
  const countryCallingCode = digitsOnly(phone?.country_calling_code ?? phone?.calling_code ?? phone?.dial_code);
  const e164Number = normalizeE164(phone?.e164_number ?? phone?.e164 ?? phone?.number);
  const nationalNumber = digitsOnly(phone?.national_number ?? phone?.phone ?? phone?.local_number)
    || deriveNationalNumber(e164Number, countryCallingCode);
  if (!accountId || !e164Number || !countryCallingCode) return null;
  const displayName = stringValue(record.display_name ?? record.name) || nationalNumber || e164Number || accountId;
  const countryIso2 = stringValue(phone?.country_iso2 ?? phone?.region ?? phone?.country).toUpperCase();
  return {
    accountId,
    displayName,
    status: stringValue(record.status),
    e164Number,
    nationalNumber,
    countryCallingCode,
    countryIso2,
    updatedAt: timestampString(objectRecord(record.audit)?.updated_at ?? record.updated_at),
  };
}

export function filterOpenAIPhonePickerAccounts(accounts: OpenAIPhonePickerAccount[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return accounts;
  return accounts.filter((account) => accountSearchText(account).includes(normalized));
}

export function limitOpenAIPhonePickerAccounts(accounts: OpenAIPhonePickerAccount[], limit: number) {
  return accounts.slice(0, boundedLimit(limit));
}

export function boundedLimit(value: unknown, fallback = 200, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.round(parsed)));
}

export function deriveNationalNumber(e164Number: string, countryCallingCode: string) {
  const digits = digitsOnly(e164Number);
  const callingCode = digitsOnly(countryCallingCode);
  if (!digits) return '';
  if (callingCode && digits.startsWith(callingCode)) return digits.slice(callingCode.length);
  return digits;
}

function accountSearchText(account: OpenAIPhonePickerAccount) {
  return [
    account.displayName,
    account.e164Number,
    account.nationalNumber,
    account.countryCallingCode,
    account.countryIso2,
    account.accountId,
    account.status,
  ].filter(Boolean).join(' ').toLowerCase();
}

function normalizeE164(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return '';
  if (raw.startsWith('+')) return `+${digitsOnly(raw)}`;
  const digits = digitsOnly(raw);
  return digits ? `+${digits}` : '';
}

function digitsOnly(value: unknown) {
  return stringValue(value).replace(/\D+/g, '');
}

function stringValue(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function objectRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timestampString(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const seconds = Number(record.seconds);
    const nanos = Number(record.nanos || 0);
    if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000)).toISOString();
  }
  return '';
}
