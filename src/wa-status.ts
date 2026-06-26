import type { WAAccount } from './types';

export type LongConnectionRecord = Record<string, unknown>;
export type StatusTone = 'ok' | 'warn' | 'bad' | 'idle';
export type AccountDisplayStatus = { label: string; tone: StatusTone };

const conflictCode = 'WA_ERROR_CODE_CONFLICT';

export function isConnectionTransferredOut(connection?: LongConnectionRecord) {
  return connectionStatus(connection).includes('stopped') && errorCode(connection) === conflictCode;
}

export function accountDisplayStatus(account?: WAAccount, connection?: LongConnectionRecord): AccountDisplayStatus {
  const status = String(account?.status || '').toLowerCase();
  if (isRegistrationPending(account)) return { label: '等待 OTP', tone: 'warn' };
  if (status && !isActiveAccountStatus(status)) return { label: accountStatusLabel(account?.status), tone: accountStatusTone(status) };
  if (isConnectionTransferredOut(connection)) return { label: '已转出', tone: 'bad' };
  const connectionViewValue = connectionView(connection, false);
  if (connectionViewValue.tone === 'ok') return { label: '正常', tone: 'ok' };
  if (connectionViewValue.tone === 'warn') return { label: '连接中', tone: 'warn' };
  return { label: '离线', tone: 'idle' };
}

export function connectionView(connection: LongConnectionRecord | undefined, loading: boolean): AccountDisplayStatus {
  const status = connectionStatus(connection);
  if (loading && !connection) return { label: '连接状态加载中', tone: 'idle' };
  if (isConnectionTransferredOut(connection)) return { label: '已转出', tone: 'bad' };
  if (Boolean(connection?.connected) || status.includes('connected') || status.includes('heartbeat')) return { label: '已连接', tone: 'ok' };
  if (status.includes('reconnect') || status.includes('starting')) return { label: '连接中', tone: 'warn' };
  if (status.includes('failed') || status.includes('error')) return { label: '连接失败', tone: 'bad' };
  return { label: '未连接', tone: 'idle' };
}

export function connectionRank(connection: LongConnectionRecord) {
  const tone = connectionView(connection, false).tone;
  if (tone === 'ok') return 0;
  if (tone === 'warn') return 1;
  if (tone === 'bad') return 2;
  return 3;
}

export function isRegistrationPending(account?: WAAccount) {
  const status = String(account?.status || '').toLowerCase();
  return status === '2' || status.includes('pending_registration') || status.includes('pending registration') || status.includes('otp');
}

function isActiveAccountStatus(status: string) {
  return !status || status === '1' || status === 'active' || status.includes('wa_account_status_active');
}

function accountStatusLabel(status: unknown) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('transferred')) return '已转出';
  if (normalized.includes('suspended')) return '已暂停';
  if (normalized.includes('archived')) return '已归档';
  return String(status || '未知');
}

function accountStatusTone(status: string): StatusTone {
  if (status.includes('transferred') || status.includes('suspended')) return 'bad';
  if (status.includes('archived')) return 'idle';
  return 'warn';
}

function connectionStatus(connection?: LongConnectionRecord) {
  return String(connection?.status || '').toLowerCase();
}

function errorCode(connection?: LongConnectionRecord) {
  const error = connection?.last_error;
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code || '');
}
