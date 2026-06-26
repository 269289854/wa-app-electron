import { describe, expect, it } from 'vitest';
import { accountDisplayStatus, connectionView, isConnectionTransferredOut } from './wa-status';

describe('wa status helpers', () => {
  it('marks stopped conflict connections as transferred out', () => {
    const connection = { status: 'LONG_CONNECTION_STATUS_STOPPED', last_error: { code: 'WA_ERROR_CODE_CONFLICT' } };
    expect(isConnectionTransferredOut(connection)).toBe(true);
    expect(connectionView(connection, false)).toEqual({ label: '已转出', tone: 'bad' });
  });

  it('derives active account display status from live connections', () => {
    expect(accountDisplayStatus({ wa_account_id: '1', status: 'ACTIVE' }, { status: 'connected' })).toEqual({ label: '正常', tone: 'ok' });
    expect(accountDisplayStatus({ wa_account_id: '1', status: 'ACTIVE' }, { status: 'reconnecting' })).toEqual({ label: '连接中', tone: 'warn' });
    expect(accountDisplayStatus({ wa_account_id: '1', status: 'ACTIVE' }, { status: 'stopped', last_error: { code: 'WA_ERROR_CODE_CONFLICT' } })).toEqual({ label: '已转出', tone: 'bad' });
    expect(accountDisplayStatus({ wa_account_id: '1', status: 'ACTIVE' })).toEqual({ label: '离线', tone: 'idle' });
  });

  it('keeps non-active account lifecycle statuses ahead of connection state', () => {
    expect(accountDisplayStatus({ wa_account_id: '1', status: 'WA_ACCOUNT_STATUS_PENDING_REGISTRATION' }, { status: 'connected' })).toEqual({ label: '等待 OTP', tone: 'warn' });
  });
});
