import { describe, expect, it } from 'vitest';
import { normalizePhoneInput } from './phone-input';

describe('normalizePhoneInput', () => {
  it('uses the provided country calling code before guessing from the phone field', () => {
    expect(normalizePhoneInput('3225115858', '57')).toMatchObject({
      region: 'CO',
      phone: '3225115858',
      e164_number: '+573225115858',
      country_calling_code: '57',
      country_iso2: 'CO',
    });
  });

  it('recognizes full international numbers when no calling code is provided', () => {
    expect(normalizePhoneInput('573243651489', '')).toMatchObject({
      region: 'CO',
      phone: '3243651489',
      e164_number: '+573243651489',
      country_calling_code: '57',
      country_iso2: 'CO',
    });
  });

  it('normalizes plus-prefixed international numbers', () => {
    expect(normalizePhoneInput('+447523175819', '')).toMatchObject({
      region: 'GB',
      phone: '7523175819',
      e164_number: '+447523175819',
      country_calling_code: '44',
      country_iso2: 'GB',
    });
  });
});
