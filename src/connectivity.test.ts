// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/connectivity.test.ts
// 全局连接横幅数据源(App战线①)。核心断言=通信龙补充要求1:时间戳诚实到「最后一次成功」。
import {
  __resetConnectivityForTest,
  bannerText,
  connectivityState,
  connectivityVersion,
  FAILURE_ROUND_MS,
  MAX_BACKOFF_MS,
  OFFLINE_AFTER_MS,
  pollBackoffMs,
  readStatusCountsAsFailure,
  reportReadFailure,
  reportReadSuccess,
  SLOW_READ_MS,
  subscribeReconnect,
} from './connectivity';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };
const R = __resetConnectivityForTest;
const S = connectivityState;
const text = () => bannerText(S(), T1 + 3_600_000) || '';
// 固定时刻(本地时区无关的断言用 HH:MM 从同一 Date 推)
const T1 = new Date(2026, 7, 13, 10, 5).getTime();   // 10:05 成功
const T2 = T1 + 60_000;                               // 10:06 失败
const T3 = T1 + 120_000;                              // 10:07 失败
const T4 = T1 + 180_000;                              // 10:08 失败
/** 有缓存后,失败 3 轮、跨 2 分钟 —— 无论怎么调阈值都该是 offline 的一段真断连。 */
const outage = () => { reportReadSuccess(T1); reportReadFailure(T2); reportReadFailure(T3); reportReadFailure(T4); };

// ── 🔴 核心:时间戳=最后一次成功,不是最后一次尝试 ──────────────────────────────
R();
outage();
ck('🔴 成功后连续失败:lastSuccessAt 纹丝不动=T1(不被尝试时刻污染)', S().lastSuccessAt === T1);
ck('🔴 横幅文案显示的是成功时刻 10:05(非 10:06/10:07/10:08)', text().includes('10:05'));
ck('此时 offline=true', S().offline === true && S().level === 'offline');
ck('跨天:截至时刻带上日期(不让「截至 10:05」被读成今天)', (bannerText(S(), T1 + 86_400_000) || '').includes('8月13日 10:05'));
ck('同一天:只写 HH:MM', !text().includes('月'));

// ── 三态文案 ──────────────────────────────────────────────────────────────────
R();
ck('在线(从未失败)→ 无横幅(null)', bannerText(S()) === null);
R(); reportReadSuccess(T1);
ck('在线(最近一次成功)→ 无横幅', bannerText(S()) === null);
R(); reportReadFailure(T2);
ck('从未成功过+失败 → 「尚未获取到数据」变体(不编造时间)', text().includes('尚未获取到数据'));

// ── 恢复:失败后一次成功即回在线 ──────────────────────────────────────────────
R();
outage(); reportReadSuccess(T4 + 1);
ck('断连→成功:offline=false·横幅立即消失', S().offline === false && bannerText(S()) === null);
ck('恢复后 lastSuccessAt 前进', S().lastSuccessAt === T4 + 1);
ck('一次成功即归零(请求数与轮数)', S().consecutiveFailures === 0 && S().failureRounds === 0);

// ── emit 纪律:只在口径翻转时通知(在线时每次轮询成功不白刷 UI) ─────────────────
R();
const v0 = connectivityVersion();
reportReadSuccess(T1); reportReadSuccess(T2);
ck('在线态连续成功:version 不动(不触发重渲染)', connectivityVersion() === v0);
reportReadFailure(T2 + 1);
ck('第 1 轮失败:进入 reconnecting 是一次翻转(version +1),但横幅仍不出', connectivityVersion() === v0 + 1 && bannerText(S()) === null);
reportReadFailure(T2 + 2);
ck('同一轮里再失败:口径不变,version 不动', connectivityVersion() === v0 + 1);
reportReadFailure(T2 + 5_000);
ck('第 2 轮失败(还不到 10s):online→slow(正在重试)翻转,version +1', connectivityVersion() === v0 + 2 && S().level === 'slow');
reportReadFailure(T3);
ck('失败持续 ≥10s:slow→offline,version +1', connectivityVersion() === v0 + 3 && S().level === 'offline');
reportReadFailure(T4 + 60_000);
ck('已 offline 再失败:version 不动', connectivityVersion() === v0 + 3);
reportReadSuccess(T4 + 70_000);
ck('翻回在线:version 再 +1', connectivityVersion() === v0 + 4);

