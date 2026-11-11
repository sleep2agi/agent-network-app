// 节点权限白名单的**显示规则**(Hub RFC-041 白名单小节 + 收件白名单)。不 import react-native。
//
// 三条不能违反的规则,全在这里收口:
//   1. null / undefined = 不限制(界面必须写「不限制」)。
//      `[]` 不是「一个都不允许」—— Hub 侧的合法取值只有两种：null(不限制) 与非空数组(只允许这些)。
//      GET /api/nodes 永远不会返回 []，PUT [] 会拿到 400 empty_allowlist_ambiguous。
//      所以这里把 [] 当「不限制」渲染，提交前也换成 null。
//   2. 保活类工具不许被单独禁用(挡掉它们,节点既干不了活也报不了自己干不了,变成更隐蔽的假活节点);
//   3. 拒绝原因码要照实显示,它们指向完全不同的排查动作,不能合并成「权限不足」。
//
// 收件白名单的条目语法(agent-network inbox_allowlist 契约):别名 / node_id = Agent 发送方;
// `user:<用户名|user_id>` = 某个人;`user:*` = 任何人;`!strict` = 主人 / 管理员也不再默认放行。
import type { HubNode } from './api';
import type { Human } from './human-dm';
import { t } from './i18n';
import './i18n-node-permissions';

export const ALWAYS_TOOLS = ['get_inbox', 'ack_inbox', 'send_reply', 'report_status'] as const;

export const isAlwaysTool = (tool: string): boolean => (ALWAYS_TOOLS as readonly string[]).includes(tool);

export const STRICT_ENTRY = '!strict';
export const ANY_PERSON_ENTRY = 'user:*';
export const personEntry = (username: string): string => `user:${username}`;

/** 名单里的一个节点:别名优先,别名没有时用 node_id(Hub 两种都认)。 */
export interface NodeChoice { key: string; alias: string | null; node_id: string }

/** 选择器的候选:这个网络的节点列表,去掉自己;同一个别名只留一项。 */
export function nodeChoices(nodes: readonly Pick<HubNode, 'node_id' | 'alias'>[], self: Pick<HubNode, 'node_id' | 'alias'>): NodeChoice[] {
  const seen = new Set<string>();
  const out: NodeChoice[] = [];
  for (const n of nodes) {
    if (!n.node_id || n.node_id === self.node_id || (self.alias && n.alias === self.alias)) continue;
    const key = n.alias || n.node_id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, alias: n.alias || null, node_id: n.node_id });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** 名单里有没有这个节点(按别名或 node_id 写的都算)。 */
export const listHasNode = (list: readonly string[] | null | undefined, c: NodeChoice): boolean =>
  !!list && list.some(e => e === c.node_id || (!!c.alias && e === c.alias));

/** 勾 / 取消一个节点。取消时两种写法都去掉;去空 ⇒ null(不限制)。 */
export function toggleNode(list: readonly string[] | null | undefined, c: NodeChoice): string[] | null {
  if (listHasNode(list, c)) return withoutItem(list ?? [], ...[c.node_id, c.alias].filter((x): x is string => !!x));
  return [...(list ?? []), c.key];
}

/** 勾 / 取消一个名单项(人、所有人)。 */
export function toggleEntry(list: readonly string[] | null | undefined, entry: string): string[] | null {
  return list?.includes(entry) ? withoutItem(list, entry) : [...(list ?? []), entry];
}

export const isStrict = (list: readonly string[] | null | undefined): boolean => !!list?.includes(STRICT_ENTRY);

/** 打开 / 关闭严格。没有任何发送方时不许开(否则 ['!strict'] 等于只有它自己能发,太容易误封)。 */
export function setStrict(list: readonly string[] | null | undefined, on: boolean): string[] | null {
  const rest = withoutItem(list ?? [], STRICT_ENTRY) ?? [];
  if (!on) return rest.length ? rest : null;
  return rest.length ? [...rest, STRICT_ENTRY] : null;
}

/** 收件名单提交前:没有发送方了就整张清空(只剩 !strict 会把主人自己也挡在外面)。 */
export function normalizeInbox(list: readonly string[] | null | undefined): string[] | null {
  return senderEntries(list).length ? [...new Set(list)] : null;
}

/** 名单里真正的发送方(去掉 !strict)。 */
export const senderEntries = (list: readonly string[] | null | undefined): string[] => (list ?? []).filter(e => e !== STRICT_ENTRY);

/** 一个名单项的显示名:node_id 换成别名,user: 前缀换成「成员 xx」,不认识的照原样并注明不在网络里。 */
/** 收件白名单的部门项(Hub 报 node_inbox_allowlist_dept 才有):`dept:<department_id>`,含子部门。 */
export const DEPT_ENTRY_PREFIX = 'dept:';
export const INBOX_DEPT_CAPABILITY = 'node_inbox_allowlist_dept';
export const deptEntry = (departmentId: string) => `${DEPT_ENTRY_PREFIX}${departmentId}`;
export type DeptChoice = { id: string; path: string };

