// 服务器页「机器」分区的纯数据层 —— 无 RN 依赖,bun/node 可直跑(配 host-levels.test.ts)。
//
// 看板 #618(Vincent 2026-10-06):「这个页面要支持看到，军团节点所在所有服务器的 CPU、RAM 和磁盘存储的水位啊」。
// 起因:当天一台 16 核 / 62.6 GB 的机器内存耗尽卡死,而每个节点的心跳里一直带着这三组数字,只是没人看得到。
//
// 数据来源:Hub 全量 /api/status 的每一行都带 `host` 对象(同时平铺在行上):
//   hostname / ip / cpu_load_1min / cpu_cores / mem_total_gb / mem_used_gb / mem_avail_gb /
//   disk_total_gb / disk_used_gb / disk_avail_gb,行本身的 updated_at = 最近一次心跳。
// 🔴 列表轮询用的 `?light=1` 投影**不带**这些字段,所以服务器页另读一份全量投影(见 ServerScreen)。
//
// 规则(全部在这里定,界面只负责画):
//   - 分组:按 hostname(去首尾空白);没有 hostname 的行不进任何一台机器,只计数。
//   - 最新者胜:一台机器的三组数字取 updated_at 最新的那一行 —— **整行取,不跨行拼**。
//     拼会把一行旧心跳里的磁盘数和新心跳的 CPU 摆成「同一时刻」,那正是 #618 要防的「把旧数当现在」。
//   - 缺字段 = 「—」,不是 0%:pct 为 null,条是空轨道,颜色是灰。
//   - 阈值:< 70% ok,70–90% warn(含两端),> 90% danger。
//   - 过期:最新心跳早于 5 分钟,或这台机器上的节点全部离线 ⇒ stale:条变灰、文案写「数据 N 分钟前」,
//     而且不参与「红色排前」—— 过期的数不能当成现在的告警,也不能当成现在的正常。
//   - 排序:有红条(未过期)的机器排最前;其余按在线节点数、再按节点总数降序;最后按名字。

import type { Session } from './api';
import { isOffline } from './agents-list';

/** 过期阈值:最新心跳早于这个时长 ⇒ 数字不再当作「现在」。 */
export const HOST_STALE_MS = 5 * 60_000;
/** 默认显示的机器数;更多的折叠在「全部 N 台」后面(与分组同一做法)。 */
export const HOSTS_COLLAPSED = 8;

export type LevelTone = 'ok' | 'warn' | 'danger' | 'none';

/** 一根水位条。pct 已经封顶在 0–100(画条用);raw 是未封顶的原值(判色用)。 */
export type Meter = {
  /** 0–100;读不出 = null(画空轨道、文字「—」)。 */
  pct: number | null;
  tone: LevelTone;
  /** 条右边的主文字:「45%」或「—」。 */
  value: string;
  /** 次要文字:CPU「load 7.2 / 16 核」、内存/磁盘「58.1 / 62.6 GB」;读不出 = 「—」。 */
  detail: string;
};

export type HostTelemetry = {
  hostname: string;
  ip: string | null;
  cpu_load_1min: number | null;
  cpu_cores: number | null;
  mem_total_gb: number | null;
  mem_used_gb: number | null;
  mem_avail_gb: number | null;
  disk_total_gb: number | null;
  disk_used_gb: number | null;
  disk_avail_gb: number | null;
};

export type HostLevel = {
  hostname: string;
  ip: string | null;
  online: number;
  total: number;
  /** 这台机器上全部节点的别名(点进节点列表时按它筛 —— light 投影的行不带 hostname)。 */
  aliases: string[];
  /** 最新心跳的毫秒时间戳;读不出 = 0。 */
  heartbeatMs: number;
  /** 最新心跳距今多久(ms);读不出 = null。 */
  ageMs: number | null;
  stale: boolean;
  /** 过期时的说明:「数据 12 分钟前」「节点均离线」。不过期 = null。 */
  staleLabel: string | null;
  cpu: Meter;
  mem: Meter;
  disk: Meter;
  /** 三根条里最高的档位(过期 = 'none')。 */
  worst: LevelTone;
};

