import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { SMSProvider } from './sms-platforms.js';

export type SMSCancelQueueStatus = 'pending' | 'processing' | 'cancelled' | 'failed' | 'removed';

export type SMSCancelQueueItem = {
  id: string;
  provider: SMSProvider;
  activationId: string;
  phone: string;
  reason: string;
  orderedAtMs: number;
  notBeforeMs: number;
  status: SMSCancelQueueStatus;
  attempts: number;
  lastError: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type SMSCancelQueueInput = {
  provider: SMSProvider;
  activationId: string;
  phone?: string;
  reason: string;
  orderedAtMs?: number;
};

export type SMSCancelQueueListStatus = 'all' | SMSCancelQueueStatus;

export type SMSCancelQueueListInput = {
  status?: SMSCancelQueueListStatus;
  page?: number;
  pageSize?: number;
};

export type SMSCancelQueueListResult = {
  items: SMSCancelQueueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type SMSCancelQueueSummary = {
  total: number;
  active: number;
  pending: number;
  processing: number;
  failed: number;
  cancelled: number;
  removed: number;
  nextDueAtMs: number;
  dbPath: string;
  error?: string;
};

type SQLiteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes?: number | bigint };
  };
  close(): void;
};

export const smsCancelQueueDefaultPollIntervalSeconds = 5;
export const heroSMSDefaultMinCancelMs = 120_000;
export const heroSMSCancelBufferMs = 2_000;
export const smsCancelQueueRetryDelayMs = 5_000;

export class SMSCancelQueueStore {
  constructor(private readonly db: SQLiteDatabase, readonly dbPath: string) {
    this.migrate();
  }

  enqueue(input: SMSCancelQueueInput, nowMs = Date.now()) {
    const provider = input.provider;
    const activationId = String(input.activationId || '').trim();
    if (!activationId) throw new Error('activationId is required');
    const orderedAtMs = numberOr(input.orderedAtMs, nowMs);
    const notBeforeMs = provider === 'hero-sms'
      ? Math.max(nowMs, orderedAtMs + heroSMSDefaultMinCancelMs + heroSMSCancelBufferMs)
      : nowMs;
    const existing = this.findActive(provider, activationId);
    if (existing) {
      this.db.prepare(`
        UPDATE sms_cancel_queue
        SET phone = COALESCE(NULLIF(?, ''), phone),
            reason = ?,
            ordered_at_ms = ?,
            not_before_ms = MIN(not_before_ms, ?),
            status = 'pending',
            updated_at_ms = ?
        WHERE id = ?
      `).run(input.phone || '', input.reason, orderedAtMs, notBeforeMs, nowMs, existing.id);
      return this.get(existing.id);
    }
    const id = `${provider}:${activationId}`;
    this.db.prepare(`
      INSERT INTO sms_cancel_queue (
        id, provider, activation_id, phone, reason, ordered_at_ms, not_before_ms,
        status, attempts, last_error, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', ?, ?)
    `).run(id, provider, activationId, input.phone || '', input.reason, orderedAtMs, notBeforeMs, nowMs, nowMs);
    return this.get(id);
  }

  list(includeDone = true) {
    const where = includeDone ? '' : "WHERE status IN ('pending', 'processing', 'failed')";
    return this.db.prepare(`
      SELECT * FROM sms_cancel_queue
      ${where}
      ORDER BY
        CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END,
        not_before_ms ASC,
        created_at_ms DESC
    `).all().map(rowToItem);
  }

