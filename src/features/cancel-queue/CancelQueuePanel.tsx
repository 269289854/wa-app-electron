import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Contact, ListChecks, RefreshCw } from 'lucide-react';
import { errorMessage } from '../../shared/errors';
import { countdownLabel, formatDate } from '../../shared/format';
import type { Toast } from '../../shared/toast';
import { InfoCard, InlineLoading } from '../../shared/ui';
import {
  cancelQueueTabs,
  invalidateSMSCancelQueue,
  providerLabel,
  queueStatusLabel,
  refetchOrBacktrackQueuePage,
} from './cancel-queue-model';

export function CancelQueuePanel({ notify }: { notify: (kind: Toast['kind'], message: string) => void }) {
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
