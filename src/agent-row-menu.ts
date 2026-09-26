/**
 * 会话行的长按 / 右键菜单(Vincent 2026-09-26,微信截图为准:
 * 「节点长按的时候，要跟微信一样，弹出一个可选的东西，可以置顶或者做其他的事情」)。
 *
 * 纯逻辑,不 import react-native / expo(ck 测试直接跑):
 *   - 菜单有哪些项、每项在什么状态下叫什么          agentRowMenuItems
 *   - 菜单落在手指/光标的哪一侧、怎么夹在屏幕里      anchorRowMenu
 *   - 「不显示该对话」「标为未读」两份本机状态的读写  ConversationFlags + 各 reducer
 *
 * 没有「删除」:agent 是节点,删节点在 节点详情 → 危险操作 里,不放在一个手滑就点到的菜单里。
 */

export type AgentRowMenuKey = 'read' | 'pin' | 'mute' | 'openWindow' | 'detail' | 'hide';

export interface AgentRowMenuItem {
  /** 稳定键:渲染、testID、测试都按它取,不按文案。 */
  readonly key: AgentRowMenuKey;
  readonly label: string;
}

export interface AgentRowMenuState {
  /** 角标上有数(hub / 本地 ledger / 回复水位线 任一),或被手动「标为未读」。 */
  readonly unread: boolean;
  readonly pinned: boolean;
  readonly muted: boolean;
  /** 这一行现在在「已隐藏的对话」里。 */
  readonly hidden: boolean;
  /** 调用方能不能置顶 / 免打扰 / 开新窗口(桌面端才有独立聊天窗口)。 */
  readonly canPin: boolean;
  readonly canMute: boolean;
  readonly canOpenWindow: boolean;
}

/**
 * 顺序固定:已读/未读 → 置顶 → 免打扰 → (桌面)新窗口 → 节点详情 → 不显示/恢复显示。
 * 高频在上,「让它从列表消失」放最后 —— 和微信一样,不显示是最后一项。
 */
export function agentRowMenuItems(s: AgentRowMenuState): AgentRowMenuItem[] {
  const items: AgentRowMenuItem[] = [{ key: 'read', label: s.unread ? '标为已读' : '标为未读' }];
  if (s.canPin) items.push({ key: 'pin', label: s.pinned ? '取消置顶' : '置顶' });
  if (s.canMute) items.push({ key: 'mute', label: s.muted ? '开启提醒' : '消息免打扰' });
  if (s.canOpenWindow) items.push({ key: 'openWindow', label: '在新窗口打开' });
  items.push({ key: 'detail', label: '节点详情' });
  items.push({ key: 'hide', label: s.hidden ? '恢复显示' : '不显示该对话' });
  return items;
}

// ── 尺寸 ────────────────────────────────────────────────────────────────────
// 每项固定高度 + 固定上下内边距 ⇒ 菜单高度只由项数决定,定位时不用先渲染再量。

export interface RowMenuMetrics {
  width: number;
  itemHeight: number;
  padY: number;
  padX: number;
  fontSize: number;
  radius: number;
}

/**
 * touch = 手机 / 安卓双栏:44 dp 行高(最小触控,界面密度调小也不低于 44),15 号字;桌面右键:34 高 13 号字(同原右键菜单)。
 * `scale` = ui-scale 的 ds 系数,`font` = fs 系数。宽度按最长文案(6 个汉字)+ 两侧内边距算,
 * 字号放大时菜单跟着变宽,不会截字。
 */
export function rowMenuMetrics(touch: boolean, scale = 1, font = 1): RowMenuMetrics {
  const fontSize = Math.round((touch ? 15 : 13) * font);
  const padX = Math.round((touch ? 16 : 14) * scale);
  // 触屏行高不随「更紧凑」缩到 44 以下(安卓双栏默认 0.75 → 33,手指点不准);桌面鼠标可以跟着缩。
  const itemHeight = touch ? Math.max(44, Math.round(44 * scale)) : Math.round(34 * scale);
  const padY = Math.round(6 * scale);
  const width = Math.max(touch ? Math.max(140, Math.round(156 * scale)) : Math.round(150 * scale), fontSize * 6 + padX * 2 + 8);
  return { width, itemHeight, padY, padX, fontSize, radius: touch ? 8 : 10 };
}

