import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  checkLoginState,
  contactAvatarPath,
  deleteAccount,
  deleteContact,
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
  requestEmailOtp,
  sendTextMessage,
  setAccountEmail,
  setProfileName,
  setProfilePicture,
  setTwoFactorPIN,
  submitRegistrationOTP,
  verifyEmailOtp,
  type PhoneInput,
} from './api';
import type { AccountMessage, ClientProfile, WAAccount, WAContact, WorkflowResponse } from './types';

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
      <DesktopApp />
    </QueryClientProvider>
  );
}

function DesktopApp() {
  const [view, setView] = useState<View>('chats');
  const [selectedAccountID, setSelectedAccountID] = useState('');
  const [selectedContactID, setSelectedContactID] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = (kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, kind, message }]);
    window.setTimeout(() => setToasts((items) => items.filter((toast) => toast.id !== id)), 4200);
  };

  const configQuery = useQuery({ queryKey: ['config'], queryFn: () => window.waDesktop.waConfig.get() });
  const connectionQuery = useQuery({
    queryKey: ['connection'],
    queryFn: () => window.waDesktop.waConfig.testConnection(),
    enabled: Boolean(configQuery.data),
    refetchInterval: 30000,
  });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(),
    enabled: connectionQuery.data?.ok === true,
    refetchInterval: 10000,
  });
  const accounts = accountsQuery.data?.accounts || [];

  useEffect(() => {
    if (!selectedAccountID && accounts[0]) setSelectedAccountID(accountID(accounts[0]));
  }, [accounts, selectedAccountID]);

  const selectedAccount = accounts.find((account) => accountID(account) === selectedAccountID);
  const connected = connectionQuery.data?.ok === true;

  return (
    <div className="app-shell">
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
        <div className="rail-list">
          {accountsQuery.isLoading ? <InlineLoading text="加载账号" /> : null}
          {accounts.map((account) => (
            <AccountRow
              key={accountID(account)}
              account={account}
              active={selectedAccountID === accountID(account)}
              onClick={() => {
                setSelectedAccountID(accountID(account));
                setView('chats');
              }}
            />
          ))}
          {!accountsQuery.isLoading && accounts.length === 0 ? <p className="muted small">还没有账号，先添加一个。</p> : null}
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
          error={connectionQuery.data?.error}
          onRefresh={() => {
            void connectionQuery.refetch();
            void accountsQuery.refetch();
          }}
        />
        {!connected ? (
          <SettingsPanel notify={notify} compact={false} />
        ) : view === 'add' ? (
          <AddAccountPanel notify={notify} onChanged={() => void accountsQuery.refetch()} />
        ) : view === 'account' ? (
          <AccountPanel account={selectedAccount} notify={notify} onChanged={() => void accountsQuery.refetch()} />
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

function AccountRow({ account, active, onClick }: { account: WAAccount; active: boolean; onClick: () => void }) {
  const id = accountID(account);
  return (
    <button className={`account-row ${active ? 'active' : ''}`} onClick={onClick}>
      <RemoteAvatar path={accountAvatarPath(id, String(account.audit?.updated_at || 'latest'))} label={accountTitle(account)} />
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
      />
    </section>
  );
}

function ContactList({ accountID, contacts, loading, activeID, onSelect, onDelete }: { accountID: string; contacts: ReturnType<typeof normalizeContacts>; loading: boolean; activeID: string; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
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

function Thread({ accountID: _accountID, contact, messages, loading, sending, onSend }: { accountID: string; contact?: ReturnType<typeof normalizeContacts>[number]; messages: AccountMessage[]; loading: boolean; sending: boolean; onSend: (text: string) => void }) {
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
        {sorted.map((message, index) => <MessageBubble key={message.account_message_id || message.message_id || index} message={message} />)}
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

function MessageBubble({ message }: { message: AccountMessage }) {
  const outgoing = String(message.direction || '').toLowerCase().includes('out') || String(message.ack_status || '').length > 0;
  return (
    <div className={`bubble-line ${outgoing ? 'outgoing' : 'incoming'}`}>
      <div className="bubble">
        <p>{messageText(message) || '[非文本消息]'}</p>
        <time>{formatDate(messageTime(message), true)}</time>
      </div>
    </div>
  );
}

function AccountPanel({ account, notify, onChanged }: { account?: WAAccount; notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void }) {
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
        <RemoteAvatar path={accountAvatarPath(accountId, String(account.audit?.updated_at || 'latest'))} label={accountTitle(account)} large />
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
      <div className="dashboard-grid">
        <ProfileCard account={account} notify={notify} onChanged={() => { onChanged(); void queryClient.invalidateQueries({ queryKey: ['accounts'] }); }} />
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

function ProfileCard({ account, notify, onChanged }: { account: WAAccount; notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void }) {
  const [name, setName] = useState(account.display_name || '');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const accountId = accountID(account);
  const nameMutation = useMutation({
    mutationFn: () => setProfileName(accountId, name.trim()),
    onSuccess: () => {
      notify('success', '名称已提交');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const pictureMutation = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await readFileDataUrl(file);
      return setProfilePicture(accountId, dataUrl.slice(dataUrl.indexOf(',') + 1), file.type || 'image/jpeg');
    },
    onSuccess: () => {
      notify('success', '头像已提交');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const removeMutation = useMutation({
    mutationFn: () => removeProfilePicture(accountId),
    onSuccess: () => {
      notify('success', '头像移除请求已提交');
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
            setFileName(file.name);
            pictureMutation.mutate(file);
          }}
        />
        <button className="secondary-button" onClick={() => fileRef.current?.click()}>
          <Upload size={15} />
          {fileName || '上传头像'}
        </button>
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
  const [countryCallingCode, setCountryCallingCode] = useState('');
  const [phone, setPhone] = useState('');
  const [probe, setProbe] = useState<WorkflowResponse | null>(null);
  const [method, setMethod] = useState('sms');
  const [pendingAccountID, setPendingAccountID] = useState('');
  const [otp, setOtp] = useState('');
  const input = resolvePhoneInput(phone, countryCallingCode);
  const probeMutation = useMutation({
    mutationFn: () => probePhoneSMS(requirePhone(input)),
    onSuccess: (result) => {
      setProbe(result);
      notify('success', '号码探测完成');
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const registerMutation = useMutation({
    mutationFn: () => registerPhone(requirePhone(input), method),
    onSuccess: (result) => {
      setProbe(result);
      if (result.wa_account_id) setPendingAccountID(result.wa_account_id);
      notify(result.success === false || result.error_message ? 'error' : 'success', result.error_message || '注册请求已提交');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const otpMutation = useMutation({
    mutationFn: () => submitRegistrationOTP(pendingAccountID, otp),
    onSuccess: (result) => {
      notify(result.success === false || result.error_message ? 'error' : 'success', result.error_message || 'OTP 已提交');
      setOtp('');
      onChanged();
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
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
              <input value={countryCallingCode} onChange={(event) => setCountryCallingCode(event.target.value)} placeholder="+1" />
            </label>
            <label>
              手机号
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="4155550123" />
            </label>
            <label>
              注册通道
              <select value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="sms">SMS</option>
                <option value="voice">Voice</option>
                <option value="flash_call">Flash call</option>
                <option value="wa_old">WA old</option>
                <option value="silent_auth">Silent auth</option>
                <option value="oauth_email">OAuth email</option>
              </select>
            </label>
            <div className="inline-actions">
              <button className="secondary-button" disabled={probeMutation.isPending} onClick={() => probeMutation.mutate()}>
                <Search size={15} />
                探测号码
              </button>
              <button className="primary-button" disabled={registerMutation.isPending} onClick={() => registerMutation.mutate()}>
                <Send size={15} />
                发起注册
              </button>
            </div>
          </div>
        </InfoCard>
        <InfoCard title="OTP" icon={<KeyRound size={17} />}>
          <div className="form-grid">
            <label>
              待注册账号 ID
              <input value={pendingAccountID} onChange={(event) => setPendingAccountID(event.target.value)} placeholder="wa_account_id" />
            </label>
            <label>
              OTP
              <input value={otp} onChange={(event) => setOtp(event.target.value)} type="password" />
            </label>
            <button className="primary-button" disabled={!pendingAccountID || !otp || otpMutation.isPending} onClick={() => otpMutation.mutate()}>
              <KeyRound size={15} />
              提交 OTP
            </button>
          </div>
        </InfoCard>
      </div>
      <InfoCard title="结果" icon={<MonitorCog size={17} />}>
        <pre className="json-box">{JSON.stringify(probe || {}, null, 2)}</pre>
      </InfoCard>
    </section>
  );
}

function SettingsPanel({ notify }: { notify: (kind: Toast['kind'], message: string) => void; compact?: boolean }) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['config'], queryFn: () => window.waDesktop.waConfig.get() });
  const serviceQuery = useQuery({ queryKey: ['service'], queryFn: () => window.waDesktop.waService.status(), refetchInterval: 10000 });
  const [form, setForm] = useState({ mode: 'remote' as ClientMode, remoteBaseUrl: '', localDataDir: '', autoStartLocalService: false, password: '' });
  useEffect(() => {
    if (!configQuery.data) return;
    setForm((current) => ({
      ...current,
      mode: configQuery.data.mode,
      remoteBaseUrl: configQuery.data.remoteBaseUrl,
      localDataDir: configQuery.data.localDataDir,
      autoStartLocalService: configQuery.data.autoStartLocalService,
    }));
  }, [configQuery.data]);
  const saveMutation = useMutation({
    mutationFn: () => window.waDesktop.waConfig.set({ ...form, password: form.password || undefined }),
    onSuccess: async () => {
      notify('success', '连接配置已保存');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  const testMutation = useMutation({
    mutationFn: () => window.waDesktop.waConfig.testConnection({ ...form, password: form.password || undefined }),
    onSuccess: async (result) => {
      notify(result.ok ? 'success' : 'error', result.ok ? '连接测试成功' : result.error || '连接测试失败');
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      await queryClient.invalidateQueries({ queryKey: ['connection'] });
    },
  });
  const startMutation = useMutation({
    mutationFn: () => window.waDesktop.waService.start(),
    onSuccess: (status) => {
      notify(status.running ? 'success' : 'error', status.error || (status.running ? '本地服务已启动' : '本地服务不可用'));
      void serviceQuery.refetch();
    },
  });
  const stopMutation = useMutation({
    mutationFn: () => window.waDesktop.waService.stop(),
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
            </label>
            <label>
              本地数据目录
              <input value={form.localDataDir} onChange={(event) => setForm({ ...form, localDataDir: event.target.value })} />
            </label>
            <label className="check-row">
              <input checked={form.autoStartLocalService} onChange={(event) => setForm({ ...form, autoStartLocalService: event.target.checked })} type="checkbox" />
              本地模式启动时自动启动服务
            </label>
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
    <div className="mini-list">
      {profiles.map((profile, index) => (
        <div key={profile.client_profile_id || index}>
          <strong>{profile.client_profile_id || 'Client profile'}</strong>
          <small>{profile.app_version || profile.locale_country || JSON.stringify(profile.device || {}).slice(0, 80)}</small>
        </div>
      ))}
    </div>
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
  const cc = countryCallingCode.replace(/\D+/g, '');
  const digits = phone.replace(/\D+/g, '');
  if (!cc || !digits) return null;
  const e164 = digits.startsWith(cc) ? `+${digits}` : `+${cc}${digits}`;
  return { region: '', phone: digits, e164_number: e164, country_calling_code: cc, country_iso2: '' };
}

function requirePhone(input: PhoneInput | null) {
  if (!input) throw new Error('请输入手机号和国家拨号码');
  return input;
}

function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
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
  return error instanceof Error ? error.message : String(error);
}

createRoot(document.getElementById('root')!).render(<App />);
