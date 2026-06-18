import type { QueryClient } from '@tanstack/react-query';

export async function invalidateSMSCancelQueue(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['sms-cancel-queue'] }),
    client.invalidateQueries({ queryKey: ['sms-cancel-queue-status'] }),
  ]);
}

export function providerLabel(provider: string) {
  return provider === 'hero-sms' ? 'Hero-SMS' : 'SMSBower';
}

export function cancelQueueTabs(summary?: SMSCancelQueueSummary): Array<{ status: SMSCancelQueueListStatus; label: string; count: number }> {
  return [
    { status: 'all', label: '全部', count: summary?.total ?? 0 },
    { status: 'pending', label: '待取消', count: summary?.pending ?? 0 },
    { status: 'processing', label: '取消中', count: summary?.processing ?? 0 },
    { status: 'failed', label: '待重试', count: summary?.failed ?? 0 },
    { status: 'cancelled', label: '已取消', count: summary?.cancelled ?? 0 },
    { status: 'removed', label: '已移除', count: summary?.removed ?? 0 },
  ];
}

export async function refetchOrBacktrackQueuePage(
  refetch: () => Promise<{ data?: SMSCancelQueueListResult }>,
  page: number,
  setPage: React.Dispatch<React.SetStateAction<number>>,
) {
  const result = await refetch();
  if (page > 1 && result.data && result.data.items.length === 0) {
    setPage((value) => Math.max(1, value - 1));
  }
}

export function queueStatusLabel(status: SMSCancelQueueStatus) {
  const labels: Record<SMSCancelQueueStatus, string> = {
    pending: '待取消',
    processing: '取消中',
    cancelled: '已取消',
    failed: '待重试',
    removed: '已移除',
  };
  return labels[status] || status;
}
