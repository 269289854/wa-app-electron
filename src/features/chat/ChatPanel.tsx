import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Contact, Loader2, MessageCircle, Search, Send, Trash2 } from 'lucide-react';
import {
  accountID,
  contactAvatarPath,
  deleteContact,
  deleteMessages,
  getContacts,
  getMessages,
  markMessagesRead,
  messageText,
  messageTime,
  normalizeContacts,
  resolveContacts,
  sendTextMessage,
} from '../../api';
import type { AccountMessage, WAAccount } from '../../types';
import { errorMessage } from '../../shared/errors';
import { formatDate } from '../../shared/format';
import type { Toast } from '../../shared/toast';
import { EmptyState, RemoteAvatar } from '../../shared/ui';
import { unresolvedContactJIDs } from './contact-model';

export function ChatPanel({ account, selectedContactID, onSelectContact, notify }: { account?: WAAccount; selectedContactID: string; onSelectContact: (id: string) => void; notify: (kind: Toast['kind'], message: string) => void }) {
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

function ContactList({ contacts, loading, activeID, onSelect, onDelete }: { contacts: ReturnType<typeof normalizeContacts>; loading: boolean; activeID: string; onSelect: (id: string) => void; onDelete: (id: string) => void }) {
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
  contact,
  messages,
  loading,
  sending,
  deletingMessageID,
  onSend,
  onDeleteMessage,
}: {
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
