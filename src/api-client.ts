export type RequestTransport = (url: string, init: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  baseUrl: string;
  password?: string;
  transport?: RequestTransport;
};

export type AssetPayload = {
  ok: boolean;
  status: number;
  contentType: string;
  data: string;
};

export function buildApiUrl(baseUrl: string, path: string) {
  if (!baseUrl.trim()) throw new Error('服务地址未配置');
  const base = new URL(baseUrl);
  base.pathname = '/';
  base.search = '';
  base.hash = '';
  return new URL(path, base).toString();
}

export function authHeaders(password?: string, extra?: Record<string, string>) {
  const headers = new Headers(extra || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (password?.trim()) headers.set('Authorization', `Basic ${btoaAscii(`wa:${password.trim()}`)}`);
  return headers;
}

export async function requestJson<T>(options: ApiClientOptions, path: string, input: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const response = await transport(options)(buildApiUrl(options.baseUrl, path), {
    method: input.method || 'GET',
    headers: authHeaders(options.password, input.headers),
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(apiErrorMessage(data, response.status));
  return data as T;
}

export async function requestAsset(options: ApiClientOptions, path: string): Promise<AssetPayload> {
  const response = await transport(options)(buildApiUrl(options.baseUrl, path), {
    headers: authHeaders(options.password, { Accept: '*/*' }),
  });
  if (!response.ok) return { ok: false, status: response.status, contentType: '', data: '' };
  const data = arrayBufferToBase64(await response.arrayBuffer());
  return {
    ok: true,
    status: response.status,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    data,
  };
}

export function assetDataUrl(payload: AssetPayload) {
  return payload.ok && payload.data ? `data:${payload.contentType};base64,${payload.data}` : '';
}

function apiErrorMessage(data: unknown, status: number) {
  if (data && typeof data === 'object') {
    const record = data as { error?: unknown };
    if (typeof record.error === 'string') return record.error;
    if (record.error && typeof record.error === 'object' && typeof (record.error as { message?: unknown }).message === 'string') return (record.error as { message: string }).message;
  }
  return `HTTP ${status}`;
}

function transport(options: ApiClientOptions) {
  return options.transport || fetch;
}

function btoaAscii(value: string) {
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value, 'utf8').toString('base64');
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoaAscii(binary);
}
