// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/connectivity.test.ts
// 全局连接横幅数据源(App战线①)。核心断言=通信龙补充要求1:时间戳诚实到「最后一次成功」。
import {
  __resetConnectivityForTest,
  bannerText,
  connectivityState,
  connectivityVersion,
  reportReadFailure,
  reportReadSuccess,
} from './connectivity';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const R = __resetConnectivityForTest;
// 固定时刻(本地时区无关的断言用 HH:MM 从同一 Date 推)
const T1 = new Date(2026, 7, 13, 10, 5).getTime();   // 10:05 成功
const T2 = T1 + 60_000;                               // 10:06 失败
const T3 = T1 + 120_000;                              // 10:07 失败

// ── 🔴 核心:时间戳=最后一次成功,不是最后一次尝试 ──────────────────────────────
R();
reportReadSuccess(T1);
reportReadFailure(T2);
reportReadFailure(T3); // 两次失败(=两次"尝试")之后
ck('🔴 成功后连续失败:lastSuccessAt 纹丝不动=T1(不被尝试时刻污染)', connectivityState().lastSuccessAt === T1);
ck('🔴 横幅文案显示的是成功时刻 10:05(非 10:06/10:07)', (bannerText(connectivityState()) || '').includes('10:05'));
ck('此时 offline=true(最近一次结局是失败)', connectivityState().offline === true);

// ── 三态文案 ──────────────────────────────────────────────────────────────────
R();
ck('在线(从未失败)→ 无横幅(null)', bannerText(connectivityState()) === null);
R(); reportReadSuccess(T1);
ck('在线(最近一次成功)→ 无横幅', bannerText(connectivityState()) === null);
R(); reportReadFailure(T2);
ck('从未成功过+失败 → 「尚未获取到数据」变体(不编造时间)', (bannerText(connectivityState()) || '').includes('尚未获取到数据'));

// ── 恢复:失败后一次成功即回在线 ──────────────────────────────────────────────
R();
reportReadFailure(T1); reportReadSuccess(T2);
ck('失败→成功:offline=false·横幅消失', connectivityState().offline === false && bannerText(connectivityState()) === null);
ck('恢复后 lastSuccessAt 前进到 T2', connectivityState().lastSuccessAt === T2);

// ── emit 纪律:只在翻转时通知(在线时每次轮询成功不白刷 UI) ─────────────────────
R();
const v0 = connectivityVersion();
reportReadSuccess(T1); reportReadSuccess(T2);
ck('在线态连续成功:version 不动(不触发重渲染)', connectivityVersion() === v0);
reportReadFailure(T3);
ck('翻转为 offline:version +1', connectivityVersion() === v0 + 1);
reportReadFailure(T3 + 1);
ck('已 offline 再失败:version 不动(横幅内容也没变)', connectivityVersion() === v0 + 1);
reportReadSuccess(T3 + 2);
ck('翻回在线:version 再 +1', connectivityVersion() === v0 + 2);

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
