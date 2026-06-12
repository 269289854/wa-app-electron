export const smsbowerEndpoint = 'https://smsbower.page/stubs/handler_api.php';
export const smsbowerWhatsAppService = 'wa';

export type SMSBowerNumber = {
  activationId: string;
  phone: string;
};

export type SMSBowerStatus =
  | { status: 'waiting'; raw: string }
  | { status: 'ok'; code: string; raw: string }
  | { status: 'cancelled'; raw: string }
  | { status: 'error'; error: string; raw: string };

export type SMSBowerPrice = {
  country: string;
  service: string;
  cost: number;
  count: number;
};

export type SMSBowerClientOptions = {
  apiKey: string;
  fetcher?: typeof fetch;
};

export class SMSBowerClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: SMSBowerClientOptions) {
    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher || fetch;
  }

  getBalance() {
    return this.requestText({ action: 'getBalance' });
  }

  async getCountries() {
    return this.requestJSON<Record<string, unknown>>({ action: 'getCountries' });
  }

  async getPrices(country: string, service = smsbowerWhatsAppService) {
    const data = await this.requestJSON<unknown>({ action: 'getPrices', country, service });
    return normalizePrices(data, country, service);
  }

  async getNumber(input: { country: string; maxPrice: number; service?: string }) {
    const raw = await this.requestText({
      action: 'getNumber',
      service: input.service || smsbowerWhatsAppService,
      country: input.country,
      maxPrice: String(input.maxPrice),
    });
    return parseNumberResponse(raw);
  }

  async getStatus(id: string) {
    const raw = await this.requestText({ action: 'getStatus', id });
    return parseStatusResponse(raw);
  }

  setStatus(id: string, status: number) {
    return this.requestText({ action: 'setStatus', id, status: String(status) });
  }

  private async requestJSON<T>(params: Record<string, string>) {
    const text = await this.requestText(params);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`SMSBower returned non-JSON response: ${text}`);
    }
  }

  private async requestText(params: Record<string, string>) {
    const url = new URL(smsbowerEndpoint);
    url.searchParams.set('api_key', this.apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.fetcher(url);
    const text = (await response.text()).trim();
    if (!response.ok) throw new Error(`SMSBower HTTP ${response.status}: ${text}`);
    if (smsbowerErrorMessage(text)) throw new Error(smsbowerErrorMessage(text));
    return text;
  }
}

export function parseNumberResponse(raw: string): SMSBowerNumber {
  const parts = raw.trim().split(':');
  if (parts[0] !== 'ACCESS_NUMBER' || !parts[1] || !parts[2]) {
    throw new Error(`Unexpected SMSBower number response: ${raw}`);
  }
  return { activationId: parts[1], phone: parts[2] };
}

export function parseStatusResponse(raw: string): SMSBowerStatus {
  const trimmed = raw.trim();
  if (trimmed.startsWith('STATUS_OK:')) return { status: 'ok', code: trimmed.slice('STATUS_OK:'.length), raw: trimmed };
  if (trimmed === 'STATUS_WAIT_CODE' || trimmed === 'STATUS_WAIT_RETRY') return { status: 'waiting', raw: trimmed };
  if (trimmed === 'STATUS_CANCEL') return { status: 'cancelled', raw: trimmed };
  return { status: 'error', error: smsbowerErrorMessage(trimmed) || trimmed, raw: trimmed };
}

export function normalizePrices(data: unknown, requestedCountry: string, requestedService: string): SMSBowerPrice[] {
  const prices: SMSBowerPrice[] = [];
  collectPrices(data, prices, requestedCountry, requestedService);
  return prices;
}

function collectPrices(value: unknown, prices: SMSBowerPrice[], country: string, service: string, requestedService = service) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectPrices(item, prices, country, service, requestedService);
    return;
  }
  const record = value as Record<string, unknown>;
  if ('cost' in record || 'price' in record) {
    const cost = Number(record.cost ?? record.price);
    const count = Number(record.count ?? record.quantity ?? 0);
    if (Number.isFinite(cost)) prices.push({ country, service, cost, count: Number.isFinite(count) ? count : 0 });
  }
  for (const [key, nested] of Object.entries(record)) {
    const nextCountry = /^\d+$/.test(key) ? key : country;
    if (key !== requestedService && key !== nextCountry && hasPriceShape(nested)) continue;
    const nextService = key === requestedService ? key : service;
    collectPrices(nested, prices, nextCountry, nextService, requestedService);
  }
}

function hasPriceShape(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if ('cost' in record || 'price' in record) return true;
  return Object.values(record).some((nested) => Boolean(nested && typeof nested === 'object' && ('cost' in (nested as Record<string, unknown>) || 'price' in (nested as Record<string, unknown>))));
}

function smsbowerErrorMessage(raw: string) {
  const errors: Record<string, string> = {
    BAD_KEY: 'SMSBower API key is invalid',
    NO_BALANCE: 'SMSBower balance is insufficient',
    NO_NUMBERS: 'SMSBower has no numbers for this request',
    NO_ACTIVATION: 'SMSBower activation was not found',
    BAD_SERVICE: 'SMSBower service is invalid',
    BAD_STATUS: 'SMSBower status is invalid',
    BAD_ACTION: 'SMSBower action is invalid',
  };
  return errors[raw] || '';
}
