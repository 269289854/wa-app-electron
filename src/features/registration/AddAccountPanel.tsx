import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, MessageCircle, MonitorCog, Plus, Send } from 'lucide-react';
import {
  accountID,
  getAccounts,
  isTransientOTPSubmitError,
  probePhoneSMS,
  registerPhone,
  submitRegistrationOTP,
  type PhoneInput,
} from '../../api';
import { normalizeOpenAIPhoneCheckResult } from '../../openai-phone-check';
import { normalizePhoneInput } from '../../phone-input';
import { probeStatus, registrationMethods, statusReason } from '../../result-model';
import { countryDisplayName, normalizeSMSBowerCountries } from '../../smsbower-countries';
import type { WorkflowResponse } from '../../types';
import { errorMessage } from '../../shared/errors';
import type { Toast } from '../../shared/toast';
import { InfoCard } from '../../shared/ui';
import {
  appendDebugExchange,
  debugError,
  debugInfo,
  debugRequest,
  patchDebugExchange,
  replaceDebugExchange,
  sanitizeDebugValue,
  type DebugExchange,
} from './debug';
import { RegistrationRecoveryPanel } from './RegistrationRecoveryPanel';

type SMSBowerStage = 'idle' | 'price' | 'number' | 'probe' | 'register' | 'otp' | 'submit';

type SMSBowerRunState = {
  running: boolean;
  stopping: boolean;
  stage: SMSBowerStage;
  successes: number;
  orders: number;
  currentPhone: string;
  activationId: string;
  message: string;
};

type SMSBowerRegistrationTaskResult = {
  successes: number;
  orders: number;
  stopped: boolean;
};

