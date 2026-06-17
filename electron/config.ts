import { join } from 'node:path';

export type ClientMode = 'remote' | 'local';

export type ClientConfig = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localBaseUrl: string;
  localDataDir: string;
  autoStartLocalService: boolean;
  smsProvider: SMSProvider;
  smsbower: SMSBowerPublicConfig;
  hasPassword: boolean;
  authPasswordRef: string;
};

export type SMSProvider = 'smsbower' | 'hero-sms';

export type SMSBowerPublicConfig = {
  enabled: boolean;
  country: string;
  minPrice: number;
  maxPrice: number;
  targetSuccessCount: number;
  maxOrders: number;
  numberIntervalSeconds: number;
  openAIPhoneCheckEnabled: boolean;
  pollIntervalSeconds: number;
  otpTimeoutSeconds: number;
  hasApiKey: boolean;
  hasHeroSMSApiKey: boolean;
  provider: SMSProvider;
  providerLabel: string;
  configured: boolean;
};

export type SMSBowerStoredConfig = Omit<SMSBowerPublicConfig, 'hasApiKey' | 'hasHeroSMSApiKey' | 'provider' | 'providerLabel' | 'configured'> & {
  provider?: SMSProvider;
  encryptedApiKey?: string;
  encryptedHeroSMSApiKey?: string;
};

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
};

export type StoredConfig = Omit<ClientConfig, 'hasPassword' | 'authPasswordRef' | 'smsbower'> & {
  encryptedPassword?: string;
  smsbower: SMSBowerStoredConfig;
  windowState?: WindowState;
};

export type PasswordCodec = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export const defaultRemoteBaseUrl = 'https://wa.yizhimeng.uk';
export const authPasswordRef = 'electron-safe-storage:wa-app-auth-password';
export const smsbowerApiKeyRef = 'electron-safe-storage:smsbower-api-key';
export const heroSMSApiKeyRef = 'electron-safe-storage:hero-sms-api-key';

export function defaultConfig(userDataDir: string): StoredConfig {
  return {
    mode: 'remote',
    remoteBaseUrl: defaultRemoteBaseUrl,
    localBaseUrl: '',
    localDataDir: join(userDataDir, 'wa-app-data'),
    autoStartLocalService: false,
    smsProvider: 'smsbower',
    smsbower: defaultSMSBowerConfig(),
    windowState: { width: 1320, height: 860 },
  };
}

export function normalizeConfig(config: Partial<StoredConfig>, userDataDir: string): StoredConfig {
  const remoteBaseUrl = normalizeBaseUrl(config.remoteBaseUrl || '') || defaultRemoteBaseUrl;
  const localBaseUrl = normalizeBaseUrl(config.localBaseUrl || '') || '';
  return {
    mode: config.mode === 'local' ? 'local' : 'remote',
    remoteBaseUrl,
    localBaseUrl,
    localDataDir: config.localDataDir || join(userDataDir, 'wa-app-data'),
    autoStartLocalService: Boolean(config.autoStartLocalService),
    smsProvider: normalizeSMSProvider(config.smsProvider),
    smsbower: normalizeSMSBowerConfig(config.smsbower),
    encryptedPassword: config.encryptedPassword,
    windowState: normalizeWindowState(config.windowState),
  };
}

export function defaultSMSBowerConfig(): SMSBowerStoredConfig {
  return {
    enabled: false,
    country: '',
    minPrice: 0,
    maxPrice: 0,
    targetSuccessCount: 1,
    maxOrders: 3,
    numberIntervalSeconds: 0,
    openAIPhoneCheckEnabled: false,
    pollIntervalSeconds: 5,
    otpTimeoutSeconds: 600,
  };
}

export function normalizeSMSBowerConfig(config?: Partial<SMSBowerStoredConfig>): SMSBowerStoredConfig {
  const fallback = defaultSMSBowerConfig();
  const provider = normalizeSMSProvider(config?.provider);
  return {
    enabled: Boolean(config?.enabled),
    country: String(config?.country || '').trim(),
    minPrice: boundedDecimal(config?.minPrice, 0, 1000, fallback.minPrice),
    maxPrice: boundedDecimal(config?.maxPrice, 0, 1000, fallback.maxPrice),
    targetSuccessCount: boundedNumber(config?.targetSuccessCount, 1, 100, fallback.targetSuccessCount),
    maxOrders: boundedNumber(config?.maxOrders, 1, 1000, fallback.maxOrders),
    numberIntervalSeconds: boundedNumber(config?.numberIntervalSeconds, 0, 3600, fallback.numberIntervalSeconds),
    openAIPhoneCheckEnabled: Boolean(config?.openAIPhoneCheckEnabled),
    pollIntervalSeconds: boundedNumber(config?.pollIntervalSeconds, 2, 120, fallback.pollIntervalSeconds),
    otpTimeoutSeconds: boundedNumber(config?.otpTimeoutSeconds, 30, 3600, fallback.otpTimeoutSeconds),
    provider,
    encryptedApiKey: config?.encryptedApiKey,
    encryptedHeroSMSApiKey: config?.encryptedHeroSMSApiKey,
  };
}

export function normalizeWindowState(value?: Partial<WindowState>): WindowState {
  return {
    width: boundedNumber(value?.width, 1060, 2400, 1320),
    height: boundedNumber(value?.height, 680, 1800, 860),
    x: typeof value?.x === 'number' ? value.x : undefined,
    y: typeof value?.y === 'number' ? value.y : undefined,
    maximized: Boolean(value?.maximized),
  };
}

