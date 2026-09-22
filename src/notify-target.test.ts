// 0.2.81:通知点击 → 跳会话。插件在桌面端不回发点击事件,所以判据是「通知后不久窗口拿到焦点」。
// 0.2.83:去掉「通知时窗口必须没焦点」那条前置——它把用户最想要的情形(正看着 A,点 B 的
// toast)排除掉了。本文件第一组就是 Vincent 那个场景,改前在旧模块上跑必须是红的。
import { FOCUS_ROUTE_WINDOW_MS, initialNotifyTarget, recordNotified, targetOnFocus } from './notify-target';
import { readFileSync } from 'fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf-8').replace(/\r\n?/g, '\n');

const T0 = 1_000_000;

// —— Vincent 2026-09-20 的场景:窗口正开着 A 的会话(有焦点),B 来通知,点 toast → 激活 → 必须跳到 B ——
{
  const s = recordNotified(initialNotifyTarget(), 'B', T0);
  const r = targetOnFocus(s, T0 + 5_000, 'A');
  ck('正看着 A 时 B 的通知也要记(不看当刻焦点)', s.agent === 'B');
  ck('激活时正开着 A → 跳到 B', r.agent === 'B');
  ck('跳过一次就清掉(一次性)', r.next.agent === null);
  ck('清掉之后再激活不会再跳', targetOnFocus(r.next, T0 + 6_000, 'B').agent === null);
}

// —— 该跳 / 不该跳 ——
{
  const s = recordNotified(initialNotifyTarget(), '通信龙', T0);
  ck('没开会话时激活 → 跳', targetOnFocus(s, T0 + 3_000, null).agent === '通信龙');
  ck('已经在看目标会话 → 不跳', targetOnFocus(s, T0 + 3_000, '通信龙').agent === null);
  ck('已在看目标时状态也清掉(不会等人切走再拽回去)', targetOnFocus(s, T0 + 3_000, '通信龙').next.agent === null);
}
{
  const s = recordNotified(initialNotifyTarget(), '通信龙', T0);
  ck('窗口期 = 60 s', FOCUS_ROUTE_WINDOW_MS === 60_000);
  ck('超出窗口期 → 不跳', targetOnFocus(s, T0 + FOCUS_ROUTE_WINDOW_MS + 1, null).agent === null);
  ck('超期后状态被清掉', targetOnFocus(s, T0 + FOCUS_ROUTE_WINDOW_MS + 1, null).next.agent === null);
  ck('窗口期最后一毫秒仍跳', targetOnFocus(s, T0 + FOCUS_ROUTE_WINDOW_MS, null).agent === '通信龙');
}
{
  ck('空状态激活 → 不跳', targetOnFocus(initialNotifyTarget(), T0, null).agent === null);
  ck('空 alias 不记', recordNotified(initialNotifyTarget(), '  ', T0).agent === null);
}

// —— 多个 agent:跳最近的(0.2.81 是不猜不跳;理由见 notify-target.ts 文件头) ——
{
  let s = recordNotified(initialNotifyTarget(), '甲', T0);
  s = recordNotified(s, '乙', T0 + 500);
  ck('先甲后乙 → 跳乙(最近的)', targetOnFocus(s, T0 + 1_000, null).agent === '乙');
  s = recordNotified(s, '甲', T0 + 900);
  ck('再来一条甲 → 目标换回甲', targetOnFocus(s, T0 + 1_000, null).agent === '甲');
}
{
  let s = recordNotified(initialNotifyTarget(), '通信龙', T0);
  s = recordNotified(s, '通信龙', T0 + 800);
  ck('同一 agent 连发两条 → 仍然跳它,时刻按最新算', targetOnFocus(s, T0 + 800 + FOCUS_ROUTE_WINDOW_MS, null).agent === '通信龙');
}

// —— 契约:接线真的在 ——
const notifier = norm('./DesktopNotifier.tsx');
ck('通知发出时登记目标(不再传焦点状态)', notifier.includes('recordNotified(target.current, group.agent, Date.now())'));
ck('激活时查目标并带上正开着的会话', notifier.includes("targetOnFocus(target.current, Date.now(), getUnreadSnapshot().ledger.open)"));
ck('focus 与 visibilitychange 两条激活信号都接了', notifier.includes("window.addEventListener('focus', onActivate)") && notifier.includes("document.addEventListener('visibilitychange', onVisible)"));
ck('拿到目标就调 onOpenChat', notifier.includes('openChat.current?.(picked.agent)'));
const app = norm('../App.tsx');
ck('App 把 DesktopNotifier 接到和托盘同一条打开会话的路', app.includes("<DesktopNotifier onOpenChat={alias => setScreen({ name: 'chat', alias })} />"));
// 🔴 插件桌面端不回发点击:不许有假装能收点击的接线
ck('没有挂 onAction(桌面端永远不触发,挂了就是假修)', !notifier.includes('onAction'));
// 🔴 0.2.81 那条把用户最想要的情形排除掉的前置,不许再回来
ck('登记不再以「当刻窗口没焦点」为条件', !notifier.includes('presence.windowFocused)'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
