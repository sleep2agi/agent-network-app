// 服务器页的纯数据层 —— 无 RN 依赖,bun/node 可直跑(配 server-stats.test.ts)。
//
// 🔴 0.2.107 之前服务器页的「在线 Agents」写的是 `sessions.length`:/api/status 返回的是
// 这个网络**全部已注册**的会话(含 offline),所以 Vincent 看到「303 在线」,而同一时刻
// Agent 列表的分组头写着「TM 46/94 在线」。这里的「在线」只有一个定义:
// agents-list.ts 的 `isOffline` 取反 —— 列表分组头、行上的在线点用的就是它。
// 不要在这个文件里另写一套 status 判断,也不要回到 `.length`。

import type { Session } from './api';
import { buildSections, isOffline, isWorking, teamOf } from './agents-list';

/** 一个会话在服务器页上的归类。互斥:每个会话只落进一个桶。 */
export type StatusBucket = 'working' | 'error' | 'idle' | 'offline';

/** 异常:运行时报了错或被卡住。离线的会话不算异常(它已经在「离线」里)。 */
export const isErrorStatus = (status: string | undefined): boolean =>
  status === 'error' || status === 'failed' || status === 'blocked';

export function bucketOf(s: Session): StatusBucket {
  if (isOffline(s)) return 'offline';
  if (isWorking(s)) return 'working';
  if (isErrorStatus(s.status)) return 'error';
  return 'idle';
}

export type ServerStats = {
  /** 全部已注册会话(= /api/status 的行数)。 */
  total: number;
  /** 在线 = 非 offline,与 Agent 列表分组头的「x/y」同一口径。 */
  online: number;
  working: number;
  error: number;
  idle: number;
  offline: number;
};

export function summarize(sessions: readonly Session[]): ServerStats {
  const out: ServerStats = { total: sessions.length, online: 0, working: 0, error: 0, idle: 0, offline: 0 };
  for (const s of sessions) {
    const b = bucketOf(s);
    out[b]++;
    if (b !== 'offline') out.online++;
  }
  return out;
}

// ── Agent 列表的状态筛选(卡片 → 列表) ──

export type AgentStatusFilter = 'online' | 'working' | 'error' | 'offline';

/** 从服务器页进入 Agent 列表时携带的筛选;两个字段都可缺省。 */
export type AgentListFilter = { status?: AgentStatusFilter; group?: string };

export const STATUS_FILTER_LABEL: Record<AgentStatusFilter, string> = {
  online: '在线',
  working: '工作中',
  error: '异常',
  offline: '离线',
};

export function matchesStatus(s: Session, f: AgentStatusFilter): boolean {
  const b = bucketOf(s);
  switch (f) {
    case 'online': return b !== 'offline';
    case 'working': return b === 'working';
    case 'error': return b === 'error';
    case 'offline': return b === 'offline';
  }
}

/** 列表页真正用来筛行的函数:卡片上的数字必须等于它筛出来的行数(见测试)。 */
export function applyAgentFilter(sessions: readonly Session[], filter: AgentListFilter | null | undefined): Session[] {
  if (!filter || (!filter.status && !filter.group)) return sessions.slice();
  return sessions.filter(s =>
    (!filter.status || matchesStatus(s, filter.status)) &&
    (!filter.group || teamOf(s.alias) === filter.group),
  );
}

export const isFilterActive = (f: AgentListFilter | null | undefined): f is AgentListFilter =>
  !!f && (!!f.status || !!f.group);

/** 列表顶部筛选条上的文字:「TM · 工作中」。 */
export function filterLabel(f: AgentListFilter): string {
  return [f.group, f.status ? STATUS_FILTER_LABEL[f.status] : undefined].filter(Boolean).join(' · ');
}

// ── 状态卡片 ──

export type StatusCard = {
  key: AgentStatusFilter;
  label: string;
  /** 大号数字。 */
  value: number;
  /** 在线卡片:数字后面跟「/总数」。 */
  of?: number;
  /** 对应的主题色 token 名。 */
  tone: 'running' | 'accent' | 'failed' | 'rest';
  /** 点卡片进入的列表筛选。 */
  filter: AgentListFilter;
};

