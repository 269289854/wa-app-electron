import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, MessageCircle, MonitorCog, Plus, Send } from 'lucide-react';
import {
  isTransientOTPSubmitError,
  probePhoneSMS,
  registerPhone,
} from '../../api';
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
import {
  confirmAccountAppears,
  checkOpenAIPhoneForSMSBower,
  delayWithStop,
  enqueueSMSCancelOrder,
  filterSMSBowerPrices,
  platformStageLabel,
  probeAndRegisterForSMSBower,
  requirePhone,
  resolvePhoneInput,
  selectSMSBowerPrice,
  smsbowerPriceErrorMessage,
  submitRegistrationOTPWithRetry,
  waitForSMSBowerCode,
  type SMSBowerRegistrationTaskResult,
  type SMSBowerRunState,
} from './registration-task';

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

