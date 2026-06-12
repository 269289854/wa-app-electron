import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import {
  AtSign,
  Check,
  Circle,
  Contact,
  Fingerprint,
  KeyRound,
  Loader2,
  MessageCircle,
  MonitorCog,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react';
import './styles.css';
import {
  accountAvatarPath,
  accountID,
  accountTitle,
  assetDataUrl,
  contactAvatarPath,
  deleteAccount,
  deleteContact,
  deleteMessages,
  getAccounts,
  getClientProfiles,
  getConnections,
  getContacts,
  getMessages,
  getOtpMessages,
  getTwoFactorStatus,
  markMessagesRead,
  messageText,
  messageTime,
  normalizeContacts,
  probePhoneSMS,
  registerPhone,
  removeProfilePicture,
  resolveContacts,
  requestEmailOtp,
  sendTextMessage,
  setAccountEmail,
  setProfileName,
  setProfilePicture,
  setTwoFactorPIN,
  submitRegistrationOTP,
  verifyEmailOtp,
  timestampValue,
  type PhoneInput,
} from './api';
import { normalizePhoneInput } from './phone-input';
import { probeStatus, registrationMethods, statusReason } from './result-model';
import { cancelSMSBowerActivation, type SMSBowerCancelLogEntry } from './smsbower-cancel';
import { countryDisplayName, filterSMSBowerCountries, normalizeSMSBowerCountries, type SMSBowerCountry } from './smsbower-countries';
import type { AccountMessage, ClientProfile, WAAccount, WorkflowResponse } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string };
type View = 'chats' | 'account' | 'add' | 'settings';

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/chats" replace />} />
          <Route path="/:view" element={<DesktopApp />} />
          <Route path="*" element={<Navigate to="/chats" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}

function DesktopApp() {
  const navigate = useNavigate();
  const routeView = useParams<{ view?: string }>().view;
  const view = routeView === 'account' || routeView === 'add' || routeView === 'settings' || routeView === 'chats' ? routeView : 'chats';
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

  useEffect(() => {
    if (!selectedAccountID && filteredAccounts[0]) setSelectedAccountID(accountID(filteredAccounts[0]));
  }, [filteredAccounts, selectedAccountID]);

  useEffect(() => {
    if (routeView && view !== routeView) navigate('/chats', { replace: true });
  }, [navigate, routeView, view]);

  const selectedAccount = accounts.find((account) => accountID(account) === selectedAccountID);
  const connected = apiReady;

  return (
    <div className="app-shell" data-view={view}>
      <aside className="account-rail">
        <div className="brand-block">
          <div className="brand-mark">WA</div>
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
          <button className={view === 'chats' ? 'active' : ''} onClick={() => setView('chats')}>
            <MessageCircle size={16} />
            消息
          </button>
          <button className={view === 'account' ? 'active' : ''} onClick={() => setView('account')}>
            <ShieldCheck size={16} />
            账号
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
        ) : view === 'add' ? (
          <AddAccountPanel notify={notify} onChanged={() => { setAccountCursor(''); void queryClient.invalidateQueries({ queryKey: ['accounts'] }); }} />
        ) : view === 'account' ? (
          <AccountPanel
            account={selectedAccount}
            avatarVersion={accountAvatarVersion}
            notify={notify}
            onAvatarChanged={() => setAccountAvatarVersion(String(Date.now()))}
            onChanged={() => { setAccountCursor(''); void queryClient.invalidateQueries({ queryKey: ['accounts'] }); }}
          />
        ) : view === 'settings' ? (
          <SettingsPanel notify={notify} compact={false} />
        ) : (
          <ChatPanel
            account={selectedAccount}
            selectedContactID={selectedContactID}
            onSelectContact={setSelectedContactID}
            notify={notify}
          />
        )}
      </main>
      <ToastStack toasts={toasts} />
    </div>
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

function AccountRow({ account, active, connection, connectionLoading, avatarVersion, onClick }: { account: WAAccount; active: boolean; connection?: LongConnectionRecord; connectionLoading: boolean; avatarVersion: string; onClick: () => void }) {
  const id = accountID(account);
  const view = connectionView(connection, connectionLoading);
  return (
    <button className={`account-row ${active ? 'active' : ''}`} onClick={onClick}>
      <span className={`connection-dot ${view.tone}`} title={view.label} aria-label={view.label} />
      <RemoteAvatar path={accountAvatarPath(id, avatarVersion || String(account.audit?.updated_at || 'latest'))} label={accountTitle(account)} />
      <span>
        <strong>{accountTitle(account)}</strong>
        <small>{account.phone?.e164_number || id}</small>
      </span>
    </button>
  );
}

