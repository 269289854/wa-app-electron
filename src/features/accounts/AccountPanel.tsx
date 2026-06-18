import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AtSign,
  Check,
  Circle,
  Contact,
  Fingerprint,
  KeyRound,
  Loader2,
  MonitorCog,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react';
import {
  accountAvatarPath,
  accountID,
  accountTitle,
  checkLoginState,
  deleteAccount,
  getClientProfiles,
  getConnections,
  getOtpMessages,
  getTwoFactorStatus,
  normalizeTwoFactorStatus,
  removeProfilePicture,
  requestEmailOtp,
  setAccountEmail,
  setProfileName,
  setProfilePicture,
  setTwoFactorPIN,
  submitRegistrationOTP,
  timestampValue,
  verifyEmailOtp,
} from '../../api';
import type { ClientProfile, WAAccount, WorkflowResponse } from '../../types';
import { cropAvatarDataUrl, readFileDataUrl } from '../../shared/avatar';
import { errorMessage } from '../../shared/errors';
import { formatDate } from '../../shared/format';
import type { Toast } from '../../shared/toast';
import { EmptyState, InfoCard, RemoteAvatar } from '../../shared/ui';
import { RegistrationRecoveryPanel } from '../registration/RegistrationRecoveryPanel';
import { isRegistrationPending } from './account-model';
import { MessageMiniList, ProfilesList } from './AccountWidgets';

export function AccountPanel({ account, avatarVersion, notify, onChanged, onAvatarChanged }: { account?: WAAccount; avatarVersion: string; notify: (kind: Toast['kind'], message: string) => void; onChanged: () => void; onAvatarChanged: () => void }) {
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
      {isRegistrationPending(account) ? <ManualOtpCard key={`otp-${accountId}`} account={account} notify={notify} onChanged={onChanged} /> : null}
      <div className="dashboard-grid">
        <ProfileCard key={`profile-${accountId}`} account={account} notify={notify} onChanged={() => { onChanged(); void queryClient.invalidateQueries({ queryKey: ['accounts'] }); }} onAvatarChanged={onAvatarChanged} />
        <AccountInfoCard account={account} />
        <SecurityCard key={`security-${accountId}`} account={account} notify={notify} />
        <LoginStateCheckCard account={account} profiles={profilesQuery.data?.client_profiles || []} notify={notify} />
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
      <RegistrationRecoveryPanel accountIDValue={accountId} notify={notify} onChanged={onChanged} />
    </InfoCard>
  );
}

function LoginStateCheckCard({ account, profiles, notify }: { account: WAAccount; profiles: ClientProfile[]; notify: (kind: Toast['kind'], message: string) => void }) {
  const accountId = accountID(account);
  const [result, setResult] = useState<WorkflowResponse | null>(null);
  const firstProfile = profiles.find((profile) => profile.client_profile_id);
  const mutation = useMutation({
    mutationFn: () => checkLoginState({
      wa_account_id: accountId,
      client_profile_id: firstProfile?.client_profile_id || '',
      registered_identity_id: '',
      remote_timeout_seconds: 30,
    }),
    onSuccess: (response) => {
      setResult(response);
      notify(response.success === false || response.error_message ? 'error' : 'success', response.error_message || '登录状态检查完成');
    },
    onError: (error) => notify('error', errorMessage(error)),
  });
  return (
    <InfoCard title="登录状态" icon={<Wifi size={17} />}>
      <div className="service-card">
        <p><strong>账号：</strong>{accountId}</p>
        <p><strong>Profile：</strong>{firstProfile?.client_profile_id || '-'}</p>
      </div>
      <button className="secondary-button" disabled={mutation.isPending || !accountId} onClick={() => mutation.mutate()}>
        {mutation.isPending ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
        检查登录状态
      </button>
      {result ? <pre className="json-box compact">{JSON.stringify(result, null, 2)}</pre> : null}
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
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const statusQuery = useQuery({ queryKey: ['2fa', accountId], queryFn: () => getTwoFactorStatus(accountId, true), enabled: false });
  const securityStatus = normalizeTwoFactorStatus(account.two_factor_auth, statusQuery.data?.status);
  const makeMutation = (fn: () => Promise<unknown>, message: string) => useMutation({
    mutationFn: fn,
    onSuccess: () => {
      notify('success', message);
      void statusQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
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
        <span>{securityStatus.configured === true ? '2FA 已配置' : securityStatus.configured === false ? '2FA 未配置' : '2FA 未知'}</span>
        <span>{securityStatus.emailAddress || '未配置邮箱'}</span>
        <span>{securityStatus.emailLabel}</span>
      </div>
      <div className="form-grid two">
        <label>
          6 位 PIN
          <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D+/g, '').slice(0, 6))} type="password" disabled={pinMutation.isPending} />
        </label>
        <button className="primary-button" disabled={pin.length !== 6 || pinMutation.isPending} onClick={() => pinMutation.mutate()}>
          {pinMutation.isPending ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}
          {pinMutation.isPending ? '设置中...' : '设置/修改 PIN'}
        </button>
        <label>
          邮箱
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" disabled={emailMutation.isPending} />
        </label>
        <button className="primary-button" disabled={!email || emailMutation.isPending} onClick={() => emailMutation.mutate()}>
          {emailMutation.isPending ? <Loader2 className="spin" size={15} /> : <AtSign size={15} />}
          {emailMutation.isPending ? '设置中...' : '设置邮箱'}
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
