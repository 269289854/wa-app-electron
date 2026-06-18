import React from 'react';

export type DebugExchange = {
  label: string;
  at: string;
  request: {
    path: string;
    method: string;
    body: unknown;
  };
  response?: unknown;
  error?: {
    name: string;
    message: string;
  };
};

export function debugRequest(label: string, path: string, body: unknown): DebugExchange {
  return {
    label,
    at: new Date().toISOString(),
    request: {
      path,
      method: 'POST',
      body: sanitizeDebugValue(body),
    },
  };
}

export function debugError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function replaceDebugExchange(items: DebugExchange[], target: DebugExchange, next: DebugExchange) {
  return items.map((item) => item === target || (item.label === target.label && item.at === target.at) ? next : item);
}

export function appendDebugExchange(setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>, exchange: DebugExchange) {
  setDebugExchanges((items) => [exchange, ...items]);
}

export function patchDebugExchange(setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>, target: DebugExchange, next: DebugExchange) {
  setDebugExchanges((items) => replaceDebugExchange(items, target, next));
}

export function debugInfo(label: string, body: unknown): DebugExchange {
  return {
    label,
    at: new Date().toISOString(),
    request: {
      path: 'client:info',
      method: 'INFO',
      body: sanitizeDebugValue(body),
    },
  };
}

export function sanitizeDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDebugValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      isSensitiveDebugKey(key) ? '***' : sanitizeDebugValue(nested),
    ]),
  );
}

function isSensitiveDebugKey(key: string) {
  return /(otp|code|token|auth|key|cookie|secret|password|session|enc|proxy_url)/i.test(key);
}