function ChatPanel({ account, selectedContactID, onSelectContact, notify }: { account?: WAAccount; selectedContactID: string; onSelectContact: (id: string) => void; notify: (kind: Toast['kind'], message: string) => void }) {
  const queryClient = useQueryClient();
  const accountId = accountID(account);
  const contactsQuery = useQuery({ queryKey: ['contacts', accountId], queryFn: () => getContacts(accountId), enabled: Boolean(accountId), refetchInterval: 30000 });
  const contacts = useMemo(() => normalizeContacts(contactsQuery.data?.contacts || []), [contactsQuery.data]);
  const activeContactID = contacts.some((contact) => contact.contact_id === selectedContactID) ? selectedContactID : contacts[0]?.contact_id || '';
  useEffect(() => {
    if (activeContactID && activeContactID !== selectedContactID) onSelectContact(activeContactID);
  }, [activeContactID, onSelectContact, selectedContactID]);
  const messagesQuery = useQuery({ queryKey: ['messages', accountId, activeContactID], queryFn: () => getMessages(accountId, activeContactID), enabled: Boolean(accountId && activeContactID), refetchInterval: 8000 });
  const sendMutation = useMutation({
    mutationFn: (text: string) => sendTextMessage(accountId, activeContactID, text),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages', accountId, activeContactID] });
      await queryClient.invalidateQueries({ queryKey: ['contacts', accountId] });
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const readMutation = useMutation({
    mutationFn: (contactID: string) => markMessagesRead(accountId, contactID),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', accountId, activeContactID] });
      void queryClient.invalidateQueries({ queryKey: ['contacts', accountId] });
    },
  });
  const deleteContactMutation = useMutation({
    mutationFn: (contactID: string) => deleteContact(accountId, contactID),
    onSuccess: () => notify('success', '联系人和本地会话已删除'),
    onError: (error) => notify('error', errorMessage(error)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['contacts', accountId] }),
  });
  const resolveAttemptedRef = useRef('');
  const { mutate: resolveContactJIDs, isPending: resolvingContacts } = useMutation({
    mutationFn: (jids: string[]) => resolveContacts(accountId, jids),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['contacts', accountId] }),
  });
  useEffect(() => {
    const targets = unresolvedContactJIDs(contactsQuery.data?.contacts || []);
    const signature = `${accountId}:${targets.join('\n')}`;
    if (!accountId || targets.length === 0 || resolvingContacts || resolveAttemptedRef.current === signature) return;
    resolveAttemptedRef.current = signature;
    resolveContactJIDs(targets);
  }, [accountId, contactsQuery.data?.contacts, resolveContactJIDs, resolvingContacts]);
  const deleteMessageMutation = useMutation({
    mutationFn: (messageID: string) => deleteMessages(accountId, [messageID]),
    onSuccess: () => notify('success', '消息已删除'),
    onError: (error) => notify('error', errorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', accountId, activeContactID] });
      void queryClient.invalidateQueries({ queryKey: ['contacts', accountId] });
      void queryClient.invalidateQueries({ queryKey: ['otp', accountId] });
    },
  });

  if (!account) return <EmptyState icon={<MessageCircle />} title="选择账号" detail="左侧选择账号后查看联系人和消息。" />;
  return (
    <section className="chat-layout">
      <ContactList
        accountID={accountId}
        contacts={contacts}
        loading={contactsQuery.isLoading}
        activeID={activeContactID}
        onSelect={(id) => {
          onSelectContact(id);
          readMutation.mutate(id);
        }}
        onDelete={(id) => {
          if (window.confirm('删除该联系人和本地会话？')) deleteContactMutation.mutate(id);
        }}
      />
      <Thread
        accountID={accountId}
        contact={contacts.find((item) => item.contact_id === activeContactID)}
        messages={messagesQuery.data?.messages || []}
        loading={messagesQuery.isFetching}
        sending={sendMutation.isPending}
        onSend={(text) => sendMutation.mutate(text)}
        deletingMessageID={deleteMessageMutation.variables}
        onDeleteMessage={(messageID) => {
          if (window.confirm('删除这条本地消息？')) deleteMessageMutation.mutate(messageID);
        }}
      />
    </section>
  );
}

function ContactList({ contacts, loading, activeID, onSelect, onDelete }: { accountID: string; contacts: ReturnType<typeof normalizeContacts>; loading: boolean; activeID: string; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const visible = contacts.filter((contact) => `${contact.title} ${contact.subtitle} ${contact.preview}`.toLowerCase().includes(query.trim().toLowerCase()));
  const unread = contacts.reduce((sum, contact) => sum + Number(contact.unread || 0), 0);
  return (
    <aside className="contact-pane">
      <div className="pane-header">
        <div>
          <h2>联系人</h2>
          <p>{contacts.length} 个会话{unread ? ` · ${unread} 条未读` : ''}</p>
        </div>
        {loading ? <Loader2 className="spin muted-icon" size={16} /> : null}
      </div>
      <label className="search-box">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索联系人" />
      </label>
      <div className="scroll-list">
        {visible.map((contact) => (
          <button className={`contact-row ${activeID === contact.contact_id ? 'active' : ''}`} key={contact.contact_id} onClick={() => onSelect(contact.contact_id)}>
            <RemoteAvatar path={contactAvatarPath(contact.contact_id, String(contact.profile_picture_id || 'latest'))} label={contact.title} />
            <span className="contact-main">
              <strong>{contact.title}</strong>
              <small>{contact.preview || contact.subtitle}</small>
            </span>
            <span className="contact-meta">
              <small>{formatDate(contact.lastAt)}</small>
              {contact.unread ? <b>{contact.unread}</b> : null}
            </span>
            <span className="row-tools">
              <Trash2 size={14} onClick={(event) => { event.stopPropagation(); onDelete(contact.contact_id); }} />
            </span>
          </button>
        ))}
        {!loading && visible.length === 0 ? <p className="muted centered">暂无联系人</p> : null}
      </div>
    </aside>
  );
}

function Thread({
  accountID: _accountID,
  contact,
  messages,
  loading,
  sending,
  deletingMessageID,
  onSend,
  onDeleteMessage,
}: {
  accountID: string;
  contact?: ReturnType<typeof normalizeContacts>[number];
  messages: AccountMessage[];
  loading: boolean;
  sending: boolean;
  deletingMessageID?: string;
  onSend: (text: string) => void;
  onDeleteMessage: (messageID: string) => void;
}) {
  const [text, setText] = useState('');
  const sorted = [...messages].sort((left, right) => Number(messageTime(left)?.getTime() || 0) - Number(messageTime(right)?.getTime() || 0));
  return (
    <section className="thread-pane">
      <div className="thread-header">
        {contact ? <RemoteAvatar path={contactAvatarPath(contact.contact_id, String(contact.profile_picture_id || 'latest'))} label={contact.title} /> : <div className="avatar ghost"><Contact size={18} /></div>}
        <div>
          <h2>{contact?.title || '暂无联系人'}</h2>
          <p>{contact?.subtitle || '等待消息或选择联系人'}</p>
        </div>
        {loading ? <Loader2 className="spin muted-icon" size={16} /> : null}
      </div>
      <div className="message-list">
        {sorted.map((message, index) => (
          <MessageBubble
            key={message.account_message_id || message.message_id || index}
            message={message}
            deleting={deletingMessageID === message.account_message_id}
            onDelete={onDeleteMessage}
          />
        ))}
        {!loading && sorted.length === 0 ? <EmptyState icon={<MessageCircle />} title="暂无消息" detail="收到消息后会显示在这里。" /> : null}
      </div>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = text.trim();
          if (!trimmed || !contact) return;
          onSend(trimmed);
          setText('');
        }}
      >
        <input value={text} onChange={(event) => setText(event.target.value)} disabled={!contact || sending} placeholder={contact ? '输入文本消息' : '选择联系人后发送'} />
        <button disabled={!contact || sending || !text.trim()}>
          {sending ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
        </button>
      </form>
    </section>
  );
}

