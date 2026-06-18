import { getPassword, readConfig, writeConfig, publicConfig, applyConfigPatch, type ClientConfigPatch } from './config-service.js';
import { errorMessage } from './errors.js';

export type ApiRequestInput = {
  path: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type LocalBaseUrlProvider = () => string;

let localBaseUrlProvider: LocalBaseUrlProvider = () => '';

export function setLocalBaseUrlProvider(provider: LocalBaseUrlProvider) {
  localBaseUrlProvider = provider;
}

export function activeBaseUrl(config = readConfig()) {
  if (config.mode === 'local') return config.localBaseUrl || localBaseUrlProvider();
  return config.remoteBaseUrl;
}

function buildUrl(path: string, baseUrl = activeBaseUrl()) {
  if (!baseUrl) throw new Error('服务地址未配置');
  return new URL(path, `${baseUrl}/`).toString();
}

export async function requestJSON<T>(input: ApiRequestInput): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 30000);
  const headers = new Headers(input.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const password = getPassword();
  if (password) headers.set('Authorization', `Basic ${Buffer.from(`wa:${password}`).toString('base64')}`);
  try {
    const response = await fetch(buildUrl(input.path), {
      method: input.method || 'GET',
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = data?.error?.message || data?.error || `HTTP ${response.status}`;
      throw new Error(typeof message === 'string' ? message : `HTTP ${response.status}`);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestAsset(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const headers = new Headers();
  const password = getPassword();
  if (password) headers.set('Authorization', `Basic ${Buffer.from(`wa:${password}`).toString('base64')}`);
  try {
    const response = await fetch(buildUrl(path), { headers, signal: controller.signal });
    if (!response.ok) return { ok: false, status: response.status, contentType: '', data: '' };
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      ok: true,
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      data: buffer.toString('base64'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testConnection(configPatch?: ClientConfigPatch) {
  const previous = readConfig();
  const next = applyConfigPatch(previous, configPatch);
  writeConfig(next);
  try {
    const health = await requestHealth();
    return { ok: true, health, config: publicConfig(next) };
  } catch (error) {
    return { ok: false, error: errorMessage(error), config: publicConfig(next) };
  }
}

async function requestHealth() {
  try {
    return await requestJSON<Record<string, unknown>>({ path: '/api/wa/health', timeoutMs: 10000 });
  } catch (primaryError) {
    try {
      return await requestJSON<Record<string, unknown>>({ path: '/healthz', timeoutMs: 10000 });
    } catch {
      throw primaryError;
    }
  }
}
