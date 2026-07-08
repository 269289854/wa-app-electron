import { describe, expect, it } from 'vitest';
import {
  deriveNationalNumber,
  filterOpenAIPhonePickerAccounts,
  normalizeOpenAIPhonePickerAccount,
  type OpenAIPhonePickerAccount,
} from './openai-phone-picker.js';

describe('OpenAI phone picker account normalization', () => {
  it('normalizes complete WA account phone fields', () => {
    expect(normalizeOpenAIPhonePickerAccount({
      wa_account_id: 'waacc_1',
      display_name: '7541944532',
      status: '正常',
      phone: {
        e164_number: '+447541944532',
        national_number: '7541944532',
        country_calling_code: '44',
        country_iso2: 'GB',
      },
      audit: { updated_at: '2026-07-07T16:01:48Z' },
    })).toEqual({
      accountId: 'waacc_1',
      displayName: '7541944532',
      status: '正常',
      e164Number: '+447541944532',
      nationalNumber: '7541944532',
      countryCallingCode: '44',
      countryIso2: 'GB',
      updatedAt: '2026-07-07T16:01:48Z',
    });
  });

  it('derives a national number and fallback display name when optional fields are missing', () => {
    expect(normalizeOpenAIPhonePickerAccount({
      wa_account_id: 'waacc_2',
      phone: {
        e164_number: '+573181593957',
        country_calling_code: '57',
        country_iso2: 'co',
      },
    })).toMatchObject({
      accountId: 'waacc_2',
      displayName: '3181593957',
      e164Number: '+573181593957',
      nationalNumber: '3181593957',
      countryCallingCode: '57',
      countryIso2: 'CO',
    });
  });

  it('searches display name, phone, calling code, country, and account id', () => {
    const accounts: OpenAIPhonePickerAccount[] = [
      normalizeOpenAIPhonePickerAccount({
        wa_account_id: 'waacc_gb',
        display_name: 'London',
        phone: { e164_number: '+447541944532', country_calling_code: '44', country_iso2: 'GB' },
      }),
      normalizeOpenAIPhonePickerAccount({
        wa_account_id: 'waacc_co',
        display_name: 'Bogota',
        phone: { e164_number: '+573181593957', country_calling_code: '57', country_iso2: 'CO' },
      }),
    ].filter((account): account is NonNullable<typeof account> => Boolean(account));

    expect(filterOpenAIPhonePickerAccounts(accounts, 'london').map((account) => account.accountId)).toEqual(['waacc_gb']);
    expect(filterOpenAIPhonePickerAccounts(accounts, '3181').map((account) => account.accountId)).toEqual(['waacc_co']);
    expect(filterOpenAIPhonePickerAccounts(accounts, '44').map((account) => account.accountId)).toEqual(['waacc_gb']);
    expect(filterOpenAIPhonePickerAccounts(accounts, 'CO').map((account) => account.accountId)).toEqual(['waacc_co']);
    expect(filterOpenAIPhonePickerAccounts(accounts, 'waacc_gb').map((account) => account.accountId)).toEqual(['waacc_gb']);
  });

  it('strips the calling code from E164 values', () => {
    expect(deriveNationalNumber('+447541944532', '44')).toBe('7541944532');
  });
});
