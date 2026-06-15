import { describe, expect, it } from 'vitest';
import { SMSBowerClient, normalizePrices, parseNumberResponse, parseStatusResponse } from './smsbower.js';

describe('SMSBower helpers', () => {
  it('parses ACCESS_NUMBER responses', () => {
    expect(parseNumberResponse('ACCESS_NUMBER:12345:573225115858')).toEqual({
      activationId: '12345',
      phone: '573225115858',
    });
  });

  it('parses activation status responses', () => {
    expect(parseStatusResponse('STATUS_WAIT_CODE')).toEqual({ status: 'waiting', raw: 'STATUS_WAIT_CODE' });
    expect(parseStatusResponse('STATUS_OK:839201')).toEqual({ status: 'ok', code: '839201', raw: 'STATUS_OK:839201' });
    expect(parseStatusResponse('NO_ACTIVATION')).toEqual({
      status: 'error',
      error: 'SMSBower activation was not found',
      raw: 'NO_ACTIVATION',
    });
    expect(parseStatusResponse('NO_NUMBERS')).toEqual({
      status: 'error',
      error: 'SMSBower has no numbers for this request',
      raw: 'NO_NUMBERS',
    });
    expect(parseStatusResponse('NO_BALANCE')).toEqual({
      status: 'error',
      error: 'SMSBower balance is insufficient',
      raw: 'NO_BALANCE',
    });
  });

  it('normalizes nested price responses', () => {
    const prices = normalizePrices({ 187: { wa: { cost: '0.42', count: '7' } } }, '187', 'wa');
    expect(prices).toEqual([{ country: '187', service: 'wa', cost: 0.42, count: 7 }]);
  });

  it('normalizes getPricesV3 provider responses', () => {
    const prices = normalizePrices({
      16: {
        wa: {
          3160: { price: '0.482', count: '16344' },
          3109: { cost: '0.399', count: '3', provider_id: '3109' },
        },
      },
    }, '16', 'wa');
    expect(prices.sort((left, right) => left.cost - right.cost)).toEqual([
      { country: '16', service: 'wa', cost: 0.399, count: 3, providerId: '3109' },
      { country: '16', service: 'wa', cost: 0.482, count: 16344, providerId: '3160' },
    ]);
  });

  it('keeps provider ids from id fields', () => {
    const prices = normalizePrices({ 16: { wa: [{ id: 1015, price: '1.188', stock: '22' }] } }, '16', 'wa');
    expect(prices).toEqual([{ country: '16', service: 'wa', cost: 1.188, count: 22, providerId: '1015' }]);
  });

  it('ignores prices for non-requested services', () => {
    const prices = normalizePrices({ 187: { wa: { cost: '0.42', count: '7' }, tg: { cost: '0.01', count: '99' } } }, '187', 'wa');
    expect(prices).toEqual([{ country: '187', service: 'wa', cost: 0.42, count: 7 }]);
  });

  it('normalizes alternative stock field names', () => {
    expect(normalizePrices({ 33: { wa: { cost: '0.38', qty: '4' } } }, '33', 'wa')).toEqual([
      { country: '33', service: 'wa', cost: 0.38, count: 4 },
    ]);
    expect(normalizePrices({ 33: { wa: { price: '0.39', stock: '2' } } }, '33', 'wa')).toEqual([
      { country: '33', service: 'wa', cost: 0.39, count: 2 },
    ]);
  });

  it('sends setStatus requests with the requested activation id and status', async () => {
    let requestedUrl = '';
    const client = new SMSBowerClient({
      apiKey: 'secret',
      fetcher: (async (url) => {
        requestedUrl = String(url);
        return new Response('ACCESS_CANCEL');
      }) as typeof fetch,
    });

    await expect(client.setStatus('12345', 8)).resolves.toBe('ACCESS_CANCEL');

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('action')).toBe('setStatus');
    expect(url.searchParams.get('id')).toBe('12345');
    expect(url.searchParams.get('status')).toBe('8');
    expect(url.searchParams.get('api_key')).toBe('secret');
  });

  it('sends getNumber requests with price bounds and provider ids', async () => {
    let requestedUrl = '';
    const client = new SMSBowerClient({
      apiKey: 'secret',
      fetcher: (async (url) => {
        requestedUrl = String(url);
        return new Response('ACCESS_NUMBER:12345:447523175819');
      }) as typeof fetch,
    });

    await expect(client.getNumber({ country: '16', minPrice: 0.1, maxPrice: 0.5, providerIds: ['3160', '3109'] })).resolves.toEqual({
      activationId: '12345',
      phone: '447523175819',
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('action')).toBe('getNumber');
    expect(url.searchParams.get('country')).toBe('16');
    expect(url.searchParams.get('service')).toBe('wa');
    expect(url.searchParams.get('minPrice')).toBe('0.1');
    expect(url.searchParams.get('maxPrice')).toBe('0.5');
    expect(url.searchParams.get('providerIds')).toBe('3160,3109');
  });
});
