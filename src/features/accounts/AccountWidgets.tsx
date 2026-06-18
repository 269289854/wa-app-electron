import { messageText, messageTime, timestampValue } from '../../api';
import type { AccountMessage, ClientProfile } from '../../types';
import { formatDate } from '../../shared/format';
import { InlineLoading } from '../../shared/ui';
import { deviceTitle, pairLabel, profileStatusLabel, profileStatusTone, radioLabel, ramLabel } from './account-model';

export function ProfilesList({ profiles, loading }: { profiles: ClientProfile[]; loading: boolean }) {
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

export function MessageMiniList({ messages }: { messages: AccountMessage[] }) {
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
