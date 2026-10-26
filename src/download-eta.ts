// 下载中的「剩余时长」：字节数 + 已用时 → 百分比、速率、预计剩余秒数。
// admin 2026-10-26（桌面聊天里的 PPT 附件卡片）：「下载显示一下剩余时长！」——
// 原来只显示「下载中」+ 转圈，大文件看不出还要多久。
export interface DownloadEta { percent: number | null; speedBps: number | null; etaSeconds: number | null }

export function downloadEta(received: number, total: number | undefined, elapsedMs: number): DownloadEta {
  const got = Number.isFinite(received) && received > 0 ? received : 0;
  const all = Number.isFinite(total) && (total ?? 0) > 0 ? (total as number) : null;
  const ms = Number.isFinite(elapsedMs) && elapsedMs > 250 ? elapsedMs : 0;
  const percent = all ? Math.max(0, Math.min(100, Math.round((got / all) * 100))) : null;
  if (!ms || got <= 0) return { percent, speedBps: null, etaSeconds: null };
  const speed = got / (ms / 1000);
  const remaining = all ? Math.max(0, all - got) : null;
  return { percent, speedBps: speed, etaSeconds: remaining === null ? null : Math.ceil(remaining / speed) };
}

/** 「剩余约 1 分 20 秒」/「剩余约 8 秒」；拿不到总量时返回 null（卡片只显示已下载量）。 */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return s ? `${m} 分 ${s} 秒` : `${m} 分`;
}

export function formatSpeed(bps: number | null): string | null {
  if (bps === null || !Number.isFinite(bps) || bps <= 0) return null;
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${Math.round(bps / 1024)} KB/s`;
  return `${Math.round(bps)} B/s`;
}
