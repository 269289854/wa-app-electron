export const smsbowerCancelAttempts = 5;
export const smsbowerCancelRetryDelayMs = 3000;

export type SMSBowerSetStatus = (input: { id: string; status: number }) => Promise<string>;
export type SMSBowerCancelLogger = (entry: SMSBowerCancelLogEntry) => void;

export type SMSBowerCancelLogEntry = {
  id: string;
  status: 8;
  reason: string;
  attempt: number;
  response?: string;
  error?: unknown;
};

export async function cancelSMSBowerActivation(
  id: string,
  reason: string,
  setStatus: SMSBowerSetStatus,
  log: SMSBowerCancelLogger = () => {},
  wait: (ms: number) => Promise<void> = defaultDelay,
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= smsbowerCancelAttempts; attempt += 1) {
    try {
      const response = await setStatus({ id, status: 8 });
      log({ id, status: 8, reason, attempt, response });
      if (isSMSBowerCancelSuccess(response)) return response;
      lastError = new Error(response || 'SMSBower cancel was not confirmed');
    } catch (error) {
      lastError = error;
      log({ id, status: 8, reason, attempt, error });
      if (isSMSBowerCancelSuccess(errorMessage(error))) return errorMessage(error);
    }
    if (attempt < smsbowerCancelAttempts) await wait(smsbowerCancelRetryDelayMs);
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
