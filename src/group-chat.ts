// 部门群 / 群聊(RFC-042,看板 #457;Hub ≥ .93,agent-network #2280/#2281/#2282)—— 客户端纯逻辑。不 import react-native。
//
// 🔴 功能门:旧 Hub 没有群接口。判据只有两个,都来自 Hub 自己的回答,不看版本号:
//   1. GET /api/dm/threads 的响应**有** `group_threads` 数组 ⇒ 会话列表画群;没有这个键 ⇒ 不画(和升级前逐字一样)。
//   2. GET /api/networks/:id/chat-groups 回 2xx ⇒ 部门页画「部门群」;404 / 405 / 其他任何失败 ⇒ 整块不画、不报错。
// 生产 Hub 在 .93 之前两条都不成立,所以这一整套界面在那里完全不出现。

import { hubMs, type DmMessage } from './human-dm';

export const GROUP_MESSAGE_EVENT = 'group_message';
export const GROUP_READ_EVENT = 'group_read';

/** GET /api/dm/threads 里 group_threads 的一项。 */
export type GroupThread = { group_id: string; name: string; department_id?: string | null; last_at?: string | null; unread?: number | null; last_read_seq?: number | null };
/** 会话列表里的一行群。 */
export type GroupRow = { group_id: string; name: string; department_id: string | null; unread: number; lastAt: number };
/** GET …/chat-groups/:gid 的群资料。 */
export type ChatGroup = { id: string; network_id?: string; name: string; department_id: string | null; member_count?: number; created_by?: string | null; created_at?: string; updated_at?: string };
export type ChatGroupMember = { user_id: string; source: string; joined_at?: string };
/** 群消息:和私信行同形,另加 group_id / seq / sender_user_id。 */
export type GroupMessage = DmMessage & { group_id?: string; seq?: number; sender_user_id?: string | null };

const count = (v: unknown) => Math.max(0, Math.floor(Number(v ?? 0)) || 0);

/**
 * /api/dm/threads 的响应里取群会话。**null = 这个 Hub 没有群**(没有 group_threads 键,或者不是数组)——
 * 调用方据此整块不画。空数组 = 有群功能、只是我还不在任何群里。
 */
export function groupThreadsOf(body: unknown): GroupThread[] | null {
  if (!body || typeof body !== 'object') return null;
  const list = (body as { group_threads?: unknown }).group_threads;
  if (!Array.isArray(list)) return null;
  return list.filter((g): g is GroupThread => !!g && typeof g === 'object' && typeof (g as GroupThread).group_id === 'string' && !!(g as GroupThread).group_id);
}

/** 群行:按最后一条消息时间倒序(没消息的排最后,再按名字)—— 与 Hub listGroupThreads 同序,与私信「最近聊过的在前」一致。 */
export function groupRows(threads: readonly GroupThread[] | null | undefined): GroupRow[] {
  return (threads ?? [])
    .map(g => ({ group_id: g.group_id, name: (g.name ?? '').trim() || g.group_id, department_id: g.department_id ?? null, unread: count(g.unread), lastAt: hubMs(g.last_at) }))
    .sort(byLastAt);
}
const byLastAt = (a: GroupRow, b: GroupRow) => b.lastAt - a.lastAt || a.name.localeCompare(b.name) || a.group_id.localeCompare(b.group_id);

/** 会话列表顶上的总未读(角标):私信未读 + 群未读。两边都按条数加,不按会话数。 */
export function conversationUnreadTotal(people: readonly { unread: number }[], groups: readonly { unread: number }[]): number {
  let n = 0;
  for (const p of people) n += count(p.unread);
  for (const g of groups) n += count(g.unread);
  return n;
}

/** 「未读」视图:只留有未读的群 + 正打开着的那一个(读完也不在眼前抽走)。与 applyConversationTabToPeople 同规则。 */
export function applyConversationTabToGroups<T extends { group_id: string; unread: number }>(rows: T[], tab: 'all' | 'unread', keep?: string | null): T[] {
  if (tab !== 'unread') return rows;
  return rows.filter(g => g.unread > 0 || g.group_id === keep);
}

