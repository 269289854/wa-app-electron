import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config.js';
import { buildLocalServiceEnv } from './local-service-env.js';

describe('local service env', () => {
  it('injects Play Integrity API settings into the bundled service process', () => {
    const config = {
      ...defaultConfig('C:/data'),
      localDataDir: 'C:/wa/data',
      localCommonProxy: 'socks5://127.0.0.1:10808',
      localDeviceProfilesFile: 'C:/wa/device_profiles.json',
      localPlayIntegrityAPIUrl: 'https://pi.example.com',
    };

    const env = buildLocalServiceEnv({ PATH: 'mock-path' }, config, {
      port: 18181,
      password: 'secret',
      playIntegrityAPIToken: 'pi-token',
    });

    expect(env).toMatchObject({
      PATH: 'mock-path',
      WA_APP_DASHBOARD_HTTP_ADDR: '127.0.0.1:18181',
      WA_APP_DATA_DIR: 'C:/wa/data',
      WA_APP_AUTH_PASSWORD: 'secret',
      WA_COMMON_PROXY: 'socks5://127.0.0.1:10808',
      WA_APP_DEVICE_PROFILES_FILE: 'C:/wa/device_profiles.json',
      WA_APP_PLAY_INTEGRITY_API_URL: 'https://pi.example.com',
      WA_APP_PLAY_INTEGRITY_API_TOKEN: 'pi-token',
    });
  });
});
