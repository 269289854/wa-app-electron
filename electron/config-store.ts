import { dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import {
  defaultConfig,
  normalizeConfig as normalizeStoredConfig,
  type SMSBowerStoredConfig,
  type SMSProvider,
  type StoredConfig,
  type WindowState,
} from './config.js';

type SQLiteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes?: number | bigint };
  };
  close(): void;
};

type ConfigRow = { field: string; value: string };

export class ConfigStore {
  private readonly upsertStmt;
  private readonly deleteStmt;
  private readonly selectAllStmt;
  private readonly countStmt;

  constructor(
    private readonly db: SQLiteDatabase,
    readonly dbPath: string,
    readonly userDataDir: string,
  ) {
    this.migrate();
    this.upsertStmt = this.db.prepare(
      `INSERT INTO app_config (field, value, updated_at_ms) VALUES (?, ?, ?)
       ON CONFLICT(field) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
    );
    this.deleteStmt = this.db.prepare('DELETE FROM app_config WHERE field = ?');
    this.selectAllStmt = this.db.prepare('SELECT field, value FROM app_config');
    this.countStmt = this.db.prepare('SELECT COUNT(*) AS count FROM app_config');
  }

  load(): StoredConfig {
    const rows = this.selectAllStmt.all() as ConfigRow[];
    const values = new Map(rows.map((row) => [row.field, row.value]));
    const partial: Partial<StoredConfig> = {};
    if (values.has('mode')) partial.mode = values.get('mode') === 'local' ? 'local' : 'remote';
    if (values.has('remoteBaseUrl')) partial.remoteBaseUrl = values.get('remoteBaseUrl');
    if (values.has('localBaseUrl')) partial.localBaseUrl = values.get('localBaseUrl');
    if (values.has('localDataDir')) partial.localDataDir = values.get('localDataDir');
    if (values.has('localCommonProxy')) partial.localCommonProxy = values.get('localCommonProxy');
    if (values.has('localDeviceProfilesFile')) partial.localDeviceProfilesFile = values.get('localDeviceProfilesFile');
    if (values.has('autoStartLocalService')) partial.autoStartLocalService = values.get('autoStartLocalService') === '1';
    if (values.has('smsCancelQueuePollIntervalSeconds')) {
      partial.smsCancelQueuePollIntervalSeconds = Number(values.get('smsCancelQueuePollIntervalSeconds'));
    }
    if (values.has('registrationActionLayout')) {
      partial.registrationActionLayout = values.get('registrationActionLayout') === 'split' ? 'split' : 'combined';
    }
    if (values.has('smsProvider')) {
      partial.smsProvider = (values.get('smsProvider') === 'hero-sms' ? 'hero-sms' : 'smsbower') as SMSProvider;
    }
    const smsbowerRaw = values.get('smsbower');
    if (smsbowerRaw !== undefined) {
      partial.smsbower = parseJsonObject<SMSBowerStoredConfig>(smsbowerRaw) ?? defaultConfig(this.userDataDir).smsbower;
    }
    const windowStateRaw = values.get('windowState');
    if (windowStateRaw !== undefined) {
      partial.windowState = parseJsonObject<WindowState>(windowStateRaw);
    }
    const encryptedPassword = values.get('encryptedPassword');
    if (encryptedPassword !== undefined) partial.encryptedPassword = encryptedPassword;
    return normalizeStoredConfig({ ...defaultConfig(this.userDataDir), ...partial }, this.userDataDir);
  }

  save(config: StoredConfig): void {
    const n = normalizeStoredConfig(config, this.userDataDir);
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      this.upsert('mode', n.mode, now);
      this.upsert('remoteBaseUrl', n.remoteBaseUrl, now);
      this.upsert('localBaseUrl', n.localBaseUrl, now);
      this.upsert('localDataDir', n.localDataDir, now);
      this.upsert('localCommonProxy', n.localCommonProxy, now);
      this.upsert('localDeviceProfilesFile', n.localDeviceProfilesFile, now);
      this.upsert('autoStartLocalService', n.autoStartLocalService ? '1' : '0', now);
      this.upsert('smsCancelQueuePollIntervalSeconds', String(n.smsCancelQueuePollIntervalSeconds), now);
      this.upsert('registrationActionLayout', n.registrationActionLayout, now);
      this.upsert('smsProvider', n.smsProvider, now);
      this.upsert('smsbower', JSON.stringify(n.smsbower), now);
      this.upsert('windowState', JSON.stringify(n.windowState), now);
      if (n.encryptedPassword) this.upsert('encryptedPassword', n.encryptedPassword, now);
      else this.deleteRow('encryptedPassword');
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // best-effort rollback; original error is more useful
      }
      throw error;
    }
  }

  hasData(): boolean {
    const row = this.countStmt.get() as { count?: number | bigint } | undefined;
    return Number(row?.count || 0) > 0;
  }

  close() {
    this.db.close();
  }

  private upsert(field: string, value: string, updatedAtMs: number) {
    this.upsertStmt.run(field, value, updatedAtMs);
  }

  private deleteRow(field: string) {
    this.deleteStmt.run(field);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_config (
        field TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `);
  }
}

export async function createConfigStore(dbPath: string, userDataDir: string): Promise<ConfigStore> {
  mkdirSync(dirname(dbPath), { recursive: true });
  try {
    const sqlite = await import('node:sqlite');
    const db = new sqlite.DatabaseSync(dbPath) as SQLiteDatabase;
    return new ConfigStore(db, dbPath, userDataDir);
  } catch (error) {
    throw new Error(`SQLite config store is unavailable: ${errorMessage(error)}`, { cause: error });
  }
}

export function migrateConfigFromJson(store: ConfigStore, jsonPath: string): void {
  if (store.hasData() || !existsSync(jsonPath)) return;
  try {
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Partial<StoredConfig>;
    const normalized = normalizeStoredConfig({ ...defaultConfig(store.userDataDir), ...parsed }, store.userDataDir);
    store.save(normalized);
    renameSync(jsonPath, `${jsonPath}.bak`);
  } catch {
    // leave the legacy JSON in place; migration retries on the next launch
  }
}

function parseJsonObject<T>(text: string): T | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