/** 部门 → 带上级路径的显示名(「TMAI / TM门户」),按路径排序;断链 / 成环时停在已走过的那段。 */
export function deptChoices(depts: readonly { id: string; name: string; parent_id: string | null }[]): DeptChoice[] {
  const byId = new Map(depts.map(d => [d.id, d]));
  const path = (id: string) => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let cur = byId.get(id); cur && !seen.has(cur.id) && names.length < 32; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined) {
      seen.add(cur.id); names.unshift(cur.name);
    }
    return names.join(' / ');
  };
  return depts.map(d => ({ id: d.id, path: path(d.id) })).sort((a, b) => a.path.localeCompare(b.path));
}

export function entryLabel(entry: string, choices: readonly NodeChoice[], humans: readonly Pick<Human, 'user_id' | 'username' | 'display_name'>[] = [], depts: readonly DeptChoice[] = []): string {
  if (entry === ANY_PERSON_ENTRY) return t('nodePerm.inbox.anyPerson');
  if (entry.startsWith(DEPT_ENTRY_PREFIX)) {
    const id = entry.slice(DEPT_ENTRY_PREFIX.length);
    return t('nodePerm.inbox.dept', { name: depts.find(d => d.id === id)?.path || id });
  }
  if (entry.startsWith('user:')) {
    const ref = entry.slice('user:'.length);
    const h = humans.find(x => x.username === ref || x.user_id === ref);
    return t('nodePerm.inbox.person', { name: h?.display_name || h?.username || ref });
  }
  const c = choices.find(x => x.node_id === entry || x.alias === entry);
  if (c) return c.alias || c.node_id;
  return choices.length ? t('nodePerm.list.notInNetwork', { item: entry }) : entry;
}

/** 白名单的「人话」:null / [] = 不限制;否则列出来(可传入显示名转换)。 */
export function allowlistText(list: readonly string[] | null | undefined, label: (entry: string) => string = e => e): string {
  if (list === null || list === undefined || list.length === 0) return t('nodePerm.list.unrestricted');
  const senders = senderEntries(list);
  if (!senders.length) return t('nodePerm.inbox.onlySelf');
  return senders.map(label).join(t('nodePerm.list.sep'));
}

/** 输入框 → 白名单:空白 = 清空限制(null);否则按逗号/空格/顿号拆开去重。 */
export function parseAllowlistInput(text: string): string[] | null {
  const items = text
    .split(/[\s,、，]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return items.length ? [...new Set(items)] : null;
}

/** 草稿合并进现有名单(去重),保留 !strict。 */
export function mergeDraft(list: readonly string[] | null | undefined, draft: string): string[] | null {
  const add = parseAllowlistInput(draft);
  if (!add) return list?.length ? [...list] : null;
  return [...new Set([...(list ?? []), ...add])];
}

/** 编辑工具清单时:保活类不能被移除(即使界面给了置灰入口,这里也兜一层)。 */
export function withoutAlwaysTools(tools: readonly string[]): string[] {
  return tools.filter(t2 => !isAlwaysTool(t2));
}

export const PERMISSION_REASON_CODES = [
  'mode_readonly', 'mode_restricted_not_assigned', 'peer_not_allowed', 'sender_not_allowed', 'tool_not_allowed',
  'secret_transport_plain', 'secret_transport_unknown', 'empty_allowlist_ambiguous',
] as const;

/** 原因码 → 可执行的一句话。未知码原样带出,别吞掉(吞掉等于让排查人猜)。 */
export function permissionReasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.trim();
  const tkey = `nodePerm.reason.${key}`;
  const text = t(tkey);
  return text === tkey ? t('nodePerm.reason.unknown', { code: key }) : text;
}

/** 从名单里去掉若干项;去空 ⇒ null(Hub 拒收 [],而且空名单在 Hub 那边就是「不限制」)。 */
export function withoutItem(list: readonly string[], ...items: string[]): string[] | null {
  const rest = list.filter(x => !items.includes(x));
  return rest.length ? rest : null;
}

/** PUT 白名单失败 → 一句人话。node_permission_denied 照实带出原因码和 Hub 的 hint。 */
export function allowlistErrorText(f: { error?: string; status?: number; reason?: string; hint?: string; message?: string } | null | undefined): string {
  if (!f) return '';
  const code = f.error ?? '';
  if (code === 'node_permission_denied') {
    const reason = f.reason || code;
    const text = permissionReasonText(reason) ?? reason;
    return [t('nodePerm.error.denied', { reason, text }), f.hint ? t('nodePerm.error.hubHint', { hint: f.hint }) : ''].filter(Boolean).join('\n');
  }
  if (code === 'user_token_required') return t('nodePerm.error.userToken');
  if (code === 'permission_denied' || f.status === 403) return t('nodePerm.error.forbidden');
  if (code === 'node_not_found' || f.status === 404) return t('nodePerm.error.notFound');
  if (code === 'empty_allowlist_ambiguous') return permissionReasonText(code) ?? code;
  if (code === 'too_many_peers' || code === 'too_many_senders') return t('nodePerm.error.tooMany', { max: 200 });
  if (code === 'too_many_tools') return t('nodePerm.error.tooMany', { max: 500 });
  if (/^invalid_(peers|senders|tools)$/.test(code)) return t('nodePerm.error.invalid');
  return t('nodePerm.error.saveFailed', { error: f.message || code || t('nodePerm.error.network') });
}
