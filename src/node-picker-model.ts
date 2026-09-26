// 执行节点选择器(定时任务表单)的纯逻辑 —— 无 React / react-native,node-picker-model.test.ts 直接引。
//
// 2026-09-26 owner(展开的折叠屏截图):新建定时任务里「执行节点」把 ~300 个 agent 全铺成换行胶囊,
// 「这个执行节点的展示实在是太丑了」。改成微信 / iOS 式:表单里一行(头像 · 名字 · 在线点 · 提示 · ›),
// 点开是一个可搜索、分组、虚拟化的选择器。
//
// 分组 / 组序 / 组内顺序**不在这里另写一套**:直接调 agents-list.ts 的 buildSections(节点列表页用的
// 同一个函数),所以选择器里的「通信」组和列表页的「通信」组是同一组人、同一个顺序。这里只做三件事:
//   ① HubNode(可选的目标,有 node_id)× Session(在线状态)按 node_id(退回 alias)接起来;
//   ② 在 buildSections 前面加一个「最近使用」组(本设备,最多 5 个);
//   ③ 折叠态、表单行文案、呈现形态(底部 sheet / 居中对话框)、要不要自动聚焦。

import type { HubNode, Session } from './api';
import { buildSections, isOffline, substringMatch, teamOf, type Matcher } from './agents-list';
import { ANDROID_TWO_PANE_MIN_WIDTH } from './wide-layout';
import { pinScopeKey } from './chat-pins-core';

export const RECENT_TITLE = '最近使用';
export const RECENT_MAX = 5;

/** 一个可选的执行节点。status 已归一:没有会话 / 空状态 ⇒ 'offline'。 */
export interface PickerNode {
  node_id: string;
  alias: string;
  runtime: string;
  status: string;
  online: boolean;
  group: string;
}

/**
 * 节点表 × 会话表。目标只能是**注册过的节点**(表单提交的是 node_id),所以以 nodes 为准;
 * 会话只贡献状态。匹配先按 node_id,会话没带 node_id(旧 hub)再按 alias。
 */
export function pickerNodes(nodes: readonly HubNode[], sessions: readonly Session[] = []): PickerNode[] {
  const byId = new Map<string, Session>();
  const byAlias = new Map<string, Session>();
  for (const s of sessions) {
    if (!s || typeof s.alias !== 'string') continue;
    if (s.node_id) byId.set(s.node_id, s);
    if (!byAlias.has(s.alias)) byAlias.set(s.alias, s);
  }
  const seen = new Set<string>();
  const out: PickerNode[] = [];
  for (const n of nodes) {
    if (!n?.node_id || !n.alias || seen.has(n.node_id)) continue;
    seen.add(n.node_id);
    const s = byId.get(n.node_id) ?? byAlias.get(n.alias);
    const status = s?.status ? s.status : 'offline';
    out.push({
      node_id: n.node_id,
      alias: n.alias,
      runtime: (n.runtime || s?.runtime || '').trim(),
      status,
      online: !isOffline({ status } as Session),
      group: teamOf(n.alias),
    });
  }
  return out;
}

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
  for (const n of nodes) { if (!byAlias.has(n.alias)) byAlias.set(n.alias, n); byId.set(n.node_id, n); }
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