export const rowMenuHeight = (m: RowMenuMetrics, count: number): number => m.padY * 2 + m.itemHeight * count;

// ── 定位 ────────────────────────────────────────────────────────────────────

export interface AnchorInput {
  /** 按下点(与菜单容器同一坐标系:Modal 铺满窗口时 = pageX/pageY)。 */
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** 离屏幕边的最小距离。 */
  margin?: number;
  /** 手指和菜单之间的空隙(手指别盖住第一项)。 */
  gap?: number;
  /** 状态栏 / 手势条等安全区。 */
  insets?: { top?: number; bottom?: number; left?: number; right?: number };
}

export interface AnchorResult {
  left: number;
  top: number;
  /** 菜单在按下点的下方还是上方。 */
  vertical: 'below' | 'above';
  /** 菜单往按下点的右边展开还是左边。 */
  horizontal: 'right' | 'left';
}

/**
 * 微信的形状:菜单的一个角贴着按下点。默认往右下展开;右边放不下 → 往左;下边放不下 → 往上(翻到手指上方)。
 * 翻了之后仍放不下(屏幕比菜单还小)就夹进安全区,保证整块菜单都在屏幕里 —— 夹紧优先于「贴着手指」。
 */
export function anchorRowMenu(a: AnchorInput): AnchorResult {
  const margin = a.margin ?? 8;
  const gap = a.gap ?? 4;
  const minX = margin + (a.insets?.left ?? 0);
  const maxX = a.viewportWidth - margin - (a.insets?.right ?? 0) - a.menuWidth;
  const minY = margin + (a.insets?.top ?? 0);
  const maxY = a.viewportHeight - margin - (a.insets?.bottom ?? 0) - a.menuHeight;

  let horizontal: AnchorResult['horizontal'] = 'right';
  let left = a.x;
  if (left > maxX) { horizontal = 'left'; left = a.x - a.menuWidth; }
  let vertical: AnchorResult['vertical'] = 'below';
  let top = a.y + gap;
  if (top > maxY) { vertical = 'above'; top = a.y - gap - a.menuHeight; }

  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));
  return { left: Math.round(clamp(left, minX, maxX)), top: Math.round(clamp(top, minY, maxY)), vertical, horizontal };
}

// ── 本机状态:隐藏 / 手动未读 ───────────────────────────────────────────────

/**
 * 每台设备、每个账号一份(不上 hub —— 这是「我这台手机不想看到它」,不是节点的属性)。
 *   hidden:       alias → 隐藏时该会话最后一条消息的时间(ms,可能为 0 = 当时没有消息)。
 *                 之后来了**更新的**消息(latestAt > 记录值)就自动回到列表 —— 微信「不显示」的语义。
 *   manualUnread: 手动「标为未读」的 alias;打开该会话即清。
 */
export interface ConversationFlags {
  hidden: Record<string, number>;
  manualUnread: string[];
}

export const emptyConversationFlags = (): ConversationFlags => ({ hidden: {}, manualUnread: [] });

/** 读盘:任何坏数据都退回空,不让一份写坏的文件把列表弄没。 */
export function parseConversationFlags(raw: unknown): ConversationFlags {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return emptyConversationFlags(); }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyConversationFlags();
  const out = emptyConversationFlags();
  const hidden = (v as { hidden?: unknown }).hidden;
  if (hidden && typeof hidden === 'object' && !Array.isArray(hidden)) {
    for (const [alias, at] of Object.entries(hidden as Record<string, unknown>)) {
      if (alias && typeof at === 'number' && Number.isFinite(at) && at >= 0) out.hidden[alias] = at;
    }
  }
  const manual = (v as { manualUnread?: unknown }).manualUnread;
  if (Array.isArray(manual)) out.manualUnread = [...new Set(manual.filter((a): a is string => typeof a === 'string' && !!a))];
  return out;
}