export function statusCards(stats: ServerStats): StatusCard[] {
  return [
    { key: 'online', label: '在线', value: stats.online, of: stats.total, tone: 'running', filter: { status: 'online' } },
    { key: 'working', label: '工作中', value: stats.working, tone: 'accent', filter: { status: 'working' } },
    { key: 'error', label: '异常', value: stats.error, tone: 'failed', filter: { status: 'error' } },
    { key: 'offline', label: '离线', value: stats.offline, tone: 'rest', filter: { status: 'offline' } },
  ];
}

// ── 分组健康度 ──

export type GroupHealth = { title: string; online: number; total: number; ratio: number };

/**
 * 与 Agent 列表**同一份**分组(buildSections 的团队组,同样的组间顺序)。不传未读/置顶,
 * 所以不会出现「新消息」「置顶」这两个伪组。
 */
export function groupHealth(sessions: readonly Session[]): GroupHealth[] {
  return buildSections(sessions.slice(), '').map(g => ({
    title: g.title,
    online: g.online,
    total: g.total,
    ratio: g.total ? g.online / g.total : 0,
  }));
}

// ── 连接面板的格式化 ──

/** 延迟:<1s 用整数毫秒,≥1s 用一位小数秒;测不到写「—」。 */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** 延迟档位:<300ms 好,<1s 一般,其余慢。 */
export function latencyTone(ms: number | null | undefined): 'good' | 'fair' | 'slow' | 'unknown' {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 300) return 'good';
  if (ms < 1000) return 'fair';
  return 'slow';
}

/** 已连接时长:「刚刚」「12 分钟」「3 小时 5 分」「2 天 4 小时」。 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} 小时 ${min % 60} 分` : `${h} 小时`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} 天 ${h % 24} 小时` : `${d} 天`;
}

/** 网络 id 压缩显示:net_ab12cd34ef56 → net_ab12…ef56(完整值走复制)。 */
export function compactId(id: string | null | undefined, head = 8, tail = 4): string {
  const v = (id ?? '').trim();
  if (!v) return '—';
  return v.length <= head + tail + 1 ? v : `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/**
 * 连接失败的原因:把 fetch 抛出的错误翻成人话。
 * api.ts 的 get() 抛 `HTTP <code> on <path>`;超时是 AbortError;其余是网络层错误。
 */
export function describeFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const name = err instanceof Error ? err.name : '';
  const http = /HTTP (\d{3})/.exec(msg);
  if (http) {
    const code = Number(http[1]);
    if (code === 401 || code === 403) return `登录已失效（HTTP ${code}）`;
    if (code >= 500) return `服务器内部错误（HTTP ${code}）`;
    return `服务器拒绝了请求（HTTP ${code}）`;
  }
  if (name === 'AbortError' || /abort|timeout|timed out/i.test(msg)) return '请求超时（12 秒无响应）';
  return msg ? `无法访问服务器：${msg}` : '无法访问服务器';
}

/**
 * 「已连接多久」的起点:连续成功时保持不变;一次失败清空;失败后第一次成功重新计时。
 * 纯函数,调用方按服务器地址存一份。
 */
export function nextConnectedSince(prev: number | null, ok: boolean, now: number): number | null {
  if (!ok) return null;
  return prev ?? now;
}

// ── 卡片 / 分组 → Agent 列表的导航 ──

/**
 * 服务器页上点卡片或分组时要去的屏幕。手机/折叠屏的 Agent 列表是 `agents`;
 * 桌面端服务器工作区里的节点清单是 `serverNodes`。两边都带同一个 filter。
 */
export function agentListScreen(
  filter: AgentListFilter,
  workspace: 'mobile' | 'desktop',
): { name: 'agents' | 'serverNodes'; filter: AgentListFilter } {
  return { name: workspace === 'desktop' ? 'serverNodes' : 'agents', filter: { ...filter } };
}
