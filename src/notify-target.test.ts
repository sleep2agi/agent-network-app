// 0.2.81:通知点击 → 跳会话。插件在桌面端不回发点击事件,所以判据是「通知后不久窗口拿到焦点」。
// 🔴 这组测试的重点不是「能跳」,是「**不该跳的时候不跳**」——跳错比不跳烦人得多。
import { FOCUS_ROUTE_WINDOW_MS, initialNotifyTarget, recordNotified, targetOnFocus } from './notify-target';
import { readFileSync } from 'fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf-8').replace(/\r\n?/g, '\n');

const T0 = 1_000_000;

// —— 该跳的那一种 ——
{
  const s = recordNotified(initialNotifyTarget(), '通信龙', T0, false);
  const r = targetOnFocus(s, T0 + 3_000);
  ck('唯一 agent + 窗口期内 → 跳它', r.agent === '通信龙');
  ck('跳过一次就清掉(一次性)', r.next.agent === null);
  ck('清掉之后再拿焦点不会再跳', targetOnFocus(r.next, T0 + 4_000).agent === null);
}

// —— 不该跳的那些 ——
{
  const s = recordNotified(initialNotifyTarget(), '通信龙', T0, true);
  ck('通知时窗口本来就有焦点 → 不记,也就不跳', targetOnFocus(s, T0 + 1_000).agent === null);
}
{
  let s = recordNotified(initialNotifyTarget(), '甲', T0, false);
  s = recordNotified(s, '乙', T0 + 500, false);
  ck('窗口期内两个不同 agent → 不猜,不跳', targetOnFocus(s, T0 + 1_000).agent === null);
  ck('歧义状态被显式记下来', s.ambiguous === true && s.agent === null);
}
{
  const s = recordNotified(initialNotifyTarget(), '通信龙', T0, false);
  ck('超出窗口期 → 不跳', targetOnFocus(s, T0 + FOCUS_ROUTE_WINDOW_MS + 1).agent === null);
  ck('超期后状态被清掉,不会一直挂着', targetOnFocus(s, T0 + FOCUS_ROUTE_WINDOW_MS + 1).next.agent === null);
}
{
  ck('空状态拿焦点 → 不跳', targetOnFocus(initialNotifyTarget(), T0).agent === null);
  ck('空 alias 不记', recordNotified(initialNotifyTarget(), '  ', T0, false).agent === null);
}

// —— 边界:同一个 agent 连来两条不算歧义 ——
{
  let s = recordNotified(initialNotifyTarget(), '通信龙', T0, false);
  s = recordNotified(s, '通信龙', T0 + 800, false);
  ck('同一 agent 连发两条 → 仍然跳它', targetOnFocus(s, T0 + 1_500).agent === '通信龙');
}
// —— 边界:旧的歧义过期后,新的一条能重新生效 ——
{
  let s = recordNotified(initialNotifyTarget(), '甲', T0, false);
  s = recordNotified(s, '乙', T0 + 500, false);
  s = recordNotified(s, '丙', T0 + FOCUS_ROUTE_WINDOW_MS + 2_000, false);
  ck('歧义过期后新通知重新可跳', targetOnFocus(s, T0 + FOCUS_ROUTE_WINDOW_MS + 3_000).agent === '丙');
}

// —— 契约:接线真的在 ——
const notifier = norm('./DesktopNotifier.tsx');
ck('通知发出时登记目标(带当刻焦点状态)', notifier.includes('recordNotified(target.current, group.agent, Date.now(), presence.windowFocused)'));
ck('窗口拿到焦点时查目标', notifier.includes('targetOnFocus(target.current, Date.now())'));
ck('拿到目标就调 onOpenChat', notifier.includes('openChat.current?.(picked.agent)'));
const app = norm('../App.tsx');
ck('App 把 DesktopNotifier 接到和托盘同一条打开会话的路', app.includes("<DesktopNotifier onOpenChat={alias => setScreen({ name: 'chat', alias })} />"));
// 🔴 插件桌面端不回发点击:不许有假装能收点击的接线
ck('没有挂 onAction(桌面端永远不触发,挂了就是假修)', !notifier.includes('onAction'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
