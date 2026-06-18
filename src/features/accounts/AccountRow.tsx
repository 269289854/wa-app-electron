import { accountAvatarPath, accountID, accountTitle } from '../../api';
import type { WAAccount } from '../../types';
import { RemoteAvatar } from '../../shared/ui';
import { connectionView, type LongConnectionRecord } from './account-model';

export function AccountRow({ account, active, connection, connectionLoading, avatarVersion, onClick }: { account: WAAccount; active: boolean; connection?: LongConnectionRecord; connectionLoading: boolean; avatarVersion: string; onClick: () => void }) {
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
