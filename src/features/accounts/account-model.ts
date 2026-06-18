import { accountID, accountTitle, timestampValue } from '../../api';
import type { ClientProfile, WAAccount } from '../../types';

export type LongConnectionRecord = Record<string, unknown>;

export function mergeAccounts(current: WAAccount[], next: WAAccount[]) {
  const merged = new Map(current.map((account) => [accountID(account), account]));
  for (const account of next) {
    const id = accountID(account);
    if (id) merged.set(id, account);
  }
  return [...merged.values()];
}

export function filterAccounts(accounts: WAAccount[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return accounts;
  return accounts.filter((account) => {
    const haystack = [accountTitle(account), account.phone?.e164_number, account.phone?.country_iso2, accountID(account)].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalized);
  });
}

export function indexConnections(data?: { states?: LongConnectionRecord[]; connections?: LongConnectionRecord[] }) {
  const records = [...(data?.connections || []), ...(data?.states || [])];
  return records.reduce((map, record) => {
    const id = String(record.wa_account_id || '');
    if (!id) return map;
    const current = map.get(id);
    if (!current || betterConnection(record, current)) map.set(id, record);
    return map;
  }, new Map<string, LongConnectionRecord>());
}

export function connectionView(connection: LongConnectionRecord | undefined, loading: boolean) {
  const status = String(connection?.status || '').toLowerCase();
  if (loading && !connection) return { label: '连接状态加载中', tone: 'idle' };
  if (connection?.connected === true || status.includes('connected') || status.includes('heartbeat')) return { label: '已连接', tone: 'ok' };
  if (status.includes('reconnect') || status.includes('starting')) return { label: '连接中', tone: 'warn' };
  if (status.includes('failed') || status.includes('error')) return { label: '连接失败', tone: 'bad' };
  return { label: '未连接', tone: 'idle' };
}

export function isRegistrationPending(account: WAAccount) {
  const status = String(account.status || '').toLowerCase();
  return status === '2' || status.includes('pending_registration') || status.includes('pending registration') || status.includes('otp');
}

export function deviceTitle(fingerprint?: ClientProfile['device_fingerprint']) {
  return fingerprint ? [fingerprint.device_vendor, fingerprint.device_model].filter(Boolean).join(' ') || '未知设备' : '未知设备';
}

export function pairLabel(a?: string, b?: string) {
  return [a, b].filter(Boolean).join('/');
}

export function ramLabel(value?: string | number) {
  return value === undefined || value === null || value === '' ? '' : `${value} GiB`;
}

export function radioLabel(value?: string | number) {
  const key = String(value || '');
  const labels: Record<string, string> = { '1': 'GPRS', '2': 'EDGE', '3': 'UMTS', '9': 'HSDPA', '13': 'LTE', '20': 'NR' };
  return key ? labels[key] || key : '';
}

export function profileStatusLabel(status: unknown) {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) return '未知';
  if (normalized.includes('active') || normalized === '1') return '可用';
  if (normalized.includes('disabled') || normalized.includes('blocked') || normalized.includes('failed')) return '不可用';
  if (normalized.includes('pending')) return '等待中';
  return String(status);
}

export function profileStatusTone(status: unknown) {
  const label = profileStatusLabel(status);
  if (label === '可用') return 'ok';
  if (label === '等待中') return 'warn';
  if (label === '不可用') return 'bad';
  return 'idle';
}

function connectionRank(connection: LongConnectionRecord) {
  const tone = connectionView(connection, false).tone;
  if (tone === 'ok') return 0;
  if (tone === 'warn') return 1;
  if (tone === 'bad') return 2;
  return 3;
}

function betterConnection(next: LongConnectionRecord, current: LongConnectionRecord) {
  const nextRank = connectionRank(next);
  const currentRank = connectionRank(current);
  if (nextRank !== currentRank) return nextRank < currentRank;
  return timestampMs(next) > timestampMs(current);
}

function timestampMs(record: LongConnectionRecord) {
  const date = timestampValue(record.updated_at || record.last_heartbeat_at || record.connected_at || record.created_at);
  return date?.getTime() || 0;
}
