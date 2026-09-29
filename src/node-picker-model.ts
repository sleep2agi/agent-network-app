// 执行节点选择器(定时任务表单)的纯逻辑 —— 无 React / react-native,node-picker-model.test.ts 直接引。
//
// 2026-09-26 owner(展开的折叠屏截图):新建定时任务里「执行节点」把 ~300 个 agent 全铺成换行胶囊,
// 「这个执行节点的展示实在是太丑了」。改成微信 / iOS 式:表单里一行(头像 · 名字 · 在线点 · 提示 · ›),
// 点开是一个可搜索、分组、虚拟化的选择器。
//
// 分组 / 组序 / 组内顺序**不在这里另写一套**:直接调 agents-list.ts 的 buildSections(节点列表页用的
// 同一个函数),所以选择器里的「通信」组和列表页的「通信」组是同一组人、同一个顺序。这里只做三件事:
//   ① HubNode(可选的目标,有 node_id)× Session(在线状态)按 node_id(退回 alias)接起来;
//      节点表里没有、但在线的会话列成不可指派的行(灰、写明原因),不静默丢掉;
//   ② 在 buildSections 前面加一个「最近使用」组(本设备,最多 5 个);
//   ③ 折叠态、表单行文案、呈现形态(底部 sheet / 居中对话框)、要不要自动聚焦。

import type { HubNode, Session } from './api';
import { buildSections, isOffline, substringMatch, teamOf, type Matcher } from './agents-list';
import { ANDROID_TWO_PANE_MIN_WIDTH } from './wide-layout';
import { pinScopeKey } from './chat-pins-core';

export const RECENT_TITLE = '最近使用';
export const RECENT_MAX = 5;

/**
 * 选择器里的一行。status 已归一:没有会话 / 空状态 ⇒ 'offline'。
 * assignable=false 的行是「在线、但 Hub 的节点表里没有它」的会话:照样列出来(灰、不可点、写明原因),
 * 不能静默消失 —— 2026-09-29 owner:选择器写「搜索 273 个节点」,网络里 304 个会话,自己那个在线的
 * claude-code 节点不在列表里,也看不出为什么。
 */
export interface PickerNode {
  /** 表单提交的目标。不可指派的行没有 node_id(''),永远不会被提交。 */
  node_id: string;
  alias: string;
  runtime: string;
  status: string;
  online: boolean;
  group: string;
  assignable: boolean;
  /** 不可指派的原因(assignable=false 时才有),行右侧显示它而不是 runtime。 */
  reason?: string;
}

/** claude-code-cli 节点的 MCP 通道旧版本不上报 node_id ⇒ Hub 节点表里没有它;升级后重启即可选。 */
export const REASON_OLD_NODE = '节点版本过旧，无法指派，升级后可选';
/** 其它没有节点登记的会话(没有 node_id 的旧节点、Hub 拒绝登记的节点)。 */
export const REASON_UNREGISTERED = '未在 Hub 登记节点，无法指派';

export interface PickerChoices {
  /** 列出来的行(每个别名一行),标题栏的计数就是它的长度。 */
  nodes: PickerNode[];
  /** 没有节点登记、且离线的会话数:不列(大多是一次性探针 / 早已退役的会话),在列表底部说一句。 */
  hiddenOffline: number;
}

const ACTIVE_STATES = new Set(['', 'active']);
const isActiveRow = (n: HubNode) => ACTIVE_STATES.has((n.lifecycle_state ?? '').trim());

/** 同一别名有多行节点(换过 node_id 的节点、残留的旧行)时挑一行:活着的优先,再取最近写过的。 */
function preferRow(a: HubNode, b: HubNode): HubNode {
  if (isActiveRow(a) !== isActiveRow(b)) return isActiveRow(a) ? a : b;
  return (b.updated_at ?? '') > (a.updated_at ?? '') ? b : a;
}

const unassignableReason = (s: Session): string =>
  (s.runtime ?? '').trim() === 'claude-code-cli' || (s.agent ?? '').trim() === 'claude-code' ? REASON_OLD_NODE : REASON_UNREGISTERED;

/**
 * 节点表 × 会话表。目标只能是**注册过的节点**(表单提交的是 node_id):
 *   - 节点表的每个别名一行,状态来自会话(先按 node_id,会话没带 node_id 再按 alias);
 *   - 会话有、节点表没有的别名:在线 ⇒ 列成不可指派的一行(写明原因);离线 ⇒ 只计数。
 * 这样「列出来的行数」= 标题栏的数字,在线的会话一个都不会不见。
 */
