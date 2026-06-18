import { app } from 'electron';
import { join } from 'node:path';
import {
  createSMSCancelQueueStore,
  SMSCancelQueueService,
  smsCancelQueueDefaultPollIntervalSeconds,
  type SMSCancelQueueInput,
  type SMSCancelQueueItem,
  type SMSCancelQueueListInput,
} from './sms-cancel-queue.js';
import { normalizeSMSProvider } from './sms-platforms.js';
import { readConfig } from './config-service.js';
import { errorMessage } from './errors.js';

let smsCancelQueue: SMSCancelQueueService | null = null;
let smsCancelQueueError = '';

export async function initSMSCancelQueue(cancelItem: (item: SMSCancelQueueItem) => Promise<string>, config = readConfig()) {
  try {
    const store = await createSMSCancelQueueStore(join(app.getPath('userData'), 'sms-cancel-queue.sqlite'));
    smsCancelQueue = new SMSCancelQueueService(store, cancelItem, config.smsCancelQueuePollIntervalSeconds || smsCancelQueueDefaultPollIntervalSeconds);
    smsCancelQueue.start();
    smsCancelQueueError = '';
  } catch (error) {
    smsCancelQueueError = errorMessage(error);
    console.error('SMS cancel queue failed:', error);
  }
}

export function setSMSCancelQueuePollInterval(seconds: number) {
  smsCancelQueue?.setPollInterval(seconds);
}

export function closeSMSCancelQueue() {
  smsCancelQueue?.close();
  smsCancelQueue = null;
}

export function smsCancelQueueStatus() {
  if (!smsCancelQueue) {
    return {
      total: 0,
      active: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      cancelled: 0,
      removed: 0,
      nextDueAtMs: 0,
      dbPath: join(app.getPath('userData'), 'sms-cancel-queue.sqlite'),
      running: false,
      lastError: smsCancelQueueError,
    };
  }
  return smsCancelQueue.status();
}

function requireSMSCancelQueue() {
  if (!smsCancelQueue) throw new Error(smsCancelQueueError || 'SMS cancel queue is not available');
  return smsCancelQueue;
}

export function smsCancelQueueEnqueue(input: SMSCancelQueueInput) {
  return requireSMSCancelQueue().enqueue({
    ...input,
    provider: normalizeSMSProvider(input.provider),
  });
}

export function smsCancelQueueList(input?: SMSCancelQueueListInput) {
  return requireSMSCancelQueue().listPage(input);
}

export function smsCancelQueueRetry(id: string) {
  return requireSMSCancelQueue().retry(id);
}

export function smsCancelQueueRemove(id: string) {
  return requireSMSCancelQueue().remove(id);
}
