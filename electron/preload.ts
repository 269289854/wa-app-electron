import { contextBridge, ipcRenderer } from 'electron';

let smsbowerTaskSeq = 0;

function startRegistrationTask(input?: unknown) {
  const requestId = `smsbower-task-${Date.now()}-${++smsbowerTaskSeq}`;
  return new Promise((resolve, reject) => {
    let accepted = false;
    const cleanup = () => {
      clearTimeout(availabilityTimer);
      window.removeEventListener('smsbower-registration-task-accepted', onAccepted);
      window.removeEventListener('smsbower-registration-task-result', onResult);
    };
    const availabilityTimer = window.setTimeout(() => {
      if (!accepted) {
        cleanup();
        reject(new Error('SMSBower registration task handler is not available'));
      }
    }, 5000);
    const onAccepted = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string }>).detail;
      if (detail?.requestId !== requestId) return;
      accepted = true;
      clearTimeout(availabilityTimer);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; result?: unknown; error?: string }>).detail;
      if (detail?.requestId !== requestId) return;
      cleanup();
      if (detail.error) reject(new Error(detail.error));
      else resolve(detail.result);
    };
    window.addEventListener('smsbower-registration-task-accepted', onAccepted);
    window.addEventListener('smsbower-registration-task-result', onResult);
    window.dispatchEvent(new CustomEvent('smsbower-registration-task-start', { detail: { requestId, input } }));
  });
}

function stopRegistrationTask() {
  window.dispatchEvent(new CustomEvent('smsbower-registration-task-stop'));
  return Promise.resolve();
}

const api = {
  waConfig: {
    get: () => ipcRenderer.invoke('wa-config:get'),
    set: (input: unknown) => ipcRenderer.invoke('wa-config:set', input),
    testConnection: (input?: unknown) => ipcRenderer.invoke('wa-config:test', input),
  },
  windowControl: {
    minimize: () => ipcRenderer.invoke('window-control:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window-control:toggle-maximize'),
    close: () => ipcRenderer.invoke('window-control:close'),
    isMaximized: () => ipcRenderer.invoke('window-control:is-maximized'),
  },
  waApi: {
    request: (input: unknown) => ipcRenderer.invoke('wa-api:request', input),
    fetchAsset: (path: string) => ipcRenderer.invoke('wa-api:asset', path),
  },
  openAIPhone: {
    bridgeStatus: () => ipcRenderer.invoke('openai-phone:bridge-status'),
    check: (input: unknown) => ipcRenderer.invoke('openai-phone:check', input),
  },
  waService: {
    status: () => ipcRenderer.invoke('wa-service:status'),
    start: () => ipcRenderer.invoke('wa-service:start'),
    stop: () => ipcRenderer.invoke('wa-service:stop'),
  },
  smsPlatform: {
    status: () => ipcRenderer.invoke('sms-platform:status'),
    getBalance: () => ipcRenderer.invoke('sms-platform:balance'),
    getCountries: (input?: unknown) => ipcRenderer.invoke('sms-platform:countries', input),
    getPrices: (input?: unknown) => ipcRenderer.invoke('sms-platform:prices', input),
    getNumber: (input?: unknown) => ipcRenderer.invoke('sms-platform:number', input),
    getStatus: (id: string) => ipcRenderer.invoke('sms-platform:get-status', id),
    setStatus: (input: unknown) => ipcRenderer.invoke('sms-platform:set-status', input),
    startRegistrationTask,
    stopRegistrationTask,
  },
  smsCancelQueue: {
    status: () => ipcRenderer.invoke('sms-cancel-queue:status'),
    list: (input?: unknown) => ipcRenderer.invoke('sms-cancel-queue:list', input),
    enqueue: (input: unknown) => ipcRenderer.invoke('sms-cancel-queue:enqueue', input),
    retry: (id: string) => ipcRenderer.invoke('sms-cancel-queue:retry', id),
    remove: (id: string) => ipcRenderer.invoke('sms-cancel-queue:remove', id),
  },
};

const legacySMSBower = api.smsPlatform;

contextBridge.exposeInMainWorld('waDesktop', api);
contextBridge.exposeInMainWorld('waConfig', api.waConfig);
contextBridge.exposeInMainWorld('waApi', api.waApi);
contextBridge.exposeInMainWorld('openAIPhone', api.openAIPhone);
contextBridge.exposeInMainWorld('waService', api.waService);
contextBridge.exposeInMainWorld('smsPlatform', api.smsPlatform);
contextBridge.exposeInMainWorld('smsCancelQueue', api.smsCancelQueue);
contextBridge.exposeInMainWorld('smsbower', legacySMSBower);