// ── 🔴 一轮并发失败只算一次(2026-09-29 截图:截至 12:15 / 截图 12:15) ────────────
R();
reportReadSuccess(T1);
// 一轮轮询并发 6 个读,同一次卡顿里一起失败(相隔几十毫秒)
for (let i = 0; i < 6; i++) reportReadFailure(T2 + i * 40);
ck('🔴 一轮 6 个并发读一起失败:不是 offline(旧实现这里已经 offline)', S().offline === false);
ck('🔴 一轮失败只记 1 轮', S().failureRounds === 1 && S().consecutiveFailures === 6);
ck('🔴 一轮失败:不出横幅(单次抖动不喊)', bannerText(S()) === null);
reportReadSuccess(T2 + 5_000);
ck('下一轮成功:一切如常,整个过程用户什么都没看到', bannerText(S()) === null && S().failureRounds === 0);

// ── 轮数 + 持续时间都要到才说「无法连接」 ───────────────────────────────────
R();
reportReadSuccess(T1);
reportReadFailure(T2); reportReadFailure(T2 + FAILURE_ROUND_MS); reportReadFailure(T2 + 2 * FAILURE_ROUND_MS);
ck('3 轮但只持续了 6s(< 10s):还不是 offline,是「连接较慢 · 正在重试」', S().failureRounds === 3 && !S().offline && text() === '连接较慢 · 正在重试');
reportReadFailure(T2 + OFFLINE_AFTER_MS);
ck('失败持续到 10s:offline', S().offline === true && text().startsWith('无法连接服务器'));

R();
reportReadSuccess(T1);
reportReadFailure(T2); reportReadFailure(T2 + 400); reportReadFailure(T2 + 20_000);
ck('两轮、间隔 20s、中间没有成功:offline(>10s 没拿到任何数据)', S().offline);
R();
reportReadSuccess(T1);
reportReadFailure(T2); reportReadFailure(T2 + 1_000); reportReadFailure(T2 + 2_000); reportReadFailure(T2 + 2_900);
ck('一轮(3s 内)里失败再多也只算 1 轮:不是 offline', !S().offline && S().failureRounds === 1);
R();
reportReadSuccess(T1);
for (let i = 0; i <= 6; i++) reportReadFailure(T2 + i * 2_000); // 每 2 秒一次、持续 12 秒,中间没有成功
ck('🔴 一串相隔 2s 的失败不会被链成「一轮」:持续 12s 就是 offline', S().offline && S().failureRounds >= 2);

// 冷启动不设宽限:屏上无数据时一次失败就要说话
R();
reportReadFailure(T2);
ck('🔴 冷启动(从未成功)失败1次:立即 offline(不吞)', S().offline === true);
ck('🔴 冷启动失败1次:reconnecting=false', S().reconnecting === false);

// ── 慢 ≠ 连不上 ─────────────────────────────────────────────────────────────
R();
reportReadSuccess(T1, SLOW_READ_MS + 2_000);
ck('单次慢读:不出横幅', bannerText(S()) === null);
reportReadSuccess(T1 + 1, SLOW_READ_MS + 2_000);
reportReadSuccess(T1 + 2, SLOW_READ_MS + 2_000);
ck('连续 3 次慢读:「连接较慢」而不是「无法连接」', S().level === 'slow' && text() === '连接较慢 · 数据可能稍有延迟');
reportReadSuccess(T1 + 3, 800);
ck('一次快读:横幅立即消失', bannerText(S()) === null);
reportReadSuccess(T1 + 4, SLOW_READ_MS + 1); reportReadSuccess(T1 + 5, 700); reportReadSuccess(T1 + 6, SLOW_READ_MS + 1);
ck('快慢交替:不出横幅', bannerText(S()) === null);

// ── 非 2xx 的分类 ────────────────────────────────────────────────────────────
ck('502/503/504(入口层够不着 hub)算连不上', [502, 503, 504].every(readStatusCountsAsFailure));
ck('401/403/404/500(hub 自己答的)不算连不上', ![401, 403, 404, 500].some(readStatusCountsAsFailure));

// ── 退避 ───────────────────────────────────────────────────────────────────
ck('在线:原间隔', pollBackoffMs(5_000, 0) === 5_000);
ck('失败 1/2/3 轮:10s/20s/40s', pollBackoffMs(5_000, 1) === 10_000 && pollBackoffMs(5_000, 2) === 20_000 && pollBackoffMs(5_000, 3) === 40_000);
ck('封顶一分钟', pollBackoffMs(5_000, 10) === MAX_BACKOFF_MS);
ck('本来就比上限长的间隔不缩短', pollBackoffMs(90_000, 2) === 90_000);

