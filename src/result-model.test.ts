import { describe, expect, it } from 'vitest';
import { probeStatus } from './result-model';

describe('probeStatus', () => {
  it('marks blocked numbers as non-registerable', () => {
    const status = probeStatus({ success: false, reject_reason: 'number is blocked' });
    expect(status.blocked).toBe(true);
    expect(status.canRegister).toBe(false);
    expect(status.tone).toBe('bad');
  });

  it('allows registration when a method is explicitly available', () => {
    const status = probeStatus({
      success: true,
      method_statuses: [{ method: 'sms', available: true }],
      phone_status: { sms_available: true },
    });
    expect(status.canRegister).toBe(true);
    expect(status.label).toBe('可发起注册');
  });

  it('turns cooldown into a warning state', () => {
    const status = probeStatus({
      success: true,
      phone_status: { sms_wait_seconds: 120 },
      method_statuses: [{ method: 'sms', available: true, cooldown_seconds: 120 }],
    });
    expect(status.canRegister).toBe(false);
    expect(status.tone).toBe('warn');
    expect(status.waitSeconds).toBe(120);
  });

  it('uses top-level retry_after_seconds and string duration cooldowns', () => {
    const status = probeStatus({
      success: true,
      retry_after_seconds: 45,
      method_statuses: [{ method: 'voice', available: true, cooldown: '90s' }],
    });

    expect(status.canRegister).toBe(false);
    expect(status.waitSeconds).toBe(45);
    expect(status.methods).toEqual([
      expect.objectContaining({ label: '语音', waitSeconds: 90 }),
    ]);
  });

  it('keeps already registered responses out of request-failed state', () => {
    const status = probeStatus({
      success: false,
      error_message: 'already registered',
      account_probe: { raw_status: 'exists' },
    });

    expect(status.accountFlow).toBe('registered');
    expect(status.requestFailed).toBe(false);
  });

  it('surfaces proxy and wait-until details in status reason', () => {
    const status = probeStatus({
      success: true,
      phone_status: { sms_wait_until: '2026-06-19T01:00:00Z' },
      proxy: { proxy_mode: 'PROXY', country_code: 'US' },
    });

    expect(status.proxyText).toBe('PROXY · US');
    expect(status.waitUntil).toBe('2026-06-19T01:00:00Z');
  });
});
