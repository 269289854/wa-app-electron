import type {
  AccountMessage,
  AccountSettingsResponse,
  ListAccountsResponse,
  ListContactsResponse,
  ListMessagesResponse,
  ListOtpMessagesResponse,
  ListProfilesResponse,
  LongConnectionStatusResponse,
  WAAccount,
  WAContact,
  WorkflowResponse,
  TwoFactorProjection,
} from './types';

export const ACCOUNT_PAGE_SIZE = 100;

export type PhoneInput = {
  region: string;
  phone: string;
  e164_number: string;
  country_calling_code: string;
  country_iso2: string;
};

export type ConnectionFilters = {
  login_state_id?: string;
  wa_account_id?: string;
  client_profile_id?: string;
  registered_identity_id?: string;
};

export async function apiRequest<T>(path: string, input: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
  const response = await window.waApi.request<T>({
    path,
    method: input.method,
    body: input.body,
    timeoutMs: input.timeoutMs,
  });
  const error = (response as { error?: { message?: string } })?.error?.message;
  if (error) throw new Error(error);
  return response;
}

export async function assetDataUrl(path: string) {
  const asset = await window.waApi.fetchAsset(path);
  if (!asset.ok || !asset.data) return '';
  return `data:${asset.contentType};base64,${asset.data}`;
}

