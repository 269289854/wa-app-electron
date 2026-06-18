export function formatDate(date: Date | null, withTime = false) {
  if (!date) return '';
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

export function countdownLabel(targetMs: number, nowMs = Date.now()) {
  const remainingMs = Math.max(0, targetMs - nowMs);
  if (remainingMs <= 0) return '已到期';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return `${minutes} 分 ${seconds} 秒`;
}
