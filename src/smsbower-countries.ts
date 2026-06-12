export type SMSBowerCountry = {
  id: string;
  name: string;
  searchText: string;
};

const nameKeys = ['name', 'eng', 'en', 'chn', 'cn', 'rus', 'ru', 'title', 'label'];
const preferredNameKeys = ['chn', 'cn', 'zh', 'zh_cn', 'chinese', 'name_cn', 'name_zh', 'name', 'eng', 'en', 'title', 'label', 'rus', 'ru'];

export function normalizeSMSBowerCountries(input: unknown): SMSBowerCountry[] {
  const countries: SMSBowerCountry[] = [];
  collectCountries(input, countries);
  return dedupeCountries(countries)
    .map((country) => ({ ...country, searchText: country.searchText.toLowerCase() }))
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
      const name = String(value);
      countries.push({ id: normalizedID, name, searchText: countrySearchText(normalizedID, name) });
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const name = countryNameFromRecord(record, normalizedID);
      countries.push({ id: normalizedID, name, searchText: countrySearchText(normalizedID, name, record) });
    }
  }
}

function collectArrayCountry(input: unknown, countries: SMSBowerCountry[]) {
  if (!input || typeof input !== 'object') return;
  const record = input as Record<string, unknown>;
  const id = normalizeID(record.id ?? record.country ?? record.country_id ?? record.key ?? record.value);
  if (!id) return;
  const name = countryNameFromRecord(record, id);
  countries.push({ id, name, searchText: countrySearchText(id, name, record) });
}

function countryNameFromRecord(record: Record<string, unknown>, fallback: string) {
  for (const key of preferredNameKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return fallback;
}

function countrySearchText(id: string, name: string, record?: Record<string, unknown>) {
  const values = [id, name];
  if (record) {
    for (const key of [...preferredNameKeys, ...nameKeys]) {
      const value = record[key];
      if (typeof value === 'string' || typeof value === 'number') values.push(String(value));
    }
  }
  return [...new Set(values.filter(Boolean))].join(' ');
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
