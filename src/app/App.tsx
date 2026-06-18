import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import {
  ListChecks,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
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
import { CancelQueuePanel } from '../features/cancel-queue/CancelQueuePanel';
import { ChatPanel } from '../features/chat/ChatPanel';
import { AddAccountPanel } from '../features/registration/AddAccountPanel';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import type { WAAccount } from '../types';
import appIconUrl from '../assets/app-icon.png';
import launchSplashUrl from '../assets/launch-splash.png';
import type { Toast } from '../shared/toast';
import { InlineLoading, ToastStack } from '../shared/ui';

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

