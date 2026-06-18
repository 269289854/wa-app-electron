import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import {
  Contact,
  ListChecks,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  accountID,
  accountTitle,
  getAccounts,
  getConnections,
} from '../api';
import {
  filterAccounts,
  indexConnections,
  mergeAccounts,
} from '../features/accounts/account-model';
import { AccountPanel } from '../features/accounts/AccountPanel';
import { AccountRow } from '../features/accounts/AccountRow';
import {
  cancelQueueTabs,
  invalidateSMSCancelQueue,
  providerLabel,
  queueStatusLabel,
  refetchOrBacktrackQueuePage,
} from '../features/cancel-queue/cancel-queue-model';
import { ChatPanel } from '../features/chat/ChatPanel';
import { AddAccountPanel } from '../features/registration/AddAccountPanel';
import { countryDisplayName, filterSMSBowerCountries, normalizeSMSBowerCountries, type SMSBowerCountry } from '../smsbower-countries';
import type { WAAccount } from '../types';
import appIconUrl from '../assets/app-icon.png';
import launchSplashUrl from '../assets/launch-splash.png';
import { errorMessage } from '../shared/errors';
import { countdownLabel, formatDate } from '../shared/format';
import type { Toast } from '../shared/toast';
import { InfoCard, InlineLoading, ToastStack } from '../shared/ui';

type View = 'chats' | 'account' | 'add' | 'settings' | 'cancel-queue';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/chats" replace />} />
      <Route path="/:view" element={<DesktopApp />} />
      <Route path="*" element={<Navigate to="/chats" replace />} />
    </Routes>
  );
}

