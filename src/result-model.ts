import type { WorkflowResponse } from './types';

export type ProbeStatus = {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'idle';
  canRegister: boolean;
  blocked: boolean;
  requestFailed: boolean;
  accountFlow: string;
  smsAvailable?: boolean;
  waitSeconds: number | null;
  reason: string;
  methods: Array<{ code: string; label: string; available?: boolean; waitSeconds: number | null }>;
};

const methodMap: Record<string, string> = {
  sms: 'SMS',
  voice: '语音',
  flash: '未接来电',
  wa_old: '旧设备',
  old_wa: '旧设备',
  email_otp: '邮箱',
  email: '邮箱',
  send_sms: '发送 SMS 至 WA',
  send_sms_to_wa: '发送 SMS 至 WA',
  silent_auth: '静默验证',
  silent_auth_ts_43: '静默验证 TS43',
  oauth_email: 'OAuth 邮箱',
};

export const registrationMethods = [
  { code: 'sms', label: 'SMS' },
  { code: 'voice', label: '语音' },
  { code: 'wa_old', label: '旧设备' },
  { code: 'email_otp', label: '邮箱' },
  { code: 'send_sms', label: '发送 SMS 至 WA' },
];

export function probeStatus(result?: WorkflowResponse | null): ProbeStatus {
  if (!result) {
    return {
      label: '等待探测',
      tone: 'idle',
      canRegister: false,
      blocked: false,
      requestFailed: false,
      accountFlow: '',
      waitSeconds: null,
      reason: '',
      methods: [],
    };
  }
  const phoneStatus = record(result.phone_status);
  const accountProbe = record(result.account_probe);
  const smsProbe = record(result.sms_probe);
  const blocked = boolValue(phoneStatus.blocked, accountProbe.blocked) ?? textHas(['blocked'], result.reject_reason, result.error_message, result.status, phoneStatus.account_raw_reason, accountProbe.raw_reason);
  const flow = textValue(phoneStatus.account_flow, accountProbe.account_flow) || deriveFlow(result, phoneStatus, accountProbe, blocked);
  const waitSeconds = numberValue(phoneStatus.sms_wait_seconds, smsProbe.sms_wait_seconds, smsProbe.wait_seconds, smsProbe.retry_after_seconds, smsProbe.cooldown_seconds, accountProbe.sms_wait_seconds);
  const smsAvailable = boolValue(phoneStatus.sms_available, phoneStatus.can_receive_sms, smsProbe.sms_available, smsProbe.can_send_sms, accountProbe.can_send_sms);
  const requestFailed = Boolean(result.success === false || result.request_failed || textHas(['network', 'proxy', 'unreachable', 'invalid_skey', 'bad_token', 'missing_param', 'bad_param'], result.error_message, result.status));
  const methods = methodStatuses(phoneStatus.method_statuses, accountProbe.method_statuses, result.method_statuses, record(result.verification_request).method_statuses);
  const hasAvailableMethod = methods.some((method) => method.available === true && !method.waitSeconds);
  const canRegister = !blocked && !requestFailed && flow !== 'invalid_number' && flow !== 'rate_limited' && (hasAvailableMethod || smsAvailable === true);
  const reason = reasonLabel(textValue(result.error_message, result.reject_reason, phoneStatus.account_raw_reason, accountProbe.raw_reason, accountProbe.error_message, result.status));
  if (blocked) return { label: '号码封禁', tone: 'bad', canRegister: false, blocked: true, requestFailed, accountFlow: flow, smsAvailable, waitSeconds, reason: reason || '号码被 WA 拒绝或封禁', methods };
  if (flow === 'invalid_number') return { label: '号码异常', tone: 'warn', canRegister: false, blocked: false, requestFailed, accountFlow: flow, smsAvailable, waitSeconds, reason: reason || '号码格式不符合规则', methods };
  if (flow === 'rate_limited' || (waitSeconds && waitSeconds > 0)) return { label: '请求冷却', tone: 'warn', canRegister: false, blocked: false, requestFailed, accountFlow: flow, smsAvailable, waitSeconds, reason: reason || '请求过于频繁', methods };
  if (requestFailed) return { label: '请求失败', tone: 'bad', canRegister: false, blocked: false, requestFailed, accountFlow: flow, smsAvailable, waitSeconds, reason: reason || '远程服务返回失败', methods };
  if (canRegister) return { label: '可发起注册', tone: 'ok', canRegister, blocked: false, requestFailed, accountFlow: flow, smsAvailable, waitSeconds, reason, methods };
  return { label: '等待可用通道', tone: 'idle', canRegister, blocked: false, requestFailed, accountFlow: flow, smsAvailable, waitSeconds, reason, methods };
}

