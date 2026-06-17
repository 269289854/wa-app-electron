export const smsbowerCancelAttempts = 5;
export const smsbowerCancelRetryDelayMs = 3000;
export const smsbowerCancelMinActivationBufferMs = 2000;

export type SMSBowerSetStatus = (input: { id: string; status: number }) => Promise<string>;
export type SMSBowerCancelLogger = (entry: SMSBowerCancelLogEntry) => void;
export type SMSBowerCancelOptions = {
  orderedAtMs?: number;
  minActivationBufferMs?: number;
  now?: () => number;
};

export type SMSBowerCancelLogEntry = {
  id: string;
  status: 8;
  reason: string;
  attempt: number;
  earlyCancel?: {
    minActivationTimeSeconds: number;
    waitMs: number;
    orderedAtMs?: number;
  };
  response?: string;
  error?: unknown;
};

export async function cancelSMSBowerActivation(
  id: string,
  reason: string,
  setStatus: SMSBowerSetStatus,
  log: SMSBowerCancelLogger = () => {},
  wait: (ms: number) => Promise<void> = defaultDelay,
  options: SMSBowerCancelOptions = {},
) {
  let lastError: unknown = null;
  const now = options.now || Date.now;
  const minActivationBufferMs = options.minActivationBufferMs ?? smsbowerCancelMinActivationBufferMs;
  for (let attempt = 1; attempt <= smsbowerCancelAttempts; attempt += 1) {
    let waitedForMinActivation = false;
    try {
      const response = await setStatus({ id, status: 8 });
      log({ id, status: 8, reason, attempt, response });
      if (isSMSBowerCancelSuccess(response)) return response;
      lastError = new Error(response || 'SMSBower cancel was not confirmed');
      const earlyCancel = heroSMSEarlyCancelInfo(response, options.orderedAtMs, now(), minActivationBufferMs);
      if (earlyCancel) {
        log({ id, status: 8, reason, attempt, response, earlyCancel });
        if (earlyCancel.waitMs > 0) {
          waitedForMinActivation = true;
          await wait(earlyCancel.waitMs);
        }
      }
    } catch (error) {
      lastError = error;
      log({ id, status: 8, reason, attempt, error });
      if (isSMSBowerCancelSuccess(errorMessage(error))) return errorMessage(error);
      const earlyCancel = heroSMSEarlyCancelInfo(error, options.orderedAtMs, now(), minActivationBufferMs);
      if (earlyCancel) {
        log({ id, status: 8, reason, attempt, error, earlyCancel });
        if (earlyCancel.waitMs > 0) {
          waitedForMinActivation = true;
          await wait(earlyCancel.waitMs);
        }
      }
    }
    if (attempt < smsbowerCancelAttempts && !waitedForMinActivation) await wait(smsbowerCancelRetryDelayMs);
  }
  throw new Error(`SMSBower 订单取消失败，请到平台手动取消：${id}${lastError ? `（${errorMessage(lastError)}）` : ''}`);
}

export function isSMSBowerCancelSuccess(value: unknown) {
  const text = String(value || '').toUpperCase();
  return text.includes('ACCESS_CANCEL')
    || text.includes('STATUS_CANCEL')
    || text.includes('NO_ACTIVATION')
    || text.includes('ACTIVATION WAS NOT FOUND');
}

function defaultDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function heroSMSEarlyCancelInfo(
  value: unknown,
  orderedAtMs: number | undefined,
  nowMs: number,
  bufferMs: number,
): SMSBowerCancelLogEntry['earlyCancel'] | null {
  const text = errorMessage(value);
  const upper = text.toUpperCase();
  if (!upper.includes('EARLY_CANCEL_DENIED') && !upper.includes('MINIMUM ACTIVATION PERIOD MUST PASS')) return null;
  const minActivationTimeSeconds = parseMinActivationTimeSeconds(text);
  if (!Number.isFinite(minActivationTimeSeconds) || minActivationTimeSeconds <= 0) return null;
  const targetMs = orderedAtMs ? orderedAtMs + minActivationTimeSeconds * 1000 + bufferMs : nowMs + minActivationTimeSeconds * 1000 + bufferMs;
  return {
    minActivationTimeSeconds,
    waitMs: Math.max(0, targetMs - nowMs),
    orderedAtMs,
  };
}

function parseMinActivationTimeSeconds(text: string) {
  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as { info?: { minActivationTime?: unknown } };
      const value = Number(parsed?.info?.minActivationTime);
      if (Number.isFinite(value)) return value;
    } catch {
      // Fall through to regex extraction.
    }
  }
  const match = text.match(/minActivationTime["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : Number.NaN;
}