/** 搜索:群名(调用方给匹配器,支持拼音)。 */
export function shownGroups<T extends { name: string }>(rows: readonly T[], query: string, match: (text: string, q: string) => boolean): T[] {
  const q = query.trim();
  return q ? rows.filter(g => match(g.name, q)) : [...rows];
}

// ── 实时事件(/events/users/me)──

export type GroupMessageEvent = { type: 'group_message'; group_id: string; group_name: string | null; message_id: string; seq: number | null; from: string | null; from_user_id: string | null; created_at: string | null; unread: number | null };
export type GroupReadEvent = { type: 'group_read'; group_id: string; last_read_seq: number | null; unread: number | null };
export type GroupEvent = GroupMessageEvent | GroupReadEvent;

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 用户流上的 group_message / group_read。别的类型、缺 group_id → null(交给其他消费者)。 */
export function parseGroupEvent(raw: unknown): GroupEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const gid = str(e.group_id);
  if (!gid) return null;
  if (e.type === GROUP_MESSAGE_EVENT) {
    const mid = str(e.message_id);
    if (!mid) return null;
    return { type: 'group_message', group_id: gid, group_name: str(e.group_name), message_id: mid, seq: num(e.seq), from: str(e.from), from_user_id: str(e.from_user_id), created_at: str(e.created_at), unread: num(e.unread) };
  }
  if (e.type === GROUP_READ_EVENT) return { type: 'group_read', group_id: gid, last_read_seq: num(e.last_read_seq), unread: num(e.unread) };
  return null;
}

/**
 * 把一条事件就地合进群行。Hub 在事件里带了**我自己的**未读数,直接用,不自己加减(多端各自标已读时不会算错)。
 * 返回 null = 列表里没有这个群(新入群 / 新建的群),调用方要整表重拉。没变化 → 同一个数组。
 */
export function applyGroupEvent(rows: GroupRow[], ev: GroupEvent): GroupRow[] | null {
  const i = rows.findIndex(r => r.group_id === ev.group_id);
  if (i < 0) return ev.type === 'group_message' ? null : rows;
  const cur = rows[i];
  const next: GroupRow = ev.type === 'group_message'
    ? { ...cur, name: ev.group_name?.trim() || cur.name, unread: ev.unread === null ? cur.unread : count(ev.unread), lastAt: Math.max(cur.lastAt, hubMs(ev.created_at)) }
    : { ...cur, unread: ev.unread === null ? cur.unread : count(ev.unread) };
  if (next.unread === cur.unread && next.lastAt === cur.lastAt && next.name === cur.name) return rows;
  const out = rows.slice();
  out[i] = next;
  return ev.type === 'group_message' ? out.sort(byLastAt) : out;
}

// ── 群聊页 ──

/** 读到哪了:已加载的消息里最大的 seq(本地乐观那条没有 seq,不算)。0 = 还没有消息。 */
export function maxSeq(messages: readonly Pick<GroupMessage, 'seq'>[]): number {
  let n = 0;
  for (const m of messages) if (typeof m.seq === 'number' && m.seq > n) n = m.seq;
  return n;
}

/** 要不要发 POST …/read:有比上次标过的更新的消息才发(只前进不后退,和 Hub 一致)。 */
export function readTarget(messages: readonly Pick<GroupMessage, 'seq'>[], lastMarked: number): number | null {
  const s = maxSeq(messages);
  return s > lastMarked ? s : null;
}

export function groupSendBody(input: { message: string; attachments?: readonly { file_id: string; name?: string; mime?: string; size?: number }[]; clientRequestId: string }) {
  return {
    message: input.message,
    ...(input.attachments?.length ? { attachments: input.attachments.map(a => ({ type: 'file', file_id: a.file_id, ...(a.name ? { name: a.name } : {}), ...(a.mime ? { mime: a.mime } : {}), ...(a.size ? { size: a.size } : {}) })) } : {}),
    client_request_id: input.clientRequestId,
  };
}

/** 群里一条消息的发信人:Hub 行里的 from_session 是发信时的用户名;显示名从人员表里找。 */
export function senderOf(m: Pick<GroupMessage, 'from_session' | 'sender_user_id'>, people: readonly { user_id: string; username: string; display_name?: string | null }[]): { username: string; name: string } {
  const p = (m.sender_user_id ? people.find(x => x.user_id === m.sender_user_id) : undefined) ?? (m.from_session ? people.find(x => x.username === m.from_session) : undefined);
  const username = p?.username ?? m.from_session ?? m.sender_user_id ?? '?';
  return { username, name: (p?.display_name ?? '').trim() || username };
}

