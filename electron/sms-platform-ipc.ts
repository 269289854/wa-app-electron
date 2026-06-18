import {
  getHeroSMSApiKey as decodeHeroSMSApiKey,
  getSMSBowerApiKey as decodeSMSBowerApiKey,
} from './config.js';
import { smsbowerWhatsAppService } from './smsbower.js';
import { publicConfig, readConfig } from './config-service.js';
import { createSMSPlatformClient, normalizeSMSProvider, smsProviderLabels, type SMSProvider } from './sms-platforms.js';

export type SMSPlatformProviderInput = { provider?: unknown };
export type SMSBowerPriceInput = SMSPlatformProviderInput & { country?: string };
export type SMSBowerNumberInput = SMSPlatformProviderInput & { country?: string; minPrice?: number; maxPrice?: number; providerIds?: string[] };
export type SMSBowerSetStatusInput = { id: string; status: number };

const mockSMSBowerEnabled = process.env.WA_APP_ELECTRON_MOCK_SMSBOWER === '1';
let mockSMSBowerStatusCalls = 0;

export function createSMSPlatformHandlers(safeStorage: Electron.SafeStorage) {
  const storage = safeStorage;
  function client(config = readConfig(), providerOverride?: SMSProvider) {
    const provider = providerOverride || config.smsProvider;
    const apiKey = provider === 'hero-sms' ? decodeHeroSMSApiKey(config, storage) : decodeSMSBowerApiKey(config, storage);
    const label = smsProviderLabels[provider];
    if (!apiKey) throw new Error(`${label} API key is not configured`);
    return createSMSPlatformClient({ provider, apiKey });
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
    return mockSMSBowerEnabled ? '100.00' : client().getBalance();
  }

  function smsPlatformCountries(input?: SMSPlatformProviderInput) {
    if (mockSMSBowerEnabled) return mockSMSBowerCountries();
    const config = readConfig();
    const provider = input?.provider ? currentSMSProvider(config, input.provider) : currentSMSProvider(config);
    return client(config, provider).getCountries();
  }

  function smsPlatformPrices(input?: SMSBowerPriceInput) {
    if (mockSMSBowerEnabled) return mockSMSBowerPrices();
    const config = readConfig();
    const provider = input?.provider ? currentSMSProvider(config, input.provider) : currentSMSProvider(config);
    const country = input?.country || config.smsbower.country;
    const label = smsProviderLabels[provider];
    if (!country) throw new Error(`${label} country is not configured`);
    return client(config, provider).getPrices(country, smsbowerWhatsAppService);
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
    return client(config, provider).getNumber({ country, minPrice, maxPrice, providerIds: input?.providerIds, service: smsbowerWhatsAppService });
  }

  function smsPlatformGetStatus(id: string) {
    return mockSMSBowerEnabled ? mockSMSBowerStatus() : client().getStatus(id);
  }

  function smsPlatformSetStatus(input: SMSBowerSetStatusInput) {
    return mockSMSBowerEnabled ? mockSMSBowerSetStatus(input) : client().setStatus(input.id, input.status);
  }

  async function cancelSMSQueueItem(item: { provider: SMSProvider; activationId: string }) {
    if (mockSMSBowerEnabled) return mockSMSBowerSetStatus({ id: item.activationId, status: 8 });
    return client(readConfig(), item.provider).setStatus(item.activationId, 8);
  }

  return {
    status: smsPlatformStatus,
    balance: smsPlatformBalance,
    countries: smsPlatformCountries,
    prices: smsPlatformPrices,
    number: smsPlatformNumber,
    getStatus: smsPlatformGetStatus,
    setStatus: smsPlatformSetStatus,
    cancelSMSQueueItem,
  };
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