function DesktopApp() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const routeView = useParams<{ view?: string }>().view;
  const view = routeView === 'account' || routeView === 'add' || routeView === 'settings' || routeView === 'chats' || routeView === 'cancel-queue' ? routeView : 'chats';
  const setView = (next: View) => navigate(`/${next}`);
  const [selectedAccountID, setSelectedAccountID] = useState('');
  const [selectedContactID, setSelectedContactID] = useState('');
  const [accountCursor, setAccountCursor] = useState('');
  const [loadedAccounts, setLoadedAccounts] = useState<WAAccount[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountAvatarVersion, setAccountAvatarVersion] = useState(() => String(Date.now()));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = (kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, kind, message }]);
    window.setTimeout(() => setToasts((items) => items.filter((toast) => toast.id !== id)), 4200);
  };

  const configQuery = useQuery({ queryKey: ['config'], queryFn: () => window.waConfig.get() });
  const connectionQuery = useQuery({
    queryKey: ['connection'],
    queryFn: () => window.waConfig.testConnection(),
    enabled: Boolean(configQuery.data),
    refetchInterval: 30000,
  });
  const needsRemotePassword = configQuery.data?.mode === 'remote' && !configQuery.data.hasPassword;
  const apiReady = connectionQuery.data?.ok === true && !needsRemotePassword;
  const accountsQuery = useQuery({
    queryKey: ['accounts', accountCursor],
    queryFn: () => getAccounts(accountCursor),
    enabled: apiReady,
    refetchInterval: 10000,
  });
  const connectionsQuery = useQuery({
    queryKey: ['connections'],
    queryFn: () => getConnections(),
    enabled: apiReady,
    refetchInterval: 5000,
  });
  const pageAccounts = accountsQuery.data?.accounts || [];
  useEffect(() => {
    if (!accountsQuery.data) return;
    setLoadedAccounts((current) => mergeAccounts(accountCursor ? current : [], pageAccounts));
  }, [accountCursor, accountsQuery.data, pageAccounts]);
  useEffect(() => {
    if (connectionQuery.data?.ok !== true) {
      setAccountCursor('');
      setLoadedAccounts([]);
    }
  }, [connectionQuery.data?.ok]);
  const accounts = loadedAccounts.length ? loadedAccounts : pageAccounts;
  const filteredAccounts = useMemo(() => filterAccounts(accounts, accountSearch), [accountSearch, accounts]);
  const connections = useMemo(() => indexConnections(connectionsQuery.data), [connectionsQuery.data]);
  const cancelQueueStatusQuery = useQuery({
    queryKey: ['sms-cancel-queue-status'],
    queryFn: () => window.smsCancelQueue.status(),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!selectedAccountID && filteredAccounts[0]) setSelectedAccountID(accountID(filteredAccounts[0]));
  }, [filteredAccounts, selectedAccountID]);

  useEffect(() => {
    if (routeView && view !== routeView) navigate('/chats', { replace: true });
  }, [navigate, routeView, view]);

  const selectedAccount = accounts.find((account) => accountID(account) === selectedAccountID);
  const connected = apiReady;
  const refreshAccounts = useCallback(() => {
    setAccountCursor('');
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
  }, [queryClient]);

  if (configQuery.isLoading) return <LaunchScreen />;

  return (
    <div className="app-shell" data-view={view}>
      <aside className="account-rail">
        <div className="brand-block">
          <img className="brand-mark" src={appIconUrl} alt="" aria-hidden="true" />
          <div>
            <strong>WA App</strong>
            <span>桌面客户端</span>
          </div>
        </div>
        <button className="rail-action" onClick={() => setView('add')}>
          <Plus size={16} />
          添加账号
        </button>
        <label className="rail-search">
          <Search size={15} />
          <input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="搜索账号" />
        </label>
        <div className="rail-list">
          {accountsQuery.isLoading && !accounts.length ? <InlineLoading text="加载账号" /> : null}
          {filteredAccounts.map((account) => (
            <AccountRow
              key={accountID(account)}
              account={account}
              connection={connections.get(accountID(account))}
              connectionLoading={connectionsQuery.isLoading}
              avatarVersion={accountAvatarVersion}
              active={selectedAccountID === accountID(account)}
              onClick={() => {
                setSelectedAccountID(accountID(account));
                setView('chats');
              }}
            />
          ))}
          {!accountsQuery.isLoading && accounts.length === 0 ? <p className="muted small">还没有账号，先添加一个。</p> : null}
          {!accountsQuery.isLoading && accounts.length > 0 && filteredAccounts.length === 0 ? <p className="muted small">没有匹配的账号。</p> : null}
          {accountsQuery.data?.next_cursor ? (
            <button className="load-more-button" disabled={accountsQuery.isFetching} onClick={() => setAccountCursor(accountsQuery.data?.next_cursor || '')}>
              {accountsQuery.isFetching ? <Loader2 className="spin" size={14} /> : null}
              加载更多账号
            </button>
          ) : null}
        </div>
        <nav className="bottom-nav">
          <PrimaryViewTabs view={view} onChange={setView} />
          <button className={view === 'cancel-queue' ? 'active' : ''} onClick={() => setView('cancel-queue')}>
            <ListChecks size={16} />
            取消队列{cancelQueueStatusQuery.data?.active ? ` (${cancelQueueStatusQuery.data.active})` : ''}
          </button>
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
            <Settings size={16} />
            设置
          </button>
        </nav>
      </aside>
      <main className="workspace">
        <TopBar
          connected={connected}
          config={configQuery.data}
          checking={connectionQuery.isFetching}
          error={needsRemotePassword ? 'Set the access password in Settings first.' : connectionQuery.data?.error}
          onRefresh={() => {
            void connectionQuery.refetch();
            if (apiReady) {
              void accountsQuery.refetch();
              void connectionsQuery.refetch();
            }
          }}
        />
        {!connected && view !== 'settings' ? (
          <SettingsPanel notify={notify} compact={false} />
        ) : (
          <>
            <div className="view-pane" hidden={view !== 'add'}>
              <AddAccountPanel notify={notify} onChanged={refreshAccounts} />
            </div>
            <div className="view-pane" hidden={view !== 'account'}>
              <AccountPanel
                account={selectedAccount}
                avatarVersion={accountAvatarVersion}
                notify={notify}
                onAvatarChanged={() => setAccountAvatarVersion(String(Date.now()))}
                onChanged={refreshAccounts}
              />
            </div>
            <div className="view-pane" hidden={view !== 'settings'}>
              <SettingsPanel notify={notify} compact={false} />
            </div>
            <div className="view-pane" hidden={view !== 'cancel-queue'}>
              <CancelQueuePanel notify={notify} />
            </div>
            <div className="view-pane" hidden={view !== 'chats'}>
              <ChatPanel
                account={selectedAccount}
                selectedContactID={selectedContactID}
                onSelectContact={setSelectedContactID}
                notify={notify}
              />
            </div>
          </>
        )}
      </main>
      <ToastStack toasts={toasts} />
    </div>
  );
}

