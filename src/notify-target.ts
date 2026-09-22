// 0.2.81(Vincent 2026-09-20:「这个消息通知 要能点击跳到具体的对话啊」)
// 0.2.83(Vincent 2026-09-20:「消息点击通知 还是不通跳转到对于的聊天界面」)—— 见下面「为什么 0.2.81 没生效」。
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
// 🔴 为什么 0.2.81 没生效(Vincent 截图那种情形):它有一条前置——「通知发出那一刻窗口
//    **没有**焦点才记」。可是真实场景恰恰相反:人正开着应用看 A 的会话,B 来了消息,
//    toast 弹出(policy 只在「正看着 B」时才不弹),人点 toast 想跳到 B——**这一刻窗口是有
//    焦点的**,于是那条通知根本没被记下来,随后的激活自然什么都不跳。那条前置把用户最想
//    要的那种情形排除掉了。0.2.83 去掉它:**通知一律记**;能不能跳,只看激活时的状态。
//
// 剩下的护栏(改了取舍,理由写在旁边):
//    · 已经在看目标会话 → 不跳(跳了等于原地刷新,还会打断输入);
//    · 只在通知后 FOCUS_ROUTE_WINDOW_MS 内 → 过期的不跳。0.2.81 是 20 s;人看到 toast 常常
//      先把手上一句话打完再点,Windows 的 toast 收进通知中心后还能点 ⇒ 放宽到 60 s;
//    · 多个 agent 先后来通知 → **跳最近一个**。0.2.81 是「不猜、不跳」;但焦点推断本来就
//      分不出点的是哪张 toast,而 300 个 agent 的机群里两人同时说话是常态——「不跳」让
//      这功能在最常见的情形下等于没有。跳错的代价是点一下回去;从不跳的代价是功能失效。
//    · 一次性 → 跳过一次就清掉,不会反复把人拽回去。
//
// 纯逻辑,不 import react-native。

export const FOCUS_ROUTE_WINDOW_MS = 60_000;

export type NotifyTargetState = {
  /** 最近一条通知指向的 agent;null = 没有待跳的。 */
  readonly agent: string | null;
  /** 最近一次通知的时刻。 */
  readonly at: number;
};

export const initialNotifyTarget = (): NotifyTargetState => ({ agent: null, at: 0 });

/**
 * 记一条「刚给这个 agent 发过通知」。一律记,不看当刻焦点(见文件头「为什么 0.2.81 没生效」)。
 * 后来的覆盖先来的:多个 agent 先后通知时,最近那个是目标。
 */
export function recordNotified(state: NotifyTargetState, agent: string, atMs: number): NotifyTargetState {
  const alias = (agent || '').trim();
  if (!alias) return state;
  return { agent: alias, at: atMs };
}

/**
 * 窗口刚被激活(拿到焦点 / 变为可见)→ 该跳到哪个会话(null = 不跳)。
 *
 * openConversation = 此刻正开着的会话(null/undefined = 没开会话)。目标就是它 → 不跳。
 * 返回 `{ agent, next }`:调用方拿 agent 去跳,拿 next 当新状态(一次性,跳完就清)。
 */
export function targetOnFocus(
  state: NotifyTargetState,
  atMs: number,
  openConversation?: string | null,
): { agent: string | null; next: NotifyTargetState } {
  if (!state.agent) return { agent: null, next: state };
  if (atMs - state.at > FOCUS_ROUTE_WINDOW_MS) return { agent: null, next: initialNotifyTarget() };
  if (openConversation && openConversation === state.agent) return { agent: null, next: initialNotifyTarget() };
  return { agent: state.agent, next: initialNotifyTarget() };
}
