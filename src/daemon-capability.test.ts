import fs from 'node:fs';
import { describeDaemonCapability, formatAge } from './daemon-capability';

let passed = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`PASS: ${name}`);
};

const NOW = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

// ── 三态各一句不同的话 ────────────────────────────────────────────
// 🔴 两向见证:只验 blocked 那一侧的话,一个恒返回 blocked 的实现也会全绿。
const ready = describeDaemonCapability(
  { can_create_nodes: true, create_capability_observed_ms_ago: 0, last_seen_at: iso(NOW - 120_000) }, NOW);
const blocked = describeDaemonCapability(
  { can_create_nodes: false, create_nodes_blocked_reason: 'anet_bin_source',
    create_capability_observed_ms_ago: 0, last_seen_at: iso(NOW - 300_000) }, NOW);
const unknown = describeDaemonCapability({ last_seen_at: iso(NOW - 60_000) }, NOW);

check('三态 kind 互不相同', new Set([ready.kind, blocked.kind, unknown.kind]).size === 3);
check('三态文案互不相同', new Set([ready.label, blocked.label, unknown.label]).size === 3);
check('ready 侧真的是 ready 且说了多久以前测的', ready.kind === 'ready' && ready.label.includes('2m 前'));
check('blocked 侧真的是 blocked 且说了多久以前测的', blocked.kind === 'blocked' && blocked.label.includes('5m 前'));

// 🔴 这条是本模块存在的理由:undefined ≠ false。
// 把没升级的 daemon 渲染成"不能建",会让人去修一台其实好好的机器;
// 渲染成"能建",又是朝"没问题"方向说谎。它必须是第三种话。
check('从没报过 ⇒ unknown,既不是 ready 也不是 blocked', unknown.kind === 'unknown');
check('unknown 说清了为什么不知道(指向 agent-node 版本 + 要重启)',
  !!unknown.detail && unknown.detail.includes('2.5.0-preview.55') && unknown.detail.includes('重启'));

// 🔴 版本号必须带包名 + 完整版本号 —— 裸 `preview.NN` 在一个三包各自编号的仓里不指向任何东西。
check('版本代际写法带包名', !!unknown.detail && unknown.detail.includes('agent-node'));

// ── blocked 必须给出「去哪找修法」,且不复制 CLI 的修法表 ───────────
check('blocked 原样带出 reason code', blocked.detail!.includes('anet_bin_source'));
check('blocked 指向那台机器上的命令', blocked.detail!.includes('anet doctor'));

// 🔴 反向:本模块**不许**自带一份 FIX_BY_REASON 式的修法表。
// 复制过来的表会随 agent-node 版本静默漂掉,而漂掉那一刻用户拿到的是一条错命令。
const src = fs.readFileSync(new URL('./daemon-capability.ts', import.meta.url), 'utf8');
const codeOnly = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
check('模块里没有自造的修法命令(不复制 CLI 的 FIX_BY_REASON)',
  !/install -d|sudo tee|ANET_BIN_ABS=/.test(codeOnly));

// ── 年龄公式:绝对年龄 = (now - last_seen_at) + observed_ms_ago ──────
// daemon 只给「时长」,绝对时间由 hub/本地的钟出。两段都要计入。
const aged = describeDaemonCapability(
  { can_create_nodes: true, create_capability_observed_ms_ago: 60_000, last_seen_at: iso(NOW - 60_000) }, NOW);
check('两段都计入(60s 心跳延迟 + 60s 测量早于上报 = 2m)', aged.ageMs === 120_000 && aged.label.includes('2m 前'));

// 正控:如果实现只用了 observed_ms_ago 而漏掉 last_seen_at 那段,上面那条会读出 1m。
check('正控 —— 只算 observed 会得到不同的数,所以上面那条不是恒真', formatAge(60_000) !== formatAge(120_000));

// 缺任一段 ⇒ 年龄未知,**不能当成 0**(那等于替一个从不重算的旧 daemon 宣称「刚测的」)。
const noAge = describeDaemonCapability({ can_create_nodes: true, last_seen_at: iso(NOW - 60_000) }, NOW);
check('缺 observed ⇒ 年龄未知,不伪造 0', noAge.ageMs === undefined && !noAge.label.includes('前'));
check('年龄未知时说清为什么(开机只算一次)', !!noAge.detail && noAge.detail.includes('开机只算一次'));
const noSeen = describeDaemonCapability({ can_create_nodes: true, create_capability_observed_ms_ago: 0 }, NOW);
check('缺 last_seen_at ⇒ 同样年龄未知', noSeen.ageMs === undefined);

// ── formatAge 不四舍五入到「刚刚」 ────────────────────────────────
check('毫秒级仍然报毫秒', formatAge(500) === '500ms 前');
check('各档位互不相同', new Set([formatAge(500), formatAge(5_000), formatAge(300_000), formatAge(7_200_000), formatAge(200_000_000)]).size === 5);
check('负数/NaN 不假装知道', formatAge(-1) === '?' && formatAge(NaN) === '?');

// ── blocked 但没给 reason ⇒ 兜底方向必须指向坏的那侧 ────────────
const noReason = describeDaemonCapability({ can_create_nodes: false }, NOW);
check('缺 reason 仍是 blocked(兜底不朝「没问题」方向倒)', noReason.kind === 'blocked');

console.log(`\n${passed}/${passed} passed`);
