import { describe, expect, it } from 'vitest';
import { probeStatus, registrationChannelStates, registrationMethodAvailability } from './result-model';

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

  it('derives the full visible registration channel state list', () => {
    const status = probeStatus({
      success: true,
      method_statuses: [
        { method: 'sms', available: true },
        { method: 'voice', available: false },
        { method: 'wa_old', available: true, cooldown_seconds: 45 },
      ],
    });

    const channels = registrationChannelStates({ methods: status.methods, probed: true });
    expect(channels.map((channel) => channel.code)).toEqual(['sms', 'voice', 'wa_old', 'email_otp', 'send_sms', 'flash']);
    expect(channels.find((channel) => channel.code === 'sms')).toMatchObject({ state: 'available', available: true });
    expect(channels.find((channel) => channel.code === 'voice')).toMatchObject({ state: 'unavailable', available: false });
    expect(channels.find((channel) => channel.code === 'wa_old')).toMatchObject({ state: 'cooldown', waitSeconds: 45, available: false });
    expect(channels.find((channel) => channel.code === 'flash')).toMatchObject({ state: 'unsupported', requestable: false });
  });

  it('reports selected method availability and aliases', () => {
    const status = probeStatus({
      success: true,
      method_statuses: [
        { delivery_method: 'VERIFICATION_DELIVERY_METHOD_SEND_SMS', available: true },
        { method: 'old-wa', available: false },
      ],
    });

    expect(registrationMethodAvailability(status, 'send_sms', true)).toEqual({ available: true, reason: '' });
    expect(registrationMethodAvailability(status, 'wa_old', true)).toMatchObject({ available: false });
    expect(registrationMethodAvailability(status, 'flash', true)).toMatchObject({ available: false, reason: '未接来电暂不支持发起注册' });
    expect(registrationMethodAvailability(status, 'sms', false)).toMatchObject({ available: false, reason: '请先探测号码' });
  });
});
