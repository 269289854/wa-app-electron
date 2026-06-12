import { describe, expect, it } from 'vitest';
import { assetDataUrl, authHeaders, buildApiUrl, requestAsset, requestJson, type RequestTransport } from './api-client';

describe('api client helpers', () => {
  it('builds URLs against a normalized base URL', () => {
    expect(buildApiUrl('https://wa.yizhimeng.uk/', '/api/wa/health')).toBe('https://wa.yizhimeng.uk/api/wa/health');
    expect(buildApiUrl('http://127.0.0.1:8080/base', 'api/wa/accounts?limit=1')).toBe('http://127.0.0.1:8080/api/wa/accounts?limit=1');
  });

  it('adds basic auth without exposing the password directly', () => {
    const headers = authHeaders('secret');
    expect(headers.get('Authorization')).toBe('Basic d2E6c2VjcmV0');
    expect(headers.get('Authorization')).not.toContain('secret');
  });

  it('normalizes JSON error messages', async () => {
    const transport: RequestTransport = async () => new Response(JSON.stringify({ error: { message: '需要登录' } }), { status: 401 });
    await expect(requestJson({ baseUrl: 'https://wa.yizhimeng.uk', transport }, '/api/wa/accounts')).rejects.toThrow('需要登录');
  });

  it('converts asset responses to data URLs', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const transport: RequestTransport = async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
    const payload = await requestAsset({ baseUrl: 'https://wa.yizhimeng.uk', transport }, '/api/wa/accounts/a/profile-picture');
    expect(payload.ok).toBe(true);
    expect(assetDataUrl(payload)).toBe('data:image/png;base64,AQID');
  });
});
