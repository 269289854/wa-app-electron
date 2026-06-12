import { join } from 'node:path';

export type ClientMode = 'remote' | 'local';

export type ClientConfig = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localBaseUrl: string;
  localDataDir: string;
  autoStartLocalService: boolean;
  hasPassword: boolean;
  authPasswordRef: string;
};

export type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
};

export type StoredConfig = Omit<ClientConfig, 'hasPassword' | 'authPasswordRef'> & {
  encryptedPassword?: string;
  windowState?: WindowState;
};

export type PasswordCodec = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

export const defaultRemoteBaseUrl = 'https://wa.yizhimeng.uk';
export const authPasswordRef = 'electron-safe-storage:wa-app-auth-password';

export function defaultConfig(userDataDir: string): StoredConfig {
  return {
    mode: 'remote',
    remoteBaseUrl: defaultRemoteBaseUrl,
    localBaseUrl: '',
    localDataDir: join(userDataDir, 'wa-app-data'),
    autoStartLocalService: false,
    windowState: { width: 1320, height: 860 },
  };
}

export function normalizeConfig(config: StoredConfig, userDataDir: string): StoredConfig {
  const remoteBaseUrl = normalizeBaseUrl(config.remoteBaseUrl) || defaultRemoteBaseUrl;
  const localBaseUrl = normalizeBaseUrl(config.localBaseUrl) || '';
  return {
    mode: config.mode === 'local' ? 'local' : 'remote',
    remoteBaseUrl,
    localBaseUrl,
    localDataDir: config.localDataDir || join(userDataDir, 'wa-app-data'),
    autoStartLocalService: Boolean(config.autoStartLocalService),
    encryptedPassword: config.encryptedPassword,
    windowState: normalizeWindowState(config.windowState),
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
  return {
    mode: config.mode,
    remoteBaseUrl: config.remoteBaseUrl,
    localBaseUrl: config.localBaseUrl,
    localDataDir: config.localDataDir,
    autoStartLocalService: config.autoStartLocalService,
    hasPassword,
    authPasswordRef: hasPassword ? authPasswordRef : '',
  };
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
