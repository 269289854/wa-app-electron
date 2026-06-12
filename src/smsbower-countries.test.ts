import { describe, expect, it } from 'vitest';
import { countryDisplayName, filterSMSBowerCountries, normalizeSMSBowerCountries } from './smsbower-countries';

describe('SMSBower country helpers', () => {
  it('normalizes string record responses', () => {
    expect(normalizeSMSBowerCountries({ 57: 'Colombia' })).toEqual([
      { id: '57', name: 'Colombia', searchText: '57 colombia' },
    ]);
  });

  it('normalizes detailed record responses', () => {
    expect(normalizeSMSBowerCountries({ 57: { eng: 'Colombia' } })).toEqual([
      { id: '57', name: 'Colombia', searchText: '57 colombia' },
    ]);
  });

  it('prefers Chinese country names and keeps English searchable', () => {
    const countries = normalizeSMSBowerCountries({ 57: { chn: '哥伦比亚', eng: 'Colombia' } });
    expect(countries).toEqual([
      { id: '57', name: '哥伦比亚', searchText: '57 哥伦比亚 colombia' },
    ]);
    expect(filterSMSBowerCountries(countries, 'Colombia').map((country) => country.id)).toEqual(['57']);
    expect(filterSMSBowerCountries(countries, '哥伦比亚').map((country) => country.id)).toEqual(['57']);
  });

  it('normalizes array responses', () => {
    expect(normalizeSMSBowerCountries([{ id: 57, name: 'Colombia' }])).toEqual([
      { id: '57', name: 'Colombia', searchText: '57 colombia' },
    ]);
  });

  it('filters by country name and ID', () => {
    const countries = normalizeSMSBowerCountries({ 57: 'Colombia', 187: 'United States' });
    expect(filterSMSBowerCountries(countries, 'colo').map((country) => country.id)).toEqual(['57']);
    expect(filterSMSBowerCountries(countries, '187').map((country) => country.name)).toEqual(['United States']);
  });

  it('formats configured country IDs for display', () => {
    const countries = normalizeSMSBowerCountries({ 57: 'Colombia' });
    expect(countryDisplayName(countries, '57')).toBe('Colombia (ID: 57)');
    expect(countryDisplayName(countries, '999')).toBe('ID: 999');
  });
});
