import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { assetDataUrl } from '../api';
import { initials } from './avatar';
import type { Toast } from './toast';

export function InfoCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
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

export function RemoteAvatar({ path, label, large = false }: { path: string; label: string; large?: boolean }) {
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

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => <div className={`toast ${toast.kind}`} key={toast.id}>{toast.message}</div>)}
    </div>
  );
}

export function EmptyState({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

export function InlineLoading({ text }: { text: string }) {
  return <p className="inline-loading"><Loader2 size={14} className="spin" />{text}</p>;
}