function PrimaryViewTabs({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const tabs: Array<{ view: View; label: string; icon: React.ReactNode }> = [
    { view: 'chats', label: '消息', icon: <MessageCircle size={15} /> },
    { view: 'account', label: '账号', icon: <ShieldCheck size={15} /> },
  ];
  return (
    <div className="view-tabs" role="tablist" aria-label="主视图">
      {tabs.map((tab) => {
        const active = view === tab.view;
        return (
          <button
            aria-selected={active}
            className={`view-tab ${active ? 'active' : ''}`}
            key={tab.view}
            onClick={() => onChange(tab.view)}
            role="tab"
            title={tab.label}
            type="button"
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function LaunchScreen() {
  return (
    <main className="launch-screen" style={{ backgroundImage: `url(${launchSplashUrl})` }}>
      <section className="launch-panel" aria-live="polite">
        <img src={appIconUrl} alt="" aria-hidden="true" />
        <div>
          <strong>WA App</strong>
          <span><Loader2 className="spin" size={16} />加载中</span>
        </div>
      </section>
    </main>
  );
}

function TopBar({ connected, config, checking, error, onRefresh }: { connected: boolean; config?: ClientConfig; checking: boolean; error?: string; onRefresh: () => void }) {
  return (
    <header className="top-bar">
      <div className="status-group">
        <span className={`status-pill ${connected ? 'ok' : 'bad'}`}>
          {checking ? <Loader2 size={14} className="spin" /> : connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {connected ? '服务在线' : '未连接'}
        </span>
        <span className="endpoint">{config?.mode === 'local' ? config.localBaseUrl || '本地服务' : config?.remoteBaseUrl}</span>
        {error ? <span className="top-error">{error}</span> : null}
      </div>
      <button className="icon-button" title="刷新" onClick={onRefresh}>
        <RefreshCw size={16} className={checking ? 'spin' : ''} />
      </button>
    </header>
  );
}

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

function SettingsPanel({ notify }: { notify: (kind: Toast['kind'], message: string) => void; compact?: boolean }) {
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

function CancelQueuePanel({ notify }: { notify: (kind: Toast['kind'], message: string) => void }) {
  const queryClient = useQueryClient();
  const [statusTab, setStatusTab] = useState<SMSCancelQueueListStatus>('all');
  const [page, setPage] = useState(1);
  const now = Date.now();
  const pageSize = 20;
  const queueQuery = useQuery({
    queryKey: ['sms-cancel-queue', statusTab, page, pageSize],
    queryFn: () => window.smsCancelQueue.list({ status: statusTab, page, pageSize }),
    refetchInterval: 5000,
  });
  const statusQuery = useQuery({
    queryKey: ['sms-cancel-queue-status'],
    queryFn: () => window.smsCancelQueue.status(),
    refetchInterval: 5000,
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => window.smsCancelQueue.retry(id),
    onSuccess: async () => {
      notify('info', '已重新加入取消队列');
      await invalidateSMSCancelQueue(queryClient);
      await refetchOrBacktrackQueuePage(queueQuery.refetch, page, setPage);
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => window.smsCancelQueue.remove(id),
    onSuccess: async () => {
      notify('info', '已从本地取消队列移除');
      await invalidateSMSCancelQueue(queryClient);
      await refetchOrBacktrackQueuePage(queueQuery.refetch, page, setPage);
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const listResult = queueQuery.data;
  const items = listResult?.items || [];
  const activeItemsCount = statusQuery.data?.active ?? 0;
  const tabs = cancelQueueTabs(statusQuery.data);
  return (
    <section className="cancel-queue-page">
      <div className="section-title">
        <h1>取消队列</h1>
        <p>接码订单会在到达可取消时间后自动取消，Hero-SMS 会等待平台最短取消时间。</p>
      </div>
      <div className="dashboard-grid">
        <InfoCard title="队列状态" icon={<ListChecks size={17} />}>
          <dl className="info-grid">
            <div><dt>运行状态</dt><dd>{statusQuery.data?.running ? '运行中' : '未运行'}</dd></div>
            <div><dt>待处理</dt><dd>{activeItemsCount}</dd></div>
            <div><dt>已取消</dt><dd>{statusQuery.data?.cancelled ?? 0}</dd></div>
            <div><dt>数据库</dt><dd title={statusQuery.data?.dbPath}>{statusQuery.data?.dbPath || '-'}</dd></div>
          </dl>
          {statusQuery.data?.lastError ? <p className="field-hint">{statusQuery.data.lastError}</p> : null}
        </InfoCard>
        <InfoCard title="下一次处理" icon={<RefreshCw size={17} />}>
          <div className="service-card">
            <p><strong>下次到期：</strong>{statusQuery.data?.nextDueAtMs ? formatDate(new Date(statusQuery.data.nextDueAtMs), true) : '-'}</p>
            <p><strong>剩余时间：</strong>{statusQuery.data?.nextDueAtMs ? countdownLabel(statusQuery.data.nextDueAtMs, now) : '-'}</p>
          </div>
        </InfoCard>
      </div>
      <InfoCard title="号码列表" icon={<Contact size={17} />}>
        <div className="queue-tabs" role="tablist" aria-label="取消队列状态">
          {tabs.map((tab) => (
            <button
              className={statusTab === tab.status ? 'active' : ''}
              key={tab.status}
              onClick={() => {
                setStatusTab(tab.status);
                setPage(1);
              }}
              role="tab"
              type="button"
            >
              {tab.label}
              <span>{tab.count}</span>
            </button>
          ))}
        </div>
        {queueQuery.isLoading ? <InlineLoading text="加载取消队列" /> : null}
        {!queueQuery.isLoading && !items.length ? <p className="muted">当前状态暂无号码。</p> : null}
        <div className="queue-list">
          {items.map((item) => (
            <article className={`queue-item ${item.status}`} key={item.id}>
              <div>
                <strong>{providerLabel(item.provider)} · {item.phone || '-'}</strong>
                <small>{item.activationId}</small>
              </div>
              <div>
                <span className={`queue-status ${item.status}`}>{queueStatusLabel(item.status)}</span>
                <small>{item.status === 'pending' || item.status === 'failed' ? countdownLabel(item.notBeforeMs, now) : formatDate(new Date(item.updatedAtMs), true)}</small>
              </div>
              <p>{item.reason}</p>
              {item.lastError ? <p className="queue-error">{item.lastError}</p> : null}
              <div className="queue-meta">
                <span>尝试 {item.attempts}</span>
                <span>下单 {formatDate(new Date(item.orderedAtMs), true)}</span>
                <span>可取消 {formatDate(new Date(item.notBeforeMs), true)}</span>
              </div>
              <div className="inline-actions">
                <button className="secondary-button" disabled={retryMutation.isPending || item.status === 'processing' || item.status === 'removed'} onClick={() => retryMutation.mutate(item.id)}>重试</button>
                <button className="secondary-button" disabled={removeMutation.isPending || item.status === 'processing' || item.status === 'removed'} onClick={() => removeMutation.mutate(item.id)}>移除</button>
              </div>
            </article>
          ))}
        </div>
        <div className="queue-pagination">
          <button className="secondary-button" disabled={page <= 1 || queueQuery.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
          <span>第 {listResult?.page ?? page} / {listResult?.totalPages ?? 1} 页，共 {listResult?.total ?? 0} 条</span>
          <button className="secondary-button" disabled={(listResult?.page ?? page) >= (listResult?.totalPages ?? 1) || queueQuery.isFetching} onClick={() => setPage((value) => value + 1)}>下一页</button>
        </div>
      </InfoCard>
    </section>
  );
}

