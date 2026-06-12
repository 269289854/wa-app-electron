import { describe, expect, it, vi } from 'vitest';
import { cancelSMSBowerActivation, smsbowerCancelRetryDelayMs } from './smsbower-cancel';

describe('SMSBower cancellation helper', () => {
  it('sends setStatus 8 with the activation id', async () => {
    const setStatus = vi.fn().mockResolvedValue('ACCESS_CANCEL');
    const log = vi.fn();
    const wait = vi.fn();

    await cancelSMSBowerActivation('12345', 'probe failed', setStatus, log, wait);

    expect(setStatus).toHaveBeenCalledWith({ id: '12345', status: 8 });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      id: '12345',
      status: 8,
      reason: 'probe failed',
      attempt: 1,
      response: 'ACCESS_CANCEL',
    }));
    expect(wait).not.toHaveBeenCalled();
  });

  it('retries until ACCESS_CANCEL is returned', async () => {
    const setStatus = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('EARLY_CANCEL_DENIED')
      .mockResolvedValueOnce('ACCESS_CANCEL');
    const wait = vi.fn().mockResolvedValue(undefined);

    await cancelSMSBowerActivation('abc', 'otp timeout', setStatus, vi.fn(), wait);

    expect(setStatus).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(smsbowerCancelRetryDelayMs);
  });

  it('treats NO_ACTIVATION as already cancelled or gone', async () => {
    const setStatus = vi.fn().mockRejectedValue(new Error('SMSBower activation was not found'));

    await expect(cancelSMSBowerActivation('gone', 'cleanup', setStatus, vi.fn(), vi.fn())).resolves.toContain('activation was not found');
  });

  it('fails after five unsuccessful attempts', async () => {
    const setStatus = vi.fn().mockResolvedValue('EARLY_CANCEL_DENIED');
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(cancelSMSBowerActivation('manual', 'register failed', setStatus, vi.fn(), wait)).rejects.toThrow('SMSBower 订单取消失败，请到平台手动取消：manual');
    expect(setStatus).toHaveBeenCalledTimes(5);
    expect(wait).toHaveBeenCalledTimes(4);
  });
});
