import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeWindowState } from './config.js';
import { createConfigStore, migrateConfigFromJson } from './config-store.js';
import {
  type SMSCancelQueueInput,
  type SMSCancelQueueListInput,
} from './sms-cancel-queue.js';
import { type ApiRequestInput, requestAsset, requestJSON, testConnection } from './api-proxy.js';
import {
  applyConfigPatch,
  getConfigStore,
  publicConfig,
  readConfig,
  setConfigStore,
  testConfigFromEnv,
  writeConfig,
  type ClientConfigPatch,
} from './config-service.js';
import { errorMessage } from './errors.js';
import { serviceStatus, startLocalService, stopLocalService } from './local-service.js';
import {
  startOpenAIPhoneBridge,
  stopOpenAIPhoneBridge,
  waitForOpenAIPhoneCheck,
  type OpenAIPhoneCheckInput,
} from './openai-phone-bridge.js';
import {
  closeSMSCancelQueue,
  initSMSCancelQueue,
  setSMSCancelQueuePollInterval,
  smsCancelQueueEnqueue,
  smsCancelQueueList,
  smsCancelQueueRemove,
  smsCancelQueueRetry,
  smsCancelQueueStatus,
} from './sms-cancel-queue-ipc.js';
import {
  createSMSPlatformHandlers,
  type SMSBowerNumberInput,
  type SMSBowerPriceInput,
  type SMSBowerSetStatusInput,
  type SMSPlatformProviderInput,
} from './sms-platform-ipc.js';

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
const electronDir = dirname(fileURLToPath(import.meta.url));
const appRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
const smsPlatform = createSMSPlatformHandlers(safeStorage);

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
  const configStore = await createConfigStore(configStorePath(), app.getPath('userData'));
  setConfigStore(configStore);
  migrateConfigFromJson(configStore, configPath());
  const testConfig = testConfigFromEnv();
  if (testConfig) {
    const next = applyConfigPatch(readConfig(), testConfig);
    writeConfig(next);
  }
  const config = readConfig();
  if (config.mode === 'local' && config.autoStartLocalService) await startLocalService();
  await initSMSCancelQueue(smsPlatform.cancelSMSQueueItem, config);
  ipcMain.handle('wa-config:get', () => publicConfig());
  ipcMain.handle('wa-config:set', (_event, input: ClientConfigPatch) => {
    const next = applyConfigPatch(readConfig(), input);
    writeConfig(next);
    setSMSCancelQueuePollInterval(next.smsCancelQueuePollIntervalSeconds);
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
  ipcMain.handle('sms-platform:status', () => smsPlatform.status());
  ipcMain.handle('sms-platform:balance', () => smsPlatform.balance());
  ipcMain.handle('sms-platform:countries', (_event, input?: SMSPlatformProviderInput) => smsPlatform.countries(input));
  ipcMain.handle('sms-platform:prices', (_event, input?: SMSBowerPriceInput) => smsPlatform.prices(input));
  ipcMain.handle('sms-platform:number', (_event, input?: SMSBowerNumberInput) => smsPlatform.number(input));
  ipcMain.handle('sms-platform:get-status', (_event, id: string) => smsPlatform.getStatus(id));
  ipcMain.handle('sms-platform:set-status', (_event, input: SMSBowerSetStatusInput) => smsPlatform.setStatus(input));
  ipcMain.handle('sms-cancel-queue:status', () => smsCancelQueueStatus());
  ipcMain.handle('sms-cancel-queue:list', (_event, input?: SMSCancelQueueListInput) => smsCancelQueueList(input));
  ipcMain.handle('sms-cancel-queue:enqueue', (_event, input: SMSCancelQueueInput) => smsCancelQueueEnqueue(input));
  ipcMain.handle('sms-cancel-queue:retry', (_event, id: string) => smsCancelQueueRetry(id));
  ipcMain.handle('sms-cancel-queue:remove', (_event, id: string) => smsCancelQueueRemove(id));
  ipcMain.handle('smsbower:status', () => smsPlatform.status());
  ipcMain.handle('smsbower:balance', () => smsPlatform.balance());
  ipcMain.handle('smsbower:countries', (_event, input?: SMSPlatformProviderInput) => smsPlatform.countries(input));
  ipcMain.handle('smsbower:prices', (_event, input?: SMSBowerPriceInput) => smsPlatform.prices(input));
  ipcMain.handle('smsbower:number', (_event, input?: SMSBowerNumberInput) => smsPlatform.number(input));
  ipcMain.handle('smsbower:get-status', (_event, id: string) => smsPlatform.getStatus(id));
  ipcMain.handle('smsbower:set-status', (_event, input: SMSBowerSetStatusInput) => smsPlatform.setStatus(input));
  createWindow();
});

app.on('window-all-closed', () => {
  stopLocalService();
  stopOpenAIPhoneBridge();
  closeSMSCancelQueue();
  const configStore = getConfigStore();
  setConfigStore(null);
  configStore?.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
