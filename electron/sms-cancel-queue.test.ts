import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import {
  SMSCancelQueueService,
  SMSCancelQueueStore,
  heroSMSCancelBufferMs,
  heroSMSDefaultMinCancelMs,
  heroSMSEarlyCancelDelay,
  smsCancelQueueRetryDelayMs,
} from './sms-cancel-queue.js';

function createMemoryStore() {
  return new SMSCancelQueueStore(new DatabaseSync(':memory:'), ':memory:');
}

describe('SMS cancel queue', () => {
  it('enqueues SMSBower orders for immediate cancellation and deduplicates active orders', () => {
    const store = createMemoryStore();
    const now = 1_000;
    const item = store.enqueue({ provider: 'smsbower', activationId: 'act-1', phone: '+15550100001', reason: 'probe failed', orderedAtMs: 900 }, now);

    expect(item).toMatchObject({
      id: 'smsbower:act-1',
      provider: 'smsbower',
      activationId: 'act-1',
      phone: '+15550100001',
      status: 'pending',
      notBeforeMs: now,
    });

    const duplicate = store.enqueue({ provider: 'smsbower', activationId: 'act-1', phone: '+15550100002', reason: 'rate limited', orderedAtMs: 950 }, now + 500);
    expect(duplicate.id).toBe(item.id);
    expect(duplicate.phone).toBe('+15550100002');
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  it('delays Hero-SMS orders until the default minimum cancellation window has passed', () => {
    const store = createMemoryStore();
    const orderedAtMs = 10_000;
    const item = store.enqueue({ provider: 'hero-sms', activationId: 'hero-1', reason: 'OpenAI session expired', orderedAtMs }, 11_000);

    expect(item.notBeforeMs).toBe(orderedAtMs + heroSMSDefaultMinCancelMs + heroSMSCancelBufferMs);
    expect(store.due(item.notBeforeMs - 1)).toEqual([]);
    expect(store.due(item.notBeforeMs)).toHaveLength(1);
    store.close();
  });

  it('lists status counts and supports manual retry and remove', () => {
    const store = createMemoryStore();
    const item = store.enqueue({ provider: 'smsbower', activationId: 'act-2', reason: 'manual test' }, 2_000);

    store.markFailed(item.id, 'temporary platform error', 12_000, 3_000);
    expect(store.status()).toMatchObject({ active: 1, failed: 1, pending: 0 });

    const retried = store.retry(item.id, 4_000);
    expect(retried.status).toBe('pending');
    expect(retried.notBeforeMs).toBe(4_000);

    const removed = store.remove(item.id, 5_000);
    expect(removed.status).toBe('removed');
    expect(store.status()).toMatchObject({ active: 0, removed: 1 });
    store.close();
  });

  it('consumer cancels due orders and marks confirmed cancellations as cancelled', async () => {
    const store = createMemoryStore();
    const item = store.enqueue({ provider: 'smsbower', activationId: 'act-3', reason: 'cleanup' }, 10_000);
    const cancel = vi.fn(async () => 'ACCESS_CANCEL');
    const service = new SMSCancelQueueService(store, cancel);

    await service.consumeDue(10_000);

    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, activationId: 'act-3' }));
    expect(store.list()[0]).toMatchObject({ id: item.id, status: 'cancelled', lastError: '' });
    service.close();
  });

  it('consumer records ordinary cancel failures with short retry delay', async () => {
    const store = createMemoryStore();
    const item = store.enqueue({ provider: 'smsbower', activationId: 'act-4', reason: 'cleanup' });
    const cancel = vi.fn(async () => {
      throw new Error('network timeout');
    });
    const service = new SMSCancelQueueService(store, cancel);
    const before = Date.now();

    await service.consumeDue(Date.now());

    const failed = store.list()[0];
    expect(failed).toMatchObject({ id: item.id, status: 'failed', attempts: 1, lastError: 'network timeout' });
    expect(failed.notBeforeMs).toBeGreaterThanOrEqual(before + smsCancelQueueRetryDelayMs);
    service.close();
  });

  it('recognizes Hero-SMS early-cancel errors and schedules the next attempt after minActivationTime', () => {
    const orderedAtMs = 1_000_000;
    const early = heroSMSEarlyCancelDelay(
      'HTTP 409 {"error":"EARLY_CANCEL_DENIED","message":"Minimum activation period must pass","info":{"minActivationTime":180}}',
      orderedAtMs,
      orderedAtMs + 10_000,
    );

    expect(early).toBe(orderedAtMs + 180_000 + heroSMSCancelBufferMs);
  });
});
