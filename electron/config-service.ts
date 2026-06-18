import { app, safeStorage } from 'electron';
import {
  defaultConfig,
  getPassword as decodePassword,
  normalizeConfig as normalizeStoredConfig,
  normalizeSMSBowerConfig,
  parseTestConfig,
  publicConfig as toPublicConfig,
  setHeroSMSApiKey as applyHeroSMSApiKey,
  setSMSBowerApiKey as applySMSBowerApiKey,
  setPassword as applyPassword,
  type ClientConfig,
  type StoredConfig,
} from './config.js';
import { ConfigStore } from './config-store.js';

export type ClientConfigPatch = Partial<ClientConfig> & { password?: string; smsbowerApiKey?: string; heroSMSApiKey?: string };

let configStore: ConfigStore | null = null;

export function setConfigStore(store: ConfigStore | null) {
  configStore = store;
}

export function getConfigStore() {
  return configStore;
}

export function testConfigFromEnv(): ClientConfigPatch | null {
  return parseTestConfig(process.env.WA_APP_ELECTRON_TEST_CONFIG);
}

export function readConfig(): StoredConfig {
  return configStore?.load() ?? defaultConfig(app.getPath('userData'));
}

export function normalizeConfig(config: StoredConfig): StoredConfig {
  return normalizeStoredConfig(config, app.getPath('userData'));
}

export function publicConfig(config = readConfig()): ClientConfig {
  return toPublicConfig(config);
}

export function writeConfig(next: StoredConfig) {
  configStore?.save(next);
}

export function setPassword(config: StoredConfig, password?: string) {
  return applyPassword(config, password, safeStorage);
}

export function getPassword(config = readConfig()) {
  return decodePassword(config, safeStorage);
}

export function applyConfigPatch(previous: StoredConfig, patch?: ClientConfigPatch) {
  if (!patch) return normalizeConfig(previous);
  const merged = normalizeConfig({
    ...previous,
    smsProvider: patch.smsProvider ?? previous.smsProvider,
    ...patch,
    smsbower: normalizeSMSBowerConfig({ ...previous.smsbower, ...patch.smsbower }),
  });
  return normalizeConfig(applyHeroSMSApiKey(applySMSBowerApiKey(setPassword(merged, patch.password), patch.smsbowerApiKey, safeStorage), patch.heroSMSApiKey, safeStorage));
}
