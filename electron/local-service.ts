import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { activeBaseUrl, setLocalBaseUrlProvider } from './api-proxy.js';
import { getPassword, readConfig, writeConfig } from './config-service.js';

let localProcess: ChildProcessWithoutNullStreams | null = null;
let localPort = 0;

setLocalBaseUrlProvider(() => (localPort ? `http://127.0.0.1:${localPort}` : ''));

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
  const serviceRoot = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'wa-app-service')
    : join(app.getAppPath(), 'resources', 'wa-app-service');
  const archDir = process.platform === 'win32'
    ? process.arch === 'ia32'
      ? 'win-ia32'
      : 'win-x64'
    : process.platform;
  const archPath = join(serviceRoot, archDir, name);
  return existsSync(archPath) ? archPath : join(serviceRoot, name);
}

export async function startLocalService() {
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

export function stopLocalService() {
  if (localProcess) {
    localProcess.kill();
    localProcess = null;
    localPort = 0;
  }
  return serviceStatus();
}

export function serviceStatus() {
  const config = readConfig();
  return {
    mode: config.mode,
    running: Boolean(localProcess),
    baseUrl: activeBaseUrl(config),
    localServiceAvailable: existsSync(serviceExecutablePath()),
  };
}
