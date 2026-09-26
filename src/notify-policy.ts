// 0.2.76 新消息系统通知的判据(纯函数,不碰 Tauri / DOM):
//  1) 哪些行是「新来的」—— 本次运行没见过的 id,且不是登录时那一大批历史(首份快照只登记不提醒),
//     且 created_at 在最近 FRESH_WINDOW_MS 内(轮询间隔漂移/老行补拉不该响铃)。
//  2) 什么时候不提醒 —— 窗口在前台且正开着那个会话(人已经在看),或免打扰时段。
// 通知正文 = 正文前 80 字,标题 = 发件 agent。

import type { HubMessage, HubUserMessage } from './api';
import { inQuietHours, type QuietHours } from './quiet-hours';

export const BODY_MAX = 80;
export const FRESH_WINDOW_MS = 10 * 60 * 1000;
const COUNTED_TYPES = new Set(['reply', 'task', 'message']);

export type Incoming = { id: string; agent: string; body: string; createdAt: string | null };

function normalizeTs(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.replace('T', ' ').slice(0, 19);
}

/** hub 的 UTC "YYYY-MM-DD HH:MM:SS" → epoch ms;解析失败返回 null。 */
export function hubTsToMs(ts: string | null): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts.replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

export function bodyOf(text: unknown, max = BODY_MAX): string {
  const s = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!s) return '';
  return Array.from(s).length > max ? Array.from(s).slice(0, max).join('') + '…' : s;
}

/** user_inbox 行(agent_message 等)→ Incoming;没有 id/发件人的丢掉。 */
export function fromUserMessages(rows: readonly HubUserMessage[] | null | undefined): Incoming[] {
  const out: Incoming[] = [];
  for (const m of rows ?? []) {
    if (!m || typeof m.message_id !== 'string' || !m.message_id) continue;
    const agent = typeof m.from_session === 'string' ? m.from_session.trim() : '';
    if (!agent) continue;
    const text = [m.title, m.content].filter(v => typeof v === 'string' && v.trim()).join(':');
    out.push({ id: `u:${m.message_id}`, agent, body: bodyOf(text), createdAt: normalizeTs(m.created_at) });
  }
  return out;
}

/** inbox 行里发给登录用户名的 reply/task/message → Incoming。 */
export function fromInboxRows(rows: readonly HubMessage[] | null | undefined, username: string): Incoming[] {
  const out: Incoming[] = [];
  if (!username) return out;
  for (const r of rows ?? []) {
    if (!r || !r.id || r.to_alias !== username) continue;
    const agent = typeof r.from_alias === 'string' ? r.from_alias.trim() : '';
    if (!agent || agent === username) continue;
    const type = typeof r.type === 'string' ? r.type : 'reply';
    if (!COUNTED_TYPES.has(type)) continue;
    out.push({ id: `i:${r.id}`, agent, body: bodyOf(r.content), createdAt: normalizeTs(r.created_at) });
  }
  return out;
}

export type SeenState = { seeded: boolean; ids: Set<string> };
export const SEEN_CAP = 2000;

export function initialSeen(): SeenState {
  return { seeded: false, ids: new Set() };
}

/**
 * 从一份快照里挑出要提醒的行。首份快照只登记(seeded=false → true)不提醒;
 * 之后只提醒「没见过 + 新鲜」的行。返回新的 seen 状态(不改入参)。
 */
export function pickNew(
  seen: SeenState,
  incoming: readonly Incoming[],
  nowMs: number,
): { seen: SeenState; toNotify: Incoming[]; stale: Incoming[] } {
  const ids = new Set(seen.ids);
  const toNotify: Incoming[] = [];
  const stale: Incoming[] = [];
  for (const row of incoming) {
    if (ids.has(row.id)) continue;
    ids.add(row.id);
    if (!seen.seeded) continue;
    const ms = hubTsToMs(row.createdAt);
    if (ms !== null && nowMs - ms > FRESH_WINDOW_MS) { stale.push(row); continue; }
    toNotify.push(row);
  }
  if (ids.size > SEEN_CAP) {
    const drop = ids.size - SEEN_CAP;
    let i = 0;
    for (const id of ids) { if (i++ >= drop) break; ids.delete(id); }
  }
  return { seen: { seeded: true, ids }, toNotify, stale };
}

