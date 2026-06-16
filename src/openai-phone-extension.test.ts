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

const openAISuccessResponse = {
  continue_url: 'https://auth.openai.com/phone-verification',
  method: 'GET',
  page: {
    type: 'phone_otp_verification',
    backstack_behavior: 'default',
  },
  'oai-client-auth-session': {
    session_id: 'authsess_test',
    phone_number: '+15550001111',
    phone_verification_channel: 'whatsapp',
  },
};

describe('OpenAI phone checker extension dedupe', () => {
  it('reuses the in-flight content check for duplicate request ids', async () => {
    const listenerRef: { listener?: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean } = {};
    const gate = deferred<void>();
    const fetchMock = vi.fn(async () => {
      await gate.promise;
      return {
        ok: true,
        text: async () => JSON.stringify(openAISuccessResponse),
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

  it('requires OTP verification JSON before content reports success', async () => {
    const listenerRef: { listener?: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean } = {};
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    }));
    const context = createContentContext(listenerRef, fetchMock);

    vm.runInContext(readFileSync(resolve('chrome-extension/openai-phone-checker/content.js'), 'utf8'), context);

    const response = deferred<unknown>();
    expect(listenerRef.listener?.({ type: 'openai-phone-check', task: { requestId: 'plain-200', phoneNumber: '+15550003333', mode: 'api' } }, {}, response.resolve)).toBe(true);
    await expect(response.promise).resolves.toMatchObject({
      status: 'error',
      message: 'OpenAI did not enter phone OTP verification',
    });
  });

  it('normalizes nested OpenAI phone-in-use errors in content', async () => {
    const listenerRef: { listener?: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean } = {};
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        error: {
          message: 'Phone number already in use. Please use a different phone number.',
          type: 'invalid_request_error',
          param: null,
          code: 'phone_number_in_use',
        },
      }),
    }));
    const context = createContentContext(listenerRef, fetchMock);

    vm.runInContext(readFileSync(resolve('chrome-extension/openai-phone-checker/content.js'), 'utf8'), context);

    const response = deferred<unknown>();
    expect(listenerRef.listener?.({ type: 'openai-phone-check', task: { requestId: 'used-phone', phoneNumber: '+15550004444', mode: 'api' } }, {}, response.resolve)).toBe(true);
    await expect(response.promise).resolves.toMatchObject({
      status: 'used',
      code: 'phone_number_in_use',
    });
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

function createContentContext(
  listenerRef: { listener?: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean },
  fetchMock: ReturnType<typeof vi.fn>,
) {
  return vm.createContext({
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
}
