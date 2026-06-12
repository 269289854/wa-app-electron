import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type ClientMode = 'remote' | 'local';

type ClientConfig = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localBaseUrl: string;
  localDataDir: string;
  autoStartLocalService: boolean;
  hasPassword: boolean;
};

type WindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
};

type StoredConfig = Omit<ClientConfig, 'hasPassword'> & {
  encryptedPassword?: string;
  windowState?: WindowState;
};

type ApiRequestInput = {
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

const defaultRemoteBaseUrl = 'https://wa.yizhimeng.uk';
let mainWindow: BrowserWindow | null = null;
let localProcess: ChildProcessWithoutNullStreams | null = null;
let localPort = 0;
const electronDir = dirname(fileURLToPath(import.meta.url));

function configPath() {
  return join(app.getPath('userData'), 'config.json');
}

function defaultConfig(): StoredConfig {
  return {
    mode: 'remote',
    remoteBaseUrl: defaultRemoteBaseUrl,
    localBaseUrl: '',
    localDataDir: join(app.getPath('userData'), 'wa-app-data'),
    autoStartLocalService: false,
    windowState: { width: 1320, height: 860 },
  };
}

function readConfig(): StoredConfig {
  try {
    const path = configPath();
    if (!existsSync(path)) return defaultConfig();
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredConfig>;
    return normalizeConfig({ ...defaultConfig(), ...parsed });
  } catch {
    return defaultConfig();
  }
}

function normalizeConfig(config: StoredConfig): StoredConfig {
  const remoteBaseUrl = normalizeBaseUrl(config.remoteBaseUrl) || defaultRemoteBaseUrl;
  const localBaseUrl = normalizeBaseUrl(config.localBaseUrl) || '';
  return {
    mode: config.mode === 'local' ? 'local' : 'remote',
    remoteBaseUrl,
    localBaseUrl,
    localDataDir: config.localDataDir || join(app.getPath('userData'), 'wa-app-data'),
    autoStartLocalService: Boolean(config.autoStartLocalService),
    encryptedPassword: config.encryptedPassword,
    windowState: normalizeWindowState(config.windowState),
  };
}

function normalizeWindowState(value?: Partial<WindowState>): WindowState {
  return {
    width: boundedNumber(value?.width, 1060, 2400, 1320),
    height: boundedNumber(value?.height, 680, 1800, 860),
    x: typeof value?.x === 'number' ? value.x : undefined,
    y: typeof value?.y === 'number' ? value.y : undefined,
    maximized: Boolean(value?.maximized),
  };
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function publicConfig(config = readConfig()): ClientConfig {
  return { ...config, hasPassword: Boolean(config.encryptedPassword) };
}

function writeConfig(next: StoredConfig) {
  const path = configPath();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(normalizeConfig(next), null, 2), 'utf8');
}

function normalizeBaseUrl(value: string) {
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

function setPassword(config: StoredConfig, password?: string) {
  if (password === undefined) return config;
  const trimmed = password.trim();
  if (!trimmed) {
    const rest = { ...config };
    delete rest.encryptedPassword;
    return rest;
  }
  const encoded = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(trimmed).toString('base64')
    : Buffer.from(trimmed, 'utf8').toString('base64');
  return { ...config, encryptedPassword: encoded };
}

function getPassword(config = readConfig()) {
  if (!config.encryptedPassword) return '';
  try {
    const value = Buffer.from(config.encryptedPassword, 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(value) : value.toString('utf8');
  } catch {
    return '';
  }
}

function activeBaseUrl(config = readConfig()) {
  if (config.mode === 'local') return config.localBaseUrl || (localPort ? `http://127.0.0.1:${localPort}` : '');
  return config.remoteBaseUrl;
}

function buildUrl(path: string, baseUrl = activeBaseUrl()) {
  if (!baseUrl) throw new Error('服务地址未配置');
  return new URL(path, `${baseUrl}/`).toString();
}

async function requestJSON<T>(input: ApiRequestInput): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 30000);
  const headers = new Headers(input.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const password = getPassword();
  if (password) headers.set('Authorization', `Basic ${Buffer.from(`wa:${password}`).toString('base64')}`);
  try {
    const response = await fetch(buildUrl(input.path), {
      method: input.method || 'GET',
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(typeof message === 'string' ? message : `HTTP ${response.status}`);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAsset(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const headers = new Headers();
  const password = getPassword();
  if (password) headers.set('Authorization', `Basic ${Buffer.from(`wa:${password}`).toString('base64')}`);
  try {
    const response = await fetch(buildUrl(path), { headers, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, contentType: '', data: '' };
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      data: buffer.toString('base64'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function testConnection(configPatch?: Partial<ClientConfig> & { password?: string }) {
  const previous = readConfig();
  const next = normalizeConfig(setPassword({ ...previous, ...configPatch }, configPatch?.password));
  writeConfig(next);
  try {
    const health = await requestJSON<Record<string, unknown>>({ path: '/api/wa/health', timeoutMs: 10000 });
    return { ok: true, health, config: publicConfig(next) };
  } catch (error) {
    return { ok: false, error: errorMessage(error), config: publicConfig(next) };
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function serviceExecutablePath() {
  const name = process.platform === 'win32' ? 'wa-app-service.exe' : 'wa-app-service';
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'wa-app-service', name)
    : join(app.getAppPath(), 'resources', 'wa-app-service', name);
}

async function startLocalService() {
  if (localProcess) return serviceStatus();
  const config = readConfig();
  const executable = serviceExecutablePath();
  if (!existsSync(executable)) return { running: false, mode: config.mode, error: '未找到本地 wa-app-service，可先使用远程服务模式' };
  localPort = await findFreePort();
  mkdirSync(config.localDataDir, { recursive: true });
  localProcess = spawn(executable, [], {
    env: {
      ...process.env,
      WA_APP_DASHBOARD_HTTP_ADDR: `127.0.0.1:${localPort}`,
      WA_APP_LISTEN_ADDR: '127.0.0.1:0',
      WA_APP_DATA_DIR: config.localDataDir,
      WA_APP_AUTH_PASSWORD: getPassword(config),
    },
  });
  localProcess.once('exit', () => {
    localProcess = null;
    localPort = 0;
  });
  writeConfig({ ...config, localBaseUrl: `http://127.0.0.1:${localPort}` });
  return serviceStatus();
}

function stopLocalService() {
  if (localProcess) {
    localProcess.kill();
    localProcess = null;
    localPort = 0;
  }
  return serviceStatus();
}

function serviceStatus() {
  const config = readConfig();
  return {
    mode: config.mode,
    running: Boolean(localProcess),
    baseUrl: activeBaseUrl(config),
    localServiceAvailable: existsSync(serviceExecutablePath()),
  };
}

function createWindow() {
  const config = readConfig();
  const state = normalizeWindowState(config.windowState);
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1060,
    minHeight: 680,
    title: 'WA App',
    backgroundColor: '#f7f8fb',
    webPreferences: {
      preload: join(electronDir, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (state.maximized) mainWindow.maximize();
  mainWindow.on('close', () => saveWindowState(mainWindow));

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(join(app.getAppPath(), 'dist', 'index.html'));
  }
}

function saveWindowState(window: BrowserWindow | null) {
  if (!window) return;
  const config = readConfig();
  const bounds = window.getBounds();
  writeConfig({
    ...config,
    windowState: {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      maximized: window.isMaximized(),
    },
  });
}

app.whenReady().then(async () => {
  const config = readConfig();
  if (config.mode === 'local' && config.autoStartLocalService) await startLocalService();
  ipcMain.handle('wa-config:get', () => publicConfig());
  ipcMain.handle('wa-config:set', (_event, input: Partial<ClientConfig> & { password?: string }) => {
    const next = normalizeConfig(setPassword({ ...readConfig(), ...input }, input.password));
    writeConfig(next);
    return publicConfig(next);
  });
  ipcMain.handle('wa-config:test', (_event, input?: Partial<ClientConfig> & { password?: string }) => testConnection(input));
  ipcMain.handle('wa-api:request', (_event, input: ApiRequestInput) => requestJSON(input));
  ipcMain.handle('wa-api:asset', (_event, path: string) => requestAsset(path));
  ipcMain.handle('wa-service:status', () => serviceStatus());
  ipcMain.handle('wa-service:start', () => startLocalService());
  ipcMain.handle('wa-service:stop', () => stopLocalService());
  createWindow();
});

app.on('window-all-closed', () => {
  stopLocalService();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