export function publicConfig(config: StoredConfig): ClientConfig {
  const hasPassword = Boolean(config.encryptedPassword);
  const smsbower = publicSMSBowerConfig(config.smsbower, config.smsProvider);
  return {
    mode: config.mode,
    remoteBaseUrl: config.remoteBaseUrl,
    localBaseUrl: config.localBaseUrl,
    localDataDir: config.localDataDir,
    autoStartLocalService: config.autoStartLocalService,
    smsProvider: config.smsProvider,
    smsbower,
    hasPassword,
    authPasswordRef: hasPassword ? authPasswordRef : '',
  };
}

export function publicSMSBowerConfig(config: SMSBowerStoredConfig, configuredProvider?: SMSProvider): SMSBowerPublicConfig {
  const provider = normalizeSMSProvider(configuredProvider || config.provider);
  const hasApiKey = Boolean(config.encryptedApiKey);
  const hasHeroSMSApiKey = Boolean(config.encryptedHeroSMSApiKey);
  const activeHasApiKey = provider === 'hero-sms' ? hasHeroSMSApiKey : hasApiKey;
  const configured = Boolean(config.enabled && activeHasApiKey && config.country && config.maxPrice > 0);
  return {
    enabled: config.enabled,
    country: config.country,
    minPrice: config.minPrice,
    maxPrice: config.maxPrice,
    targetSuccessCount: config.targetSuccessCount,
    maxOrders: config.maxOrders,
    numberIntervalSeconds: config.numberIntervalSeconds,
    openAIPhoneCheckEnabled: config.openAIPhoneCheckEnabled,
    pollIntervalSeconds: config.pollIntervalSeconds,
    otpTimeoutSeconds: config.otpTimeoutSeconds,
    hasApiKey,
    hasHeroSMSApiKey,
    provider,
    providerLabel: providerLabel(provider),
    configured,
  };
}

export function normalizeSMSProvider(value: unknown): SMSProvider {
  return value === 'hero-sms' ? 'hero-sms' : 'smsbower';
}

export function providerLabel(provider: SMSProvider) {
  return provider === 'hero-sms' ? 'Hero-SMS' : 'SMSBower';
}

export function normalizeBaseUrl(value: string) {
  try {
    const url = new URL(value.trim());
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function setPassword(config: StoredConfig, password: string | undefined, codec: PasswordCodec) {
  if (password === undefined) return config;
  const trimmed = password.trim();
  if (!trimmed) {
    const rest = { ...config };
    delete rest.encryptedPassword;
    return rest;
  }
  const encoded = codec.isEncryptionAvailable()
    ? codec.encryptString(trimmed).toString('base64')
    : Buffer.from(trimmed, 'utf8').toString('base64');
  return { ...config, encryptedPassword: encoded };
}

export function getPassword(config: StoredConfig, codec: PasswordCodec) {
  if (!config.encryptedPassword) return '';
  try {
    const value = Buffer.from(config.encryptedPassword, 'base64');
    return codec.isEncryptionAvailable() ? codec.decryptString(value) : value.toString('utf8');
  } catch {
    return '';
  }
}

export function setSMSBowerApiKey(config: StoredConfig, apiKey: string | undefined, codec: PasswordCodec) {
  if (apiKey === undefined) return config;
  const smsbower = normalizeSMSBowerConfig(config.smsbower);
  const trimmed = apiKey.trim();
  if (!trimmed) {
    const next = { ...smsbower };
    delete next.encryptedApiKey;
    return { ...config, smsbower: next };
  }
  const encoded = codec.isEncryptionAvailable()
    ? codec.encryptString(trimmed).toString('base64')
    : Buffer.from(trimmed, 'utf8').toString('base64');
  return { ...config, smsbower: { ...smsbower, encryptedApiKey: encoded } };
}

export function getSMSBowerApiKey(config: StoredConfig, codec: PasswordCodec) {
  if (!config.smsbower?.encryptedApiKey) return '';
  try {
    const value = Buffer.from(config.smsbower.encryptedApiKey, 'base64');
    return codec.isEncryptionAvailable() ? codec.decryptString(value) : value.toString('utf8');
  } catch {
    return '';
  }
}

export function setHeroSMSApiKey(config: StoredConfig, apiKey: string | undefined, codec: PasswordCodec) {
  if (apiKey === undefined) return config;
  const smsbower = normalizeSMSBowerConfig(config.smsbower);
  const trimmed = apiKey.trim();
  if (!trimmed) {
    const next = { ...smsbower };
    delete next.encryptedHeroSMSApiKey;
    return { ...config, smsbower: next };
  }
  const encoded = codec.isEncryptionAvailable()
    ? codec.encryptString(trimmed).toString('base64')
    : Buffer.from(trimmed, 'utf8').toString('base64');
  return { ...config, smsbower: { ...smsbower, encryptedHeroSMSApiKey: encoded } };
}

export function getHeroSMSApiKey(config: StoredConfig, codec: PasswordCodec) {
  if (!config.smsbower?.encryptedHeroSMSApiKey) return '';
  try {
    const value = Buffer.from(config.smsbower.encryptedHeroSMSApiKey, 'base64');
    return codec.isEncryptionAvailable() ? codec.decryptString(value) : value.toString('utf8');
  } catch {
    return '';
  }
}

export function parseTestConfig(raw: string | undefined): (Partial<ClientConfig> & { password?: string }) | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ClientConfig> & { password?: string };
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function boundedDecimal(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
