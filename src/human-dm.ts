// 人与人私信(hub agent-network#2086:POST/GET /api/dm、GET /api/dm/threads、GET /api/networks/:id/humans)
// —— 客户端纯逻辑。不 import react-native。
//
// 🔴 私信也落在收件人的 user_inbox 表里(kind='human_dm',from_session=发信人用户名),而 app 里
//    「agent 主动消息 / 未读角标 / 新消息分组 / 手机通知」都按 user_inbox 的 from_session 当 agent 名算。
//    不处理的话,每个给你发过私信的人都会变成一个幽灵 agent 会话和角标。所以 scope=user 的响应
//    在唯一的取数口(api.ts fetchUserMessages)先经过 stripHumanDms,私信只走这里的 /api/dm。

export const HUMAN_DM_KIND = 'human_dm';

/** GET /api/networks/:id/humans 的一项。online / last_seen_at 是 hub 较新版本才给的在线状态(只给用户令牌);
 *  旧 hub 没有这两个字段 → 什么都不画(不画成假的灰点)。 */
export type Human = { user_id: string; username: string; display_name?: string | null; online?: boolean; last_seen_at?: string | null };
/** GET /api/dm/threads 的一项。 */
export type DmThread = { other_user_id: string; last_at?: string | null; unread?: number | null };
/** GET /api/dm 的一条(新的在前)。 */
export type DmMessage = {
  message_id: string;
  content?: string | null;
  meta_json?: string | null;
  created_at?: string | null;
  direction: 'in' | 'out';
  from_session?: string | null;
  acked?: number | null;
  /** 本地刚发、还没从 hub 读回的那条(乐观显示)。 */
  pending?: boolean;
  failed?: boolean;
};
export type DmAttachment = { type?: string; file_id: string; name?: string; mime?: string; size?: number };

/** 人员列表的一行:去掉自己,带上未读和最后一条时间。有未读 / 最近聊过的在前,其余按名字。 */
export type PersonRow = Human & { unread: number; lastAt: number; name: string };

export function hubMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  let s = value.trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export function personName(h: Pick<Human, 'username' | 'display_name'>): string {
  return (h.display_name ?? '').trim() || h.username;
}

export function peopleRows(humans: readonly Human[], threads: readonly DmThread[], selfUserId: string | undefined): PersonRow[] {
  const byId = new Map(threads.map(t => [t.other_user_id, t] as const));
  return humans
    .filter(h => h && h.user_id && h.user_id !== selfUserId)
    .map(h => {
      const t = byId.get(h.user_id);
      return { ...h, name: personName(h), unread: Math.max(0, Math.floor(Number(t?.unread ?? 0)) || 0), lastAt: hubMs(t?.last_at) };
    })
    .sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.lastAt - a.lastAt || a.name.localeCompare(b.name));
}

/**
 * 人员区块放在列表**最上面**(Vincent 2026-09-30「这个人员放太下面了」:300 个 agent 时它沉在最底下)。
 * 折叠状态和 agent 分组记在同一份「已折叠」里(每台设备各记各的),用一个不会和分组名撞上的键。
 */
export const PEOPLE_GROUP_KEY = '\u0000people';

/**
 * 人员区块此刻画什么:搜索时按名字 / 用户名过滤(与 agent 同一个匹配器,支持拼音),不可折叠、没匹配就整块不画;
 * 不搜索时可折叠,折叠后只剩标题行(带人数)。total 永远是全部人数。
 */
export function shownPeople(
  rows: readonly PersonRow[],
  query: string,
  collapsed: readonly string[],
  match: (text: string, q: string) => boolean,
): { rows: PersonRow[]; total: number; collapsed: boolean; collapsible: boolean; visible: boolean } {
  const q = query.trim();
  if (q) {
    const hits = rows.filter(p => match(p.name, q) || match(p.username, q));
    return { rows: hits, total: hits.length, collapsed: false, collapsible: false, visible: hits.length > 0 };
  }
  const folded = collapsed.includes(PEOPLE_GROUP_KEY);
  return { rows: folded ? [] : [...rows], total: rows.length, collapsed: folded, collapsible: true, visible: rows.length > 0 };
}

