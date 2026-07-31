// 节点列表纯逻辑断言 — run: bun src/agents-list.test.ts
//
// 判据纪律(通信龙 d08c56db):
//   - 双向:不只断言"有序",而是构造**只在某一级不同**的两组输入,断言顺序
//     确实因为那一级而变;再加一组"改了不该影响的字段,顺序不变"。
//     任何稳定排序都"有序",只断言有序守不住任何东西。
//   - 报分母:命中数要 >0 且 <总数,不能是"全命中"或"全不中"这种退化绿。

import {
  buildSections, compareInTeam, countShown, teamOf, substringMatch,
  type Matcher,
} from './agents-list';
import type { Session } from './api';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const S = (alias: string, status = 'idle', updated_at?: string): Session =>
  ({ alias, status, updated_at } as Session);

// ── teamOf(逐字搬移,行为必须与抽离前一致)────────────────────────
ck('teamOf 显式分隔符优先', teamOf('team/role') === 'team');
ck('teamOf 中文取前 2 字', teamOf('通信测试马') === '通信');
ck('teamOf 短别名原样', teamOf('工程') === '工程');
ck('teamOf 空别名归「其他」', teamOf('') === '其他');

// ── 排序第 1 级:pinned ───────────────────────────────────────────
{
  const a = S('通信A', 'offline', '2020-01-01T00:00:00Z');   // 各方面都更弱
  const b = S('通信B', 'working', '2030-01-01T00:00:00Z');   // 各方面都更强
  const noPin = [a, b].slice().sort((x, y) => compareInTeam(x, y));
  const pinA = [a, b].slice().sort((x, y) => compareInTeam(x, y, { pinned: n => n === '通信A' }));
  ck('pin 级:不置顶时强者在前', noPin[0].alias === '通信B');
  ck('pin 级:置顶弱者能翻到最前(顺序确实因这一级改变)', pinA[0].alias === '通信A');
  ck('pin 级:默认不置顶(占位恒 false,不假装已有该能力)',
    compareInTeam(a, b) === compareInTeam(a, b, {}));
}

// ── 排序第 2 级:online ───────────────────────────────────────────
{
  const off = S('通信X', 'offline', '2030-01-01T00:00:00Z');  // 离线但更新更近
  const on  = S('通信Y', 'idle',    '2020-01-01T00:00:00Z');  // 在线但更新更旧
  const sorted = [off, on].slice().sort((x, y) => compareInTeam(x, y));
  ck('online 级:在线压过更近的 recency', sorted[0].alias === '通信Y');
  // 注入 R29 迟滞:把离线的那个当成"60s 内在线过"→ 顺序应翻转
  const hyst = [off, on].slice().sort((x, y) =>
    compareInTeam(x, y, { recentlyOnline: n => n === '通信X' }));
  ck('online 级:注入迟滞后顺序确实翻转(这一级真的在起作用)', hyst[0].alias === '通信X');
}

// ── 排序第 3 级:recency ──────────────────────────────────────────
{
  const older = S('通信M', 'idle', '2024-01-01T00:00:00Z');
  const newer = S('通信N', 'idle', '2026-01-01T00:00:00Z');
  const sorted = [older, newer].slice().sort((x, y) => compareInTeam(x, y));
  ck('recency 级:同为在线时更近的在前', sorted[0].alias === '通信N');
  // 反向:把 updated_at 抹掉,退化到字母序,证明这一级确实读的是 updated_at
  const noTs = [S('通信N', 'idle'), S('通信M', 'idle')].sort((x, y) => compareInTeam(x, y));
  ck('recency 级:无 updated_at 时退化为字母序', noTs[0].alias === '通信M');
}

// ── 负向:改了不该影响排序的字段,顺序必须不变 ──────────────────
{
  const base = [S('通信A', 'idle', '2025-01-01T00:00:00Z'), S('通信B', 'idle', '2026-01-01T00:00:00Z')];
  const before = base.slice().sort((x, y) => compareInTeam(x, y)).map(s => s.alias).join(',');
  const withTask = base.map(s => ({ ...s, task: '在忙别的事', agent: 'claude' } as Session));
  const after = withTask.slice().sort((x, y) => compareInTeam(x, y)).map(s => s.alias).join(',');
  ck('负向:task/agent 变化不影响顺序', before === after, `${before} vs ${after}`);
}

// ── 分组 + 过滤:报分母,拒绝退化绿 ───────────────────────────────
{
  const fleet: Session[] = [
    S('通信龙', 'working', '2026-01-03T00:00:00Z'),
    S('通信测试马', 'idle', '2026-01-02T00:00:00Z'),
    S('通信N站马', 'offline', '2026-01-01T00:00:00Z'),
    S('工程马', 'idle', '2026-01-05T00:00:00Z'),
    S('支付助手', 'idle', '2026-01-04T00:00:00Z'),
  ];
  const all = buildSections(fleet, '');
  ck('无查询时条目数 = 输入总数(分母对得上)', countShown(all) === fleet.length,
    `${countShown(all)}/${fleet.length}`);

  const hit = buildSections(fleet, '通信');
  const n = countShown(hit);
  ck('子串搜「通信」命中数 >0 且 <总数(不是退化绿)', n > 0 && n < fleet.length, `命中 ${n}/${fleet.length}`);

  const none = buildSections(fleet, 'zzz-不存在');
  ck('搜不到时返回 0 条(调用方据此显示空态,而不是空白)', countShown(none) === 0);

  const cleared = buildSections(fleet, '');
  ck('清空查询后完全复原', countShown(cleared) === fleet.length);

  // 组内顺序:通信组里 working 应在 idle 之前,offline 最后
  const tx = hit.find(g => g.title === '通信')!;
  ck('组内顺序 working → idle → offline',
    tx.data.map(s => s.alias).join(',') === '通信龙,通信测试马,通信N站马',
    tx.data.map(s => s.alias).join(','));

  // 组间顺序:有人在线的团队在前
  ck('组间顺序:全员离线的团队沉底',
    buildSections([S('甲一', 'offline'), S('乙一', 'idle')], '')[0].title === '乙一'.slice(0, 2));
}

// ── 注入式匹配器:证明 buildSections 不写死子串匹配 ──────────────
{
  const fleet = [S('支付助手'), S('通信龙')];
  const fake: Matcher = (text, filter) => filter === 'zf' && text === '支付助手';
  const viaInjected = buildSections(fleet, 'zf', { match: fake });
  ck('可注入匹配器(拼音将从这里接入)', countShown(viaInjected) === 1);
  ck('默认子串匹配器不认 zf(证明上一条真的走了注入的那个)',
    countShown(buildSections(fleet, 'zf')) === 0);
  ck('substringMatch 大小写不敏感', substringMatch('Alpha', 'ALP'));
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
