import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultConfig,
  getPassword as decodePassword,
  getSMSBowerApiKey as decodeSMSBowerApiKey,
  getHeroSMSApiKey as decodeHeroSMSApiKey,
  normalizeConfig as normalizeStoredConfig,
  normalizeSMSBowerConfig,
  normalizeWindowState,
  parseTestConfig,
  publicConfig as toPublicConfig,
  setHeroSMSApiKey as applyHeroSMSApiKey,
  setSMSBowerApiKey as applySMSBowerApiKey,
  setPassword as applyPassword,
  type ClientConfig,
  type StoredConfig,
} from './config.js';
import { smsbowerWhatsAppService } from './smsbower.js';
import { ConfigStore, createConfigStore, migrateConfigFromJson } from './config-store.js';
import {
  createSMSCancelQueueStore,
  SMSCancelQueueService,
  smsCancelQueueDefaultPollIntervalSeconds,
  type SMSCancelQueueInput,
  type SMSCancelQueueItem,
  type SMSCancelQueueListInput,
} from './sms-cancel-queue.js';
import { createSMSPlatformClient, normalizeSMSProvider, smsProviderLabels, type SMSProvider } from './sms-platforms.js';

type ApiRequestInput = {
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

type ClientConfigPatch = Partial<ClientConfig> & { password?: string; smsbowerApiKey?: string; heroSMSApiKey?: string };

type SMSPlatformProviderInput = { provider?: SMSProvider };
type SMSBowerPriceInput = SMSPlatformProviderInput & { country?: string };
type SMSBowerNumberInput = SMSPlatformProviderInput & { country?: string; minPrice?: number; maxPrice?: number; providerIds?: string[] };
type SMSBowerSetStatusInput = { id: string; status: number };
type OpenAIPhoneCheckInput = {
  requestId: string;
  phoneNumber: string;
  countryCallingCode?: string;
  nationalNumber?: string;
  countryIso2?: string;
  mode?: 'page' | 'api';
  timeoutMs?: number;
};
type OpenAIPhoneCheckResult = {
  requestId: string;
  phoneNumber?: string;
  status: 'used' | 'sent' | 'available' | 'error' | 'rate_limited' | 'session_expired';
  message: string;
  code?: string;
  raw?: unknown;
};

const mockSMSBowerEnabled = process.env.WA_APP_ELECTRON_MOCK_SMSBOWER === '1';
const mockOpenAIPhoneMode = process.env.WA_APP_ELECTRON_MOCK_OPENAI_PHONE || '';
let mockSMSBowerStatusCalls = 0;

const userDataDirOverride = process.env.WA_APP_ELECTRON_USER_DATA_DIR?.trim();
if (userDataDirOverride) app.setPath('userData', userDataDirOverride);
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
app.on('second-instance', () => {
  const window = mainWindow;
  if (!window) return;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
});
let mainWindow: BrowserWindow | null = null;
let localProcess: ChildProcessWithoutNullStreams | null = null;
let localPort = 0;
let openAIPhoneBridge: HttpServer | null = null;
let smsCancelQueue: SMSCancelQueueService | null = null;
let smsCancelQueueError = '';
let configStore: ConfigStore | null = null;
const openAIPhoneBridgePort = 17391;
const openAIPhoneTasks = new Map<string, {
  input: OpenAIPhoneCheckInput;
  createdAt: number;
  resolve: (result: OpenAIPhoneCheckResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>();
const electronDir = dirname(fileURLToPath(import.meta.url));
const appRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();

function appIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'brand', process.platform === 'win32' ? 'icon.ico' : 'app-icon.png')
    : join(appRoot, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function configPath() {
  return join(app.getPath('userData'), 'config.json');
}

function configStorePath() {
  return join(app.getPath('userData'), 'config.sqlite');
}

function testConfigFromEnv(): ClientConfigPatch | null {
  return parseTestConfig(process.env.WA_APP_ELECTRON_TEST_CONFIG);
}

function readConfig(): StoredConfig {
  return configStore?.load() ?? defaultConfig(app.getPath('userData'));
}

function normalizeConfig(config: StoredConfig): StoredConfig {
  return normalizeStoredConfig(config, app.getPath('userData'));
}

function publicConfig(config = readConfig()): ClientConfig {
  return toPublicConfig(config);
}

function writeConfig(next: StoredConfig) {
  configStore?.save(next);
}

function setPassword(config: StoredConfig, password?: string) {
  return applyPassword(config, password, safeStorage);
}

function getPassword(config = readConfig()) {
  return decodePassword(config, safeStorage);
}

function getSMSPlatformClient(config = readConfig(), providerOverride?: SMSProvider) {
  const provider = providerOverride || config.smsProvider;
  const apiKey = provider === 'hero-sms' ? decodeHeroSMSApiKey(config, safeStorage) : decodeSMSBowerApiKey(config, safeStorage);
  const label = smsProviderLabels[provider];
  if (!apiKey) throw new Error(`${label} API key is not configured`);
  return createSMSPlatformClient({ provider, apiKey });
}

function mockSMSBowerCountries() {
  return [{ id: '187', name: 'Smoke Country' }];
}

function mockSMSBowerPrices() {
  return [{ country: '187', service: smsbowerWhatsAppService, cost: 0.2, count: 10, providerId: 'mock-provider' }];
}

function mockSMSBowerNumber() {
  return { activationId: 'act-smoke-1', phone: '573145865572' };
}

function mockSMSBowerStatus() {
  mockSMSBowerStatusCalls += 1;
  if (mockSMSBowerStatusCalls < 2) return { status: 'waiting', raw: 'STATUS_WAIT_CODE' };
  return { status: 'ok', code: '333444', raw: 'STATUS_OK:333444' };
}

function mockSMSBowerSetStatus(input: SMSBowerSetStatusInput) {
  return input.status === 6 ? 'ACCESS_READY' : 'ACCESS_CANCEL';
}

function currentSMSProvider(config = readConfig(), providerOverride?: unknown): SMSProvider {
  return providerOverride ? normalizeSMSProvider(providerOverride) : config.smsProvider;
}

function smsPlatformStatus() {
  const config = publicConfig();
  return {
    provider: config.smsProvider,
    label: config.smsbower.providerLabel,
    configured: config.smsbower.configured,
    config: config.smsbower,
  };
}

function smsPlatformBalance() {
  return mockSMSBowerEnabled ? '100.00' : getSMSPlatformClient().getBalance();
}

function smsPlatformCountries(input?: SMSPlatformProviderInput) {
  if (mockSMSBowerEnabled) return mockSMSBowerCountries();
  const config = readConfig();
  const provider = input?.provider ? currentSMSProvider(config, input.provider) : currentSMSProvider(config);
  return getSMSPlatformClient(config, provider).getCountries();
}

function smsPlatformPrices(input?: SMSBowerPriceInput) {
  if (mockSMSBowerEnabled) return mockSMSBowerPrices();
  const config = readConfig();
  const provider = input?.provider ? currentSMSProvider(config, input.provider) : currentSMSProvider(config);
  const country = input?.country || config.smsbower.country;
  const label = smsProviderLabels[provider];
  if (!country) throw new Error(`${label} country is not configured`);
  return getSMSPlatformClient(config, provider).getPrices(country, smsbowerWhatsAppService);
}

function smsPlatformNumber(input?: SMSBowerNumberInput) {
  if (mockSMSBowerEnabled) return mockSMSBowerNumber();
  const config = readConfig();
  const provider = input?.provider ? currentSMSProvider(config, input.provider) : currentSMSProvider(config);
  const country = input?.country || config.smsbower.country;
  const minPrice = Number(input?.minPrice ?? config.smsbower.minPrice);
  const maxPrice = Number(input?.maxPrice ?? config.smsbower.maxPrice);
  const label = smsProviderLabels[provider];
  if (!country) throw new Error(`${label} country is not configured`);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) throw new Error(`${label} max price is not configured`);
  return getSMSPlatformClient(config, provider).getNumber({ country, minPrice, maxPrice, providerIds: input?.providerIds, service: smsbowerWhatsAppService });
}

function smsPlatformGetStatus(id: string) {
  return mockSMSBowerEnabled ? mockSMSBowerStatus() : getSMSPlatformClient().getStatus(id);
}

function smsPlatformSetStatus(input: SMSBowerSetStatusInput) {
  return mockSMSBowerEnabled ? mockSMSBowerSetStatus(input) : getSMSPlatformClient().setStatus(input.id, input.status);
}

async function initSMSCancelQueue(config = readConfig()) {
  try {
    const store = await createSMSCancelQueueStore(join(app.getPath('userData'), 'sms-cancel-queue.sqlite'));
    smsCancelQueue = new SMSCancelQueueService(store, cancelSMSQueueItem, config.smsCancelQueuePollIntervalSeconds || smsCancelQueueDefaultPollIntervalSeconds);
    smsCancelQueue.start();
    smsCancelQueueError = '';
  } catch (error) {
    smsCancelQueueError = errorMessage(error);
    console.error('SMS cancel queue failed:', error);
  }
}

function smsCancelQueueStatus() {
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

function smsCancelQueueEnqueue(input: SMSCancelQueueInput) {
  return requireSMSCancelQueue().enqueue({
    ...input,
    provider: normalizeSMSProvider(input.provider),
  });
}

function smsCancelQueueList(input?: SMSCancelQueueListInput) {
  return requireSMSCancelQueue().listPage(input);
}

function smsCancelQueueRetry(id: string) {
  return requireSMSCancelQueue().retry(id);
}

function smsCancelQueueRemove(id: string) {
  return requireSMSCancelQueue().remove(id);
}

async function cancelSMSQueueItem(item: SMSCancelQueueItem) {
  if (mockSMSBowerEnabled) return mockSMSBowerSetStatus({ id: item.activationId, status: 8 });
  return getSMSPlatformClient(readConfig(), item.provider).setStatus(item.activationId, 8);
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

async function testConnection(configPatch?: ClientConfigPatch) {
  const previous = readConfig();
  const next = applyConfigPatch(previous, configPatch);
  writeConfig(next);
  try {
    const health = await requestHealth();
    return { ok: true, health, config: publicConfig(next) };
  } catch (error) {
    return { ok: false, error: errorMessage(error), config: publicConfig(next) };
  }
}

function applyConfigPatch(previous: StoredConfig, patch?: ClientConfigPatch) {
  if (!patch) return normalizeConfig(previous);
  const merged = normalizeConfig({
    ...previous,
    smsProvider: patch.smsProvider ?? previous.smsProvider,
    ...patch,
    smsbower: normalizeSMSBowerConfig({ ...previous.smsbower, ...patch.smsbower }),
  });
  return normalizeConfig(applyHeroSMSApiKey(applySMSBowerApiKey(setPassword(merged, patch.password), patch.smsbowerApiKey, safeStorage), patch.heroSMSApiKey, safeStorage));
}

async function requestHealth() {
  try {
    return await requestJSON<Record<string, unknown>>({ path: '/api/wa/health', timeoutMs: 10000 });
  } catch (primaryError) {
    try {
      return await requestJSON<Record<string, unknown>>({ path: '/healthz', timeoutMs: 10000 });
    } catch {
      throw primaryError;
    }
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

function openAIPhoneBridgeStatus() {
  return {
    running: Boolean(openAIPhoneBridge),
    port: openAIPhoneBridgePort,
    baseUrl: `http://127.0.0.1:${openAIPhoneBridgePort}`,
    pending: openAIPhoneTasks.size,
  };
}

function startOpenAIPhoneBridge() {
  if (openAIPhoneBridge) return openAIPhoneBridgeStatus();
  openAIPhoneBridge = createHttpServer((request, response) => {
    void handleOpenAIPhoneBridgeRequest(request, response);
  });
  openAIPhoneBridge.once('error', (error) => {
    openAIPhoneBridge = null;
    console.error('OpenAI phone bridge failed:', error);
  });
  openAIPhoneBridge.listen(openAIPhoneBridgePort, '127.0.0.1');
  return openAIPhoneBridgeStatus();
}

function stopOpenAIPhoneBridge() {
  if (!openAIPhoneBridge) return;
  openAIPhoneBridge.close();
  openAIPhoneBridge = null;
}

async function waitForOpenAIPhoneCheck(input: OpenAIPhoneCheckInput) {
  if (mockOpenAIPhoneMode === 'rate_limit') {
    return {
      requestId: input.requestId,
      phoneNumber: input.phoneNumber,
      status: 'error',
      message: "You've made too many phone verification requests. Please try again later or contact us through our help center at help.openai.com.",
      code: 'rate_limit_exceeded',
      raw: {
        message: "You've made too many phone verification requests. Please try again later or contact us through our help center at help.openai.com.",
        type: 'invalid_request_error',
        param: null,
        code: 'rate_limit_exceeded',
      },
    } satisfies OpenAIPhoneCheckResult;
  }
  if (mockOpenAIPhoneMode === 'session_expired') {
    return {
      requestId: input.requestId,
      phoneNumber: input.phoneNumber,
      status: 'error',
      message: 'Your sign-in session is no longer valid. Please start over to continue.',
      code: 'invalid_state',
      raw: {
        error: {
          message: 'Your sign-in session is no longer valid. Please start over to continue.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_state',
        },
      },
    } satisfies OpenAIPhoneCheckResult;
  }
  startOpenAIPhoneBridge();
  const timeoutMs = input.timeoutMs || 120000;
  return new Promise<OpenAIPhoneCheckResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      openAIPhoneTasks.delete(input.requestId);
      reject(new Error('OpenAI phone check timed out'));
    }, timeoutMs);
    openAIPhoneTasks.set(input.requestId, {
      input: { ...input, mode: input.mode || 'api' },
      createdAt: Date.now(),
      resolve,
      reject,
      timer,
    });
  });
}

async function handleOpenAIPhoneBridgeRequest(request: IncomingMessage, response: ServerResponse) {
  setBridgeCorsHeaders(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url || '/', `http://127.0.0.1:${openAIPhoneBridgePort}`);
  try {
    if (request.method === 'GET' && url.pathname === '/openai-phone-check/task') {
      const task = [...openAIPhoneTasks.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
      writeJSON(response, 200, { task: task?.input || null });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/openai-phone-check/result') {
      const result = await readJSON<OpenAIPhoneCheckResult>(request);
      const requestId = String(result.requestId || '');
      const task = openAIPhoneTasks.get(requestId);
      if (!task) {
        writeJSON(response, 404, { ok: false, error: 'OpenAI phone check request was not found' });
        return;
      }
      clearTimeout(task.timer);
      openAIPhoneTasks.delete(requestId);
      task.resolve(result);
      writeJSON(response, 200, { ok: true });
      return;
    }
    writeJSON(response, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    writeJSON(response, 500, { ok: false, error: errorMessage(error) });
  }
}

function setBridgeCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function writeJSON(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJSON<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return (text ? JSON.parse(text) : {}) as T;
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
    icon: appIconPath(),
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
    if (process.env.WA_APP_OPEN_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });
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
  if (!gotSingleInstanceLock) return;
  configStore = await createConfigStore(configStorePath(), app.getPath('userData'));
  migrateConfigFromJson(configStore, configPath());
  const testConfig = testConfigFromEnv();
  if (testConfig) {
    const next = applyConfigPatch(readConfig(), testConfig);
    writeConfig(next);
  }
  const config = readConfig();
  if (config.mode === 'local' && config.autoStartLocalService) await startLocalService();
  await initSMSCancelQueue(config);
  ipcMain.handle('wa-config:get', () => publicConfig());
  ipcMain.handle('wa-config:set', (_event, input: ClientConfigPatch) => {
    const next = applyConfigPatch(readConfig(), input);
    writeConfig(next);
    smsCancelQueue?.setPollInterval(next.smsCancelQueuePollIntervalSeconds);
    return publicConfig(next);
  });
  ipcMain.handle('wa-config:test', (_event, input?: ClientConfigPatch) => testConnection(input));
  ipcMain.handle('wa-api:request', (_event, input: ApiRequestInput) => requestJSON(input));
  ipcMain.handle('wa-api:asset', (_event, path: string) => requestAsset(path));
  ipcMain.handle('openai-phone:bridge-status', () => startOpenAIPhoneBridge());
  ipcMain.handle('openai-phone:check', (_event, input: OpenAIPhoneCheckInput) => waitForOpenAIPhoneCheck(input));
  ipcMain.handle('wa-service:status', () => serviceStatus());
  ipcMain.handle('wa-service:start', () => startLocalService());
  ipcMain.handle('wa-service:stop', () => stopLocalService());
  ipcMain.handle('sms-platform:status', () => smsPlatformStatus());
  ipcMain.handle('sms-platform:balance', () => smsPlatformBalance());
  ipcMain.handle('sms-platform:countries', (_event, input?: SMSPlatformProviderInput) => smsPlatformCountries(input));
  ipcMain.handle('sms-platform:prices', (_event, input?: SMSBowerPriceInput) => smsPlatformPrices(input));
  ipcMain.handle('sms-platform:number', (_event, input?: SMSBowerNumberInput) => smsPlatformNumber(input));
  ipcMain.handle('sms-platform:get-status', (_event, id: string) => smsPlatformGetStatus(id));
  ipcMain.handle('sms-platform:set-status', (_event, input: SMSBowerSetStatusInput) => smsPlatformSetStatus(input));
  ipcMain.handle('sms-cancel-queue:status', () => smsCancelQueueStatus());
  ipcMain.handle('sms-cancel-queue:list', (_event, input?: SMSCancelQueueListInput) => smsCancelQueueList(input));
  ipcMain.handle('sms-cancel-queue:enqueue', (_event, input: SMSCancelQueueInput) => smsCancelQueueEnqueue(input));
  ipcMain.handle('sms-cancel-queue:retry', (_event, id: string) => smsCancelQueueRetry(id));
  ipcMain.handle('sms-cancel-queue:remove', (_event, id: string) => smsCancelQueueRemove(id));
  ipcMain.handle('smsbower:status', () => smsPlatformStatus());
  ipcMain.handle('smsbower:balance', () => smsPlatformBalance());
  ipcMain.handle('smsbower:countries', (_event, input?: SMSPlatformProviderInput) => smsPlatformCountries(input));
  ipcMain.handle('smsbower:prices', (_event, input?: SMSBowerPriceInput) => smsPlatformPrices(input));
  ipcMain.handle('smsbower:number', (_event, input?: SMSBowerNumberInput) => smsPlatformNumber(input));
  ipcMain.handle('smsbower:get-status', (_event, id: string) => smsPlatformGetStatus(id));
  ipcMain.handle('smsbower:set-status', (_event, input: SMSBowerSetStatusInput) => smsPlatformSetStatus(input));
  createWindow();
});

app.on('window-all-closed', () => {
  stopLocalService();
  stopOpenAIPhoneBridge();
  smsCancelQueue?.close();
  smsCancelQueue = null;
  configStore?.close();
  configStore = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
