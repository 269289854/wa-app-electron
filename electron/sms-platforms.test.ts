import { describe, expect, it } from 'vitest';
import { createSMSPlatformClient, heroSMSEndpoint, normalizeSMSProvider, smsProviderLabels } from './sms-platforms.js';

describe('SMS platform adapters', () => {
  it('normalizes provider ids and labels', () => {
    expect(normalizeSMSProvider('hero-sms')).toBe('hero-sms');
    expect(normalizeSMSProvider('unknown')).toBe('smsbower');
    expect(smsProviderLabels['hero-sms']).toBe('Hero-SMS');
  });

  it('uses the Hero-SMS endpoint with its SMS-Activate compatible number parameters', async () => {
    let requestedUrl = '';
    const client = createSMSPlatformClient({
      provider: 'hero-sms',
      apiKey: 'hero-secret',
      fetcher: (async (url) => {
        requestedUrl = String(url);
        return new Response('ACCESS_NUMBER:hero-act-1:573244521293');
      }) as typeof fetch,
    });

    await expect(client.getNumber({ country: '187', minPrice: 0.1, maxPrice: 0.5, providerIds: ['p1'] })).resolves.toEqual({
      activationId: 'hero-act-1',
      phone: '573244521293',
    });

    const url = new URL(requestedUrl);
    expect(`${url.origin}${url.pathname}`).toBe(heroSMSEndpoint);
    expect(url.searchParams.get('api_key')).toBe('hero-secret');
    expect(url.searchParams.get('action')).toBe('getNumber');
    expect(url.searchParams.get('service')).toBe('wa');
    expect(url.searchParams.get('country')).toBe('187');
    expect(url.searchParams.get('maxPrice')).toBe('0.5');
  });

  it('uses getPrices for Hero-SMS prices because getPricesV3 returns BAD_ACTION', async () => {
    let requestedUrl = '';
    const client = createSMSPlatformClient({
      provider: 'hero-sms',
      apiKey: 'hero-secret',
      fetcher: (async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({ 187: { wa: { cost: 2.5, count: 554358, physicalCount: 169 } } }));
      }) as typeof fetch,
    });

    await expect(client.getPrices('187', 'wa')).resolves.toEqual([
      { country: '187', service: 'wa', cost: 2.5, count: 554358 },
    ]);

    const url = new URL(requestedUrl);
    expect(`${url.origin}${url.pathname}`).toBe(heroSMSEndpoint);
    expect(url.searchParams.get('api_key')).toBe('hero-secret');
    expect(url.searchParams.get('action')).toBe('getPrices');
    expect(url.searchParams.get('service')).toBe('wa');
    expect(url.searchParams.get('country')).toBe('187');
  });

  it('normalizes Hero-SMS status and cancel responses', async () => {
    const responses = ['STATUS_WAIT_CODE', 'STATUS_OK:123456', 'ACCESS_CANCEL'];
    const client = createSMSPlatformClient({
      provider: 'hero-sms',
      apiKey: 'hero-secret',
      fetcher: (async () => new Response(responses.shift() || 'NO_ACTIVATION')) as typeof fetch,
    });

    await expect(client.getStatus('hero-act-1')).resolves.toEqual({ status: 'waiting', raw: 'STATUS_WAIT_CODE' });
    await expect(client.getStatus('hero-act-1')).resolves.toEqual({ status: 'ok', code: '123456', raw: 'STATUS_OK:123456' });
    await expect(client.setStatus('hero-act-1', 8)).resolves.toBe('ACCESS_CANCEL');
  });

  it('maps Hero-SMS common API errors with the provider label', async () => {
    const client = createSMSPlatformClient({
      provider: 'hero-sms',
      apiKey: 'bad',
      fetcher: (async () => new Response('NO_BALANCE')) as typeof fetch,
    });

    await expect(client.getBalance()).rejects.toThrow('Hero-SMS balance is insufficient');
  });
});