export type HostLevelsResult = { hosts: HostLevel[]; unreported: number };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** hub 的时间是 UTC `YYYY-MM-DD HH:MM:SS`(无时区);也接受 ISO。读不出 = 0。 */
export function heartbeatMs(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0;
  let s = value.trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/** 一行的主机遥测:优先 `host` 对象,其次平铺在行上的同名字段。没有 hostname = null。 */
export function telemetryOf(s: Session): HostTelemetry | null {
  const row = s as Session & Record<string, unknown>;
  const host = (row.host && typeof row.host === 'object' ? row.host : {}) as Record<string, unknown>;
  const pick = (k: string): unknown => (host[k] !== undefined && host[k] !== null ? host[k] : row[k]);
  const name = pick('hostname');
  const hostname = typeof name === 'string' ? name.trim() : '';
  if (!hostname) return null;
  const ip = pick('ip');
  return {
    hostname,
    ip: typeof ip === 'string' && ip.trim() ? ip.trim() : null,
    cpu_load_1min: num(pick('cpu_load_1min')),
    cpu_cores: num(pick('cpu_cores')),
    mem_total_gb: num(pick('mem_total_gb')),
    mem_used_gb: num(pick('mem_used_gb')),
    mem_avail_gb: num(pick('mem_avail_gb')),
    disk_total_gb: num(pick('disk_total_gb')),
    disk_used_gb: num(pick('disk_used_gb')),
    disk_avail_gb: num(pick('disk_avail_gb')),
  };
}

/** < 70 ok;70–90(含)warn;> 90 danger;读不出 none。 */
export function levelTone(pct: number | null): LevelTone {
  if (pct == null || !Number.isFinite(pct)) return 'none';
  if (pct > 90) return 'danger';
  if (pct >= 70) return 'warn';
  return 'ok';
}

/** used / total 的百分比(未封顶);任一缺失或 total ≤ 0 = null。 */
export function ratioPct(used: number | null, total: number | null): number | null {
  if (used == null || total == null || total <= 0 || used < 0) return null;
  return (used / total) * 100;
}

const clampPct = (p: number | null): number | null => (p == null ? null : Math.max(0, Math.min(100, p)));
const fmtPct = (p: number | null): string => (p == null ? '—' : `${Math.round(p)}%`);
/** GB:≥ 100 取整,其余保留一位小数(62.6 GB 的机器差 0.6 GB 就是一个节点)。 */
export function fmtGb(v: number): string {
  if (v >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}
const fmtLoad = (v: number): string => String(Math.round(v * 100) / 100);

export function cpuMeter(t: Pick<HostTelemetry, 'cpu_load_1min' | 'cpu_cores'>): Meter {
  const load = t.cpu_load_1min, cores = t.cpu_cores;
  const raw = load != null && cores != null && cores > 0 && load >= 0 ? (load / cores) * 100 : null;
  const pct = clampPct(raw);
  return {
    pct,
    tone: levelTone(raw),
    value: fmtPct(pct),
    detail: load != null && cores != null && cores > 0 ? `load ${fmtLoad(load)} / ${cores} 核` : load != null ? `load ${fmtLoad(load)}` : '—',
  };
}

export function sizeMeter(used: number | null, total: number | null): Meter {
  const raw = ratioPct(used, total);
  const pct = clampPct(raw);
  return {
    pct,
    tone: levelTone(raw),
    value: fmtPct(pct),
    detail: raw != null ? `${fmtGb(used!)} / ${fmtGb(total!)} GB` : '—',
  };
}

/** 「数据 N 分钟前」:< 60 分钟按分钟,< 48 小时按小时,其余按天。 */
export function ageLabel(ageMs: number | null): string {
  if (ageMs == null || !Number.isFinite(ageMs)) return '数据时间未知';
  const min = Math.max(0, Math.floor(ageMs / 60_000));
  if (min < 60) return `数据 ${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 48) return `数据 ${h} 小时前`;
  return `数据 ${Math.floor(h / 24)} 天前`;
}

/** 过期判定:心跳读不出、早于 HOST_STALE_MS,或节点全部离线。 */
export function isStale(ageMs: number | null, online: number): boolean {
  if (ageMs == null) return true;
  if (ageMs > HOST_STALE_MS) return true;
  return online === 0;
}

const RANK: Record<LevelTone, number> = { danger: 3, warn: 2, ok: 1, none: 0 };
const worstOf = (...m: Meter[]): LevelTone => m.reduce<LevelTone>((w, x) => (RANK[x.tone] > RANK[w] ? x.tone : w), 'none');

/** 红色(未过期)排最前;再按在线数、总数降序;最后按名字。 */
export function compareHosts(a: HostLevel, b: HostLevel): number {
  const ra = a.worst === 'danger' ? 1 : 0, rb = b.worst === 'danger' ? 1 : 0;
  if (ra !== rb) return rb - ra;
  if (a.online !== b.online) return b.online - a.online;
  if (a.total !== b.total) return b.total - a.total;
  return a.hostname.localeCompare(b.hostname);
}

export function hostLevels(sessions: readonly Session[], now: number): HostLevelsResult {
  type Acc = { newest: HostTelemetry; newestMs: number; online: number; total: number; aliases: string[] };
  const by = new Map<string, Acc>();
  let unreported = 0;
  for (const s of sessions) {
    const t = telemetryOf(s);
    if (!t) { unreported++; continue; }
    const ms = heartbeatMs(s.updated_at);
    const acc = by.get(t.hostname);
    if (!acc) {
      by.set(t.hostname, { newest: t, newestMs: ms, online: isOffline(s) ? 0 : 1, total: 1, aliases: [s.alias] });
      continue;
    }
    acc.total++;
    if (!isOffline(s)) acc.online++;
    if (!acc.aliases.includes(s.alias)) acc.aliases.push(s.alias);
    // 最新者胜,整行取;同一时刻的两行保留先到的那行(Hub 按 updated_at DESC 返回)。
    if (ms > acc.newestMs) { acc.newest = t; acc.newestMs = ms; }
  }
  const hosts: HostLevel[] = [];
  for (const [hostname, acc] of by) {
    const t = acc.newest;
    const ageMs = acc.newestMs > 0 ? Math.max(0, now - acc.newestMs) : null;
    const stale = isStale(ageMs, acc.online);
    const cpu = cpuMeter(t);
    const mem = sizeMeter(t.mem_used_gb, t.mem_total_gb);
    const disk = sizeMeter(t.disk_used_gb, t.disk_total_gb);
    const staleLabel = !stale
      ? null
      : ageMs != null && ageMs <= HOST_STALE_MS
        ? '节点均离线'
        : ageLabel(ageMs);
    hosts.push({
      hostname,
      ip: t.ip,
      online: acc.online,
      total: acc.total,
      aliases: acc.aliases,
      heartbeatMs: acc.newestMs,
      ageMs,
      stale,
      staleLabel,
      cpu,
      mem,
      disk,
      worst: stale ? 'none' : worstOf(cpu, mem, disk),
    });
  }
  hosts.sort(compareHosts);
  return { hosts, unreported };
}
