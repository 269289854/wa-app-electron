import { describe, expect, it } from 'vitest';
import { normalizePrices, parseNumberResponse, parseStatusResponse } from './smsbower.js';

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
});
