import { contextBridge, ipcRenderer } from 'electron';

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
  waService: {
    status: () => ipcRenderer.invoke('wa-service:status'),
    start: () => ipcRenderer.invoke('wa-service:start'),
    stop: () => ipcRenderer.invoke('wa-service:stop'),
  },
};

contextBridge.exposeInMainWorld('waDesktop', api);