export async function getAccounts(cursor = '') {
  const params = new URLSearchParams({ limit: String(ACCOUNT_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  const response = await apiRequest<ListAccountsResponse>(`/api/wa/accounts?${params}`);
  return { ...response, accounts: response.accounts || [] };
}

export function deleteAccount(accountID: string) {
  return apiRequest(`/api/wa/accounts/${encodeURIComponent(accountID)}`, { method: 'DELETE' });
}

export function getClientProfiles(accountID: string, cursor = '') {
  const params = new URLSearchParams({ wa_account_id: accountID, limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return apiRequest<ListProfilesResponse>(`/api/wa/client-profiles?${params}`);
}

export function getContacts(accountID: string, cursor = '') {
  const params = new URLSearchParams({ wa_account_id: accountID, limit: '500' });
  if (cursor) params.set('cursor', cursor);
  return apiRequest<ListContactsResponse>(`/api/wa/contacts?${params}`);
}

export function resolveContacts(accountID: string, jids: string[]) {
  return apiRequest('/api/wa/contacts/resolve', { method: 'POST', body: { wa_account_id: accountID, jids, limit: jids.length } });
}

export function deleteContact(accountID: string, contactID: string) {
  const params = new URLSearchParams({ wa_account_id: accountID });
  return apiRequest(`/api/wa/contacts/${encodeURIComponent(contactID)}?${params}`, { method: 'DELETE' });
}

export function getMessages(accountID: string, contactRef: string, cursor = '') {
  const params = new URLSearchParams({ wa_account_id: accountID, contact_ref: contactRef, limit: '100', include_sensitive_text: 'true' });
  if (cursor) params.set('cursor', cursor);
  return apiRequest<ListMessagesResponse>(`/api/wa/messages?${params}`);
}

export function markMessagesRead(accountID: string, contactRef: string) {
  return apiRequest('/api/wa/messages/read', { method: 'POST', body: { wa_account_id: accountID, contact_ref: contactRef, local_only: false, account_message_ids: [] } });
}

export function deleteMessages(accountID: string, ids: string[]) {
  return apiRequest('/api/wa/messages/delete', { method: 'POST', body: { wa_account_id: accountID, account_message_ids: ids, mode: 'for_me' } });
}

export function sendTextMessage(accountID: string, contactRef: string, text: string) {
  return apiRequest('/api/wa/messages/send', { method: 'POST', body: { wa_account_id: accountID, contact_ref: contactRef, text } });
}

export function getOtpMessages(accountID: string, cursor = '') {
  const params = new URLSearchParams({ wa_account_id: accountID, limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return apiRequest<ListOtpMessagesResponse>(`/api/wa/account-otp-messages?${params}`);
}

export function getConnections(filters: ConnectionFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return apiRequest<LongConnectionStatusResponse>(`/api/wa/long-connections${params.size ? `?${params}` : ''}`);
}

export function probePhoneSMS(input: PhoneInput) {
  return apiRequest<WorkflowResponse>('/api/wa/phone/sms-probe', { method: 'POST', body: input, timeoutMs: 70000 });
}

export function registerPhone(input: PhoneInput, deliveryMethod: string) {
  return apiRequest<WorkflowResponse>('/api/wa/register', { method: 'POST', body: { ...input, delivery_method: deliveryMethod }, timeoutMs: 95000 });
}

export type SubmitRegistrationOTPInput = {
  verificationRequestID?: string;
};

export function submitRegistrationOTP(accountID: string, otp: string, input: SubmitRegistrationOTPInput = {}) {
  const body: Record<string, string> = { wa_account_id: accountID, otp };
  if (input.verificationRequestID) body.verification_request_id = input.verificationRequestID;
  return apiRequest<WorkflowResponse>('/api/wa/actions/registration/resume-otp', { method: 'POST', body, timeoutMs: 70000 });
}

export function isTransientOTPSubmitError(error: unknown) {
  const message = apiErrorMessage(error).toLowerCase();
  return message.includes('http 502')
    || message.includes('http 503')
    || message.includes('http 504')
    || message.includes(' 502')
    || message.includes(' 503')
    || message.includes(' 504')
    || message.includes('wasafe upstream')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('network')
    || message.includes('abort');
}

function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function checkLoginState(input: Record<string, unknown>) {
  return apiRequest<WorkflowResponse>('/api/wa/login-state-check', { method: 'POST', body: input, timeoutMs: 70000 });
}

export function getTwoFactorStatus(accountID: string, remoteRefresh = true) {
  const params = new URLSearchParams({ wa_account_id: accountID });
  if (remoteRefresh) params.set('remote_refresh', 'true');
  return apiRequest<AccountSettingsResponse>(`/api/wa/account-settings/2fa/status?${params}`);
}

export function setTwoFactorPIN(accountID: string, pin: string) {
  return apiRequest<AccountSettingsResponse>('/api/wa/account-settings/2fa', { method: 'POST', body: { wa_account_id: accountID, pin }, timeoutMs: 70000 });
}

export function setAccountEmail(accountID: string, emailAddress: string) {
  return apiRequest<AccountSettingsResponse>('/api/wa/account-settings/email', { method: 'POST', body: { wa_account_id: accountID, email_address: emailAddress, google_id_token: '' }, timeoutMs: 70000 });
}

export function requestEmailOtp(accountID: string) {
  return apiRequest<AccountSettingsResponse>('/api/wa/account-settings/email/otp/request', { method: 'POST', body: { wa_account_id: accountID, locale_language: 'en', locale_country: 'US' }, timeoutMs: 70000 });
}

export function verifyEmailOtp(accountID: string, code: string) {
  return apiRequest<AccountSettingsResponse>('/api/wa/account-settings/email/otp/verify', { method: 'POST', body: { wa_account_id: accountID, code }, timeoutMs: 70000 });
}

export function setProfileName(accountID: string, displayName: string) {
  return apiRequest<AccountSettingsResponse>('/api/wa/account-settings/profile/name', { method: 'POST', body: { selector: { wa_account_id: accountID }, display_name: displayName }, timeoutMs: 70000 });
}

export function setProfilePicture(accountID: string, imageBase64: string, contentType: string) {
  return apiRequest<AccountSettingsResponse>('/api/wa/account-settings/profile/picture', { method: 'POST', body: { selector: { wa_account_id: accountID }, image: imageBase64, content_type: contentType }, timeoutMs: 90000 });
}

export function removeProfilePicture(accountID: string) {
  return apiRequest<AccountSettingsResponse>('/api/wa/account-settings/profile/picture/remove', { method: 'POST', body: { selector: { wa_account_id: accountID } }, timeoutMs: 70000 });
}

export function accountID(account?: WAAccount) {
  return account?.wa_account_id || '';
}

export function accountTitle(account?: WAAccount) {
  return account?.display_name?.trim() || account?.phone?.e164_number || accountID(account) || '未命名账号';
}

export function accountAvatarPath(accountIDValue: string, version = 'latest') {
  return `/api/wa/accounts/${encodeURIComponent(accountIDValue)}/profile-picture?v=${encodeURIComponent(version)}`;
}

export function contactAvatarPath(contactID: string, version = 'latest') {
  return `/api/wa/contacts/${encodeURIComponent(contactID)}/profile-picture?v=${encodeURIComponent(version)}`;
}

export function normalizeContacts(contacts: WAContact[], messages: AccountMessage[] = []) {
  const latestByContact = new Map<string, AccountMessage>();
  for (const message of messages) {
    const ref = String(message.contact_ref || '');
    if (ref && !latestByContact.has(ref)) latestByContact.set(ref, message);
  }
  return contacts.map((contact) => ({
    ...contact,
    title: contact.display_name || contact.wa_name || contact.verified_name || contact.number || contact.jid || contact.contact_id,
    subtitle: contact.number || contact.jid || contact.contact_id,
    preview: contact.last_message_preview || messageText(latestByContact.get(contact.contact_id)) || '',
    unread: Number(contact.unread_count || 0),
    lastAt: timestampValue(contact.last_message_at || contact.updated_at),
  }));
}

export function messageText(message?: AccountMessage) {
  if (!message) return '';
  return firstMessageText(message.display_text, message.text, message.preview, message.message_text);
}

const textFieldPriority = [
  'value',
  'display_text',
  'message_text',
  'body',
  'text',
  'message',
  'content',
  'caption',
  'conversation',
  'redacted_value',
];

function firstMessageText(...values: unknown[]): string {
  const seen = new Set<unknown>();
  for (const value of values) {
    const text = extractMessageText(value, seen);
    if (text) return text;
  }
  return '';
}

function extractMessageText(value: unknown, seen: Set<unknown>): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractMessageText(item, seen);
      if (text) return text;
    }
    return '';
  }

  const record = value as Record<string, unknown>;
  for (const key of textFieldPriority) {
    const text = extractMessageText(record[key], seen);
    if (text) return text;
  }
  for (const key of Object.keys(record)) {
    if (textFieldPriority.includes(key)) continue;
    const nested = record[key];
    if (!nested || typeof nested !== 'object') continue;
    const text = extractMessageText(nested, seen);
    if (text) return text;
  }
  return '';
}

export function messageTime(message: AccountMessage) {
  return timestampValue(message.sent_at || message.received_at || message.created_at);
}

export type NormalizedTwoFactorStatus = {
  configured: boolean | null;
  emailConfigured: boolean;
  emailVerified: boolean | null;
  emailAddress: string;
  emailLabel: string;
};

export function normalizeTwoFactorStatus(...values: Array<TwoFactorProjection | null | undefined>): NormalizedTwoFactorStatus {
  const merged = Object.assign({}, ...values.filter(Boolean)) as TwoFactorProjection;
  const configured = typeof merged.configured === 'boolean' ? merged.configured : null;
  const emailAddress = String(merged.email_address || '').trim();
  const emailConfigured = Boolean(merged.email_configured || emailAddress);
  const hasVerifiedFlag = typeof merged.email_verified === 'boolean' || typeof merged.email_confirmed === 'boolean';
  const emailVerified = hasVerifiedFlag ? Boolean(merged.email_verified || merged.email_confirmed) : null;
  const emailLabel = !emailConfigured
    ? '未配置邮箱'
    : emailVerified === true
      ? '已验证'
      : '待验证邮箱';
  return { configured, emailConfigured, emailVerified, emailAddress, emailLabel };
}

export function timestampValue(input: unknown): Date | null {
  if (!input) return null;
  if (typeof input === 'string') {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof input === 'object' && input && 'seconds' in input) {
    const seconds = Number((input as { seconds?: unknown }).seconds || 0);
    const nanos = Number((input as { nanos?: unknown }).nanos || 0);
    return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
  }
  return null;
}
