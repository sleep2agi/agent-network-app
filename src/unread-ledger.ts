/**
 * #161 —— 跨 Agent 未读计数（ingest）。
 *
 * 远端现状（2026-08-31 核过 origin/main）：
 *   ✅ 写盘契约 conversation-unread-persist.ts（#203）
 *   ✅ 会话内「N 条新消息」药丸（ChatScreen 本地 state + jumpPillLabel）
 *   ❌ 跨 Agent 计数 —— 就是本文件
 *   ❌ Agent 列表徽标 UI —— 需要能真跑 GUI 的人来做，DOM 里有不等于用户看得见
 *
 * 这里只放**纯逻辑**：它可以在无 GUI 的环境里被严格验证，而徽标的视觉不能。
 *
 * 🔴 #161 的已读规则里最容易悄悄写错的是这一条：
 *    「仅选中列表行但消息尚未加载成功时**不能**误清零」。
 *    把「打开会话」当成「已读」是最自然的写法，也正是那条规则要防的 ——
 *    用户点了一下、没加载出来、未读就没了，而消息他一眼都没看到。
 *    所以 open 和 renderedToLatest 是**两个**事件，只有后者清零。
 */

export type AgentId = string;

export type UnreadEvent =
  | { kind: "message_arrived"; agent: AgentId }
  /** 用户选中了某个 Agent 的会话行。**不清零** —— 还没展示出来。 */
  | { kind: "conversation_opened"; agent: AgentId }
  /** 该会话已成功渲染到最新一条。**这一步才清零。** */
  | { kind: "rendered_to_latest"; agent: AgentId }
  | { kind: "conversation_left" }
  | { kind: "foreground_changed"; foreground: boolean };

export type UnreadState = {
  counts: Readonly<Record<AgentId, number>>;
  /** 当前打开的会话；null 表示没有 */
  open: AgentId | null;
  /** 当前打开的那个会话是否已渲染到最新 */
  renderedToLatest: boolean;
  foreground: boolean;
};

export const initialUnreadState = (): UnreadState => ({
  counts: {}, open: null, renderedToLatest: false, foreground: true,
});

/** 正在看、且窗口在前台、且已经渲染到最新 —— 三者同时成立才算「他确实看到了」。 */
function isBeingWatched(s: UnreadState, agent: AgentId): boolean {
  return s.open === agent && s.foreground && s.renderedToLatest;
}

export function reduceUnread(state: UnreadState, ev: UnreadEvent): UnreadState {
  switch (ev.kind) {
    case "message_arrived": {
      // 正在看的那条会话,新消息直接追加,不计未读。
      if (isBeingWatched(state, ev.agent)) return state;
      const n = (state.counts[ev.agent] ?? 0) + 1;
      return { ...state, counts: { ...state.counts, [ev.agent]: n } };
    }
    case "conversation_opened":
      // 🔴 这里**不清零**。清零只发生在 rendered_to_latest。
      return { ...state, open: ev.agent, renderedToLatest: false };
    case "rendered_to_latest": {
      if (state.open !== ev.agent) return state;   // 迟到的渲染回调,别清错人的
      const { [ev.agent]: _drop, ...rest } = state.counts;
      return { ...state, renderedToLatest: true, counts: rest };
    }
    case "conversation_left":
      // 切走之后,原会话的新消息重新开始累计 —— 靠把 open 置空实现。
      return { ...state, open: null, renderedToLatest: false };
    case "foreground_changed":
      return { ...state, foreground: ev.foreground };
  }
}

export const unreadOf = (s: UnreadState, agent: AgentId): number => s.counts[agent] ?? 0;
export const totalUnread = (s: UnreadState): number =>
  Object.values(s.counts).reduce((a, b) => a + b, 0);

export type UnreadBadge = { text: string; a11yLabel: string };

/**
 * 0 返回 null —— 调用方据此**完全隐藏**徽标，而不是留一个空红点（#161 UI 规则）。
 * 1–99 显示准确数字；>99 显示 `99+`。色彩不能是唯一提示，所以同时给可访问性文本。
 */
export function formatUnreadBadge(count: number): UnreadBadge | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return { text: n > 99 ? "99+" : String(n), a11yLabel: `${n} 条未读消息` };
}
