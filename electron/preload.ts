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
  smsbower: {
    status: () => ipcRenderer.invoke('smsbower:status'),
    getBalance: () => ipcRenderer.invoke('smsbower:balance'),
    getCountries: () => ipcRenderer.invoke('smsbower:countries'),
    getPrices: (input?: unknown) => ipcRenderer.invoke('smsbower:prices', input),
    getNumber: (input?: unknown) => ipcRenderer.invoke('smsbower:number', input),
    getStatus: (id: string) => ipcRenderer.invoke('smsbower:get-status', id),
    setStatus: (input: unknown) => ipcRenderer.invoke('smsbower:set-status', input),
    startRegistrationTask,
    stopRegistrationTask,
  },
};

contextBridge.exposeInMainWorld('waDesktop', api);
contextBridge.exposeInMainWorld('waConfig', api.waConfig);
contextBridge.exposeInMainWorld('waApi', api.waApi);
contextBridge.exposeInMainWorld('openAIPhone', api.openAIPhone);
contextBridge.exposeInMainWorld('waService', api.waService);
contextBridge.exposeInMainWorld('smsbower', api.smsbower);