export function dmUnreadTotal(rows: readonly Pick<PersonRow, 'unread'>[]): number {
  return rows.reduce((n, r) => n + r.unread, 0);
}

export function dmAttachments(msg: Pick<DmMessage, 'meta_json'>): DmAttachment[] {
  if (!msg.meta_json) return [];
  try {
    const list = JSON.parse(msg.meta_json)?.attachments;
    return Array.isArray(list) ? list.filter((a: any) => a && typeof a.file_id === 'string' && a.file_id) : [];
  } catch {
    return [];
  }
}

export const isImageAttachment = (a: Pick<DmAttachment, 'mime' | 'name'>): boolean =>
  (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name ?? '');

/** 合并两批(按 message_id 去重,后来的覆盖先来的;hub 读回的那条替换本地乐观那条),新的在前。 */
export function mergeDm(existing: readonly DmMessage[], incoming: readonly DmMessage[]): DmMessage[] {
  const map = new Map<string, DmMessage>();
  for (const m of existing) if (m?.message_id) map.set(m.message_id, m);
  for (const m of incoming) if (m?.message_id) map.set(m.message_id, m);
  return [...map.values()].sort((a, b) => hubMs(b.created_at) - hubMs(a.created_at) || (b.message_id < a.message_id ? -1 : 1));
}

/** 打开会话时要 ack 的:对方发来、还没读的。 */
export function unackedIncomingIds(messages: readonly DmMessage[]): string[] {
  return messages.filter(m => m.direction === 'in' && !m.acked && !m.pending).map(m => m.message_id);
}

/** 本地乐观那条的 id 与发给 hub 的 client_request_id 同一个:hub 按 (发信人, client_request_id) 幂等。 */
export function newClientRequestId(now = Date.now(), rand = Math.random()): string {
  return `dmc_${now.toString(36)}_${Math.floor(rand * 1e9).toString(36)}`;
}

export function dmSendBody(input: { networkId: string; toUserId: string; message: string; attachments?: readonly DmAttachment[]; clientRequestId: string }) {
  return {
    network_id: input.networkId,
    to_user_id: input.toUserId,
    message: input.message,
    ...(input.attachments?.length ? { attachments: input.attachments.map(a => ({ type: 'file', file_id: a.file_id, ...(a.name ? { name: a.name } : {}), ...(a.mime ? { mime: a.mime } : {}), ...(a.size ? { size: a.size } : {}) })) } : {}),
    client_request_id: input.clientRequestId,
  };
}

// ── 把私信从 agent 那条链路里摘出去 ─────────────────────────────────────────────────────────────

/** 已知的人类用户名(人员列表读到的),供 stripHumanDms 把他们从 unread_by_agent 里去掉。 */
const knownHumans = new Set<string>();
export function noteHumanUsernames(names: Iterable<string>): void {
  for (const n of names) if (n) knownHumans.add(n);
}
export function knownHumanUsernames(): ReadonlySet<string> {
  return knownHumans;
}

type UserMessagesBodyLike = {
  messages?: ReadonlyArray<object>;
  unread?: number;
  pending_count?: number;
  unread_by_agent?: Record<string, number>;
  unread_total?: number;
};
type RowLike = { kind?: unknown; from_session?: unknown; acked?: unknown };

/**
 * `/api/messages?scope=user` 的响应去掉私信:
 *   - messages 里 kind='human_dm' 的行;
 *   - unread_by_agent 里私信发信人(本页的 human_dm 行 + 已知人类用户名)的键;
 *   - unread / pending_count / unread_total 相应减掉(hub 算它们时把私信也算进去了)。
 * 旧 hub 没有 human_dm 行也没有这些字段 → 原样返回(逐字相同)。
 */
