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
});
