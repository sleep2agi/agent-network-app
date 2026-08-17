// 纯逻辑单测(bun/node 可跑)。run: bun src/messages-view-state.test.ts
// Messages 三态空态选择器(App战线① PR2)。核心=三态不许合成一种(通信龙 补充要求2)。
import { messagesViewState } from './messages-view-state';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// ── 🔴 说谎陷阱:失败+无数据 绝不能渲染成「暂无消息」──────────────────────────────
ck('🔴 加载失败+无数据 → failed(不是 empty——连不上≠没有消息)', messagesViewState(true, 0, true) === 'failed');
ck('🔴 加载成功+无数据 → empty(这时才允许说「暂无消息」)', messagesViewState(true, 0, false) === 'empty');
ck('两者互斥:同输入不可能同时是 failed 和 empty', messagesViewState(true, 0, true) !== messagesViewState(true, 0, false));

// ── 首载优先:没结果前什么都不声称 ─────────────────────────────────────────────
ck('未加载完 → loading(即使曾失败)', messagesViewState(false, 0, true) === 'loading');
ck('未加载完 → loading(即使已有旧数据)', messagesViewState(false, 5, false) === 'loading');

// ── 有数据就展示;陈旧性归全局横幅(PR1),本页不造第二份失败 UI ─────────────────
ck('有数据+最近刷新失败 → list(不清空不遮挡·横幅声明陈旧)', messagesViewState(true, 7, true) === 'list');
ck('有数据+正常 → list', messagesViewState(true, 7, false) === 'list');

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
