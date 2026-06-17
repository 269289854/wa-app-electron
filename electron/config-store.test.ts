import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore, createConfigStore, migrateConfigFromJson } from './config-store.js';
import { defaultConfig, setPassword, publicConfig, type PasswordCodec } from './config.js';

const plainCodec: PasswordCodec = {
  isEncryptionAvailable: () => false,
  encryptString: (value: string) => Buffer.from(value, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8'),
};

function createMemoryStore(userDataDir = 'C:/data') {
  return new ConfigStore(new DatabaseSync(':memory:'), ':memory:', userDataDir);
}

describe('config store', () => {
  it('returns the default config when the database is empty', () => {
    const store = createMemoryStore('C:/data');
    const config = store.load();
    expect(config.mode).toBe('remote');
    expect(config.remoteBaseUrl).toBe('https://wa.yizhimeng.uk');
    expect(config.smsProvider).toBe('smsbower');
    expect(publicConfig(config).hasPassword).toBe(false);
    store.close();
  });

  it('round-trips scalar, smsbower, and window state fields through SQLite', () => {
    const store = createMemoryStore('C:/data');
    const original = {
      ...defaultConfig('C:/data'),
      mode: 'local' as const,
      remoteBaseUrl: 'https://example.com',
      localBaseUrl: 'http://127.0.0.1:9000',
      autoStartLocalService: true,
      smsCancelQueuePollIntervalSeconds: 12,
      smsProvider: 'hero-sms' as const,
      smsbower: { ...defaultConfig('C:/data').smsbower, enabled: true, country: '187', maxPrice: 0.5 },
      windowState: { width: 1400, height: 900, x: 10, y: 20, maximized: true },
    };
    store.save(original);

    const loaded = store.load();
    expect(loaded).toMatchObject({
      mode: 'local',
      remoteBaseUrl: 'https://example.com',
      localBaseUrl: 'http://127.0.0.1:9000',
      autoStartLocalService: true,
      smsCancelQueuePollIntervalSeconds: 12,
      smsProvider: 'hero-sms',
    });
    expect(loaded.smsbower).toMatchObject({ enabled: true, country: '187', maxPrice: 0.5 });
    expect(loaded.windowState).toEqual({ width: 1400, height: 900, x: 10, y: 20, maximized: true });
    store.close();
  });

  it('persists and clears the encrypted password row so hasPassword tracks the column', () => {
    const store = createMemoryStore('C:/data');
    const withPassword = setPassword(defaultConfig('C:/data'), 'secret', plainCodec);
    store.save(withPassword);

    expect(store.load().encryptedPassword).toBe(withPassword.encryptedPassword);
    expect(publicConfig(store.load()).hasPassword).toBe(true);

    const cleared = setPassword(withPassword, '', plainCodec);
    store.save(cleared);
    expect(store.load().encryptedPassword).toBeUndefined();
    expect(publicConfig(store.load()).hasPassword).toBe(false);
    store.close();
  });

  it('always persists window state (normalize guarantees a value)', () => {
    const store = createMemoryStore('C:/data');
    store.save(defaultConfig('C:/data'));
    const loaded = store.load();
    expect(loaded.windowState).toBeDefined();
    expect(loaded.windowState).toEqual({ width: 1320, height: 860, maximized: false });
    store.close();
  });

  it('hasData reports whether any row has been written', () => {
    const store = createMemoryStore('C:/data');
    expect(store.hasData()).toBe(false);
    store.save(defaultConfig('C:/data'));
    expect(store.hasData()).toBe(true);
    store.close();
  });

  it('migrates a legacy config.json into SQLite and archives it as .bak without re-importing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wa-config-migrate-'));
    try {
      const userDataDir = join(dir, 'userData');
      mkdirSync(userDataDir, { recursive: true });
      const dbPath = join(userDataDir, 'config.sqlite');
      const jsonPath = join(userDataDir, 'config.json');
      const legacy = setPassword(
        { ...defaultConfig(userDataDir), smsProvider: 'hero-sms', remoteBaseUrl: 'https://legacy.example' },
        'topsecret',
        plainCodec,
      );
      writeFileSync(jsonPath, JSON.stringify(legacy), 'utf8');

      const store = await createConfigStore(dbPath, userDataDir);
      migrateConfigFromJson(store, jsonPath);

      const migrated = store.load();
      expect(migrated.smsProvider).toBe('hero-sms');
      expect(migrated.remoteBaseUrl).toBe('https://legacy.example');
      expect(migrated.encryptedPassword).toBe(legacy.encryptedPassword);

      // second launch: JSON is archived, store already has data → no-op
      migrateConfigFromJson(store, jsonPath);
      expect(store.load().remoteBaseUrl).toBe('https://legacy.example');
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