  listPage(input: SMSCancelQueueListInput = {}): SMSCancelQueueListResult {
    const status = normalizeListStatus(input.status);
    const pageSize = boundedInteger(input.pageSize, 1, 100, 20);
    const page = Math.max(1, Math.round(Number(input.page || 1)) || 1);
    const offset = (page - 1) * pageSize;
    const where = status === 'all' ? '' : 'WHERE status = ?';
    const params = status === 'all' ? [] : [status];
    const countRow = this.db.prepare(`SELECT COUNT(*) AS total FROM sms_cancel_queue ${where}`).get(...params) as Record<string, unknown> | undefined;
    const total = Number(countRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const rows = this.db.prepare(`
      SELECT * FROM sms_cancel_queue
      ${where}
      ${listOrderBy(status)}
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, offset);
    return { items: rows.map(rowToItem), total, page, pageSize, totalPages };
  }

  status(): SMSCancelQueueSummary {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM sms_cancel_queue GROUP BY status').all() as Array<Record<string, unknown>>;
    const counts = new Map(rows.map((row) => [String(row.status), Number(row.count || 0)]));
    const next = this.db.prepare("SELECT MIN(not_before_ms) AS nextDueAtMs FROM sms_cancel_queue WHERE status IN ('pending', 'failed')").get() as Record<string, unknown> | undefined;
    const pending = counts.get('pending') || 0;
    const processing = counts.get('processing') || 0;
    const failed = counts.get('failed') || 0;
    const cancelled = counts.get('cancelled') || 0;
    const removed = counts.get('removed') || 0;
    return {
      total: pending + processing + failed + cancelled + removed,
      active: pending + processing + failed,
      pending,
      processing,
      failed,
      cancelled,
      removed,
      nextDueAtMs: Number(next?.nextDueAtMs || 0),
      dbPath: this.dbPath,
    };
  }

  due(nowMs = Date.now(), limit = 5) {
    return this.db.prepare(`
      SELECT * FROM sms_cancel_queue
      WHERE status IN ('pending', 'failed') AND not_before_ms <= ?
      ORDER BY not_before_ms ASC, created_at_ms ASC
      LIMIT ?
    `).all(nowMs, limit).map(rowToItem);
  }

  markProcessing(id: string, nowMs = Date.now()) {
    this.db.prepare("UPDATE sms_cancel_queue SET status = 'processing', updated_at_ms = ? WHERE id = ? AND status IN ('pending', 'failed')").run(nowMs, id);
    return this.get(id);
  }

  markCancelled(id: string, nowMs = Date.now()) {
    this.db.prepare("UPDATE sms_cancel_queue SET status = 'cancelled', last_error = '', updated_at_ms = ? WHERE id = ?").run(nowMs, id);
    return this.get(id);
  }

  markFailed(id: string, error: string, notBeforeMs: number, nowMs = Date.now()) {
    this.db.prepare(`
      UPDATE sms_cancel_queue
      SET status = 'failed', attempts = attempts + 1, last_error = ?, not_before_ms = ?, updated_at_ms = ?
      WHERE id = ?
    `).run(error, notBeforeMs, nowMs, id);
    return this.get(id);
  }

  retry(id: string, nowMs = Date.now()) {
    this.db.prepare("UPDATE sms_cancel_queue SET status = 'pending', not_before_ms = ?, updated_at_ms = ? WHERE id = ? AND status != 'removed'").run(nowMs, nowMs, id);
    return this.get(id);
  }

  remove(id: string, nowMs = Date.now()) {
    this.db.prepare("UPDATE sms_cancel_queue SET status = 'removed', updated_at_ms = ? WHERE id = ?").run(nowMs, id);
    return this.get(id);
  }

  close() {
    this.db.close();
  }

  private get(id: string) {
    const row = this.db.prepare('SELECT * FROM sms_cancel_queue WHERE id = ?').get(id);
    if (!row) throw new Error(`SMS cancel queue item not found: ${id}`);
    return rowToItem(row);
  }

  private findActive(provider: SMSProvider, activationId: string) {
    const row = this.db.prepare(`
      SELECT * FROM sms_cancel_queue
      WHERE provider = ? AND activation_id = ? AND status IN ('pending', 'processing', 'failed')
      LIMIT 1
    `).get(provider, activationId);
    return row ? rowToItem(row) : null;
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sms_cancel_queue (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        activation_id TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL,
        ordered_at_ms INTEGER NOT NULL,
        not_before_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sms_cancel_queue_due ON sms_cancel_queue(status, not_before_ms);
      CREATE INDEX IF NOT EXISTS idx_sms_cancel_queue_activation ON sms_cancel_queue(provider, activation_id);
    `);
  }
}

export class SMSCancelQueueService {
  private timer: NodeJS.Timeout | null = null;
  private consuming = false;
  private lastError = '';

  constructor(
    private readonly store: SMSCancelQueueStore,
    private readonly cancel: (item: SMSCancelQueueItem) => Promise<string>,
    private pollIntervalSeconds = smsCancelQueueDefaultPollIntervalSeconds,
  ) {}