export function pickerChoices(nodes: readonly HubNode[], sessions: readonly Session[] = []): PickerChoices {
  const byId = new Map<string, Session>();
  const byAlias = new Map<string, Session>();
  for (const s of sessions) {
    if (!s || typeof s.alias !== 'string' || !s.alias) continue;
    if (s.node_id) byId.set(s.node_id, s);
    // 同一别名多条会话:在线的那条说了算(一条旧的离线行不能把在线节点画成离线)。
    const prev = byAlias.get(s.alias);
    if (!prev || (isOffline(prev) && !isOffline(s))) byAlias.set(s.alias, s);
  }
  const rows = new Map<string, HubNode>();
  for (const n of nodes) {
    if (!n?.node_id || !n.alias) continue;
    const prev = rows.get(n.alias);
    rows.set(n.alias, prev ? preferRow(prev, n) : n);
  }
  const out: PickerNode[] = [];
  for (const n of rows.values()) {
    const s = byId.get(n.node_id) ?? byAlias.get(n.alias);
    const status = s?.status ? s.status : 'offline';
    out.push({
      node_id: n.node_id,
      alias: n.alias,
      runtime: (n.runtime || s?.runtime || '').trim(),
      status,
      online: !isOffline({ status } as Session),
      group: teamOf(n.alias),
      assignable: true,
    });
  }
  let hiddenOffline = 0;
  for (const s of byAlias.values()) {
    if (rows.has(s.alias)) continue;
    if (!s.status || isOffline(s)) { hiddenOffline++; continue; }
    out.push({
      node_id: '',
      alias: s.alias,
      runtime: (s.runtime ?? '').trim(),
      status: s.status,
      online: true,
      group: teamOf(s.alias),
      assignable: false,
      reason: unassignableReason(s),
    });
  }
  return { nodes: out, hiddenOffline };
}

/** 只要行(测试 / 旧调用方)。 */
export const pickerNodes = (nodes: readonly HubNode[], sessions: readonly Session[] = []): PickerNode[] =>
  pickerChoices(nodes, sessions).nodes;

/** 列表底部那一句;没有被省略的会话时为空。 */
export const hiddenOfflineText = (n: number): string =>
  n > 0 ? `另有 ${n} 个离线会话没有登记节点，无法指派` : '';

/** 搜索框的占位字:数字就是列出来的行数。 */
export const searchPlaceholder = (listed: number): string => `搜索 ${listed} 个节点(支持拼音)`;

export interface PickerSection {
  /** SectionList key:最近使用 与同名团队组不能撞 key。 */
  key: string;
  title: string;
  data: PickerNode[];
  online: number;
  total: number;
  collapsible: boolean;
  collapsed: boolean;
}

export interface PickerSectionOpts {
  query?: string;
  /** 最近使用的 node_id,新的在前(recentsPush 维护)。 */
  recents?: readonly string[];
  /** 置顶的 alias(与节点列表同一份置顶)。 */
  pinned?: readonly string[];
  /** 折叠了的组标题。 */
  collapsed?: readonly string[];
  match?: Matcher;
}

/**
 * 选择器的分组:
 *   - 不搜索:最近使用(≤5,不可折叠)→ 置顶 → 团队组(与节点列表同序)。
 *     最近使用是**复制**(那一行在它的团队组里也在),置顶是**搬走**(与列表页一致)。
 *   - 搜索:没有最近使用;所有组展开、不可折叠(搜到的必须看得见)。
 * 组内顺序来自 buildSections 的 compareInTeam:在线在前 → 别名字母序(这里不给 updated_at,
 * 心跳不会让行来回跳)。
 */
export function buildPickerSections(nodes: readonly PickerNode[], opts: PickerSectionOpts = {}): PickerSection[] {
  const q = (opts.query ?? '').trim();
  const match = opts.match ?? substringMatch;
  const byAlias = new Map<string, PickerNode>();
  const byId = new Map<string, PickerNode>();
  for (const n of nodes) {
    if (!byAlias.has(n.alias)) byAlias.set(n.alias, n);
    // 不可指派的行没有 node_id,不进「最近使用」的查找表。
    if (n.node_id && n.assignable !== false) byId.set(n.node_id, n);
  }
  const pins = new Set(opts.pinned ?? []);
  const sessions = [...byAlias.values()].map(n => ({ alias: n.alias, status: n.status, node_id: n.node_id }) as Session);
  const grouped = buildSections(sessions, q, { match, sort: pins.size ? { pinned: a => pins.has(a) } : undefined });
  const folded = new Set(opts.collapsed ?? []);
  const out: PickerSection[] = [];
  if (!q) {
    const recent = recentNodes(opts.recents ?? [], byId);
    if (recent.length) out.push({ key: `recent:${RECENT_TITLE}`, title: RECENT_TITLE, data: recent, online: recent.filter(n => n.online).length, total: recent.length, collapsible: false, collapsed: false });
  }
  for (const g of grouped) {
    const data = g.data.map(s => byAlias.get(s.alias)!).filter(Boolean);
    const collapsible = !q;
    const collapsed = collapsible && folded.has(g.title);
    out.push({ key: `group:${g.title}`, title: g.title, data: collapsed ? [] : data, online: g.online, total: g.total, collapsible, collapsed });
  }
  return out;
}

