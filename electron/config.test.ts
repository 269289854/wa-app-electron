import { describe, expect, it } from 'vitest';
import {
  authPasswordRef,
  defaultConfig,
  getPassword,
  normalizeBaseUrl,
  normalizeConfig,
  normalizeWindowState,
  parseTestConfig,
  publicConfig,
  setPassword,
  type PasswordCodec,
} from './config.js';

const plainCodec: PasswordCodec = {
  isEncryptionAvailable: () => false,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
};

const encryptedCodec: PasswordCodec = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
};

describe('electron config helpers', () => {
  it('builds a remote-first default config', () => {
    const config = defaultConfig('C:/Users/test/AppData/Roaming/wa-app-electron');
    expect(config.mode).toBe('remote');
    expect(config.remoteBaseUrl).toBe('https://wa.yizhimeng.uk');
    expect(config.localDataDir).toContain('wa-app-data');
    expect(config.windowState).toEqual({ width: 1320, height: 860 });
  });

  it('normalizes URLs and falls back to remote mode defaults', () => {
    const config = normalizeConfig({
      mode: 'local',
      remoteBaseUrl: 'https://example.com/base/?x=1#hash',
      localBaseUrl: 'http://127.0.0.1:9000///healthz',
      localDataDir: '',
      autoStartLocalService: 1 as unknown as boolean,
      windowState: { width: 9999, height: 12, maximized: true },
    }, 'C:/data');

    expect(config.mode).toBe('local');
    expect(config.remoteBaseUrl).toBe('https://example.com/base');
    expect(config.localBaseUrl).toBe('http://127.0.0.1:9000///healthz');
    expect(config.localDataDir.replaceAll('\\', '/')).toContain('C:/data');
    expect(config.localDataDir.replaceAll('\\', '/')).toContain('wa-app-data');
    expect(config.autoStartLocalService).toBe(true);
    expect(config.windowState).toMatchObject({ width: 2400, height: 680, maximized: true });
  });

  it('bounds persisted window state', () => {
    expect(normalizeWindowState({ width: 100, height: 3000, x: 12, y: 24 })).toEqual({
      width: 1060,
      height: 1800,
      x: 12,
      y: 24,
      maximized: false,
    });
  });

  it('publishes only password presence and a stable password reference', () => {
    const config = publicConfig({ ...defaultConfig('C:/data'), encryptedPassword: 'abc' });
    expect(config.hasPassword).toBe(true);
    expect(config.authPasswordRef).toBe(authPasswordRef);
    expect(JSON.stringify(config)).not.toContain('abc');
    expect('encryptedPassword' in config).toBe(false);
  });

  it('sets, reads, and clears stored passwords without returning plaintext in config', () => {
    const withPassword = setPassword(defaultConfig('C:/data'), ' secret ', encryptedCodec);
    expect(withPassword.encryptedPassword).toBe(Buffer.from('encrypted:secret', 'utf8').toString('base64'));
    expect(JSON.stringify(publicConfig(withPassword))).not.toContain('secret');
    expect(getPassword(withPassword, encryptedCodec)).toBe('secret');

    const cleared = setPassword(withPassword, '', encryptedCodec);
    expect(cleared.encryptedPassword).toBeUndefined();
    expect(publicConfig(cleared).authPasswordRef).toBe('');
  });

  it('falls back to base64 when OS encryption is unavailable', () => {
    const config = setPassword(defaultConfig('C:/data'), 'secret', plainCodec);
    expect(config.encryptedPassword).toBe(Buffer.from('secret', 'utf8').toString('base64'));
    expect(getPassword(config, plainCodec)).toBe('secret');
  });

  it('parses test config injection safely', () => {
    expect(parseTestConfig('{"mode":"remote","password":"x"}')).toMatchObject({ mode: 'remote', password: 'x' });
    expect(parseTestConfig('{bad json')).toBeNull();
    expect(parseTestConfig(undefined)).toBeNull();
  });

  it('normalizes invalid base URLs to empty strings', () => {
    expect(normalizeBaseUrl('not a url')).toBe('');
    expect(normalizeBaseUrl(' https://wa.yizhimeng.uk///?token=abc#x ')).toBe('https://wa.yizhimeng.uk');
  });
});
