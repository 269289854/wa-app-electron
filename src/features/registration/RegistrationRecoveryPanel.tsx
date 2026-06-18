import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, RefreshCw, Save, Trash2, Wifi } from 'lucide-react';
import {
  cleanupFailedRegistration,
  persistLoginState,
  pollAccountTransferRegistration,
  refreshAccountTransferChallenge,
} from '../../api';
import type { WorkflowResponse } from '../../types';
import { errorMessage } from '../../shared/errors';
import type { Toast } from '../../shared/toast';
import { debugError, debugRequest, sanitizeDebugValue, type DebugExchange } from './debug';
import {
  challengeSummary,
  isAccountTransferWaiting,
  nestedText,
  requireValue,
  workflowText,
} from './workflow-model';

export function RegistrationRecoveryPanel({
  accountIDValue,
  verificationRequestID,
  result,
  notify,
  onChanged,
  onDebug,
}: {
  accountIDValue?: string;
  verificationRequestID?: string;
  result?: WorkflowResponse | null;
  notify: (kind: Toast['kind'], message: string) => void;
  onChanged: () => void;
  onDebug?: (exchange: DebugExchange) => void;
}) {
  const [lastResult, setLastResult] = useState<WorkflowResponse | null>(null);
  const visibleResult = lastResult || result || null;
  const effectiveVerificationRequestID = verificationRequestID
    || workflowText(result, 'verification_request_id')
    || workflowText(lastResult, 'verification_request_id')
    || nestedText(result, 'verification_request', 'verification_request_id')
    || nestedText(lastResult, 'verification_request', 'verification_request_id');
  const effectiveAccountID = accountIDValue
    || workflowText(result, 'wa_account_id')
    || workflowText(lastResult, 'wa_account_id')
    || nestedText(result, 'registration', 'wa_account_id')
    || nestedText(lastResult, 'registration', 'wa_account_id');
  const registrationID = nestedText(visibleResult, 'registration', 'registration_id');
  const clientProfileID = workflowText(visibleResult, 'client_profile_id') || nestedText(visibleResult, 'login_state', 'client_profile_id');
  const accountTransferWaiting = isAccountTransferWaiting(visibleResult);
  const challenge = challengeSummary(visibleResult);
  const hasContext = Boolean(effectiveVerificationRequestID || effectiveAccountID || registrationID || clientProfileID || accountTransferWaiting);
  const runRecovery = async (path: string, fn: () => Promise<WorkflowResponse>) => {
    const exchange = debugRequest(path, path, {
      wa_account_id: effectiveAccountID,
      verification_request_id: effectiveVerificationRequestID,
      registration_id: registrationID,
      client_profile_id: clientProfileID,
    });
    onDebug?.(exchange);
    try {
      const response = await fn();
      setLastResult(response);
      onDebug?.({ ...exchange, response: sanitizeDebugValue(response) });
      notify(response.success === false || response.error_message ? 'error' : 'success', response.error_message || '注册恢复操作已完成');
      onChanged();
      return response;
    } catch (error) {
      onDebug?.({ ...exchange, error: debugError(error) });
      notify('error', errorMessage(error));
      throw error;
    }
  };
  const refreshMutation = useMutation({
    mutationFn: () => runRecovery('/api/wa/actions/registration/account-transfer/refresh', () => refreshAccountTransferChallenge(requireValue(effectiveVerificationRequestID, 'verification_request_id'))),
  });
  const pollMutation = useMutation({
    mutationFn: () => runRecovery('/api/wa/actions/registration/account-transfer/poll', () => pollAccountTransferRegistration(requireValue(effectiveVerificationRequestID, 'verification_request_id'), effectiveAccountID, 10)),
  });
  const cleanupMutation = useMutation({
    mutationFn: () => runRecovery('/api/wa/actions/registration/cleanup-failed-account', () => cleanupFailedRegistration({ accountID: effectiveAccountID, verificationRequestID: effectiveVerificationRequestID })),
  });
  const persistMutation = useMutation({
    mutationFn: () => runRecovery('/api/wa/actions/registration/persist-login-state', () => persistLoginState({ registrationID, clientProfileID, registration: visibleResult?.registration })),
  });
  if (!hasContext) return null;
  const busy = refreshMutation.isPending || pollMutation.isPending || cleanupMutation.isPending || persistMutation.isPending;
  return (
    <div className="recovery-panel">
      <div className={`result-banner ${accountTransferWaiting ? 'warn' : visibleResult?.success ? 'ok' : 'idle'}`}>
        <strong>{accountTransferWaiting ? '账号迁移等待中' : '注册恢复'}</strong>
        <span>{challenge || '刷新账号迁移挑战、轮询迁移结果、保存登录态或清理失败待注册账号。'}</span>
      </div>
      <div className="inline-actions">
        <button className="secondary-button" disabled={!effectiveVerificationRequestID || busy} onClick={() => refreshMutation.mutate()}>
          {refreshMutation.isPending ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          刷新挑战
        </button>
        <button className="secondary-button" disabled={!effectiveVerificationRequestID || busy} onClick={() => pollMutation.mutate()}>
          {pollMutation.isPending ? <Loader2 className="spin" size={15} /> : <Wifi size={15} />}
          轮询完成
        </button>
        <button className="secondary-button" disabled={(!registrationID && !clientProfileID && !visibleResult?.registration) || busy} onClick={() => persistMutation.mutate()}>
          {persistMutation.isPending ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
          保存登录态
        </button>
        <button className="secondary-button" disabled={(!effectiveAccountID && !effectiveVerificationRequestID) || busy} onClick={() => cleanupMutation.mutate()}>
          {cleanupMutation.isPending ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
          清理失败账号
        </button>
      </div>
      {lastResult ? <pre className="json-box compact">{JSON.stringify(lastResult, null, 2)}</pre> : null}
    </div>
  );
}