export function methodLabel(code: string) {
  const normalized = code.trim().toLowerCase().replace(/^verification_delivery_method_/, '').replace(/^registration_login_method_/, '');
  return methodMap[normalized] || normalized.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function statusReason(status: ProbeStatus) {
  const parts = [
    status.reason,
    status.smsAvailable === true ? 'SMS 可用' : status.smsAvailable === false ? 'SMS 不可用' : '',
    status.waitSeconds ? `冷却 ${formatDuration(status.waitSeconds)}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.ceil(minutes / 60)} 小时`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function boolValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (/^(true|yes|1)$/i.test(value)) return true;
      if (/^(false|no|0)$/i.test(value)) return false;
    }
  }
  return undefined;
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function textHas(needles: string[], ...values: unknown[]) {
  const text = values.map(textValue).join(' ').toLowerCase();
  return Boolean(text && needles.some((needle) => text.includes(needle)));
}

function deriveFlow(result: WorkflowResponse, phoneStatus: Record<string, unknown>, accountProbe: Record<string, unknown>, blocked: boolean) {
  const raw = [result.status, result.error_message, result.reject_reason, phoneStatus.account_status, phoneStatus.account_raw_status, phoneStatus.account_raw_reason, accountProbe.status, accountProbe.raw_status, accountProbe.raw_reason].map(textValue).join(' ').toLowerCase();
  if (blocked || raw.includes('blocked')) return 'blocked';
  if (raw.includes('format_wrong') || raw.includes('length_short') || raw.includes('length_long') || raw.includes('invalid_number')) return 'invalid_number';
  if (raw.includes('too_recent') || raw.includes('too_many') || raw.includes('rate_limited') || raw.includes('temporarily_unavailable')) return 'rate_limited';
  if (raw.includes('registered') || raw.includes('exists')) return 'registered';
  if (raw.includes('not_registered')) return 'not_registered';
  return 'unknown';
}

function methodStatuses(...values: unknown[]) {
  const seen = new Map<string, { code: string; label: string; available?: boolean; waitSeconds: number | null }>();
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) addMethod(seen, item);
    } else {
      addMethod(seen, value);
    }
  }
  return [...seen.values()];
}

function addMethod(seen: Map<string, { code: string; label: string; available?: boolean; waitSeconds: number | null }>, value: unknown) {
  if (typeof value === 'string') {
    for (const part of value.split(',')) {
      const code = part.trim();
      if (code) seen.set(code.toLowerCase(), { code, label: methodLabel(code), available: true, waitSeconds: null });
    }
    return;
  }
  const item = record(value);
  const code = textValue(item.method, item.delivery_method, item.name, item.type);
  if (!code) return;
  const key = code.toLowerCase();
  const previous = seen.get(key);
  seen.set(key, {
    code,
    label: methodLabel(code),
    available: previous?.available ?? boolValue(item.available, item.eligible, item.enabled),
    waitSeconds: numberValue(item.cooldown_seconds, item.wait_seconds, item.retry_after_seconds, previous?.waitSeconds),
  });
}

function reasonLabel(value: string) {
  const normalized = value.toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('blocked')) return '号码被 WA 拒绝或封禁';
  if (normalized.includes('length') || normalized.includes('format')) return '号码格式或长度不符合规则';
  if (normalized.includes('too_recent') || normalized.includes('too_many') || normalized.includes('rate_limited')) return '请求过于频繁，请稍后重试';
  if (normalized.includes('no_routes') || normalized.includes('route_unavailable')) return '暂无可用验证通道';
  if (normalized.includes('invalid_skey') || normalized.includes('bad_token')) return '注册会话已失效，请重新探测';
  if (normalized.includes('proxy') || normalized.includes('network') || normalized.includes('unreachable') || normalized.includes('eof')) return '网络或代理出口异常';
  return value;
}
