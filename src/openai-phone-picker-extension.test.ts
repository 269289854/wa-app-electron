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

describe('OpenAI phone picker extension', () => {
  it('loads phone accounts from the WA App bridge with the popup query', async () => {
    const listenerRef: { listener?: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean } = {};
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        accounts: [{
          accountId: 'waacc_gb',
          displayName: '7541944532',
          e164Number: '+447541944532',
          nationalNumber: '7541944532',
          countryCallingCode: '44',
          countryIso2: 'GB',
        }],
      }),
    }));
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
      URL,
      Error,
      String,
      Array,
    });

    vm.runInContext(readFileSync(resolve('chrome-extension/openai-phone-picker/background.js'), 'utf8'), context);

    const response = deferred<unknown>();
    expect(listenerRef.listener?.({ type: 'openai-phone-picker-search', query: 'GB', limit: 200 }, {}, response.resolve)).toBe(true);
    await expect(response.promise).resolves.toMatchObject({
      ok: true,
      accounts: [{ accountId: 'waacc_gb', countryCallingCode: '44' }],
    });
    const firstFetchCall = fetchMock.mock.calls[0] as unknown[];
    const url = new URL(String(firstFetchCall[0]));
    expect(url.pathname).toBe('/openai-phone-picker/accounts');
    expect(url.searchParams.get('query')).toBe('GB');
  });

  it('selects the matching OpenAI country and fills the national number without continuing', async () => {
    const listenerRef: { listener?: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean } = {};
    let pickerOpen = false;
    const countryTrigger = fakeButton('美国合众国 (+1)', () => {
      pickerOpen = true;
      countryOption.hidden = false;
    }, { role: 'combobox', 'aria-haspopup': 'listbox' });
    const countryOption = fakeButton('英国 (+44)', () => undefined, { role: 'option', 'data-country': 'GB' });
    countryOption.hidden = true;
    const continueButton = fakeButton('Continue', () => undefined);
    const phoneInput = new FakeInput({ type: 'tel', name: 'phone-number', placeholder: 'Phone number' });
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
      document: {
        querySelectorAll: (selector: string) => {
          if (selector === 'input') return [phoneInput];
          if (selector.includes('button') || selector.includes('role') || selector.includes('tabindex') || selector.includes('li')) {
            return pickerOpen ? [countryTrigger, countryOption, continueButton] : [countryTrigger, countryOption, continueButton];
          }
          return [];
        },
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      HTMLInputElement: FakeInput,
      Event: FakeEvent,
      Object,
      RegExp,
      String,
      Error,
      Promise,
      setTimeout,
      clearTimeout,
    });

    vm.runInContext(readFileSync(resolve('chrome-extension/openai-phone-picker/content.js'), 'utf8'), context);

    const response = deferred<unknown>();
    expect(listenerRef.listener?.({
      type: 'openai-phone-picker-apply',
      account: {
        accountId: 'waacc_gb',
        displayName: '7541944532',
        e164Number: '+447541944532',
        nationalNumber: '7541944532',
        countryCallingCode: '44',
        countryIso2: 'GB',
      },
    }, {}, response.resolve)).toBe(true);

    await expect(response.promise).resolves.toMatchObject({ ok: true });
    expect(countryTrigger.clicked).toBe(true);
    expect(countryOption.clicked).toBe(true);
    expect(phoneInput.value).toBe('7541944532');
    expect(phoneInput.events).toEqual(['input', 'change']);
    expect(continueButton.clicked).toBe(false);
  });
});

class FakeEvent {
  type: string;

  constructor(type: string) {
    this.type = type;
  }
}

class FakeElement {
  textContent: string;
  hidden = false;
  clicked = false;
  disabled = false;
  attributes: Record<string, string>;

  constructor(textContent = '', attributes: Record<string, string> = {}) {
    this.textContent = textContent;
    this.attributes = attributes;
  }

  click() {
    this.clicked = true;
  }

  getAttribute(name: string) {
    return this.attributes[name] || '';
  }

  getAttributeNames() {
    return Object.keys(this.attributes);
  }

  getClientRects() {
    return this.hidden ? [] : [{}];
  }
}

class FakeInput extends FakeElement {
  type: string;
  name: string;
  id: string;
  placeholder: string;
  ariaLabel = '';
  events: string[] = [];
  private nextValue = '';

  constructor(input: { type?: string; name?: string; id?: string; placeholder?: string }) {
    super('');
    this.type = input.type || 'text';
    this.name = input.name || '';
    this.id = input.id || '';
    this.placeholder = input.placeholder || '';
  }

  get value() {
    return this.nextValue;
  }

  set value(value: string) {
    this.nextValue = value;
  }

  dispatchEvent(event: FakeEvent) {
    this.events.push(event.type);
  }
}

function fakeButton(text: string, onClick: () => void, attributes: Record<string, string> = {}) {
  const element = new FakeElement(text, attributes);
  element.click = () => {
    element.clicked = true;
    onClick();
  };
  return element;
}