function MessageBubble({ message, deleting, onDelete }: { message: AccountMessage; deleting: boolean; onDelete: (messageID: string) => void }) {
  const outgoing = String(message.direction || '').toLowerCase().includes('out') || String(message.ack_status || '').length > 0;
  const messageID = message.account_message_id || '';
  return (
    <div className={`bubble-line ${outgoing ? 'outgoing' : 'incoming'}`}>
      <div className="bubble">
        <p>{messageText(message) || '[非文本消息]'}</p>
        <span className="bubble-meta">
          <time>{formatDate(messageTime(message), true)}</time>
          {messageID ? (
            <button className="message-delete-button" disabled={deleting} title="删除消息" onClick={() => onDelete(messageID)}>
              {deleting ? <Loader2 className="spin" size={13} /> : <Trash2 size={13} />}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function AccountPanel({ account, avatarVersion, notify, onChanged, onAvatarChanged }: { account?: WAAccount; avatarVersion: string; notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void; onAvatarChanged: () => void }) {
  const queryClient = useQueryClient();
  const accountId = accountID(account);
  const profilesQuery = useQuery({ queryKey: ['profiles', accountId], queryFn: () => getClientProfiles(accountId), enabled: Boolean(accountId), refetchInterval: 30000 });
  const otpQuery = useQuery({ queryKey: ['otp', accountId], queryFn: () => getOtpMessages(accountId), enabled: Boolean(accountId), refetchInterval: 30000 });
  const connectionsQuery = useQuery({ queryKey: ['connections', accountId], queryFn: () => getConnections({ wa_account_id: accountId }), enabled: Boolean(accountId), refetchInterval: 10000 });
  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount(accountId),
    onSuccess: () => {
      notify('success', '账号已删除');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  if (!account) return <EmptyState icon={<ShieldCheck />} title="选择账号" detail="左侧选择账号后查看资料、安全和设备指纹。" />;
  return (
    <section className="account-page">
      <div className="account-hero">
        <RemoteAvatar path={accountAvatarPath(accountId, avatarVersion || String(account.audit?.updated_at || 'latest'))} label={accountTitle(account)} large />
        <div>
          <h1>{accountTitle(account)}</h1>
          <p>{account.phone?.e164_number || accountId}</p>
          <span className="status-pill ok"><Circle size={10} fill="currentColor" />{String(account.status || 'ACTIVE')}</span>
        </div>
        <button className="danger-button" onClick={() => window.confirm('确定删除该账号？') && deleteMutation.mutate()}>
          <Trash2 size={15} />
          删除账号
        </button>
      </div>
      {isRegistrationPending(account) ? <ManualOtpCard account={account} notify={notify} onChanged={onChanged} /> : null}
      <div className="dashboard-grid">
        <ProfileCard account={account} notify={notify} onChanged={() => { onChanged(); void queryClient.invalidateQueries({ queryKey: ['accounts'] }); }} onAvatarChanged={onAvatarChanged} />
        <AccountInfoCard account={account} />
        <SecurityCard account={account} notify={notify} />
        <InfoCard title="设备指纹" icon={<Fingerprint size={17} />}>
          <ProfilesList profiles={profilesQuery.data?.client_profiles || []} loading={profilesQuery.isLoading} />
        </InfoCard>
        <InfoCard title="OTP 历史" icon={<KeyRound size={17} />}>
          <MessageMiniList messages={[...(otpQuery.data?.otp_messages || []), ...(otpQuery.data?.messages || [])]} />
        </InfoCard>
        <InfoCard title="长连接" icon={<Server size={17} />}>
          <pre className="json-box">{JSON.stringify(connectionsQuery.data || {}, null, 2)}</pre>
        </InfoCard>
      </div>
    </section>
  );
}

function ManualOtpCard({ account, notify, onChanged }: { account: WAAccount; notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void }) {
  const [otp, setOtp] = useState('');
  const accountId = accountID(account);
  const otpMutation = useMutation({
    mutationFn: () => submitRegistrationOTP(accountId, otp.trim()),
    onSuccess: (result) => {
      notify(result.success === false || result.error_message ? 'error' : 'success', result.error_message || 'OTP 已提交');
      setOtp('');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  return (
    <InfoCard title="提交注册 OTP" icon={<KeyRound size={17} />}>
      <div className="form-grid two">
        <label>
          验证码
          <input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D+/g, '').slice(0, 8))} type="password" inputMode="numeric" autoComplete="one-time-code" />
        </label>
        <button className="primary-button" disabled={!otp.trim() || otpMutation.isPending} onClick={() => otpMutation.mutate()}>
          {otpMutation.isPending ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}
          提交
        </button>
      </div>
    </InfoCard>
  );
}

function AccountInfoCard({ account }: { account: WAAccount }) {
  const rows = [
    { label: '账号 ID', value: accountID(account) },
    { label: '手机号', value: account.phone?.e164_number || '-' },
    { label: '国家', value: account.phone?.country_iso2 || '-' },
    { label: '拨号码', value: account.phone?.country_calling_code || '-' },
    { label: '创建时间', value: formatDate(timestampValue(account.audit?.created_at), true) || '-' },
    { label: '更新时间', value: formatDate(timestampValue(account.audit?.updated_at), true) || '-' },
  ];
  return (
    <InfoCard title="账号信息" icon={<MonitorCog size={17} />}>
      <dl className="info-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </InfoCard>
  );
}

function ProfileCard({ account, notify, onChanged, onAvatarChanged }: { account: WAAccount; notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void; onAvatarChanged: () => void }) {
  const [name, setName] = useState(account.display_name || '');
  const [fileName, setFileName] = useState('');
  const [pendingPicture, setPendingPicture] = useState<{ fileName: string; dataUrl: string; scale: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const accountId = accountID(account);
  const resetPicture = () => {
    setPendingPicture(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };
  const nameMutation = useMutation({
    mutationFn: () => setProfileName(accountId, name.trim()),
    onSuccess: () => {
      notify('success', '名称已提交');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const pictureMutation = useMutation({
    mutationFn: async () => {
      if (!pendingPicture) throw new Error('请选择头像图片');
      const dataUrl = await cropAvatarDataUrl(pendingPicture.dataUrl, pendingPicture.scale);
      return setProfilePicture(accountId, dataUrl.slice(dataUrl.indexOf(',') + 1), 'image/jpeg');
    },
    onSuccess: () => {
      notify('success', '头像已提交');
      onAvatarChanged();
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const removeMutation = useMutation({
    mutationFn: () => removeProfilePicture(accountId),
    onSuccess: () => {
      notify('success', '头像移除请求已提交');
      onAvatarChanged();
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  return (
    <InfoCard title="资料" icon={<Contact size={17} />}>
      <div className="form-grid">
        <label>
          显示名
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={25} />
        </label>
        <button className="primary-button" disabled={!name.trim() || nameMutation.isPending} onClick={() => nameMutation.mutate()}>
          <Save size={15} />
          保存名称
        </button>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              notify('error', '头像图片不能超过 2 MiB');
              return;
            }
            readFileDataUrl(file).then((dataUrl) => {
              setFileName(file.name);
              setPendingPicture({ fileName: file.name, dataUrl, scale: 1 });
            }).catch((error) => notify('error', errorMessage(error)));
          }}
        />
        <div className="inline-actions">
          <button className="secondary-button" onClick={() => fileRef.current?.click()}>
            <Upload size={15} />
            {fileName || '上传头像'}
          </button>
          <button className="secondary-button" data-action="refresh-avatar" onClick={onAvatarChanged}>
            <RefreshCw size={15} />
            刷新头像
          </button>
        </div>
        {pendingPicture ? (
          <div className="avatar-cropper">
            <div className="crop-preview">
              <img src={pendingPicture.dataUrl} alt={pendingPicture.fileName} style={{ transform: `scale(${pendingPicture.scale})` }} />
            </div>
            <label>
              头像缩放
              <input
                type="range"
                min="1"
                max="2.5"
                step="0.05"
                value={pendingPicture.scale}
                onChange={(event) => setPendingPicture({ ...pendingPicture, scale: Number(event.target.value) })}
              />
            </label>
            <div className="inline-actions">
              <button className="primary-button" disabled={pictureMutation.isPending} onClick={() => pictureMutation.mutate()}>
                <Check size={15} />
                提交头像
              </button>
              <button className="secondary-button" onClick={resetPicture}>取消</button>
            </div>
          </div>
        ) : null}
        <button className="secondary-button" onClick={() => removeMutation.mutate()}>移除头像</button>
      </div>
    </InfoCard>
  );
}

function SecurityCard({ account, notify }: { account: WAAccount; notify: (kind: Toast['kind'], message: string) => void }) {
  const accountId = accountID(account);
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const statusQuery = useQuery({ queryKey: ['2fa', accountId], queryFn: () => getTwoFactorStatus(accountId, true), enabled: false });
  const makeMutation = (fn: () => Promise<unknown>, message: string) => useMutation({
    mutationFn: fn,
    onSuccess: () => {
      notify('success', message);
      void statusQuery.refetch();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const pinMutation = makeMutation(() => setTwoFactorPIN(accountId, pin), '2FA PIN 请求已提交');
  const emailMutation = makeMutation(() => setAccountEmail(accountId, email), '邮箱设置请求已提交');
  const otpRequestMutation = makeMutation(() => requestEmailOtp(accountId), '邮箱 OTP 已请求');
  const otpVerifyMutation = makeMutation(() => verifyEmailOtp(accountId, emailOtp), '邮箱 OTP 校验请求已提交');
  return (
    <InfoCard title="安全" icon={<ShieldCheck size={17} />}>
      <div className="security-status">
        <button className="secondary-button" onClick={() => void statusQuery.refetch()}>
          <RefreshCw size={15} className={statusQuery.isFetching ? 'spin' : ''} />
          同步状态
        </button>
        <span>{statusQuery.data?.status?.configured ? '2FA 已配置' : '2FA 未知/未配置'}</span>
        <span>{statusQuery.data?.status?.email_address || '未显示邮箱'}</span>
      </div>
      <div className="form-grid two">
        <label>
          6 位 PIN
          <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D+/g, '').slice(0, 6))} type="password" />
        </label>
        <button className="primary-button" disabled={pin.length !== 6 || pinMutation.isPending} onClick={() => pinMutation.mutate()}>
          <KeyRound size={15} />
          设置/修改 PIN
        </button>
        <label>
          邮箱
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <button className="primary-button" disabled={!email || emailMutation.isPending} onClick={() => emailMutation.mutate()}>
          <AtSign size={15} />
          设置邮箱
        </button>
        <label>
          邮箱 OTP
          <input value={emailOtp} onChange={(event) => setEmailOtp(event.target.value.replace(/\D+/g, '').slice(0, 6))} type="password" />
        </label>
        <div className="inline-actions">
          <button className="secondary-button" onClick={() => otpRequestMutation.mutate()}>请求 OTP</button>
          <button className="primary-button" disabled={emailOtp.length !== 6} onClick={() => otpVerifyMutation.mutate()}>
            <Check size={15} />
            校验
          </button>
        </div>
      </div>
    </InfoCard>
  );
}

function AddAccountPanel({ notify, onChanged }: { notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['config'], queryFn: () => window.waConfig.get() });
  const smsbowerCountriesQuery = useQuery({
    queryKey: ['smsbower-countries'],
    queryFn: async () => normalizeSMSBowerCountries(await window.smsbower.getCountries()),
    enabled: Boolean(configQuery.data?.smsbower.hasApiKey),
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
    const config = configQuery.data?.smsbower || (await window.waConfig.get()).smsbower;
    if (!config.configured) throw new Error('SMSBower is not configured');
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
      message: 'Checking SMSBower price',
    });
    appendDebugExchange(setDebugExchanges, debugInfo('SMSBower start', {
      country: config.country,
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
      targetSuccessCount: config.targetSuccessCount,
      maxOrders: config.maxOrders,
      numberIntervalSeconds: config.numberIntervalSeconds,
    }));
    const prices = await window.smsbower.getPrices({ country: config.country });
    appendDebugExchange(setDebugExchanges, debugInfo('SMSBower prices', {
      country: config.country,
      service: 'wa',
      minPrice: config.minPrice,
      maxPrice: config.maxPrice,
      availablePrices: prices,
      inRangePrices: prices.filter((item) => item.count > 0 && item.cost >= config.minPrice && item.cost <= config.maxPrice),
    }));
    const price = selectSMSBowerPrice(prices, config);
    if (!price) throw new Error(smsbowerPriceErrorMessage(prices, config));
    appendDebugExchange(setDebugExchanges, debugInfo('SMSBower price ok', price));

    let successes = 0;
    let orders = 0;
    while (successes < config.targetSuccessCount && orders < config.maxOrders && !stopPlatformRef.current) {
      const nextOrder = orders + 1;
      if (orders > 0 && config.numberIntervalSeconds > 0) {
        setPlatformState((state) => ({ ...state, stage: 'number', message: `Waiting ${config.numberIntervalSeconds}s before next number` }));
        appendDebugExchange(setDebugExchanges, debugInfo('SMSBower number interval', {
          seconds: config.numberIntervalSeconds,
          nextOrder,
        }));
        await delayWithStop(config.numberIntervalSeconds * 1000, stopPlatformRef);
        if (stopPlatformRef.current) break;
      }
      orders += 1;
      setPlatformState((state) => ({ ...state, stage: 'number', orders, message: `Buying number ${orders}/${config.maxOrders}` }));
      const numberExchange = debugRequest('SMSBower getNumber', 'smsbower:getNumber', { country: config.country, service: 'wa', maxPrice: config.maxPrice });
      appendDebugExchange(setDebugExchanges, numberExchange);
      let number: SMSBowerNumberResult;
      try {
        number = await window.smsbower.getNumber({ country: config.country, maxPrice: config.maxPrice });
        patchDebugExchange(setDebugExchanges, numberExchange, { ...numberExchange, response: sanitizeDebugValue(number) });
      } catch (error) {
        patchDebugExchange(setDebugExchanges, numberExchange, { ...numberExchange, error: debugError(error) });
        appendDebugExchange(setDebugExchanges, debugInfo('SMSBower task stopped', { order: orders, error: errorMessage(error) }));
        throw error;
      }

      let completed = false;
      let cancelReason = '';
      try {
        const normalized = normalizePhoneInput(number.phone, '');
        setPlatformState((state) => ({ ...state, stage: 'probe', currentPhone: number.phone, activationId: number.activationId, message: 'Probing WA registration route' }));
        if (!normalized) {
          cancelReason = 'SMSBower returned an invalid phone number';
          appendDebugExchange(setDebugExchanges, debugInfo('SMSBower invalid number', number));
          continue;
        }
        setCountryCallingCode(normalized.country_calling_code);
        setPhone(normalized.phone);

        const registration = await probeAndRegisterForSMSBower(normalized, setAddAccountStage, setDebugExchanges, setProbe);
        if (!registration.ok) {
          cancelReason = registration.reason || 'WA registration was skipped';
          appendDebugExchange(setDebugExchanges, debugInfo('SMSBower WA registration skipped', {
            activationId: number.activationId,
            reason: cancelReason,
          }));
          continue;
        }
        const waAccountId = registration.response.wa_account_id || '';
        if (!waAccountId) {
          cancelReason = 'WA registration response did not include wa_account_id';
          appendDebugExchange(setDebugExchanges, debugInfo('SMSBower missing wa_account_id', registration.response));
          continue;
        }
        setPendingAccountID(waAccountId);
        setPlatformState((state) => ({ ...state, stage: 'otp', message: 'Waiting for SMSBower OTP code' }));
        const codeResult = await waitForSMSBowerCode(number.activationId, config, setDebugExchanges, stopPlatformRef);
        if (!codeResult.code) {
          cancelReason = codeResult.reason;
          continue;
        }

        setPlatformState((state) => ({ ...state, stage: 'submit', message: 'Submitting OTP to wa-app' }));
        const otpExchange = debugRequest('Submit SMSBower OTP', '/api/wa/actions/registration/resume-otp', { wa_account_id: waAccountId, otp: codeResult.code });
        appendDebugExchange(setDebugExchanges, otpExchange);
        try {
          const otpResponse = await submitRegistrationOTP(waAccountId, codeResult.code);
          patchDebugExchange(setDebugExchanges, otpExchange, { ...otpExchange, response: sanitizeDebugValue(otpResponse) });
          const exists = await confirmAccountAppears(waAccountId);
          if (!exists) throw new Error(otpResponse.error_message || 'OTP submitted but account was not found in the account list');
          completed = true;
          const doneExchange = debugRequest('SMSBower setStatus complete', 'smsbower:setStatus', { id: number.activationId, status: 6 });
          appendDebugExchange(setDebugExchanges, doneExchange);
          try {
            const done = await window.smsbower.setStatus({ id: number.activationId, status: 6 });
            patchDebugExchange(setDebugExchanges, doneExchange, { ...doneExchange, response: sanitizeDebugValue(done) });
          } catch (error) {
            patchDebugExchange(setDebugExchanges, doneExchange, { ...doneExchange, error: debugError(error) });
            appendDebugExchange(setDebugExchanges, debugInfo('SMSBower setStatus complete failed', { activationId: number.activationId, error: errorMessage(error) }));
          }
          successes += 1;
          setPlatformState((state) => ({ ...state, successes, stage: 'number', message: `Success ${successes}/${config.targetSuccessCount}` }));
          await queryClient.invalidateQueries({ queryKey: ['accounts'] });
          onChanged();
        } catch (error) {
          cancelReason = errorMessage(error);
          patchDebugExchange(setDebugExchanges, otpExchange, { ...otpExchange, error: debugError(error) });
          appendDebugExchange(setDebugExchanges, debugInfo('SMSBower OTP submit failed', { activationId: number.activationId, error: cancelReason }));
        }
      } catch (error) {
        cancelReason = errorMessage(error);
        appendDebugExchange(setDebugExchanges, debugInfo('SMSBower order failed', { activationId: number.activationId, error: cancelReason }));
      } finally {
        if (!completed && cancelReason) {
          setPlatformState((state) => ({ ...state, message: `Cancelling SMSBower order ${number.activationId}` }));
          await cancelSMSBowerOrder(number.activationId, cancelReason, setDebugExchanges);
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
      const body = { wa_account_id: pendingAccountID, otp };
      const exchange = debugRequest('提交 OTP', '/api/wa/actions/registration/resume-otp', body);
      try {
        const response = await submitRegistrationOTP(pendingAccountID, otp);
        setDebugExchanges([{ ...exchange, response: sanitizeDebugValue(response) }]);
        return response;
      } catch (error) {
        setDebugExchanges([{ ...exchange, error: debugError(error) }]);
        throw error;
      }
    },
    onSuccess: (result) => {
      notify(result.success === false || result.error_message ? 'error' : 'success', result.error_message || 'OTP 已提交');
      setOtp('');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const platformConfigured = Boolean(configQuery.data?.smsbower.configured);
  const platformCountryLabel = countryDisplayName(smsbowerCountriesQuery.data || [], configQuery.data?.smsbower.country || '');
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
              OTP
              <input value={otp} onChange={(event) => setOtp(event.target.value)} type="password" disabled={addAccountBusy} />
            </label>
            <button className="primary-button" disabled={!pendingAccountID || !otp || addAccountBusy} onClick={() => otpMutation.mutate()}>
              {otpMutation.isPending ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}
              提交 OTP
            </button>
          </div>
        </InfoCard>
      </div>
      {platformConfigured ? (
        <InfoCard title="SMSBower 平台注册" icon={<MessageCircle size={17} />}>
          <div className="platform-register">
            <div className="platform-stats">
              <span>国家 {platformCountryLabel || '-'}</span>
              <span>价格 {configQuery.data?.smsbower.minPrice}-{configQuery.data?.smsbower.maxPrice}</span>
              <span>成功 {platformState.successes}/{configQuery.data?.smsbower.targetSuccessCount || 0}</span>
              <span>下单 {platformState.orders}/{configQuery.data?.smsbower.maxOrders || 0}</span>
            </div>
            <div className={`result-banner ${platformBusy ? 'warn' : platformState.successes ? 'ok' : ''}`}>
              <strong>{platformStageLabel(platformState.stage)}</strong>
              <span>{platformState.message || '使用 SMSBower 购买 WhatsApp 号码，自动探测、注册、等待验证码并提交 OTP。'}</span>
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

type DebugExchange = {
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

type SettingsForm = {
  mode: ClientMode;
  remoteBaseUrl: string;
  localDataDir: string;
  autoStartLocalService: boolean;
  password: string;
  smsbowerApiKey: string;
  smsbower: Pick<
    SMSBowerPublicConfig,
    'enabled' | 'country' | 'minPrice' | 'maxPrice' | 'targetSuccessCount' | 'maxOrders' | 'numberIntervalSeconds' | 'pollIntervalSeconds' | 'otpTimeoutSeconds'
  >;
};

function debugRequest(label: string, path: string, body: unknown): DebugExchange {
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

function debugError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };
}

function replaceDebugExchange(items: DebugExchange[], target: DebugExchange, next: DebugExchange) {
  return items.map((item) => item === target || (item.label === target.label && item.at === target.at) ? next : item);
}

function appendDebugExchange(setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>, exchange: DebugExchange) {
  setDebugExchanges((items) => [exchange, ...items]);
}

function patchDebugExchange(setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>, target: DebugExchange, next: DebugExchange) {
  setDebugExchanges((items) => replaceDebugExchange(items, target, next));
}

function debugInfo(label: string, body: unknown): DebugExchange {
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

async function probeAndRegisterForSMSBower(
  phoneInput: PhoneInput,
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

function selectSMSBowerPrice(prices: SMSBowerPrice[], config: SMSBowerPublicConfig) {
  return prices
    .filter((item) => item.count > 0 && item.cost >= config.minPrice && item.cost <= config.maxPrice)
    .sort((left, right) => left.cost - right.cost)[0] || null;
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

async function cancelSMSBowerOrder(
  activationId: string,
  reason: string,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
) {
  return cancelSMSBowerActivation(
    activationId,
    reason,
    (input) => window.smsbower.setStatus(input),
    (entry) => appendDebugExchange(setDebugExchanges, smsbowerCancelExchange(entry)),
  );
}

function smsbowerCancelExchange(entry: SMSBowerCancelLogEntry): DebugExchange {
  const exchange = debugRequest('SMSBower setStatus cancel', 'smsbower:setStatus', {
    id: entry.id,
    status: entry.status,
    reason: entry.reason,
    attempt: entry.attempt,
  });
  if (entry.response !== undefined) return { ...exchange, response: sanitizeDebugValue(entry.response) };
  if (entry.error !== undefined) return { ...exchange, error: debugError(entry.error) };
  return exchange;
}

async function waitForSMSBowerCode(
  activationId: string,
  config: SMSBowerPublicConfig,
  setDebugExchanges: React.Dispatch<React.SetStateAction<DebugExchange[]>>,
  stopRef: React.MutableRefObject<boolean>,
) {
  const started = Date.now();
  const timeoutMs = config.otpTimeoutSeconds * 1000;
  const intervalMs = config.pollIntervalSeconds * 1000;
  while (Date.now() - started < timeoutMs) {
    if (stopRef.current) return { code: '', reason: 'SMSBower task was stopped by user' };
    await delay(intervalMs);
    if (stopRef.current) return { code: '', reason: 'SMSBower task was stopped by user' };
    const statusExchange = debugRequest('SMSBower getStatus', 'smsbower:getStatus', { id: activationId });
    appendDebugExchange(setDebugExchanges, statusExchange);
    try {
      const status = await window.smsbower.getStatus(activationId);
      patchDebugExchange(setDebugExchanges, statusExchange, { ...statusExchange, response: sanitizeDebugValue(status) });
      if (status.status === 'ok' && status.code) return { code: status.code, reason: '' };
      if (status.status === 'cancelled') return { code: '', reason: 'SMSBower activation was already cancelled' };
      if (status.status === 'error') return { code: '', reason: status.error || status.raw || 'SMSBower status returned an error' };
    } catch (error) {
      patchDebugExchange(setDebugExchanges, statusExchange, { ...statusExchange, error: debugError(error) });
      return { code: '', reason: errorMessage(error) };
    }
  }
  return { code: '', reason: 'SMSBower OTP timed out' };
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

function sanitizeDebugValue(value: unknown): unknown {
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

function SMSBowerSettingsFields({
  form,
  setForm,
  hasApiKey,
  countries,
  countriesLoading,
  countriesError,
  onReloadCountries,
}: {
  form: SettingsForm;
  setForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
  hasApiKey?: boolean;
  countries: SMSBowerCountry[];
  countriesLoading: boolean;
  countriesError?: string;
  onReloadCountries: () => void;
}) {
  const [countryQuery, setCountryQuery] = useState('');
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
        启用 SMSBower 平台注册
      </label>
      <label>
        SMSBower API Key
        <input
          value={form.smsbowerApiKey}
          onChange={(event) => setForm((current) => ({ ...current, smsbowerApiKey: event.target.value }))}
          type="password"
          placeholder={hasApiKey ? '已保存，留空不修改' : '请输入 SMSBower API Key'}
        />
      </label>
      <div className="form-grid two">
        <div className="form-field">
          国家
          <input
            value={countryQuery}
            onChange={(event) => setCountryQuery(event.target.value)}
            placeholder={hasApiKey ? '搜索国家名称或 ID' : '先保存 SMSBower API Key'}
            disabled={!hasApiKey}
          />
          <span className="field-hint">{selectedCountryLabel ? `已选择：${selectedCountryLabel}` : '请选择 SMSBower 国家列表里的国家 ID。'}</span>
          {countriesLoading ? <span className="field-hint">正在加载国家列表...</span> : null}
          {countriesError ? <span className="field-hint">{countriesError}</span> : null}
          {hasApiKey ? (
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
  const smsbowerCountriesQuery = useQuery({
    queryKey: ['smsbower-countries'],
    queryFn: async () => normalizeSMSBowerCountries(await window.smsbower.getCountries()),
    enabled: Boolean(configQuery.data?.smsbower.hasApiKey),
    staleTime: 60 * 60 * 1000,
  });
  const [form, setForm] = useState<SettingsForm>({
    mode: 'remote' as ClientMode,
    remoteBaseUrl: '',
    localDataDir: '',
    autoStartLocalService: false,
    password: '',
    smsbowerApiKey: '',
    smsbower: {
      enabled: false,
      country: '',
      minPrice: 0,
      maxPrice: 0,
      targetSuccessCount: 1,
      maxOrders: 3,
      numberIntervalSeconds: 0,
      pollIntervalSeconds: 5,
      otpTimeoutSeconds: 600,
    },
  });
  useEffect(() => {
    if (!configQuery.data) return;
    setForm((current) => ({
      ...current,
      mode: configQuery.data.mode,
      remoteBaseUrl: configQuery.data.remoteBaseUrl,
      localDataDir: configQuery.data.localDataDir,
      autoStartLocalService: configQuery.data.autoStartLocalService,
      smsbower: {
        enabled: configQuery.data.smsbower.enabled,
        country: configQuery.data.smsbower.country,
        minPrice: configQuery.data.smsbower.minPrice,
        maxPrice: configQuery.data.smsbower.maxPrice,
        targetSuccessCount: configQuery.data.smsbower.targetSuccessCount,
        maxOrders: configQuery.data.smsbower.maxOrders,
        numberIntervalSeconds: configQuery.data.smsbower.numberIntervalSeconds,
        pollIntervalSeconds: configQuery.data.smsbower.pollIntervalSeconds,
        otpTimeoutSeconds: configQuery.data.smsbower.otpTimeoutSeconds,
      },
    }));
  }, [configQuery.data]);
  const saveMutation = useMutation({
    mutationFn: () => window.waConfig.set({ ...form, password: form.password || undefined, smsbowerApiKey: form.smsbowerApiKey || undefined }),
    onSuccess: async () => {
      notify('success', '连接配置已保存');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const testMutation = useMutation({
    mutationFn: () => window.waConfig.testConnection({ ...form, password: form.password || undefined }),
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
            <SMSBowerSettingsFields
              form={form}
              setForm={setForm}
              hasApiKey={configQuery.data?.smsbower.hasApiKey}
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

function InfoCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="info-card">
      <header>
        <span>{icon}</span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function ProfilesList({ profiles, loading }: { profiles: ClientProfile[]; loading: boolean }) {
  if (loading) return <InlineLoading text="加载设备指纹" />;
  if (!profiles.length) return <p className="muted">暂无客户端 profile。</p>;
  return (
    <div className="profile-list">
      {profiles.map((profile, index) => (
        <ProfileFingerprintBlock profile={profile} key={profile.client_profile_id || index} />
      ))}
    </div>
  );
}

function ProfileFingerprintBlock({ profile }: { profile: ClientProfile }) {
  const fingerprint = profile.device_fingerprint;
  const rows = fingerprint ? [
    { label: '指纹 ID', value: fingerprint.fingerprint_id },
    { label: 'FDID', value: fingerprint.fdid },
    { label: 'Android', value: fingerprint.android_version },
    { label: 'RAM / Radio', value: [ramLabel(fingerprint.device_ram_gib), radioLabel(fingerprint.network_radio_type)].filter(Boolean).join(' / ') },
    { label: 'MCC/MNC', value: pairLabel(fingerprint.mcc, fingerprint.mnc) },
    { label: 'SIM MCC/MNC', value: pairLabel(fingerprint.sim_mcc, fingerprint.sim_mnc) },
    { label: 'Phone Hash', value: fingerprint.phone_sha256_prefix ? `${fingerprint.phone_sha256_prefix}...` : '' },
    { label: '生成时间', value: formatDate(timestampValue(fingerprint.created_at), true) },
  ] : [];
  return (
    <article className="profile-block">
      <header>
        <div>
          <strong>{deviceTitle(fingerprint)}</strong>
          <small>{profile.client_profile_id || profile.protocol_profile_id || 'Client profile'}</small>
        </div>
        <span className={`profile-status ${profileStatusTone(profile.status)}`}>{profileStatusLabel(profile.status)}</span>
      </header>
      {rows.length ? (
        <dl className="fingerprint-grid">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value || '-'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">没有可展示的设备指纹。</p>
      )}
      <small className="profile-meta">{[profile.app_version, profile.locale_language, profile.locale_country].filter(Boolean).join(' · ') || JSON.stringify(profile.device || {}).slice(0, 90)}</small>
    </article>
  );
}

function MessageMiniList({ messages }: { messages: AccountMessage[] }) {
  if (!messages.length) return <p className="muted">暂无 OTP 记录。</p>;
  return (
    <div className="mini-list">
      {messages.slice(0, 8).map((message, index) => (
        <div key={message.account_message_id || index}>
          <strong>{messageText(message) || 'OTP 消息'}</strong>
          <small>{formatDate(messageTime(message), true)}</small>
        </div>
      ))}
    </div>
  );
}

function RemoteAvatar({ path, label, large = false }: { path: string; label: string; large?: boolean }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let cancelled = false;
    setSrc('');
    if (!path) return undefined;
    assetDataUrl(path).then((value) => {
      if (!cancelled) setSrc(value);
    }).catch(() => {
      if (!cancelled) setSrc('');
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return <span className={`avatar ${large ? 'large' : ''}`}>{src ? <img src={src} alt={label} /> : initials(label)}</span>;
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => <div className={`toast ${toast.kind}`} key={toast.id}>{toast.message}</div>)}
    </div>
  );
}

function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function InlineLoading({ text }: { text: string }) {
  return <p className="inline-loading"><Loader2 size={14} className="spin" />{text}</p>;
}

function resolvePhoneInput(phone: string, countryCallingCode: string): PhoneInput | null {
  return normalizePhoneInput(phone, countryCallingCode);
}

function requirePhone(input: PhoneInput | null) {
  if (!input) throw new Error('请输入手机号和国家拨号码');
  return input;
}

type LongConnectionRecord = Record<string, unknown>;

function mergeAccounts(current: WAAccount[], next: WAAccount[]) {
  const merged = new Map(current.map((account) => [accountID(account), account]));
  for (const account of next) {
    const id = accountID(account);
    if (id) merged.set(id, account);
  }
  return [...merged.values()];
}

function filterAccounts(accounts: WAAccount[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return accounts;
  return accounts.filter((account) => {
    const haystack = [accountTitle(account), account.phone?.e164_number, account.phone?.country_iso2, accountID(account)].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalized);
  });
}

function indexConnections(data?: { states?: LongConnectionRecord[]; connections?: LongConnectionRecord[] }) {
  const records = [...(data?.connections || []), ...(data?.states || [])];
  return records.reduce((map, record) => {
    const id = String(record.wa_account_id || '');
    if (!id) return map;
    const current = map.get(id);
    if (!current || betterConnection(record, current)) map.set(id, record);
    return map;
  }, new Map<string, LongConnectionRecord>());
}

function connectionView(connection: LongConnectionRecord | undefined, loading: boolean) {
  const status = String(connection?.status || '').toLowerCase();
  if (loading && !connection) return { label: '连接状态加载中', tone: 'idle' };
  if (connection?.connected === true || status.includes('connected') || status.includes('heartbeat')) return { label: '已连接', tone: 'ok' };
  if (status.includes('reconnect') || status.includes('starting')) return { label: '连接中', tone: 'warn' };
  if (status.includes('failed') || status.includes('error')) return { label: '连接失败', tone: 'bad' };
  return { label: '未连接', tone: 'idle' };
}

function connectionRank(connection: LongConnectionRecord) {
  const tone = connectionView(connection, false).tone;
  if (tone === 'ok') return 0;
  if (tone === 'warn') return 1;
  if (tone === 'bad') return 2;
  return 3;
}

function betterConnection(next: LongConnectionRecord, current: LongConnectionRecord) {
  const nextRank = connectionRank(next);
  const currentRank = connectionRank(current);
  if (nextRank !== currentRank) return nextRank < currentRank;
  return timestampMs(next) > timestampMs(current);
}

function timestampMs(record: LongConnectionRecord) {
  const date = timestampValue(record.updated_at || record.last_heartbeat_at || record.connected_at || record.created_at);
  return date?.getTime() || 0;
}

function isRegistrationPending(account: WAAccount) {
  const status = String(account.status || '').toLowerCase();
  return status === '2' || status.includes('pending_registration') || status.includes('pending registration') || status.includes('otp');
}

function deviceTitle(fingerprint?: ClientProfile['device_fingerprint']) {
  return fingerprint ? [fingerprint.device_vendor, fingerprint.device_model].filter(Boolean).join(' ') || '未知设备' : '未知设备';
}

function pairLabel(a?: string, b?: string) {
  return [a, b].filter(Boolean).join('/');
}

function ramLabel(value?: string | number) {
  return value === undefined || value === null || value === '' ? '' : `${value} GiB`;
}

function radioLabel(value?: string | number) {
  const key = String(value || '');
  const labels: Record<string, string> = { '1': 'GPRS', '2': 'EDGE', '3': 'UMTS', '9': 'HSDPA', '13': 'LTE', '20': 'NR' };
  return key ? labels[key] || key : '';
}

function profileStatusLabel(status: unknown) {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) return '未知';
  if (normalized.includes('active') || normalized === '1') return '可用';
  if (normalized.includes('disabled') || normalized.includes('blocked') || normalized.includes('failed')) return '不可用';
  if (normalized.includes('pending')) return '等待中';
  return String(status);
}

function profileStatusTone(status: unknown) {
  const label = profileStatusLabel(status);
  if (label === '可用') return 'ok';
  if (label === '等待中') return 'warn';
  if (label === '不可用') return 'bad';
  return 'idle';
}

function unresolvedContactJIDs(records: Array<{ jid?: string; display_name?: string; number?: string; profile_picture_id?: string }>) {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const jid = String(record.jid || '').trim();
    const displayName = String(record.display_name || '').trim();
    const needsResolve = !record.profile_picture_id || !record.number || !displayName || displayName === '未知联系人' || displayName.startsWith('LID ') || displayName.startsWith('联系人');
    if (!jid.endsWith('@lid') || !needsResolve || seen.has(jid)) continue;
    seen.add(jid);
    targets.push(jid);
    if (targets.length >= 20) break;
  }
  return targets;
}

function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function cropAvatarDataUrl(sourceDataUrl: string, scale: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('无法创建图片画布'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size, size);
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / Math.max(1, scale);
      const sx = Math.max(0, (image.naturalWidth - sourceSize) / 2);
      const sy = Math.max(0, (image.naturalHeight - sourceSize) / 2);
      context.drawImage(image, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    image.onerror = () => reject(new Error('头像图片读取失败'));
    image.src = sourceDataUrl;
  });
}

function initials(label: string) {
  const text = label.trim();
  if (!text) return 'WA';
  return [...text].slice(0, 2).join('').toUpperCase();
}

function formatDate(date: Date | null, withTime = false) {
  if (!date) return '';
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('reason=blocked') || normalized.includes('number is blocked')) return '号码被 WhatsApp 拒绝或封禁，当前协议链路无法发起验证码。';
  if (normalized.includes('too_recent') || normalized.includes('too_many') || normalized.includes('cooling down') || normalized.includes('rate_limited')) return '请求过于频繁，正在冷却中，请稍后再试。';
  if (normalized.includes('no_routes') || normalized.includes('route_unavailable')) return '暂无可用验证码通道，请换 SMS/语音或稍后再试。';
  if (normalized.includes('smsbower has no numbers')) return 'SMSBower 当前无法按这个国家/价格下单：平台返回 NO_NUMBERS。请检查国家参数是否为 SMSBower 国家 ID，或提高最高价格/更换国家后再试。';
  if (normalized.includes('smsbower balance is insufficient')) return 'SMSBower 余额不足，平台返回 NO_BALANCE。';
  return message;
}

createRoot(document.getElementById('root')!).render(<App />);
