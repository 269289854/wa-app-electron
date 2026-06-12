export type SMSBowerCountry = {
  id: string;
  name: string;
  searchText: string;
};

const nameKeys = ['name', 'eng', 'en', 'chn', 'cn', 'rus', 'ru', 'title', 'label'];

export function normalizeSMSBowerCountries(input: unknown): SMSBowerCountry[] {
  const countries: SMSBowerCountry[] = [];
  collectCountries(input, countries);
  return dedupeCountries(countries)
    .map((country) => ({ ...country, searchText: `${country.id} ${country.name}`.toLowerCase() }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function filterSMSBowerCountries(countries: SMSBowerCountry[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return countries;
  return countries.filter((country) => country.searchText.includes(normalized));
}

export function countryDisplayName(countries: SMSBowerCountry[], id: string) {
  const country = countries.find((item) => item.id === id);
  return country ? `${country.name} (ID: ${country.id})` : id ? `ID: ${id}` : '';
}

function collectCountries(input: unknown, countries: SMSBowerCountry[]) {
  if (!input) return;
  if (Array.isArray(input)) {
    for (const item of input) collectArrayCountry(item, countries);
    return;
  }
  if (typeof input !== 'object') return;
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedID = normalizeID(id);
    if (!normalizedID) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      countries.push({ id: normalizedID, name: String(value), searchText: '' });
    } else if (value && typeof value === 'object') {
      countries.push({ id: normalizedID, name: countryNameFromRecord(value as Record<string, unknown>, normalizedID), searchText: '' });
    }
  }
}

function collectArrayCountry(input: unknown, countries: SMSBowerCountry[]) {
  if (!input || typeof input !== 'object') return;
  const record = input as Record<string, unknown>;
  const id = normalizeID(record.id ?? record.country ?? record.country_id ?? record.key ?? record.value);
  if (!id) return;
  countries.push({ id, name: countryNameFromRecord(record, id), searchText: '' });
}

function countryNameFromRecord(record: Record<string, unknown>, fallback: string) {
  for (const key of nameKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return fallback;
}

function normalizeID(value: unknown) {
  const id = String(value ?? '').trim();
  return id || '';
}

function dedupeCountries(countries: SMSBowerCountry[]) {
  const byID = new Map<string, SMSBowerCountry>();
  for (const country of countries) {
    if (!byID.has(country.id)) byID.set(country.id, country);
  }
  return [...byID.values()];
}
