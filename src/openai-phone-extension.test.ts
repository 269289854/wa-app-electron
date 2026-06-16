import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolveValue = resolvePromise;
  });
  return { promise, resolve: resolveValue };
}

describe('OpenAI phone checker extension dedupe', () => {
  it('reuses the in-flight content check for duplicate request ids', async () => {
    const listenerRef: { listener?: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean } = {};
    const gate = deferred<void>();
    const fetchMock = vi.fn(async () => {
      await gate.promise;
      return {
        ok: true,
        text: async () => '{}',
      };
    });
    const context = vm.createContext({
      chrome: {
        runtime: {
          onMessage: {
            addListener: (listener: typeof listenerRef.listener) => {
              listenerRef.listener = listener;
            },
          },
        },
      },
      fetch: fetchMock,
      JSON,
      String,
    });

    vm.runInContext(readFileSync(resolve('chrome-extension/openai-phone-checker/content.js'), 'utf8'), context);

    const firstResponse = deferred<unknown>();
    const secondResponse = deferred<unknown>();
    const task = { requestId: 'duplicate-request', phoneNumber: '+15550001111', mode: 'api' };
    expect(listenerRef.listener?.({ type: 'openai-phone-check', task }, {}, firstResponse.resolve)).toBe(true);
    expect(listenerRef.listener?.({ type: 'openai-phone-check', task }, {}, secondResponse.resolve)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    gate.resolve();
    await expect(firstResponse.promise).resolves.toMatchObject({ status: 'sent' });
    await expect(secondResponse.promise).resolves.toMatchObject({ status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch an active background task twice', async () => {
    const gate = deferred<unknown>();
    const task = { requestId: 'active-request', phoneNumber: '+15550002222', mode: 'api' };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/openai-phone-check/task')) {
        return {
          ok: true,
          json: async () => ({ task }),
        };
      }
      if (url.endsWith('/openai-phone-check/result')) {
        return { ok: true };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const sendMessageMock = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === 'openai-phone-check-ping') return { ok: true };
      await gate.promise;
      return { status: 'sent', message: 'sent', raw: {} };
    });
    const context = vm.createContext({
      chrome: {
        runtime: {
          onInstalled: { addListener: vi.fn() },
          onMessage: { addListener: vi.fn() },
        },
        storage: {
          local: {
            set: vi.fn(),
            get: vi.fn(async () => ({ mode: 'api' })),
          },
        },
        alarms: {
          create: vi.fn(),
          onAlarm: { addListener: vi.fn() },
        },
        tabs: {
          query: vi.fn(async () => [{ id: 1, status: 'complete', url: 'https://auth.openai.com/add-phone' }]),
          get: vi.fn(async () => ({ id: 1, status: 'complete', url: 'https://auth.openai.com/add-phone' })),
          sendMessage: sendMessageMock,
          create: vi.fn(),
        },
        scripting: {
          executeScript: vi.fn(),
        },
      },
      fetch: fetchMock,
      setInterval: vi.fn(),
      setTimeout,
      clearTimeout,
      JSON,
      Date,
      String,
      Error,
      Promise,
    });

    vm.runInContext(readFileSync(resolve('chrome-extension/openai-phone-checker/background.js'), 'utf8'), context);
    await vi.waitFor(() => {
      expect(sendMessageMock.mock.calls.filter(([, message]) => message.type === 'openai-phone-check')).toHaveLength(1);
    });

    await context.pollTask();
    expect(sendMessageMock.mock.calls.filter(([, message]) => message.type === 'openai-phone-check')).toHaveLength(1);

    gate.resolve({ status: 'sent' });
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/openai-phone-check/result'))).toBe(true);
    });
  });
});