export function stripHumanDms<T extends UserMessagesBodyLike>(body: T, humans: ReadonlySet<string> = knownHumans): T {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return body;
  const rows = body.messages as ReadonlyArray<RowLike>;
  const dmRows = rows.filter(m => m?.kind === HUMAN_DM_KIND);
  const senders = new Set<string>([...humans]);
  for (const m of dmRows) if (typeof m.from_session === 'string' && m.from_session) senders.add(m.from_session);
  const byAgent = body.unread_by_agent && typeof body.unread_by_agent === 'object' ? body.unread_by_agent : null;
  const removedFromAgent = byAgent ? Object.entries(byAgent).filter(([k]) => senders.has(k)).reduce((n, [, v]) => n + (Number(v) || 0), 0) : 0;
  if (!dmRows.length && !removedFromAgent) return body;
  const unreadDmRows = dmRows.filter(m => !m.acked).length;
  const next: T = { ...body, messages: rows.filter(m => m?.kind !== HUMAN_DM_KIND) as T['messages'] };
  if (byAgent) next.unread_by_agent = Object.fromEntries(Object.entries(byAgent).filter(([k]) => !senders.has(k)));
  // unread / pending_count 只数 user_inbox;unread_total 是 unread_by_agent 的和。
  const sub = (v: unknown, n: number) => (typeof v === 'number' ? Math.max(0, v - n) : v);
  const dmUnread = Math.max(unreadDmRows, removedFromAgent);
  if (typeof body.unread === 'number') next.unread = sub(body.unread, dmUnread) as number;
  if (typeof body.pending_count === 'number') next.pending_count = sub(body.pending_count, dmUnread) as number;
  if (typeof body.unread_total === 'number') next.unread_total = sub(body.unread_total, removedFromAgent) as number;
  return next;
}

/** SSE 的 desktop_message(desktop-message-consume 解析过的)是不是一条私信。 */
export const isHumanDmNotice = (notice: { kind?: string | null } | null | undefined): boolean => notice?.kind === HUMAN_DM_KIND;

// —— 在线状态(hub:humans 的 online / last_seen_at + 用户流上的 member_presence)——

/** 用户流上的 `{type:'member_presence', member_user_id, online, last_seen_at}`(事件里的 user_id 是收件人自己)。 */
export type MemberPresence = { user_id: string; online: boolean; last_seen_at: string | null };

export function parseMemberPresence(raw: unknown): MemberPresence | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (e.type !== 'member_presence' || typeof e.member_user_id !== 'string' || !e.member_user_id || typeof e.online !== 'boolean') return null;
  return { user_id: e.member_user_id, online: e.online, last_seen_at: typeof e.last_seen_at === 'string' ? e.last_seen_at : null };
}

/** 把一条 member_presence 合进人员行。没有这个人 → 原样返回(同一个数组,不触发重画)。 */
export function applyMemberPresence(rows: PersonRow[], ev: MemberPresence): PersonRow[] {
  const i = rows.findIndex(r => r.user_id === ev.user_id);
  if (i < 0) return rows;
  const next = rows.slice();
  next[i] = { ...rows[i], online: ev.online, last_seen_at: ev.last_seen_at };
  return next;
}

/** 「x 分钟前在线」的档位,由调用方按语言拼字。 */
export type LastSeen = { key: 'justNow' | 'minutes' | 'hours' | 'days' | 'date'; n?: number; date?: string };
/** null = 不画点(旧 hub 没给 online)。离线且 last_seen 未知(hub 重启后没再连过)→ 只有灰点,没有「x 前在线」。 */
export type PersonPresence = { online: boolean; lastSeen: LastSeen | null } | null;

export function personPresence(p: Pick<Human, 'online' | 'last_seen_at'>, nowMs: number): PersonPresence {
  if (typeof p.online !== 'boolean') return null;
  if (p.online) return { online: true, lastSeen: null };
  const at = hubMs(p.last_seen_at);
  if (!at) return { online: false, lastSeen: null };
  const min = Math.floor(Math.max(0, nowMs - at) / 60000);
  if (min < 1) return { online: false, lastSeen: { key: 'justNow' } };
  if (min < 60) return { online: false, lastSeen: { key: 'minutes', n: min } };
  const hours = Math.floor(min / 60);
  if (hours < 24) return { online: false, lastSeen: { key: 'hours', n: hours } };
  const days = Math.floor(hours / 24);
  if (days < 7) return { online: false, lastSeen: { key: 'days', n: days } };
  const d = new Date(at);
  return { online: false, lastSeen: { key: 'date', date: `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}` } };
}
