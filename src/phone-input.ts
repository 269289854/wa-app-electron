import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { PhoneInput } from './api';

export function normalizePhoneInput(phone: string, countryCallingCode: string): PhoneInput | null {
  const raw = phone.trim();
  const digits = phone.replace(/\D+/g, '');
  const callingCode = countryCallingCode.replace(/\D+/g, '');
  if (!digits) return null;

  const candidates = callingCode
    ? [`+${digits.startsWith(callingCode) ? digits : `${callingCode}${digits}`}`]
    : [raw.startsWith('+') ? raw : `+${digits}`];

  for (const candidate of candidates) {
    const parsed = parsePhoneNumberFromString(candidate);
    if (!parsed?.country || !parsed.countryCallingCode || !parsed.nationalNumber || !parsed.isPossible()) continue;
    return {
      region: parsed.country,
      phone: parsed.nationalNumber,
      e164_number: parsed.number,
      country_calling_code: parsed.countryCallingCode,
      country_iso2: parsed.country,
    };
  }
  return null;
}
