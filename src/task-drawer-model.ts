// 看板 #701 —— 任务详情抽屉(桌面):点任务 = 应用内右侧抽屉(默认 560,左沿可拖宽窄),不再弹系统窗口;
// 「在新窗口打开」留在抽屉头上给要老样子的人。手机仍是推入的整页,样子与抽屉对齐。
// 这里只放纯逻辑(宽度、模式、分栏、标题 / 描述的失焦保存与 Esc 取消、链接、主题色),屏幕在
// TaskDrawer.tsx(可拖宽的外框)和 TaskDetailPanel.tsx(内容)。不 import react-native。
import { colors, themeMode } from './theme';
import { requestOpenTask } from './task-open-request';
import { editDraftOf, editPatch, type EditDraft, type EditPatch } from './task-board-model';
import type { Requirement } from './requirements-model';

export const DRAWER_DEFAULT_WIDTH = 560;
export const DRAWER_MIN_WIDTH = 420;
/** 抽屉最多占看板宽度的这么多(左边总要留一截列表 / 看板看得见)。 */
export const DRAWER_MAX_RATIO = 0.85;
/** 抽屉 ≥ 这个宽度时内容分两栏(左:描述 / 子任务 / 动态;右:属性)。 */
export const DRAWER_TWO_COLUMN_MIN = 520;
/** 触屏的宽屏(平板)沿用以前的门槛:看板够宽才用抽屉,否则推入整页。 */
export const TOUCH_DRAWER_MIN_BOARD = 860;

/** 宽度夹在 [MIN, 看板 × RATIO] 里;看板比 MIN 还窄时就是看板宽。 */
export function clampDrawerWidth(width: number, boardWidth: number): number {
  const max = Math.max(DRAWER_MIN_WIDTH, Math.floor(boardWidth * DRAWER_MAX_RATIO));
  const w = Number.isFinite(width) ? width : DRAWER_DEFAULT_WIDTH;
  const clamped = Math.min(max, Math.max(DRAWER_MIN_WIDTH, Math.round(w)));
  return boardWidth > 0 ? Math.min(clamped, boardWidth) : clamped;
}

/** 拖左沿:往左拖(dx < 0)= 变宽。 */
export function dragDrawerWidth(startWidth: number, dx: number, boardWidth: number): number {
  return clampDrawerWidth(startWidth - dx, boardWidth);
}

/**
 * 详情怎么出现。桌面(有指针):一律右侧抽屉 —— 以前看板窄于 860 时会变成盖满整个窗口的「推入页」,
 * 在 Windows 上看起来就是另一个窗口。触屏:宽屏(平板)抽屉,手机推入整页。
 */
export function detailMode(opts: { pointer: boolean; boardWidth: number }): 'drawer' | 'page' {
  if (opts.pointer) return 'drawer';
  return opts.boardWidth >= TOUCH_DRAWER_MIN_BOARD ? 'drawer' : 'page';
}

export const drawerColumns = (width: number): 1 | 2 => (width >= DRAWER_TWO_COLUMN_MIN ? 2 : 1);

// ── 宽度记在本机(每台设备一份,和「更多」展开一样不分账号) ─────────────────────────────────────
export const DRAWER_WIDTH_KEY = 'task_drawer_width_v1';
export function parseDrawerWidth(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) && n >= DRAWER_MIN_WIDTH && n <= 4000 ? Math.round(n) : null;
}
export function loadDrawerWidth(): number {
  try { return parseDrawerWidth((globalThis as any).localStorage?.getItem(DRAWER_WIDTH_KEY)) ?? DRAWER_DEFAULT_WIDTH; } catch { return DRAWER_DEFAULT_WIDTH; }
}
export function saveDrawerWidth(width: number): void {
  try { (globalThis as any).localStorage?.setItem(DRAWER_WIDTH_KEY, String(Math.round(width))); } catch { /* 只活这一次 */ }
}

// ── 标题 / 描述:失焦保存,Esc 取消 ──────────────────────────────────────────────────────────
export type TextField = 'name' | 'description';

/** 失焦时要发的补丁:只带这一个字段,且只在真的改了时。 */
export function blurPatch(item: Requirement, draft: EditDraft, field: TextField): EditPatch | null {
  const all = editPatch(item, draft);
  if (!all || all[field] === undefined) return null;
  return { [field]: all[field] } as EditPatch;
}

/** Esc:这个字段退回卡上的值(别的字段不动)。 */
export function escapeDraft(item: Requirement, draft: EditDraft, field: TextField): EditDraft {
  return { ...draft, [field]: editDraftOf(item)[field] };
}

// ── 属性自动保存:每个属性只发它自己的字段 ─────────────────────────────────────────────────────
export type PropertyChange =
  | { field: 'project'; projectId: string | null }
  | { field: 'due'; due: string }
  | { field: 'priority'; priority: EditDraft['priority'] };
export function propertyPatch(item: Requirement, draft: EditDraft, change: PropertyChange): EditPatch | null {
  const next: EditDraft = change.field === 'project' ? { ...draft, projectId: change.projectId }
    : change.field === 'due' ? { ...draft, due: change.due }
    : { ...draft, priority: change.priority };
  const all = editPatch(item, next);
  if (!all) return null;
  const key = change.field === 'project' ? 'project_id' : change.field;
  return (all as Record<string, unknown>)[key] === undefined ? null : ({ [key]: (all as Record<string, unknown>)[key] } as EditPatch);
}

/** 「已保存」小提示停留时长。 */
export const SAVED_TOAST_MS = 1600;

// ── 链接 / 从 id 打开 ───────────────────────────────────────────────────────────────────────
/**
 * 「复制链接」的内容:anet://task/<网络>/<任务 id>。#700(深链)会注册这个 scheme 并用 openTaskDrawer 打开;
 * 在那之前它只是一个能贴进聊天、带着完整 id 的文本。
 */
export function taskLink(task: Pick<Requirement, 'id'>, networkId?: string | null): string {
  const net = networkId?.trim() ? encodeURIComponent(networkId.trim()) : '_';
  return `anet://task/${net}/${encodeURIComponent(task.id)}`;
}
export function parseTaskLink(link: string): { networkId: string | null; taskId: string } | null {
  const m = /^anet:\/\/task\/([^/?#]+)\/([^/?#]+)$/.exec(link.trim());
  if (!m) return null;
  const net = decodeURIComponent(m[1]);
  return { networkId: net === '_' ? null : net, taskId: decodeURIComponent(m[2]) };
}

/** 从任何地方按任务 id 打开抽屉(任务页开着就马上开;没开就在任务页挂载时开)。 */
export function openTaskDrawer(taskId: string, networkId?: string | null): void {
  requestOpenTask({ requirementId: taskId, networkId: networkId ?? null });
}

// ── 主题 ───────────────────────────────────────────────────────────────────────────────────
/** 抽屉用的颜色:全部取自主题(跟着浅色 / 深色走),没有写死的色值。 */
export function drawerTokens() {
  const dark = themeMode() === 'dark';
  return {
    bg: dark ? colors.card : colors.bg,
    surface: dark ? colors.bg : colors.subtleFill,
    border: colors.border,
    text: colors.text,
    muted: colors.textMuted,
    accent: colors.accent,
    pillBg: colors.subtleFill,
    toastBg: colors.text,
    toastText: colors.bg,
    handleActive: colors.accent,
  };
}