export function AddAccountPanel({ notify, onChanged }: { notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['config'], queryFn: () => window.waConfig.get() });
  const smsbowerCountriesQuery = useQuery({
    queryKey: ['sms-platform-countries', configQuery.data?.smsProvider],
    queryFn: async () => normalizeSMSBowerCountries(await window.smsPlatform.getCountries({ provider: configQuery.data?.smsProvider })),
    enabled: Boolean(configQuery.data?.smsbower.configured),
    staleTime: 60 * 60 * 1000,
  });
  const [countryCallingCode, setCountryCallingCode] = useState('');
  const [phone, setPhone] = useState('');
  const [probe, setProbe] = useState<WorkflowResponse | null>(null);
  const [debugExchanges, setDebugExchanges] = useState<DebugExchange[]>([]);
  const [addAccountStage, setAddAccountStage] = useState<'idle' | 'probe' | 'register'>('idle');
  const [platformState, setPlatformState] = useState<SMSBowerRunState>({
    running: false,
    stopping: false,
    stage: 'idle',
    successes: 0,
    orders: 0,
    currentPhone: '',
    activationId: '',
    message: '',
  });
  const stopPlatformRef = useRef(false);
  const [method, setMethod] = useState('sms');
  const [pendingAccountID, setPendingAccountID] = useState('');
  const [pendingVerificationRequestID, setPendingVerificationRequestID] = useState('');
  const [otp, setOtp] = useState('');
  const input = resolvePhoneInput(phone, countryCallingCode);
  const recognizedPhone = input?.country_iso2 ? `${input.country_iso2} +${input.country_calling_code}` : '';
  const status = probeStatus(probe);
  const updatePhoneInput = (value: string) => {
    setPhone(value);
    const normalized = normalizePhoneInput(value, countryCallingCode);
    if (!normalized) return;
    setCountryCallingCode(normalized.country_calling_code);
    setPhone(normalized.phone);
  };
  const startSMSBowerRegistrationTask = async (): Promise<SMSBowerRegistrationTaskResult> => {
    const appConfig = await window.waConfig.get();
    const config = appConfig.smsbower;
    const platformName = config.providerLabel || '接码平台';
    if (!config.configured) throw new Error(`${platformName} is not configured`);
    stopPlatformRef.current = false;
    setDebugExchanges([]);
    setPlatformState({
      running: true,
      stopping: false,
      stage: 'price',
      successes: 0,
      orders: 0,
      currentPhone: '',
      activationId: '',
      message: `Checking ${platformName} price`,
    });
    appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} start`, {
      provider: config.provider,
      country: config.country,
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
      targetSuccessCount: config.targetSuccessCount,
      maxOrders: config.maxOrders,
      numberIntervalSeconds: config.numberIntervalSeconds,
    }));
    const prices = await window.smsPlatform.getPrices({ country: config.country });
    const inRangePrices = filterSMSBowerPrices(prices, config);
    const providerIds = inRangePrices.map((item) => item.providerId).filter((id): id is string => Boolean(id));
    appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} prices`, {
      provider: config.provider,
      country: config.country,
      service: 'wa',
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
      availablePrices: prices,
      inRangePrices,
    }));
    const price = selectSMSBowerPrice(prices, config);
    if (!price) throw new Error(smsbowerPriceErrorMessage(prices, config));
    appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} price ok`, {
      selectedProviders: providerIds,
      minCost: price.cost,
      totalCount: inRangePrices.reduce((total, item) => total + item.count, 0),
      prices: inRangePrices,
    }));

    let successes = 0;
    let orders = 0;
    while (successes < config.targetSuccessCount && orders < config.maxOrders && !stopPlatformRef.current) {
      const nextOrder = orders + 1;
      if (orders > 0 && config.numberIntervalSeconds > 0) {
        setPlatformState((state) => ({ ...state, stage: 'number', message: `Waiting ${config.numberIntervalSeconds}s before next number` }));
        appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} number interval`, {
          seconds: config.numberIntervalSeconds,
          nextOrder,
        }));
        await delayWithStop(config.numberIntervalSeconds * 1000, stopPlatformRef);
        if (stopPlatformRef.current) break;
      }
      orders += 1;
      setPlatformState((state) => ({ ...state, stage: 'number', orders, message: `Buying number ${orders}/${config.maxOrders}` }));
      const numberRequest = { country: config.country, service: 'wa', minPrice: config.minPrice, maxPrice: config.maxPrice, providerIds };
      const numberExchange = debugRequest(`${platformName} getNumber`, 'sms-platform:getNumber', numberRequest);
      appendDebugExchange(setDebugExchanges, numberExchange);
      let number: SMSBowerNumberResult;
      let orderedAtMs: number;
      try {
        number = await window.smsPlatform.getNumber({ country: config.country, minPrice: config.minPrice, maxPrice: config.maxPrice, providerIds });
        orderedAtMs = Date.now();
        patchDebugExchange(setDebugExchanges, numberExchange, { ...numberExchange, response: sanitizeDebugValue(number) });
      } catch (error) {
        patchDebugExchange(setDebugExchanges, numberExchange, { ...numberExchange, error: debugError(error) });
        appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} task stopped`, { order: orders, error: errorMessage(error) }));
        throw error;
      }

      let completed = false;
      let cancelReason = '';
      let otpReceived = false;
      let skipCancel = false;
      try {
        const normalized = normalizePhoneInput(number.phone, '');
        setPlatformState((state) => ({ ...state, stage: 'probe', currentPhone: number.phone, activationId: number.activationId, message: 'Probing WA registration route' }));
        if (!normalized) {
          cancelReason = `${platformName} returned an invalid phone number`;
          appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} invalid number`, number));
          continue;
        }
        setCountryCallingCode(normalized.country_calling_code);
        setPhone(normalized.phone);

        const registration = await probeAndRegisterForSMSBower(
          normalized,
          config.openAIPhoneCheckEnabled,
          setAddAccountStage,
          setDebugExchanges,
          setProbe,
        );
        if (!registration.ok) {
          cancelReason = registration.reason || 'WA registration was skipped';
          appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} WA registration skipped`, {
            activationId: number.activationId,
            reason: cancelReason,
          }));
          if (registration.stopTask) {
            stopPlatformRef.current = true;
            setPlatformState((state) => ({ ...state, stopping: true, message: cancelReason }));
            throw new Error(cancelReason);
          }
          continue;
        }
        const waAccountId = registration.response.wa_account_id || '';
        const verificationRequestId = registration.response.verification_request_id || '';
        if (!waAccountId) {
          cancelReason = 'WA registration response did not include wa_account_id';
          appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} missing wa_account_id`, registration.response));
          continue;
        }
        setPendingAccountID(waAccountId);
        setPendingVerificationRequestID(verificationRequestId);
        setPlatformState((state) => ({ ...state, stage: 'otp', message: `Waiting for ${platformName} OTP code` }));
        const codeResult = await waitForSMSBowerCode(number.activationId, config, platformName, setDebugExchanges, stopPlatformRef);
        if (!codeResult.code) {
          cancelReason = codeResult.reason;
          continue;
        }
        otpReceived = true;
        setOtp(codeResult.code);

        setPlatformState((state) => ({ ...state, stage: 'submit', message: 'Submitting OTP to wa-app' }));
        try {
          const otpResponse = await submitRegistrationOTPWithRetry({
            accountID: waAccountId,
            verificationRequestID: verificationRequestId,
            otp: codeResult.code,
            setDebugExchanges,
            stopRef: stopPlatformRef,
            label: `Submit ${platformName} OTP`,
            onRetry: (attempt) => setPlatformState((state) => ({
              ...state,
              stage: 'submit',
              message: `OTP submit failed, retrying in 3s (${attempt + 1}/3)`,
            })),
          });
          const exists = await confirmAccountAppears(waAccountId);
          if (!exists) throw new Error(otpResponse.error_message || 'OTP submitted but account was not found in the account list');
          completed = true;
          setOtp('');
          const doneExchange = debugRequest(`${platformName} setStatus complete`, 'sms-platform:setStatus', { id: number.activationId, status: 6 });
          appendDebugExchange(setDebugExchanges, doneExchange);
          try {
            const done = await window.smsPlatform.setStatus({ id: number.activationId, status: 6 });
            patchDebugExchange(setDebugExchanges, doneExchange, { ...doneExchange, response: sanitizeDebugValue(done) });
          } catch (error) {
            patchDebugExchange(setDebugExchanges, doneExchange, { ...doneExchange, error: debugError(error) });
            appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} setStatus complete failed`, { activationId: number.activationId, error: errorMessage(error) }));
          }
          successes += 1;
          setPlatformState((state) => ({ ...state, successes, stage: 'number', message: `Success ${successes}/${config.targetSuccessCount}` }));
          await queryClient.invalidateQueries({ queryKey: ['accounts'] });
          onChanged();
        } catch (error) {
          cancelReason = errorMessage(error);
          if (isTransientOTPSubmitError(error)) {
            skipCancel = true;
            setPlatformState((state) => ({
              ...state,
              stage: 'submit',
              message: 'OTP received, but WA submit failed temporarily. You can retry manually.',
            }));
            appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} OTP submit transient failed`, {
              activationId: number.activationId,
              wa_account_id: waAccountId,
              verification_request_id: verificationRequestId,
              error: cancelReason,
            }));
          } else {
            appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} OTP submit failed`, { activationId: number.activationId, error: cancelReason }));
          }
        }
      } catch (error) {
        cancelReason = errorMessage(error);
        appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} order failed`, { activationId: number.activationId, error: cancelReason }));
      } finally {
        if (!completed && cancelReason && otpReceived && skipCancel) {
          appendDebugExchange(setDebugExchanges, debugInfo(`${platformName} cancel skipped after OTP received`, {
            activationId: number.activationId,
            reason: cancelReason,
          }));
        } else if (!completed && cancelReason) {
          setPlatformState((state) => ({ ...state, message: `Queueing ${platformName} order ${number.activationId} for cancellation` }));
          await enqueueSMSCancelOrder(
            number.activationId,
            number.phone,
            cancelReason,
            config.provider,
            platformName,
            orderedAtMs,
            setDebugExchanges,
          );
          setPlatformState((state) => ({ ...state, message: `${platformName} order ${number.activationId} queued for cancellation` }));
        }
      }
      if (stopPlatformRef.current) break;
    }
    return { successes, orders, stopped: stopPlatformRef.current };
  };
  const stopSMSBowerRegistrationTask = useCallback(() => {
    stopPlatformRef.current = true;
    setPlatformState((state) => ({ ...state, stopping: true, message: 'Stopping after current request' }));
  }, []);
  const probeAndRegisterMutation = useMutation({
    mutationFn: async () => {
      const phoneInput = requirePhone(input);
      const probeExchange = debugRequest('探测号码', '/api/wa/phone/sms-probe', phoneInput);
      setAddAccountStage('probe');
      setDebugExchanges([probeExchange]);
      let probeResponse: WorkflowResponse;
      try {
        probeResponse = await probePhoneSMS(phoneInput);
        setDebugExchanges([{ ...probeExchange, response: sanitizeDebugValue(probeResponse) }]);
      } catch (error) {
        setDebugExchanges([{ ...probeExchange, error: debugError(error) }]);
        throw error;
      }
      const probeResultStatus = probeStatus(probeResponse);
      if (!probeResultStatus.canRegister) {
        throw new Error(statusReason(probeResultStatus) || '探测未通过，未发起注册。');
      }
      const smsbowerConfig = configQuery.data?.smsbower || (await window.waConfig.get()).smsbower;
      const openAIResult = await checkOpenAIPhoneForSMSBower(phoneInput, setDebugExchanges, smsbowerConfig.openAIPhoneCheckEnabled);
      if (openAIResult.status === 'used') {
        appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check blocked registration', {
          phoneNumber: phoneInput.e164_number,
          result: openAIResult,
        }));
        throw new Error('openai \u624b\u673a\u53f7\u5df2\u88ab\u4f7f\u7528');
      }
      if (openAIResult.status === 'rate_limited') {
        appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check rate limited', {
          phoneNumber: phoneInput.e164_number,
          result: openAIResult,
        }));
        throw new Error(openAIResult.message);
      }
      if (openAIResult.status === 'session_expired') {
        appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check session expired', {
          phoneNumber: phoneInput.e164_number,
          result: openAIResult,
        }));
        throw new Error(openAIResult.message);
      }
      if (openAIResult.status === 'error') {
        appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check failed', {
          phoneNumber: phoneInput.e164_number,
          result: openAIResult,
        }));
        throw new Error(openAIResult.message || 'OpenAI phone check failed');
      }
      const registerBody = { ...phoneInput, delivery_method: method };
      const registerExchange = debugRequest('发起注册', '/api/wa/register', registerBody);
      setAddAccountStage('register');
      setDebugExchanges((items) => [...items, registerExchange]);
      try {
        const registerResponse = await registerPhone(phoneInput, method);
        setDebugExchanges((items) => replaceDebugExchange(items, registerExchange, { ...registerExchange, response: sanitizeDebugValue(registerResponse) }));
        return { registerResponse };
      } catch (error) {
        setDebugExchanges((items) => replaceDebugExchange(items, registerExchange, { ...registerExchange, error: debugError(error) }));
        throw error;
      }
    },
    onSuccess: ({ registerResponse }) => {
      setProbe(registerResponse);
      if (registerResponse.wa_account_id) setPendingAccountID(registerResponse.wa_account_id);
      setPendingVerificationRequestID(registerResponse.verification_request_id || '');
      notify(registerResponse.success === false || registerResponse.error_message ? 'error' : 'success', registerResponse.error_message || '注册请求已提交');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
    onSettled: () => setAddAccountStage('idle'),
  });
  const platformRegisterMutation = useMutation({
    mutationFn: startSMSBowerRegistrationTask,
    onSuccess: (result) => {
      notify(result.successes ? 'success' : 'info', result.stopped ? `平台注册已停止，成功 ${result.successes} 个` : `平台注册结束，成功 ${result.successes} 个`);
    },
    onError: (error) => notify('error', errorMessage(error)),
    onSettled: () => {
      stopPlatformRef.current = false;
      setAddAccountStage('idle');
      setPlatformState((state) => ({ ...state, running: false, stopping: false, stage: 'idle', message: state.message || 'Idle' }));
    },
  });
  const otpMutation = useMutation({
    mutationFn: async () => {
      setDebugExchanges([]);
      return submitRegistrationOTPWithRetry({
        accountID: pendingAccountID,
        verificationRequestID: pendingVerificationRequestID,
        otp,
        setDebugExchanges,
        label: '提交 OTP',
      });
    },
    onSuccess: (result) => {
      notify(result.success === false || result.error_message ? 'error' : 'success', result.error_message || 'OTP 已提交');
      setOtp('');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const smsConfig = configQuery.data?.smsbower;
  const platformName = smsConfig?.providerLabel || '接码平台';
  const platformConfigured = Boolean(smsConfig?.configured);
  const platformCountryLabel = countryDisplayName(smsbowerCountriesQuery.data || [], smsConfig?.country || '');
  const platformBusy = platformRegisterMutation.isPending;
  const addAccountBusy = probeAndRegisterMutation.isPending || otpMutation.isPending || platformBusy;
  useEffect(() => {
    const onStart = (event: Event) => {
      const requestId = (event as CustomEvent<{ requestId?: string }>).detail?.requestId || '';
      window.dispatchEvent(new CustomEvent('smsbower-registration-task-accepted', { detail: { requestId } }));
      void platformRegisterMutation.mutateAsync()
        .then((result) => window.dispatchEvent(new CustomEvent('smsbower-registration-task-result', { detail: { requestId, result } })))
        .catch((error) => window.dispatchEvent(new CustomEvent('smsbower-registration-task-result', { detail: { requestId, error: errorMessage(error) } })));
    };
    const onStop = () => stopSMSBowerRegistrationTask();
    window.addEventListener('smsbower-registration-task-start', onStart);
    window.addEventListener('smsbower-registration-task-stop', onStop);
    return () => {
      window.removeEventListener('smsbower-registration-task-start', onStart);
      window.removeEventListener('smsbower-registration-task-stop', onStop);
    };
  }, [platformRegisterMutation, stopSMSBowerRegistrationTask]);
  return (
    <section className="add-page">
      <div className="section-title">
        <h1>添加 WAAccount</h1>
        <p>先探测号码，再选择可用通道发起注册并提交 OTP。</p>
      </div>
      <div className="two-column">
        <InfoCard title="号码与通道" icon={<Plus size={17} />}>
          <div className="form-grid">
            <label>
              国家拨号码
              <input value={countryCallingCode} onChange={(event) => setCountryCallingCode(event.target.value)} placeholder="+1" disabled={addAccountBusy} />
            </label>
            <label>
              手机号
              <input value={phone} onChange={(event) => updatePhoneInput(event.target.value)} placeholder="4155550123" disabled={addAccountBusy} />
            </label>
            {recognizedPhone ? <span className="field-hint">已识别：{recognizedPhone}</span> : null}
            <label>
              注册通道
              <select value={method} onChange={(event) => setMethod(event.target.value)} disabled={addAccountBusy}>
                {registrationMethods.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}
              </select>
            </label>
            <div className={`result-banner ${status.tone}`}>
              <strong>{status.label}</strong>
              <span>{statusReason(status) || '完成号码探测后会显示通道状态。'}</span>
            </div>
            {status.methods.length ? (
              <div className="method-grid">
                {status.methods.map((item) => (
                  <span className={item.available === true && !item.waitSeconds ? 'ok' : item.waitSeconds ? 'warn' : 'idle'} key={item.code}>
                    {item.label}
                    <small>{item.waitSeconds ? `冷却 ${item.waitSeconds}s` : item.available === true ? '可用' : '未知'}</small>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="inline-actions">
              <button className="primary-button" disabled={addAccountBusy} onClick={() => probeAndRegisterMutation.mutate()}>
                {probeAndRegisterMutation.isPending ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                {addAccountStage === 'probe' ? '探测中...' : addAccountStage === 'register' ? '注册请求中...' : '探测并发起注册'}
              </button>
            </div>
          </div>
        </InfoCard>
        <InfoCard title="OTP" icon={<KeyRound size={17} />}>
          <div className="form-grid">
            <label>
              待注册账号 ID
              <input value={pendingAccountID} onChange={(event) => setPendingAccountID(event.target.value)} placeholder="wa_account_id" disabled={addAccountBusy} />
            </label>
            <label>
              verification_request_id
              <input value={pendingVerificationRequestID} onChange={(event) => setPendingVerificationRequestID(event.target.value)} placeholder="verification_request_id" disabled={addAccountBusy} />
            </label>
            <label>
              OTP
              <input value={otp} onChange={(event) => setOtp(event.target.value)} type="password" disabled={addAccountBusy} />
            </label>
            <button className="primary-button" disabled={!pendingAccountID || !otp || addAccountBusy} onClick={() => otpMutation.mutate()}>
              {otpMutation.isPending ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}
              提交 OTP
            </button>
            <RegistrationRecoveryPanel
              accountIDValue={pendingAccountID}
              verificationRequestID={pendingVerificationRequestID}
              result={probe}
              notify={notify}
              onChanged={onChanged}
              onDebug={(exchange) => appendDebugExchange(setDebugExchanges, exchange)}
            />
          </div>
        </InfoCard>
      </div>
      {platformConfigured ? (
        <InfoCard title={`${platformName} 平台注册`} icon={<MessageCircle size={17} />}>
          <div className="platform-register">
            <div className="platform-stats">
              <span>国家 {platformCountryLabel || '-'}</span>
              <span>价格 {smsConfig?.minPrice}-{smsConfig?.maxPrice}</span>
              <span>成功 {platformState.successes}/{smsConfig?.targetSuccessCount || 0}</span>
              <span>下单 {platformState.orders}/{smsConfig?.maxOrders || 0}</span>
            </div>
            <div className={`result-banner ${platformBusy ? 'warn' : platformState.successes ? 'ok' : ''}`}>
              <strong>{platformStageLabel(platformState.stage)}</strong>
              <span>{platformState.message || `使用 ${platformName} 购买 WhatsApp 号码，自动探测、注册、等待验证码并提交 OTP。`}</span>
              {platformState.currentPhone ? <span>{platformState.currentPhone} / {platformState.activationId}</span> : null}
            </div>
            <div className="inline-actions">
              <button
                className="primary-button"
                disabled={addAccountBusy}
                onClick={() => {
                  if (window.smsbower.startRegistrationTask) void window.smsbower.startRegistrationTask().catch((error) => notify('error', errorMessage(error)));
                  else platformRegisterMutation.mutate();
                }}
              >
                {platformBusy ? <Loader2 className="spin" size={15} /> : <MessageCircle size={15} />}
                通过平台注册
              </button>
              <button
                className="secondary-button"
                disabled={!platformBusy || platformState.stopping}
                onClick={() => {
                  if (window.smsbower.stopRegistrationTask) void window.smsbower.stopRegistrationTask();
                  else stopSMSBowerRegistrationTask();
                }}
              >
                停止
              </button>
            </div>
          </div>
        </InfoCard>
      ) : null}
      <InfoCard title="结果" icon={<MonitorCog size={17} />}>
        <pre className="json-box debug-json">{JSON.stringify(debugExchanges.length ? debugExchanges : [{ hint: '点击“探测并发起注册”后，这里会显示请求和应答链路。' }], null, 2)}</pre>
      </InfoCard>
    </section>
  );
}

async function probeAndRegisterForSMSBower(
  phoneInput: PhoneInput,
  openAIPhoneCheckEnabled: boolean,
  setStage: React.Dispatch<React.SetStateAction<'idle' | 'probe' | 'register'>>,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
  setProbe: React.Dispatch<React.SetStateAction<WorkflowResponse | null>>,
) {
  const probeExchange = debugRequest('探测号码', '/api/wa/phone/sms-probe', phoneInput);
  setStage('probe');
  appendDebugExchange(setDebugExchanges, probeExchange);
  let probeResponse: WorkflowResponse;
  try {
    probeResponse = await probePhoneSMS(phoneInput);
    setProbe(probeResponse);
    patchDebugExchange(setDebugExchanges, probeExchange, { ...probeExchange, response: sanitizeDebugValue(probeResponse) });
  } catch (error) {
    patchDebugExchange(setDebugExchanges, probeExchange, { ...probeExchange, error: debugError(error) });
    return { ok: false as const, reason: errorMessage(error) };
  }
  const currentStatus = probeStatus(probeResponse);
  if (!currentStatus.canRegister) return { ok: false as const, reason: statusReason(currentStatus) || '号码探测未通过' };

  const openAIResult = await checkOpenAIPhoneForSMSBower(phoneInput, setDebugExchanges, openAIPhoneCheckEnabled);
  if (openAIResult.status === 'used') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check blocked registration', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: 'openai \u624b\u673a\u53f7\u5df2\u88ab\u4f7f\u7528' };
  }
  if (openAIResult.status === 'rate_limited') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check rate limited', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: openAIResult.message, stopTask: true };
  }
  if (openAIResult.status === 'session_expired') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check session expired', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: openAIResult.message, stopTask: true };
  }
  if (openAIResult.status === 'error') {
    appendDebugExchange(setDebugExchanges, debugInfo('OpenAI phone check failed', {
      phoneNumber: phoneInput.e164_number,
      result: openAIResult,
    }));
    return { ok: false as const, reason: openAIResult.message || 'OpenAI phone check failed' };
  }

  const registerBody = { ...phoneInput, delivery_method: 'sms' };
  const registerExchange = debugRequest('发起注册', '/api/wa/register', registerBody);
  setStage('register');
  appendDebugExchange(setDebugExchanges, registerExchange);
  try {
    const response = await registerPhone(phoneInput, 'sms');
    setProbe(response);
    patchDebugExchange(setDebugExchanges, registerExchange, { ...registerExchange, response: sanitizeDebugValue(response) });
    return { ok: true as const, response };
  } catch (error) {
    patchDebugExchange(setDebugExchanges, registerExchange, { ...registerExchange, error: debugError(error) });
    return { ok: false as const, reason: errorMessage(error) };
  }
}

async function checkOpenAIPhoneForSMSBower(
  phoneInput: PhoneInput,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
  enabled: boolean,
) {
  if (!enabled) {
    return { status: 'available' as const, message: 'OpenAI phone check disabled' };
  }
  const requestId = `openai-phone-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = {
    requestId,
    phoneNumber: phoneInput.e164_number,
    countryCallingCode: phoneInput.country_calling_code,
    nationalNumber: phoneInput.phone,
    countryIso2: phoneInput.country_iso2,
    mode: 'api' as const,
    timeoutMs: 120000,
  };
  const exchange = debugRequest('OpenAI phone check start', 'openai-phone:check', body);
  appendDebugExchange(setDebugExchanges, exchange);
  try {
    await window.openAIPhone.bridgeStatus();
    const result = normalizeOpenAIPhoneCheckResult(await window.openAIPhone.check(body));
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, response: sanitizeDebugValue(result) });
    return result;
  } catch (error) {
    const result = normalizeOpenAIPhoneCheckResult({ status: 'error', message: errorMessage(error) });
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, error: debugError(error) });
    return result;
  }
}

function selectSMSBowerPrice(prices: SMSBowerPrice[], config: SMSBowerPublicConfig) {
  return filterSMSBowerPrices(prices, config)
    .sort((left, right) => left.cost - right.cost)[0] || null;
}

function filterSMSBowerPrices(prices: SMSBowerPrice[], config: SMSBowerPublicConfig) {
  return prices.filter((item) => item.count > 0 && item.cost >= config.minPrice && item.cost <= config.maxPrice);
}

function smsbowerPriceErrorMessage(prices: SMSBowerPrice[], config: SMSBowerPublicConfig) {
  if (!prices.length) return 'SMSBower 没有返回 WhatsApp 价格数据，请确认国家 ID 是否正确，或稍后重试。';
  const stocked = prices.filter((item) => item.count > 0);
  if (!stocked.length) return 'SMSBower 当前国家的 WhatsApp 号码库存为 0，请更换国家或稍后重试。';
  const cheapest = stocked.sort((left, right) => left.cost - right.cost)[0];
  const summary = stocked.slice(0, 5).map((item) => `${item.cost}(${item.count})`).join(', ');
  if (cheapest && cheapest.cost > config.maxPrice) {
    return `SMSBower 有库存，但最低价格 ${cheapest.cost} 高于当前最高价 ${config.maxPrice}，请提高最高价格后再试。可用价格：${summary}`;
  }
  return `SMSBower 没有符合 ${config.minPrice}-${config.maxPrice} 的 WhatsApp 号码，请调整价格范围或更换国家。可用价格：${summary}`;
}

async function enqueueSMSCancelOrder(
  activationId: string,
  phone: string,
  reason: string,
  provider: SMSProvider,
  platformName: string,
  orderedAtMs: number,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
) {
  const exchange = debugRequest(`${platformName} enqueue cancel`, 'sms-cancel-queue:enqueue', {
    provider,
    activationId,
    phone,
    reason,
    orderedAtMs,
  });
  appendDebugExchange(setDebugExchanges, exchange);
  try {
    const item = await window.smsCancelQueue.enqueue({ provider, activationId, phone, reason, orderedAtMs });
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, response: sanitizeDebugValue(item) });
    return item;
  } catch (error) {
    patchDebugExchange(setDebugExchanges, exchange, { ...exchange, error: debugError(error) });
    throw error;
  }
}

const otpSubmitMaxAttempts = 3;
const otpSubmitRetryDelayMs = 3000;

type SubmitRegistrationOTPWithRetryInput = {
  accountID: string;
  verificationRequestID?: string;
  otp: string;
  label: string;
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>;
  stopRef?: React.MutableRefObject<boolean>;
  onRetry?: (attempt: number, error: unknown) => void;
};

async function submitRegistrationOTPWithRetry(input: SubmitRegistrationOTPWithRetryInput) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= otpSubmitMaxAttempts; attempt += 1) {
    if (input.stopRef?.current) throw new Error('SMSBower task was stopped by user');
    const body: Record<string, string | number> = {
      wa_account_id: input.accountID,
      otp: input.otp,
      attempt,
    };
    if (input.verificationRequestID) body.verification_request_id = input.verificationRequestID;
    const exchange = debugRequest(input.label, '/api/wa/actions/registration/resume-otp', body);
    appendDebugExchange(input.setDebugExchanges, exchange);
    try {
      const response = await submitRegistrationOTP(input.accountID, input.otp, {
        verificationRequestID: input.verificationRequestID,
      });
      patchDebugExchange(input.setDebugExchanges, exchange, { ...exchange, response: sanitizeDebugValue(response) });
      return response;
    } catch (error) {
      lastError = error;
      patchDebugExchange(input.setDebugExchanges, exchange, { ...exchange, error: debugError(error) });
      if (!isTransientOTPSubmitError(error) || attempt >= otpSubmitMaxAttempts) throw error;
      input.onRetry?.(attempt, error);
      appendDebugExchange(input.setDebugExchanges, debugInfo('OTP submit retry wait', {
        attempt,
        nextAttempt: attempt + 1,
        waitMs: otpSubmitRetryDelayMs,
        error: errorMessage(error),
      }));
      if (input.stopRef) await delayWithStop(otpSubmitRetryDelayMs, input.stopRef);
      else await delay(otpSubmitRetryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError));
}

async function waitForSMSBowerCode(
  activationId: string,
  config: SMSBowerPublicConfig,
  platformName: string,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
  stopRef: React.MutableRefObject<boolean>,
) {
  const started = Date.now();
  const timeoutMs = config.otpTimeoutSeconds * 1000;
  const intervalMs = config.pollIntervalSeconds * 1000;
  while (Date.now() - started < timeoutMs) {
    if (stopRef.current) return { code: '', reason: `${platformName} task was stopped by user` };
    await delay(intervalMs);
    if (stopRef.current) return { code: '', reason: `${platformName} task was stopped by user` };
    const statusExchange = debugRequest(`${platformName} getStatus`, 'sms-platform:getStatus', { id: activationId });
    appendDebugExchange(setDebugExchanges, statusExchange);
    try {
      const status = await window.smsPlatform.getStatus(activationId);
      patchDebugExchange(setDebugExchanges, statusExchange, { ...statusExchange, response: sanitizeDebugValue(status) });
      if (status.status === 'ok' && status.code) return { code: status.code, reason: '' };
      if (status.status === 'cancelled') return { code: '', reason: `${platformName} activation was already cancelled` };
      if (status.status === 'error') return { code: '', reason: status.error || status.raw || `${platformName} status returned an error` };
    } catch (error) {
      patchDebugExchange(setDebugExchanges, statusExchange, { ...statusExchange, error: debugError(error) });
      return { code: '', reason: errorMessage(error) };
    }
  }
  return { code: '', reason: `${platformName} OTP timed out` };
}

async function confirmAccountAppears(accountId: string) {
  let cursor = '';
  try {
    for (let page = 0; page < 20; page += 1) {
      const response = await getAccounts(cursor);
      if (response.accounts.some((account) => accountID(account) === accountId)) return true;
      if (!response.next_cursor) return false;
      cursor = response.next_cursor;
    }
    return false;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function delayWithStop(ms: number, stopRef: React.MutableRefObject<boolean>) {
  const started = Date.now();
  while (Date.now() - started < ms && !stopRef.current) {
    await delay(Math.min(250, ms - (Date.now() - started)));
  }
}

function platformStageLabel(stage: SMSBowerStage) {
  const labels: Record<SMSBowerStage, string> = {
    idle: '空闲',
    price: '检查价格',
    number: '下单取号',
    probe: '探测号码',
    register: '发起注册',
    otp: '等待验证码',
    submit: '提交 OTP',
  };
  return labels[stage];
}

function resolvePhoneInput(phone: string, countryCallingCode: string): PhoneInput | null {
  return normalizePhoneInput(phone, countryCallingCode);
}

function requirePhone(input: PhoneInput | null) {
  if (!input) throw new Error('请输入手机号和国家拨号码');
  return input;
}
