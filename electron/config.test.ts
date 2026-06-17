import { describe, expect, it } from 'vitest';
import {
  authPasswordRef,
  defaultConfig,
  getPassword,
  getSMSBowerApiKey,
  getHeroSMSApiKey,
  normalizeBaseUrl,
  normalizeConfig,
  normalizeWindowState,
  parseTestConfig,
  publicConfig,
  setPassword,
  setSMSBowerApiKey,
  setHeroSMSApiKey,
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
    expect(config.smsProvider).toBe('smsbower');
    expect(config.smsCancelQueuePollIntervalSeconds).toBe(5);
    expect(config.localDataDir).toContain('wa-app-data');
    expect(config.smsbower).toMatchObject({ enabled: false, targetSuccessCount: 1, maxOrders: 3, numberIntervalSeconds: 0, openAIPhoneCheckEnabled: false });
    expect(config.windowState).toEqual({ width: 1320, height: 860 });
  });

  it('normalizes URLs and falls back to remote mode defaults', () => {
    const config = normalizeConfig({
      mode: 'local',
      remoteBaseUrl: 'https://example.com/base/?x=1#hash',
      localBaseUrl: 'http://127.0.0.1:9000///healthz',
      localDataDir: '',
      autoStartLocalService: 1 as unknown as boolean,
      smsCancelQueuePollIntervalSeconds: 999,
      windowState: { width: 9999, height: 12, maximized: true },
    }, 'C:/data');

    expect(config.mode).toBe('local');
    expect(config.remoteBaseUrl).toBe('https://example.com/base');
    expect(config.localBaseUrl).toBe('http://127.0.0.1:9000///healthz');
    expect(config.localDataDir.replaceAll('\\', '/')).toContain('C:/data');
    expect(config.localDataDir.replaceAll('\\', '/')).toContain('wa-app-data');
    expect(config.autoStartLocalService).toBe(true);
    expect(config.smsCancelQueuePollIntervalSeconds).toBe(300);
    expect(config.windowState).toMatchObject({ width: 2400, height: 680, maximized: true });
  });

  it('keeps SMSBower decimal price bounds while normalizing integer limits', () => {
    const config = normalizeConfig({
      ...defaultConfig('C:/data'),
      smsbower: {
        enabled: true,
        country: '187',
        minPrice: 0.12,
        maxPrice: 0.48,
        targetSuccessCount: 1.8,
        maxOrders: 2.2,
        numberIntervalSeconds: 10.6,
        openAIPhoneCheckEnabled: true,
        pollIntervalSeconds: 4.7,
        otpTimeoutSeconds: 90.2,
      },
    }, 'C:/data');
    expect(config.smsbower.minPrice).toBe(0.12);
    expect(config.smsbower.maxPrice).toBe(0.48);
    expect(config.smsbower.targetSuccessCount).toBe(2);
    expect(config.smsbower.maxOrders).toBe(2);
    expect(config.smsbower.numberIntervalSeconds).toBe(11);
    expect(config.smsbower.openAIPhoneCheckEnabled).toBe(true);
    expect(config.smsbower.pollIntervalSeconds).toBe(5);
    expect(config.smsbower.otpTimeoutSeconds).toBe(90);
  });

  it('allows SMSBower number interval to be disabled with zero or invalid values', () => {
    const base = defaultConfig('C:/data').smsbower;
    expect(normalizeConfig({ ...defaultConfig('C:/data'), smsbower: { ...base, numberIntervalSeconds: 0 } }, 'C:/data').smsbower.numberIntervalSeconds).toBe(0);
    expect(normalizeConfig({ ...defaultConfig('C:/data'), smsbower: { ...base, numberIntervalSeconds: -5 } }, 'C:/data').smsbower.numberIntervalSeconds).toBe(0);
    expect(normalizeConfig({ ...defaultConfig('C:/data'), smsbower: { ...base, numberIntervalSeconds: 'bad' as unknown as number } }, 'C:/data').smsbower.numberIntervalSeconds).toBe(0);
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

  it('publishes SMSBower config without exposing the stored API key', () => {
    const stored = setSMSBowerApiKey({
      ...defaultConfig('C:/data'),
      smsbower: {
        ...defaultConfig('C:/data').smsbower,
        enabled: true,
        country: '187',
        maxPrice: 0.5,
      },
    }, ' key-123 ', encryptedCodec);
    const config = publicConfig(stored);
    expect(config.smsbower).toMatchObject({ enabled: true, country: '187', hasApiKey: true, configured: true });
    expect(JSON.stringify(config)).not.toContain('key-123');
    expect(getSMSBowerApiKey(stored, encryptedCodec)).toBe('key-123');

    const cleared = setSMSBowerApiKey(stored, '', encryptedCodec);
    expect(cleared.smsbower.encryptedApiKey).toBeUndefined();
    expect(publicConfig(cleared).smsbower.hasApiKey).toBe(false);
  });

  it('stores Hero-SMS API key separately and marks Hero-SMS configured', () => {
    const stored = setHeroSMSApiKey({
      ...defaultConfig('C:/data'),
      smsProvider: 'hero-sms',
      smsbower: {
        ...defaultConfig('C:/data').smsbower,
        enabled: true,
        country: '187',
        maxPrice: 0.5,
      },
    }, ' hero-key ', encryptedCodec);
    const config = publicConfig(stored);
    expect(config.smsProvider).toBe('hero-sms');
    expect(config.smsbower).toMatchObject({ provider: 'hero-sms', providerLabel: 'Hero-SMS', hasHeroSMSApiKey: true, configured: true });
    expect(config.smsbower.hasApiKey).toBe(false);
    expect(JSON.stringify(config)).not.toContain('hero-key');
    expect(getHeroSMSApiKey(stored, encryptedCodec)).toBe('hero-key');

    const cleared = setHeroSMSApiKey(stored, '', encryptedCodec);
    expect(cleared.smsbower.encryptedHeroSMSApiKey).toBeUndefined();
    expect(publicConfig(cleared).smsbower.hasHeroSMSApiKey).toBe(false);
  });

  it('requires SMSBower key, country, and max price before marking it configured', () => {
    const base = {
      ...defaultConfig('C:/data'),
      smsbower: {
        ...defaultConfig('C:/data').smsbower,
        enabled: true,
        country: '187',
        maxPrice: 0.5,
      },
    };
    expect(publicConfig(base).smsbower.configured).toBe(false);
    expect(publicConfig(setSMSBowerApiKey({ ...base, smsbower: { ...base.smsbower, country: '' } }, 'key', plainCodec)).smsbower.configured).toBe(false);
    expect(publicConfig(setSMSBowerApiKey({ ...base, smsbower: { ...base.smsbower, maxPrice: 0 } }, 'key', plainCodec)).smsbower.configured).toBe(false);
    expect(publicConfig(setSMSBowerApiKey(base, 'key', plainCodec)).smsbower.configured).toBe(true);
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
