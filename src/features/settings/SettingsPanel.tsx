import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Server, Settings, Wifi } from 'lucide-react';
import { countryDisplayName, filterSMSBowerCountries, normalizeSMSBowerCountries, type SMSBowerCountry } from '../../smsbower-countries';
import { errorMessage } from '../../shared/errors';
import type { Toast } from '../../shared/toast';
import { InfoCard } from '../../shared/ui';

type SettingsForm = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localDataDir: string;
  autoStartLocalService: boolean;
  smsCancelQueuePollIntervalSeconds: number;
  password: string;
  smsProvider: SMSProvider;
  smsbowerApiKey: string;
  heroSMSApiKey: string;
  smsbower: Pick<
    SMSBowerPublicConfig,
    'enabled' | 'country' | 'minPrice' | 'maxPrice' | 'targetSuccessCount' | 'maxOrders' | 'numberIntervalSeconds' | 'openAIPhoneCheckEnabled' | 'pollIntervalSeconds' | 'otpTimeoutSeconds'
  >;
};

function SMSBowerSettingsFields({
  form,
  setForm,
  hasApiKey,
  hasHeroSMSApiKey,
  countries,
  countriesLoading,
  countriesError,
  onReloadCountries,
}: {
  form: SettingsForm;
  setForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
  hasApiKey?: boolean;
  hasHeroSMSApiKey?: boolean;
  countries: SMSBowerCountry[];
  countriesLoading: boolean;
  countriesError?: string;
  onReloadCountries: () => void;
}) {
  const [countryQuery, setCountryQuery] = useState('');
  const activeHasApiKey = form.smsProvider === 'hero-sms' ? hasHeroSMSApiKey : hasApiKey;
  const platformName = form.smsProvider === 'hero-sms' ? 'Hero-SMS' : 'SMSBower';
  const filteredCountries = filterSMSBowerCountries(countries, countryQuery).slice(0, 80);
  const selectedCountryLabel = countryDisplayName(countries, form.smsbower.country);
  const updateSMSBower = (patch: Partial<SettingsForm['smsbower']>) => setForm((current) => ({
    ...current,
    smsbower: { ...current.smsbower, ...patch },
  }));
  return (
    <div className="settings-subsection">
      <label className="check-row">
        <input checked={form.smsbower.enabled} onChange={(event) => updateSMSBower({ enabled: event.target.checked })} type="checkbox" />
        启用接码平台注册
      </label>
      <label>
        接码平台
        <select value={form.smsProvider} onChange={(event) => setForm((current) => ({ ...current, smsProvider: event.target.value as SMSProvider }))}>
          <option value="smsbower">SMSBower</option>
          <option value="hero-sms">Hero-SMS</option>
        </select>
      </label>
      <label className="check-row">
        <input checked={form.smsbower.openAIPhoneCheckEnabled} onChange={(event) => updateSMSBower({ openAIPhoneCheckEnabled: event.target.checked })} type="checkbox" />
        注册前检查 OpenAI 手机号占用
      </label>
      {form.smsProvider === 'smsbower' ? (
        <label>
          SMSBower API Key
          <input
            value={form.smsbowerApiKey}
            onChange={(event) => setForm((current) => ({ ...current, smsbowerApiKey: event.target.value }))}
            type="password"
            placeholder={hasApiKey ? '已保存，留空不修改' : '请输入 SMSBower API Key'}
          />
        </label>
      ) : (
        <label>
          Hero-SMS API Key
          <input
            value={form.heroSMSApiKey}
            onChange={(event) => setForm((current) => ({ ...current, heroSMSApiKey: event.target.value }))}
            type="password"
            placeholder={hasHeroSMSApiKey ? '已保存，留空不修改' : '请输入 Hero-SMS API Key'}
          />
        </label>
      )}
      <div className="form-grid two">
        <div className="form-field">
          国家
          <input
            value={countryQuery}
            onChange={(event) => setCountryQuery(event.target.value)}
            placeholder={activeHasApiKey ? '搜索国家名称或 ID' : `先保存 ${platformName} API Key`}
            disabled={!activeHasApiKey}
          />
          <span className="field-hint">{selectedCountryLabel ? `已选择：${selectedCountryLabel}` : `请选择 ${platformName} 国家列表里的国家 ID。`}</span>
          {countriesLoading ? <span className="field-hint">正在加载国家列表...</span> : null}
          {countriesError ? <span className="field-hint">{countriesError}</span> : null}
          {activeHasApiKey ? (
            <div className="country-picker">
              <div className="inline-actions">
                <button className="secondary-button" type="button" onClick={onReloadCountries}>刷新国家</button>
                <input value={form.smsbower.country} onChange={(event) => updateSMSBower({ country: event.target.value })} placeholder="手动输入国家 ID" />
              </div>
              {filteredCountries.length ? (
                <div className="country-options">
                  {filteredCountries.map((country) => (
                    <button
                      className={country.id === form.smsbower.country ? 'selected' : ''}
                      key={country.id}
                      type="button"
                      onClick={() => {
                        updateSMSBower({ country: country.id });
                        setCountryQuery(country.name);
                      }}
                    >
                      <span>{country.name}</span>
                      <small>ID: {country.id}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="field-hint">没有匹配国家，可使用手动国家 ID。</span>
              )}
            </div>
          ) : null}
        </div>
        <label>
          目标成功数
          <input value={form.smsbower.targetSuccessCount} onChange={(event) => updateSMSBower({ targetSuccessCount: Number(event.target.value) })} type="number" min="1" />
        </label>
        <label>
          最低价格
          <input value={form.smsbower.minPrice} onChange={(event) => updateSMSBower({ minPrice: Number(event.target.value) })} type="number" min="0" step="0.01" />
        </label>
        <label>
          最高价格
          <input value={form.smsbower.maxPrice} onChange={(event) => updateSMSBower({ maxPrice: Number(event.target.value) })} type="number" min="0" step="0.01" />
        </label>
        <label>
          最大下单数
          <input value={form.smsbower.maxOrders} onChange={(event) => updateSMSBower({ maxOrders: Number(event.target.value) })} type="number" min="1" />
        </label>
        <label>
          获取手机号间隔（秒）
          <input value={form.smsbower.numberIntervalSeconds} onChange={(event) => updateSMSBower({ numberIntervalSeconds: Number(event.target.value) })} type="number" min="0" placeholder="0 表示不等待" />
        </label>
        <label>
          轮询间隔秒
          <input value={form.smsbower.pollIntervalSeconds} onChange={(event) => updateSMSBower({ pollIntervalSeconds: Number(event.target.value) })} type="number" min="2" />
        </label>
        <label>
          验证码超时秒
          <input value={form.smsbower.otpTimeoutSeconds} onChange={(event) => updateSMSBower({ otpTimeoutSeconds: Number(event.target.value) })} type="number" min="30" />
        </label>
      </div>
      <span className="field-hint">服务项目固定使用 WhatsApp，平台未配置完整时添加账号页不会显示平台注册。</span>
    </div>
  );
}

export function SettingsPanel({ notify }: { notify: (kind: Toast['kind'], message: string) => void; compact?: boolean }) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['config'], queryFn: () => window.waConfig.get() });
  const serviceQuery = useQuery({ queryKey: ['service'], queryFn: () => window.waService.status(), refetchInterval: 10000 });
  const [form, setForm] = useState<SettingsForm>({
    mode: 'remote' as ClientMode,
    remoteBaseUrl: '',
    localDataDir: '',
    autoStartLocalService: false,
    smsCancelQueuePollIntervalSeconds: 5,
    password: '',
    smsProvider: 'smsbower',
    smsbowerApiKey: '',
    heroSMSApiKey: '',
    smsbower: {
      enabled: false,
      country: '',
      minPrice: 0,
      maxPrice: 0,
      targetSuccessCount: 1,
      maxOrders: 3,
      numberIntervalSeconds: 0,
      openAIPhoneCheckEnabled: false,
      pollIntervalSeconds: 5,
      otpTimeoutSeconds: 600,
    },
  });
  const smsbowerCountriesQuery = useQuery({
    queryKey: ['sms-platform-countries', form.smsProvider],
    queryFn: async () => normalizeSMSBowerCountries(await window.smsPlatform.getCountries({ provider: form.smsProvider })),
    enabled: Boolean(form.smsProvider === 'hero-sms' ? configQuery.data?.smsbower.hasHeroSMSApiKey : configQuery.data?.smsbower.hasApiKey),
    staleTime: 60 * 60 * 1000,
  });
  useEffect(() => {
    if (!configQuery.data) return;
    setForm((current) => ({
      ...current,
      mode: configQuery.data.mode,
      remoteBaseUrl: configQuery.data.remoteBaseUrl,
      localDataDir: configQuery.data.localDataDir,
      autoStartLocalService: configQuery.data.autoStartLocalService,
      smsCancelQueuePollIntervalSeconds: configQuery.data.smsCancelQueuePollIntervalSeconds,
      smsProvider: configQuery.data.smsProvider,
      smsbower: {
        enabled: configQuery.data.smsbower.enabled,
        country: configQuery.data.smsbower.country,
        minPrice: configQuery.data.smsbower.minPrice,
        maxPrice: configQuery.data.smsbower.maxPrice,
        targetSuccessCount: configQuery.data.smsbower.targetSuccessCount,
        maxOrders: configQuery.data.smsbower.maxOrders,
        numberIntervalSeconds: configQuery.data.smsbower.numberIntervalSeconds,
        openAIPhoneCheckEnabled: configQuery.data.smsbower.openAIPhoneCheckEnabled,
        pollIntervalSeconds: configQuery.data.smsbower.pollIntervalSeconds,
        otpTimeoutSeconds: configQuery.data.smsbower.otpTimeoutSeconds,
      },
    }));
  }, [configQuery.data]);
  const saveMutation = useMutation({
    mutationFn: () => window.waConfig.set({
      ...form,
      password: form.password || undefined,
      smsbowerApiKey: form.smsbowerApiKey || undefined,
      heroSMSApiKey: form.heroSMSApiKey || undefined,
    }),
    onSuccess: async () => {
      notify('success', '连接配置已保存');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const testMutation = useMutation({
    mutationFn: () => window.waConfig.testConnection({
      ...form,
      password: form.password || undefined,
      smsbowerApiKey: form.smsbowerApiKey || undefined,
      heroSMSApiKey: form.heroSMSApiKey || undefined,
    }),
    onSuccess: async (result) => {
      notify(result.ok ? 'success' : 'error', result.ok ? '连接测试成功' : result.error || '连接测试失败');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      await queryClient.invalidateQueries({ queryKey: ['connection'] });
    },
  });
  const startMutation = useMutation({
    mutationFn: () => window.waService.start(),
    onSuccess: (status) => {
      notify(status.running ? 'success' : 'error', status.error || (status.running ? '本地服务已启动' : '本地服务不可用'));
      void serviceQuery.refetch();
    },
  });
  const stopMutation = useMutation({
    mutationFn: () => window.waService.stop(),
    onSuccess: () => {
      notify('info', '本地服务已停止');
      void serviceQuery.refetch();
    },
  });
  return (
    <section className="settings-page">
      <div className="section-title">
        <h1>连接与本地服务</h1>
        <p>默认连接远程服务；本地模式已预留启动入口，检测到 wa-app-service 后即可使用。</p>
      </div>
      <div className="two-column">
        <InfoCard title="连接配置" icon={<Settings size={17} />}>
          <div className="form-grid">
            <label>
              模式
              <select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as ClientMode })}>
                <option value="remote">远程服务</option>
                <option value="local">本地内置</option>
              </select>
            </label>
            <label>
              远程服务地址
              <input value={form.remoteBaseUrl} onChange={(event) => setForm({ ...form, remoteBaseUrl: event.target.value })} />
            </label>
            <label>
              访问密码
              <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} type="password" placeholder={configQuery.data?.hasPassword ? '已保存，留空不修改' : '请输入访问密码'} />
              {configQuery.data?.authPasswordRef ? <span className="field-hint">Password saved in local secure storage</span> : null}
            </label>
            <label>
              本地数据目录
              <input value={form.localDataDir} onChange={(event) => setForm({ ...form, localDataDir: event.target.value })} />
            </label>
            <label className="check-row">
              <input checked={form.autoStartLocalService} onChange={(event) => setForm({ ...form, autoStartLocalService: event.target.checked })} type="checkbox" />
              本地模式启动时自动启动服务
            </label>
            <label>
              取消队列扫描间隔（秒）
              <input value={form.smsCancelQueuePollIntervalSeconds} onChange={(event) => setForm({ ...form, smsCancelQueuePollIntervalSeconds: Number(event.target.value) })} type="number" min="1" max="300" />
            </label>
            <SMSBowerSettingsFields
              form={form}
              setForm={setForm}
              hasApiKey={configQuery.data?.smsbower.hasApiKey}
              hasHeroSMSApiKey={configQuery.data?.smsbower.hasHeroSMSApiKey}
              countries={smsbowerCountriesQuery.data || []}
              countriesLoading={smsbowerCountriesQuery.isFetching}
              countriesError={smsbowerCountriesQuery.error ? errorMessage(smsbowerCountriesQuery.error) : ''}
              onReloadCountries={() => void smsbowerCountriesQuery.refetch()}
            />
            <div className="inline-actions">
              <button className="primary-button" onClick={() => saveMutation.mutate()}>
                <Save size={15} />
                保存
              </button>
              <button className="secondary-button" onClick={() => testMutation.mutate()}>
                <Wifi size={15} />
                测试连接
              </button>
            </div>
          </div>
        </InfoCard>
        <InfoCard title="本地服务预留" icon={<Server size={17} />}>
          <div className="service-card">
            <p><strong>状态：</strong>{serviceQuery.data?.running ? '运行中' : '未运行'}</p>
            <p><strong>地址：</strong>{serviceQuery.data?.baseUrl || '-'}</p>
            <p><strong>二进制：</strong>{serviceQuery.data?.localServiceAvailable ? '已找到' : '未找到'}</p>
            <div className="inline-actions">
              <button className="secondary-button" onClick={() => startMutation.mutate()}>启动本地服务</button>
              <button className="secondary-button" onClick={() => stopMutation.mutate()}>停止</button>
            </div>
          </div>
        </InfoCard>
      </div>
    </section>
  );
}