const recentNodes = (ids: readonly string[], byId: Map<string, PickerNode>): PickerNode[] => {
  const out: PickerNode[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= RECENT_MAX) break;
  }
  return out;
};

export const countPickerRows = (sections: readonly PickerSection[]): number =>
  sections.reduce((n, s) => n + s.data.length, 0);

/** 选中后:放到最近使用的最前面,去重,截到 RECENT_MAX。 */
export function recentsPush(list: readonly string[], nodeId: string, max = RECENT_MAX): string[] {
  if (!nodeId) return list.slice(0, max);
  return [nodeId, ...list.filter(id => id !== nodeId)].slice(0, max);
}

/** 持久化值 → 最近使用。坏值一律读成空(不让一个坏文件弄崩表单)。 */
export function parseRecents(raw: unknown): string[] {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === 'string' && x && !out.includes(x)) out.push(x);
  return out.slice(0, RECENT_MAX);
}

/**
 * 最近使用的存取,与存储后端解耦(schedule-target-recents.ts 给出 localStorage / 原生文件两种后端;
 * 测试喂一个内存后端)。按 Hub 账号分 key:node_id 只在一个 Hub 里有意义。
 */
export interface RecentsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
type Scope = { profileId?: string; serverUrl?: string; username?: string };
export const recentsStorageKey = (cfg: Scope): string => `schedule_target_recents_v1_${pinScopeKey(cfg)}`;

export async function loadRecents(store: RecentsStore, cfg: Scope): Promise<string[]> {
  try { return parseRecents(await store.get(recentsStorageKey(cfg))); } catch { return []; }
}

/** 放到最前并写回;返回新列表(调用方立刻渲染,不等写盘;写失败只影响下次打开)。 */
export function rememberRecent(store: RecentsStore, cfg: Scope, current: readonly string[], nodeId: string): string[] {
  const next = recentsPush(current, nodeId);
  try { void store.set(recentsStorageKey(cfg), JSON.stringify(next)).catch(() => { /* session only */ }); } catch { /* session only */ }
  return next;
}

export function toggleFolded(collapsed: readonly string[], title: string): string[] {
  return collapsed.includes(title) ? collapsed.filter(t => t !== title) : [...collapsed, title];
}

/** 空搜索结果的文案(owner 指定的形状)。 */
export const emptySearchText = (query: string): string => `没有找到 “${query.trim()}”`;

export interface FieldModel {
  placeholder: boolean;
  title: string;
  /** 右侧浅色提示:runtime · 组。没选时为空。 */
  hint: string;
  online: boolean;
}

/**
 * 表单里那一行。选了但节点表里没有(已删 / 还没加载到)时仍显示 alias,不退回占位 ——
 * 编辑一条旧计划时,它的目标就算下线了也得看得出是谁。
 */
export function fieldModel(selected: PickerNode | null | undefined, fallbackAlias?: string | null): FieldModel {
  if (selected) {
    return { placeholder: false, title: selected.alias, hint: [selected.runtime, selected.group].filter(Boolean).join(' · '), online: selected.online };
  }
  if (fallbackAlias) return { placeholder: false, title: fallbackAlias, hint: '', online: false };
  return { placeholder: true, title: '选择执行节点', hint: '', online: false };
}

export type PickerPresentation = 'sheet' | 'dialog';

/** 手机(窄)= 底部 sheet;双栏 / 桌面宽度 = 居中对话框。阈值与双栏同一个数。 */
export const pickerPresentation = (windowWidth: number): PickerPresentation =>
  Number.isFinite(windowWidth) && windowWidth >= ANDROID_TWO_PANE_MIN_WIDTH ? 'dialog' : 'sheet';

export const PICKER_DIALOG_WIDTH = 520;
export const PICKER_DIALOG_HEIGHT = 640;
export const PICKER_SHEET_RATIO = 0.85;

/** 对话框尺寸:520×640,窗口放不下时各留 24 的边。 */
export function pickerDialogSize(windowWidth: number, windowHeight: number): { width: number; height: number } {
  const w = Number.isFinite(windowWidth) ? windowWidth : PICKER_DIALOG_WIDTH;
  const h = Number.isFinite(windowHeight) ? windowHeight : PICKER_DIALOG_HEIGHT;
  return { width: Math.max(0, Math.min(PICKER_DIALOG_WIDTH, w - 48)), height: Math.max(0, Math.min(PICKER_DIALOG_HEIGHT, h - 48)) };
}

/**
 * 搜索框自动聚焦:只在有实体键盘的桌面上(web 且不是粗指针)。原生手机 / 平板永远不聚焦 ——
 * 一打开就弹软键盘,半个屏幕的列表就没了。
 */
export const pickerAutoFocus = (os: string, coarsePointer: boolean): boolean => os === 'web' && !coarsePointer;