export type Presence = { windowFocused: boolean; openConversation: string | null };

/** 人正在看这条消息所属的会话 ⇒ 不提醒。 */
export function suppressedByPresence(agent: string, presence: Presence): boolean {
  return presence.windowFocused && presence.openConversation === agent;
}

export type NotifyDecision = { notify: boolean; sound: boolean };

/**
 * 0.2.107:桌面端和手机端共用这一个判据(手机端 presence.windowFocused = AppState 为 active)。
 * `enabled`(总开关)和 `muted`(本账号下免打扰的 agent)是可选的 —— 不传 = 开、无人免打扰,
 * 行为与 0.2.76–0.2.106 完全一样。
 *
 * 🔴 不要在这里加「窗口/应用必须不在前台才提醒」一类前置:最常见的场景恰恰是人正开着应用、
 *    在看 A 的会话,B 来了消息 —— 这时必须提醒(0.2.81 的通知跳转就是被这样一条前置废掉的,
 *    见 notify-target.ts 文件头)。唯一按「在不在看」抑制的,是**正开着的就是这个会话**。
 */
export function decide(
  agent: string,
  presence: Presence,
  settings: { soundEnabled: boolean; quiet: QuietHours; enabled?: boolean; muted?: readonly string[] },
  nowMinutes: number,
): NotifyDecision {
  const d = decideWithReason(agent, presence, settings, nowMinutes);
  return { notify: d.notify, sound: d.sound };
}

/** 判定结果 + 原因(诊断面板显示「上一次为什么没弹」)。与 decide 同一条判据,decide 只是丢掉原因。 */
export type DecisionReason = 'notify' | 'master_off' | 'viewing' | 'muted' | 'quiet_hours';
export function decideWithReason(
  agent: string,
  presence: Presence,
  settings: { soundEnabled: boolean; quiet: QuietHours; enabled?: boolean; muted?: readonly string[] },
  nowMinutes: number,
): NotifyDecision & { reason: DecisionReason } {
  if (settings.enabled === false) return { notify: false, sound: false, reason: 'master_off' };
  if (suppressedByPresence(agent, presence)) return { notify: false, sound: false, reason: 'viewing' };
  if (settings.muted?.includes(agent)) return { notify: false, sound: false, reason: 'muted' };
  if (inQuietHours(settings.quiet, nowMinutes)) return { notify: false, sound: false, reason: 'quiet_hours' };
  return { notify: true, sound: settings.soundEnabled, reason: 'notify' };
}

/** unread-store 快照 → 候选行(user_inbox 那半 + 发给我的 inbox 回复那半)。桌面/手机通知共用。 */
export function incomingFromSnapshot(snap: { serverBody: unknown; replyRows: readonly HubMessage[]; replyUsername: string }): Incoming[] {
  const body = snap.serverBody as { messages?: unknown } | null;
  const messages = body && Array.isArray(body.messages) ? (body.messages as HubUserMessage[]) : [];
  return [...fromUserMessages(messages), ...fromInboxRows(snap.replyRows, snap.replyUsername)];
}

/** 同一轮多条新消息只响一次铃、按 agent 合并成一条通知(飞书也是按会话合并)。 */
export function groupByAgent(rows: readonly Incoming[]): Array<{ agent: string; count: number; body: string }> {
  const map = new Map<string, { agent: string; count: number; body: string }>();
  for (const r of rows) {
    const g = map.get(r.agent);
    if (g) { g.count++; g.body = r.body || g.body; } else map.set(r.agent, { agent: r.agent, count: 1, body: r.body });
  }
  return [...map.values()];
}

export function notificationTitle(agent: string, count: number): string {
  return count > 1 ? `${agent}(${count} 条新消息)` : agent;
}