export const serializeConversationFlags = (f: ConversationFlags): string => JSON.stringify(f);

export function hideConversation(f: ConversationFlags, alias: string, latestAt: number): ConversationFlags {
  if (!alias) return f;
  // 隐藏一个手动未读的会话:未读标记一起去掉(隐藏 = 我不想再被它提醒)。
  return { hidden: { ...f.hidden, [alias]: Math.max(0, Number.isFinite(latestAt) ? latestAt : 0) }, manualUnread: f.manualUnread.filter(a => a !== alias) };
}

export function restoreConversation(f: ConversationFlags, alias: string): ConversationFlags {
  if (!(alias in f.hidden)) return f;
  const { [alias]: _drop, ...rest } = f.hidden;
  return { ...f, hidden: rest };
}

/** 该行现在是否隐藏:有记录,且此后没有更新的消息。 */
export const isConversationHidden = (f: ConversationFlags, alias: string, latestAt: number): boolean =>
  alias in f.hidden && !(latestAt > f.hidden[alias]);

/**
 * 新消息到达后把「自动回来」的记录删掉(否则下次它又静下来时,旧记录的时间戳早于新消息 → 永远显示,
 * 行为上对,但记录会无限增长)。没有变化时返回同一个对象,调用方据此跳过写盘。
 */
export function pruneRevivedHidden(f: ConversationFlags, latestAtByAlias: Readonly<Record<string, number>>): ConversationFlags {
  let changed = false;
  const hidden: Record<string, number> = {};
  for (const [alias, at] of Object.entries(f.hidden)) {
    if ((latestAtByAlias[alias] ?? 0) > at) { changed = true; continue; }
    hidden[alias] = at;
  }
  return changed ? { ...f, hidden } : f;
}

/**
 * 列表分两份:visible 进分组列表,hidden 进底部「已隐藏的对话」。
 * 搜索时不分 —— 用户明确在找它,隐藏的也要能搜到(微信同样)。
 */
export function partitionHidden<T extends { alias: string }>(
  sessions: readonly T[],
  f: ConversationFlags,
  latestAt: (alias: string) => number,
  searching: boolean,
): { visible: T[]; hidden: T[] } {
  if (searching) return { visible: [...sessions], hidden: [] };
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const s of sessions) (isConversationHidden(f, s.alias, latestAt(s.alias)) ? hidden : visible).push(s);
  return { visible, hidden };
}

export function markManualUnread(f: ConversationFlags, alias: string): ConversationFlags {
  if (!alias || f.manualUnread.includes(alias)) return f;
  return { ...f, manualUnread: [...f.manualUnread, alias] };
}

export function clearManualUnread(f: ConversationFlags, alias: string): ConversationFlags {
  if (!f.manualUnread.includes(alias)) return f;
  return { ...f, manualUnread: f.manualUnread.filter(a => a !== alias) };
}

/**
 * 行上的角标:真实未读优先(有数就显示数);没有真实未读但被手动标为未读 → 一个不带数字的红点。
 * 返回 null = 不画(与 formatUnreadBadge 的约定一致)。
 */
export function rowBadgeWithManual<B extends { text: string; a11yLabel: string }>(
  real: B | null,
  manualUnread: boolean,
): B | { text: ''; a11yLabel: string; dot: true } | null {
  if (real) return real;
  return manualUnread ? { text: '', a11yLabel: '标为未读', dot: true } : null;
}

/** 菜单里「已读 / 未读」那一项该显示哪一个:真实未读或手动未读,任一即算未读。 */
export const rowIsUnread = (realCount: number, manualUnread: boolean): boolean => realCount > 0 || manualUnread;

/** 空聊天区的提示文案(双栏右侧没有选中会话时)。 */
export const ROW_MENU_EMPTY_HINT = '长按列表里的 agent 可以置顶、免打扰、查看节点详情';
