import type { WorkflowResponse } from '../../types';

export function requireValue(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

export function workflowText(result: WorkflowResponse | null | undefined, key: keyof WorkflowResponse) {
  const value = result?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function nestedText(result: WorkflowResponse | null | undefined, objectKey: keyof WorkflowResponse, field: string) {
  const value = result?.[objectKey];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const nested = (value as Record<string, unknown>)[field];
  return typeof nested === 'string' ? nested.trim() : '';
}

export function isAccountTransferWaiting(result?: WorkflowResponse | null) {
  const phase = workflowText(result, 'registration_phase').toLowerCase();
  const status = workflowText(result, 'status').toLowerCase();
  return phase.includes('account_transfer') || status.includes('account_transfer') || Boolean(result?.account_transfer_challenge);
}

export function challengeSummary(result?: WorkflowResponse | null) {
  const challenge = result?.account_transfer_challenge;
  if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) return '';
  const record = challenge as Record<string, unknown>;
  return [
    textFromRecord(record, 'type') || textFromRecord(record, 'challenge_type'),
    textFromRecord(record, 'status'),
    textFromRecord(record, 'expires_at') || textFromRecord(record, 'expiry_time'),
  ].filter(Boolean).join(' / ');
}

function textFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
