// 0.2.81(Vincent 2026-09-20:「这个消息通知 要能点击跳到具体的对话啊」)。
//
// 🔴 先说清楚这层为什么长这样,别人读到这里不用再去翻插件源码:
//    `@tauri-apps/plugin-notification` 的 `onAction()` **在桌面端不会触发**。
//    插件 2.4.0 的 `src/desktop.rs::show()` 只把 title/body/icon/sound 交给 notify-rust
//    然后 `show()`,既不保留 handle、也不回发任何事件;`extra` / `actionTypeId` 在桌面端
//    被直接丢弃(它们只在 mobile.rs 里有对应实现)。⇒ 挂 `onAction` 会写出一个**永远不响的
//    回调**,那比没有更糟——看起来修好了。
//
// 所以这里做能做的那件:**记住通知指向谁,窗口随后被带到前台时跳过去**。
// Windows 的 toast 归属于应用的 AUMID,点它会激活应用 ⇒ 「通知后不久窗口拿到焦点」是
// 我们真正观测得到的信号。
//
// 🔴 宁可不跳,也不要跳错(用户只是自己切回来,却被甩进某个会话,比不跳烦人得多):
//    · 只有**唯一一个** agent 在等 → 多个 agent 同时来消息时不猜,交给未读角标;
//    · 只在通知后 FOCUS_ROUTE_WINDOW_MS 内 → 过期的不跳;
//    · 通知发出那一刻**窗口本来就没焦点**才算数 → 用户当时就在用应用的话,焦点变化跟通知无关;
//    · 一次性 → 跳过一次就清掉,不会反复把人拽回去。
//
// 纯逻辑,不 import react-native。

export const FOCUS_ROUTE_WINDOW_MS = 20_000;

export type NotifyTargetState = {
  /** 待跳转的 agent;多个不同 agent 同时在等时为 null(不猜)。 */
  readonly agent: string | null;
  /** 最近一次通知的时刻。 */
  readonly at: number;
  /** 是否已经有过「多个不同 agent」的情况(有过就一直不跳,直到被清)。 */
  readonly ambiguous: boolean;
};

export const initialNotifyTarget = (): NotifyTargetState => ({ agent: null, at: 0, ambiguous: false });

/**
 * 记一条「刚给这个 agent 发过通知」。
 *
 * windowFocused = 通知发出那一刻窗口有没有焦点。有焦点的不记——用户当时就在应用里,
 * 之后的焦点变化不能归因给这条通知。
 */
export function recordNotified(
  state: NotifyTargetState,
  agent: string,
  atMs: number,
  windowFocused: boolean,
): NotifyTargetState {
  const alias = (agent || '').trim();
  if (!alias || windowFocused) return state;
  const stale = state.at > 0 && atMs - state.at > FOCUS_ROUTE_WINDOW_MS;
  if (stale || state.agent === null) {
    return { agent: alias, at: atMs, ambiguous: false };
  }
  if (state.agent === alias) return { agent: alias, at: atMs, ambiguous: state.ambiguous };
  // 窗口期内来了第二个 agent:不猜。
  return { agent: null, at: atMs, ambiguous: true };
}

/**
 * 窗口刚拿到焦点 → 该跳到哪个会话(null = 不跳)。
 *
 * 返回 `{ agent, next }`:调用方拿 agent 去跳,拿 next 当新状态(一次性,跳完就清)。
 */
export function targetOnFocus(
  state: NotifyTargetState,
  atMs: number,
): { agent: string | null; next: NotifyTargetState } {
  if (!state.agent || state.ambiguous) return { agent: null, next: state };
  if (atMs - state.at > FOCUS_ROUTE_WINDOW_MS) return { agent: null, next: initialNotifyTarget() };
  return { agent: state.agent, next: initialNotifyTarget() };
}
