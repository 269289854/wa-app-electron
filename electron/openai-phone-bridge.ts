import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { errorMessage } from './errors.js';

export type OpenAIPhoneCheckInput = {
  requestId: string;
  phoneNumber: string;
  countryCallingCode?: string;
  nationalNumber?: string;
  countryIso2?: string;
  mode?: 'page' | 'api';
  timeoutMs?: number;
};

export type OpenAIPhoneCheckResult = {
  requestId: string;
  phoneNumber?: string;
  status: 'used' | 'sent' | 'available' | 'error' | 'rate_limited' | 'session_expired';
  message: string;
  code?: string;
  raw?: unknown;
};

const mockOpenAIPhoneMode = process.env.WA_APP_ELECTRON_MOCK_OPENAI_PHONE || '';
const openAIPhoneBridgePort = 17391;
let openAIPhoneBridge: HttpServer | null = null;
const openAIPhoneTasks = new Map<string, {
  input: OpenAIPhoneCheckInput;
  createdAt: number;
  resolve: (result: OpenAIPhoneCheckResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>();

export function openAIPhoneBridgeStatus() {
  return {
    running: Boolean(openAIPhoneBridge),
    port: openAIPhoneBridgePort,
    baseUrl: `http://127.0.0.1:${openAIPhoneBridgePort}`,
    pending: openAIPhoneTasks.size,
  };
}

export function startOpenAIPhoneBridge() {
  if (openAIPhoneBridge) return openAIPhoneBridgeStatus();
  openAIPhoneBridge = createHttpServer((request, response) => {
    void handleOpenAIPhoneBridgeRequest(request, response);
  });
  openAIPhoneBridge.once('error', (error) => {
    openAIPhoneBridge = null;
    console.error('OpenAI phone bridge failed:', error);
  });
  openAIPhoneBridge.listen(openAIPhoneBridgePort, '127.0.0.1');
  return openAIPhoneBridgeStatus();
}

export function stopOpenAIPhoneBridge() {
  if (!openAIPhoneBridge) return;
  openAIPhoneBridge.close();
  openAIPhoneBridge = null;
}

export async function waitForOpenAIPhoneCheck(input: OpenAIPhoneCheckInput) {
  if (mockOpenAIPhoneMode === 'rate_limit') {
    return {
      requestId: input.requestId,
      phoneNumber: input.phoneNumber,
      status: 'error',
      message: "You've made too many phone verification requests. Please try again later or contact us through our help center at help.openai.com.",
      code: 'rate_limit_exceeded',
      raw: {
        message: "You've made too many phone verification requests. Please try again later or contact us through our help center at help.openai.com.",
        type: 'invalid_request_error',
        param: null,
        code: 'rate_limit_exceeded',
      },
    } satisfies OpenAIPhoneCheckResult;
  }
  if (mockOpenAIPhoneMode === 'session_expired') {
    return {
      requestId: input.requestId,
      phoneNumber: input.phoneNumber,
      status: 'error',
      message: 'Your sign-in session is no longer valid. Please start over to continue.',
      code: 'invalid_state',
      raw: {
        error: {
          message: 'Your sign-in session is no longer valid. Please start over to continue.',
          type: 'invalid_request_error',
          param: null,
          code: 'invalid_state',
        },
      },
    } satisfies OpenAIPhoneCheckResult;
  }
  startOpenAIPhoneBridge();
  const timeoutMs = input.timeoutMs || 120000;
  return new Promise<OpenAIPhoneCheckResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      openAIPhoneTasks.delete(input.requestId);
      reject(new Error('OpenAI phone check timed out'));
    }, timeoutMs);
    openAIPhoneTasks.set(input.requestId, {
      input: { ...input, mode: input.mode || 'api' },
      createdAt: Date.now(),
      resolve,
      reject,
      timer,
    });
  });
}

async function handleOpenAIPhoneBridgeRequest(request: IncomingMessage, response: ServerResponse) {
  setBridgeCorsHeaders(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url || '/', `http://127.0.0.1:${openAIPhoneBridgePort}`);
  try {
    if (request.method === 'GET' && url.pathname === '/openai-phone-check/task') {
      const task = [...openAIPhoneTasks.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
      writeJSON(response, 200, { task: task?.input || null });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/openai-phone-check/result') {
      const result = await readJSON<OpenAIPhoneCheckResult>(request);
      const requestId = String(result.requestId || '');
      const task = openAIPhoneTasks.get(requestId);
      if (!task) {
        writeJSON(response, 404, { ok: false, error: 'OpenAI phone check request was not found' });
        return;
      }
      clearTimeout(task.timer);
      openAIPhoneTasks.delete(requestId);
      task.resolve(result);
      writeJSON(response, 200, { ok: true });
      return;
    }
    writeJSON(response, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    writeJSON(response, 500, { ok: false, error: errorMessage(error) });
  }
}

function setBridgeCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function writeJSON(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJSON<T>(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return (text ? JSON.parse(text) : {}) as T;
}
