import { SMSBowerClient, smsbowerEndpoint, smsbowerWhatsAppService, type SMSBowerPrice, type SMSBowerStatus } from './smsbower.js';

export type SMSProvider = 'smsbower' | 'hero-sms';

export type SMSPlatformClient = {
  provider: SMSProvider;
  label: string;
  getBalance(): Promise<string>;
  getCountries(): Promise<unknown>;
  getPrices(country: string, service?: string): Promise<SMSBowerPrice[]>;
  getNumber(input: { country: string; maxPrice: number; minPrice?: number; providerIds?: string[]; service?: string }): Promise<{ activationId: string; phone: string }>;
  getStatus(id: string): Promise<SMSBowerStatus>;
  setStatus(id: string, status: number): Promise<string>;
};

export const smsProviderLabels: Record<SMSProvider, string> = {
  smsbower: 'SMSBower',
  'hero-sms': 'Hero-SMS',
};

export const heroSMSEndpoint = 'https://hero-sms.com/stubs/handler_api.php';

export function normalizeSMSProvider(value: unknown): SMSProvider {
  return value === 'hero-sms' ? 'hero-sms' : 'smsbower';
}

export function createSMSPlatformClient(input: { provider: SMSProvider; apiKey: string; fetcher?: typeof fetch }): SMSPlatformClient {
  const endpoint = input.provider === 'hero-sms' ? heroSMSEndpoint : smsbowerEndpoint;
  const client = new SMSBowerClient({
    apiKey: input.apiKey,
    endpoint,
    label: smsProviderLabels[input.provider],
    fetcher: input.fetcher,
  });
  return {
    provider: input.provider,
    label: smsProviderLabels[input.provider],
    getBalance: () => client.getBalance(),
    getCountries: () => client.getCountries(),
    getPrices: (country, service = smsbowerWhatsAppService) => client.getPrices(country, service),
    getNumber: (numberInput) => client.getNumber(numberInput),
    getStatus: (id) => client.getStatus(id),
    setStatus: (id, status) => client.setStatus(id, status),
  };
}