  start() {
    this.stop();
    this.timer = setInterval(() => void this.consumeDue(), Math.max(1, this.pollIntervalSeconds) * 1000);
    void this.consumeDue();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPollInterval(seconds: number) {
    this.pollIntervalSeconds = Math.max(1, Math.round(seconds || smsCancelQueueDefaultPollIntervalSeconds));
    if (this.timer) this.start();
  }

  enqueue(input: SMSCancelQueueInput) {
    const item = this.store.enqueue(input);
    void this.consumeDue();
    return item;
  }

  list() {
    return this.store.listPage();
  }

  listPage(input?: SMSCancelQueueListInput) {
    return this.store.listPage(input);
  }

  status() {
    return { ...this.store.status(), running: Boolean(this.timer), lastError: this.lastError };
  }

  retry(id: string) {
    const item = this.store.retry(id);
    void this.consumeDue();
    return item;
  }

  remove(id: string) {
    return this.store.remove(id);
  }

  async consumeDue(nowMs = Date.now()) {
    if (this.consuming) return;
    this.consuming = true;
    try {
      for (const item of this.store.due(nowMs, 5)) {
        const processing = this.store.markProcessing(item.id);
        if (!processing) continue;
        try {
          const response = await this.cancel(processing);
          if (isCancelSuccess(response)) {
            this.store.markCancelled(processing.id);
          } else {
            this.store.markFailed(processing.id, response || 'Cancel was not confirmed', Date.now() + smsCancelQueueRetryDelayMs);
          }
        } catch (error) {
          const message = errorMessage(error);
          const earlyCancel = heroSMSEarlyCancelDelay(message, processing.orderedAtMs, Date.now());
          const nextAt = earlyCancel || Date.now() + smsCancelQueueRetryDelayMs;
          this.store.markFailed(processing.id, message, nextAt);
        }
      }
      this.lastError = '';
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      this.consuming = false;
    }
  }

  close() {
    this.stop();
    this.store.close();
  }
}

export async function createSMSCancelQueueStore(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  try {
    const sqlite = await import('node:sqlite');
    const db = new sqlite.DatabaseSync(dbPath) as SQLiteDatabase;
    return new SMSCancelQueueStore(db, dbPath);
  } catch (error) {
    throw new Error(`SQLite cancel queue is unavailable: ${errorMessage(error)}`, { cause: error });
  }
}

export function heroSMSEarlyCancelDelay(value: unknown, orderedAtMs: number, nowMs = Date.now()) {
  const text = errorMessage(value);
  const upper = text.toUpperCase();
  if (!upper.includes('EARLY_CANCEL_DENIED') && !upper.includes('MINIMUM ACTIVATION PERIOD MUST PASS')) return 0;
  const minActivationTimeSeconds = parseMinActivationTimeSeconds(text);
  if (!Number.isFinite(minActivationTimeSeconds) || minActivationTimeSeconds <= 0) return 0;
  return Math.max(nowMs, orderedAtMs + minActivationTimeSeconds * 1000 + heroSMSCancelBufferMs);
}

function rowToItem(row: unknown): SMSCancelQueueItem {
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id || ''),
    provider: record.provider === 'hero-sms' ? 'hero-sms' : 'smsbower',
    activationId: String(record.activation_id || ''),
    phone: String(record.phone || ''),
    reason: String(record.reason || ''),
    orderedAtMs: Number(record.ordered_at_ms || 0),
    notBeforeMs: Number(record.not_before_ms || 0),
    status: normalizeStatus(record.status),
    attempts: Number(record.attempts || 0),
    lastError: String(record.last_error || ''),
    createdAtMs: Number(record.created_at_ms || 0),
    updatedAtMs: Number(record.updated_at_ms || 0),
  };
}

function normalizeStatus(value: unknown): SMSCancelQueueStatus {
  return value === 'processing' || value === 'cancelled' || value === 'failed' || value === 'removed' ? value : 'pending';
}

function normalizeListStatus(value: unknown): SMSCancelQueueListStatus {
  return value === 'pending' || value === 'processing' || value === 'cancelled' || value === 'failed' || value === 'removed' ? value : 'all';
}

function listOrderBy(status: SMSCancelQueueListStatus) {
  if (status === 'cancelled' || status === 'removed') return 'ORDER BY updated_at_ms DESC, created_at_ms DESC';
  if (status === 'pending' || status === 'processing' || status === 'failed') return 'ORDER BY not_before_ms ASC, created_at_ms ASC';
  return `
    ORDER BY
      CASE status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 WHEN 'failed' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END,
      not_before_ms ASC,
      created_at_ms DESC
  `;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isCancelSuccess(value: unknown) {
  const text = String(value || '').toUpperCase();
  return text.includes('ACCESS_CANCEL')
    || text.includes('STATUS_CANCEL')
    || text.includes('NO_ACTIVATION')
    || text.includes('ACTIVATION WAS NOT FOUND');
}

function parseMinActivationTimeSeconds(text: string) {
  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as { info?: { minActivationTime?: unknown } };
      const value = Number(parsed?.info?.minActivationTime);
      if (Number.isFinite(value)) return value;
    } catch {
      // Fall through to regex extraction.
    }
  }
  const match = text.match(/minActivationTime["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : Number.NaN;
}

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