// ── 部门页:谁能管、成员列表 ──

/**
 * 能不能给这个部门建群 / 改群名 / 拉人移人(RFC-042 §3):owner / admin / Hub 管理员(在「成员与部门」里 = 非负责人模式,
 * managed = null),或这个部门(含上级)的负责人(managed 是 /api/auth/me 的 managed_department_ids,已含下级)。
 * 解除关联的群(department_id = null)只归管理员。Hub 仍然是最后的判定 —— 这里只决定按钮画不画。
 */
export function canManageDeptGroup(managed: ReadonlySet<string> | null, departmentId: string | null): boolean {
  if (!managed) return true;
  return !!departmentId && managed.has(departmentId);
}

export type MemberSource = 'department' | 'manual';
export const memberSource = (s: unknown): MemberSource => (s === 'department' ? 'department' : 'manual');
export const memberSourceLabel = (s: unknown): string => (memberSource(s) === 'department' ? '部门' : '手动');

/** 能不能把这个人移出群:手动拉的能;部门同步进来的、群还挂着部门 → 不能(Hub 409 department_member,下次对账会加回来)。 */
export function canRemoveMember(member: Pick<ChatGroupMember, 'source'>, group: Pick<ChatGroup, 'department_id'>): boolean {
  return memberSource(member.source) === 'manual' || group.department_id === null;
}

export type GroupMemberRow = ChatGroupMember & { name: string; username: string; sourceLabel: string; removable: boolean };

/** 成员列表:部门来的在前、手动拉的在后,各自按名字。名字从人员表里找,找不到就显示 user_id(不是空行)。 */
export function groupMemberRows(members: readonly ChatGroupMember[], group: Pick<ChatGroup, 'department_id'>, people: readonly { user_id: string; username: string; display_name?: string | null }[]): GroupMemberRow[] {
  return members
    .map(m => {
      const p = people.find(x => x.user_id === m.user_id);
      const username = p?.username ?? m.user_id;
      return { ...m, username, name: (p?.display_name ?? '').trim() || username, sourceLabel: memberSourceLabel(m.source), removable: canRemoveMember(m, group) };
    })
    .sort((a, b) => (memberSource(a.source) === memberSource(b.source) ? 0 : memberSource(a.source) === 'department' ? -1 : 1) || a.name.localeCompare(b.name));
}

/** 「添加成员」能选的人:还不在群里的人(Hub 只认本网络成员;人员表本来就是本网络的人)。 */
export function addableMembers<P extends { user_id: string }>(people: readonly P[], members: readonly Pick<ChatGroupMember, 'user_id'>[]): P[] {
  const inGroup = new Set(members.map(m => m.user_id));
  return people.filter(p => !inGroup.has(p.user_id));
}

/** 群名:trim 后 1–40 个字(按字符,不按 UTF-16 单元)—— 与 Hub invalid_group_name 同一判据。 */
export function validGroupName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && [...n].length <= 40;
}

/** Hub 的错误码 → 一句人话。 */
export function groupErrorText(code: string): string {
  switch (code) {
    case 'department_group_exists': return '这个部门已经有群了,刷新后再看';
    case 'department_not_found': return '这个部门已经不存在了';
    case 'department_scope_denied': return '只能给你负责的部门建群';
    case 'group_manage_denied': return '你没有权限管理这个群';
    case 'group_not_found': return '这个群已经不存在了,或你已不在群里';
    case 'invalid_group_name': return '群名称 1–40 个字';
    case 'already_group_member': return '这个人已经在群里了';
    case 'not_network_member': return '只能拉本网络的成员进群';
    case 'department_member': return '这个人是随部门自动加入的,要移出请调整他的部门';
    case 'group_member_not_found': return '这个人已经不在群里了';
    case 'message_required': return '不能发送空消息';
    case 'message_too_long': return '消息太长了(最多 1 万字)';
    case 'attachment_not_accessible': return '有附件无法发到群里(没有权限使用这个文件)';
    case 'humans_only': return '群只对成员开放';
    default: return code || '操作失败,请重试';
  }
}