// ── 恢复时广播「立即重试」 ─────────────────────────────────────────────────────
R();
let pokes = 0;
subscribeReconnect(() => { pokes++; });
reportReadSuccess(T1); reportReadSuccess(T2);
ck('在线时成功不广播(不让所有轮询每次都跟着多跑一轮)', pokes === 0);
reportReadFailure(T3); reportReadSuccess(T3 + 100);
ck('失败后第一次成功:广播一次,让退避里的轮询马上刷新', pokes === 1);

// ── 🔴 模拟链路:把一段时间里的请求结局喂进状态机,看横幅在每一刻说什么 ─────────────
// 每轮 = 4 个并发读(列表 / 消息 / 任务 / 通知),轮与轮之间按 usePoll 的退避间隔推进。
type Outcome = { ok: true; ms: number } | { ok: false };
function simulate(rounds: Outcome[][], intervalMs = 5_000): { shown: string[]; levels: string[] } {
  R();
  let now = T1;
  reportReadSuccess(now, 300); // 屏上已有缓存
  const shown: string[] = []; const levels: string[] = [];
  for (const round of rounds) {
    const start = now;
    let longest = 0;
    round.forEach((o, i) => {
      if (o.ok) { const end = start + o.ms + i * 20; reportReadSuccess(end, o.ms); longest = Math.max(longest, o.ms); }
      else { const end = start + 20_000 + i * 20; reportReadFailure(end); longest = Math.max(longest, 20_000); }
    });
    levels.push(S().level);
    shown.push(bannerText(S(), now) ?? '');
    now = start + longest + pollBackoffMs(intervalMs);
  }
  return { shown, levels };
}
const ok = (ms: number): Outcome => ({ ok: true, ms });
const bad: Outcome = { ok: false };

{
  // 高延迟但通的链路(手机经 RELAY:/health 2.8s、列表几秒):永远不说「无法连接」
  const r = simulate(Array.from({ length: 20 }, (_, i) => [ok(2_800 + (i % 3) * 900), ok(3_500), ok(1_900), ok(4_200)]));
  ck('🔴 慢而通的链路(2–5s/读):20 轮里一次都没出现「无法连接」', r.levels.every(l => l !== 'offline'));
  ck('慢而通(未到 6s 阈值):横幅始终不出', r.shown.every(s => s === ''));
}
{
  // 抖动链路:每 4 轮里有 1 轮整轮超时,其余正常
  const r = simulate(Array.from({ length: 24 }, (_, i) => (i % 4 === 1 ? [bad, bad, bad, bad] : [ok(1_200), ok(900), ok(2_000), ok(1_500)])));
  ck('🔴 抖动链路(每 4 轮坏 1 轮,整轮超时):「无法连接」一次都不出现', r.levels.every(l => l !== 'offline'));
  ck('🔴 抖动链路:横幅一次都不闪', r.shown.every(s => s === ''));
}
{
  // 抖动链路:偶尔连坏两轮
  const r = simulate([[ok(900)], [bad, bad], [ok(1_000), ok(800)], [bad, bad, bad], [ok(900)]]);
  ck('坏一轮、好一轮交替:横幅一次都不出', r.levels.join() === 'online,online,online,online,online');
}
{
  // 持续断连:从第 2 轮起全部超时
  const r = simulate([[ok(900), ok(900)], ...Array.from({ length: 6 }, () => [bad, bad, bad, bad])]);
  const firstOffline = r.levels.indexOf('offline');
  ck('🔴 持续断连:最终一定说「无法连接」', r.levels[r.levels.length - 1] === 'offline');
  ck('持续断连:第 2 个失败轮就是 offline(不会拖着不报)', firstOffline === 2);
  ck('持续断连:offline 文案给出最后成功时刻', r.shown[r.shown.length - 1].includes('截至 10:05'));
}
{
  // 慢到超过阈值、但每次都成功:说「连接较慢」,不说「无法连接」
  const r = simulate(Array.from({ length: 6 }, () => [ok(7_000), ok(9_000), ok(8_000), ok(12_000)]));
  ck('持续很慢(7–12s/读)但都成功:「连接较慢」,从不「无法连接」', r.levels.every(l => l !== 'offline') && r.levels[r.levels.length - 1] === 'slow');
}

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
