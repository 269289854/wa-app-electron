import type { StoredConfig } from './config.js';

export function buildLocalServiceEnv(
  baseEnv: NodeJS.ProcessEnv,
  config: StoredConfig,
  input: { port: number; password: string; playIntegrityAPIToken: string },
) {
  return {
    ...baseEnv,
    WA_APP_DASHBOARD_HTTP_ADDR: `127.0.0.1:${input.port}`,
    WA_APP_LISTEN_ADDR: '127.0.0.1:0',
    WA_APP_DATA_DIR: config.localDataDir,
    WA_APP_AUTH_PASSWORD: input.password,
    WA_COMMON_PROXY: config.localCommonProxy,
    WA_APP_DEVICE_PROFILES_FILE: config.localDeviceProfilesFile,
    WA_APP_PLAY_INTEGRITY_API_URL: config.localPlayIntegrityAPIUrl,
    WA_APP_PLAY_INTEGRITY_API_TOKEN: input.playIntegrityAPIToken,
  };
}
