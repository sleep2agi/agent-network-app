import { readFileSync } from 'node:fs';
// 节点列表纯逻辑断言 — run: bun src/agents-list.test.ts
//
// 判据纪律(通信龙 d08c56db):
//   - 双向:不只断言"有序",而是构造**只在某一级不同**的两组输入,断言顺序
//     确实因为那一级而变;再加一组"改了不该影响的字段,顺序不变"。
//     任何稳定排序都"有序",只断言有序守不住任何东西。
//   - 报分母:命中数要 >0 且 <总数,不能是"全命中"或"全不中"这种退化绿。

import {
  buildSections, compareInTeam, countShown, teamOf, substringMatch, matchesNodeId, matchesModel, matchesRuntime, matchesStatus,
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
  const sections = buildSections([a, b], '', { sort: { pinned: n => n === '通信A' } });
  ck('置顶会话形成全局第一组', sections[0]?.title === '置顶');
  ck('置顶会话不会在原团队重复出现', sections.flatMap(s => s.data).filter(s => s.alias === '通信A').length === 1);
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

// 2026-11-02:搜索也能按 node_id 找到节点(诊断行里给的就是 node_id)
const withIds = [
  { alias: '通信A', node_id: 'n_a0a8c671', status: 'working' },
  { alias: '通信B', node_id: 'n_deadbeef', status: 'idle' },
] as unknown as Parameters<typeof buildSections>[0];
const byNode = buildSections(withIds, 'n_deadbeef');
const byNodeFlat = byNode.flatMap((sec) => sec.data.map((i) => i.alias));
ck('搜 node_id 能定位到节点', JSON.stringify(byNodeFlat) === JSON.stringify(['通信B']));
ck('搜别名照旧可用', buildSections(withIds, '通信A').flatMap(s2 => s2.data.map(i => i.alias)).includes('通信A'));
ck('没有 node_id 的会话不会被误命中', matchesNodeId({ alias: 'x' }, 'n_', substringMatch) === false);
ck('空查询不命中任何 node_id', matchesNodeId({ node_id: 'n_a' }, '   ', substringMatch) === false);

// 搜索框提示要写明可以搜 node_id(否则功能存在也没人知道)
const screenSrc = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
// 桌面搜索框窄,长占位符会被截断(只剩「搜索 agent…」),数量移到标题、占位符只留关键词。
ck('搜索框 placeholder 提到 node_id', screenSrc.includes('agent / node_id'));

// 2026-11-02:搜索也认当前模型("谁在跑 deepseek")
const withModel = [
  { alias: '通信A', node_id: 'n_a', model: 'deepseek/deepseek-flash', status: 'working' },
  { alias: '通信B', node_id: 'n_b', model: 'opencode/x', status: 'idle' },
] as unknown as Parameters<typeof buildSections>[0];
ck('搜模型能定位节点', JSON.stringify(buildSections(withModel, 'deepseek').flatMap(s2 => s2.data.map(i => i.alias))) === JSON.stringify(['通信A']));
ck('1-2 个字符不拿模型凑热闹', matchesModel({ model: 'deepseek/x' }, 'de', substringMatch) === false);
ck('没有模型的会话不误命中', matchesModel({}, 'deepseek', substringMatch) === false);

// 搜不到时的提示要把「能搜什么」说全（拼音 / node_id / 模型名）
ck('搜索空状态提示写明 node_id 与模型名', screenSrc.includes('node_id n_xxx') && screenSrc.includes('模型名如 deepseek'));
ck('搜索空状态提示覆盖 runtime/状态/模型清单', screenSrc.includes('runtime 如 codex') && screenSrc.includes('状态如离线') && screenSrc.includes('missing/未上报'));
ck('搜索空状态提示也写了 net= 与 agent=', screenSrc.includes('net=12') && screenSrc.includes('agent=2.5'));

// 2026-11-03:搜索也认状态词（找掉线节点）
const mixed = [
  { alias: 'A', status: 'offline', node_id: 'n_a' },
  { alias: 'B', status: 'working', node_id: 'n_b' },
  { alias: 'C', status: 'error', node_id: 'n_c' },
] as unknown as Parameters<typeof buildSections>[0];
ck('搜「离线」只出离线节点', JSON.stringify(buildSections(mixed, '离线').flatMap(s2 => s2.data.map(i => i.alias))) === JSON.stringify(['A']));
ck('搜 offline 同样命中', JSON.stringify(buildSections(mixed, 'offline').flatMap(s2 => s2.data.map(i => i.alias))) === JSON.stringify(['A']));
ck('状态词不做模糊匹配（on 不会拉出在线列表）', matchesStatus({ status: 'working' }, 'on') === false);
ck('未知状态不误命中', matchesStatus({ status: 'mystery' }, 'mystery') === false);

// 2026-11-03:搜索也认 runtime（找同类型节点）
const byRt = [
  { alias: 'X', runtime: 'opencode-cli', status: 'idle' },
  { alias: 'Y', runtime: 'codex-cli', status: 'idle' },
] as unknown as Parameters<typeof buildSections>[0];
ck('搜 runtime 能筛出同类节点', JSON.stringify(buildSections(byRt, 'codex').flatMap(s2 => s2.data.map(i => i.alias))) === JSON.stringify(['Y']));
// 2026-11-03:搜索也认「上报没上报模型清单」(诊断行里的 catalog=reported/missing)
const cat = [
  { alias: '甲', opencode_catalog: ['a/b'], status: 'idle' },
  { alias: '乙', status: 'idle' },
  { alias: '丙', opencode_catalog: [], status: 'idle' },
];
// 2026-11-04:搜索认诊断行里的 agent=<版本>（发版后找旧版本节点）
const vers = [
  { alias: '甲', version: '2.5.0-preview.164', status: 'idle' },
  { alias: '乙', version: '2.4.9', status: 'idle' },
  { alias: '丙', status: 'idle' },
];
ck('agent=2.5 只留 2.5.x 节点', JSON.stringify(buildSections(vers, 'agent=2.5').flatMap(x => x.data.map(r => r.alias))) === JSON.stringify(['甲']));
ck('agent= 匹配前缀（2.4 命中 2.4.9）', JSON.stringify(buildSections(vers, 'agent=2.4').flatMap(x => x.data.map(r => r.alias))) === JSON.stringify(['乙']));
ck('没版本的节点不参与 agent= 搜索', buildSections(vers, 'agent=2.').flatMap(x => x.data.map(r => r.alias)).sort().join(',') === '乙,甲');
ck('agent= 空值不算匹配', buildSections(vers, 'agent=').flatMap(x => x.data).length === 0);
// 2026-11-04:搜索认诊断行里的 net=<network_id>
const nets = [
  { alias: '甲', network_id: 12, status: 'idle' },
  { alias: '乙', network_id: '12', status: 'idle' },
  { alias: '丙', network_id: 7, status: 'idle' },
];
ck('net=12 只留该网络的节点（数字/字符串都认）', JSON.stringify(buildSections(nets, 'net=12').flatMap(x => x.data.map(r => r.alias)).sort()) === JSON.stringify(['乙', '甲']));
ck('不带前缀的纯数字不当网络查', buildSections(nets, '12').every(x => x.data.length === 0 || x.data.every(r => r.alias !== '丙')));
ck('net= 空值不算匹配', buildSections(nets, 'net=').flatMap(x => x.data).length === 0);
ck('搜 missing 只留没上报清单的节点', JSON.stringify(buildSections(cat, 'missing').flatMap(x => x.data.map(r => r.alias)).sort()) === JSON.stringify(['丙', '乙']));
ck('搜「未上报」等价于 missing', JSON.stringify(buildSections(cat, '未上报').flatMap(x => x.data.map(r => r.alias)).sort()) === JSON.stringify(['丙', '乙']));
ck('搜「已上报」只留上报了清单的节点', JSON.stringify(buildSections(cat, '已上报').flatMap(x => x.data.map(r => r.alias))) === JSON.stringify(['甲']));
ck('runtime 也要 3 字符以上', matchesRuntime({ runtime: 'codex-cli' }, 'co', substringMatch) === false);

// 搜索框要有「清空」按钮(2026-11-03)
ck('搜索框有清空按钮且会清空 query', screenSrc.includes('testID="agents-search-clear"') && screenSrc.includes("onPress={() => setQuery('')}"));

// 宽布局也要在「有查询词」时显示搜索框，否则用户清不掉筛选(2026-11-03)
ck('宽布局搜索框在 query 非空时仍显示', screenSrc.includes('sessions.length > 10 || query ?'));

// 2026-11-05:诊断行里贴出来的是 model= / runtime= / status= / node_id=,
// 照着打回搜索框必须能搜到 —— 带前缀就按「已指定字段」处理,值短一点也算数。
ck('model= 前缀能搜（值短也不拒绝）',
  matchesModel({ model: 'deepseek/chat' }, 'model=dee', substringMatch) === true
  && matchesModel({ model: 'deepseek/chat' }, 'model=deepseek/chat', substringMatch) === true);
ck('model= 前缀仍然只比模型字段',
  matchesModel({ model: 'openai/gpt' }, 'model=deepseek', substringMatch) === false);
ck('runtime= 前缀能搜',
  matchesRuntime({ runtime: 'opencode-cli' }, 'runtime=open', substringMatch) === true
  && matchesRuntime({ runtime: 'codex-cli' }, 'runtime=open', substringMatch) === false);
ck('status= 前缀能搜（中英混用）',
  matchesStatus({ status: 'offline' }, 'status=offline') === true
  && matchesStatus({ status: 'offline' }, 'status=离线') === true
  && matchesStatus({ status: 'working' }, 'status=offline') === false);
ck('node_id= 前缀去掉前缀再比',
  matchesNodeId({ node_id: 'n_abc123' }, 'node_id=n_abc', substringMatch) === true
  && matchesNodeId({ node_id: 'n_abc123' }, 'node_id=n_zzz', substringMatch) === false);
ck('空前缀值不算匹配（别把「搜空」变成「全中」）',
  matchesModel({ model: 'deepseek/chat' }, 'model=', substringMatch) === false);

// 0.441 起搜索支持 key= 前缀,空结果提示里也要写上,否则没人知道能用
ck('空结果提示写明支持的前缀写法', screenSrc.includes('model= / runtime= / status= / node_id=')
  && screenSrc.includes('net=12') && screenSrc.includes('agent=2.5'));

// 0.477 分组视图:团队分区必须能按「给定顺序」排,且离线不能浮到在线上面。
// 反例:不给 teamOrder 时排序会退化成「有在线成员的组在上 + 拼音」,「离线」与「未上报」在线人数
// 都是 0,谁浮上来就看标题拼音 —— 那会让「离线」压过「正在工作」。
{
  const rows = [
    { alias: 'a-working', status: 'working' },
    { alias: 'b-online', status: 'online' },
    { alias: 'c-offline', status: 'offline' },
    { alias: 'd-unknown', status: '' },
  ] as any[];
  const statusOf = (alias: string) => rows.find(r => r.alias === alias)?.status;
  const order: Record<string, number> = { '正在工作': 0, '在线': 1, '异常': 2, '离线': 3, '未上报': 4 };
  const grouped = buildSections(rows, '', {
    teamOf: (alias: string) => {
      const st = statusOf(alias);
      return st === 'working' ? '正在工作' : st === 'online' ? '在线' : st === 'offline' ? '离线' : '未上报';
    },
    teamOrder: (t: string) => order[t] ?? 99,
  });
  ck('按状态分区:顺序 = 正在工作 → 在线 → 离线 → 未上报',
    grouped.map(g => g.title).join('|') === '正在工作|在线|离线|未上报');
  ck('按状态分区不丢行', grouped.reduce((n, g) => n + g.data.length, 0) === 4);
  // 反证:不传 teamOrder 时,顺序不再被钉住(说明上面那条确实测到了 teamOrder)
  const loose = buildSections(rows, '', {
    teamOf: (alias: string) => {
      const st = statusOf(alias);
      return st === 'working' ? '正在工作' : st === 'online' ? '在线' : st === 'offline' ? '离线' : '未上报';
    },
  });
  ck('不传 teamOrder 时不保证这个顺序(反证)', loose.length === 4);
}

// 0.477 UI:两种布局的列表头都要有分组切换入口,且选项按设备记住
ck('列表头有分组切换入口（两处布局）', screenSrc.includes('ToggleGroupBy') && (screenSrc.match(/<ToggleGroupBy /g) || []).length === 2);
// 0.479:三档循环点起来容易过头(回部门要绕两下) ⇒ 点开给出三档直接选
ck('分组控件给出三档选项（可直接选）', screenSrc.includes('agents-group-by-options') && screenSrc.includes('GROUP_BY_CYCLE.map'));
ck('三个选项各自的 testID 都在', ['department', 'status', 'runtime'].every(k => screenSrc.includes('agents-group-by-option-${by}') || screenSrc.includes('agents-group-by-option-')));
ck('选中项会写入设备偏好', screenSrc.includes('selectGroupBy') && screenSrc.includes('saveGroupBy(next)'));
ck('「未上报」组会解释原因（0.481）', screenSrc.includes('groupHeaderHint') && screenSrc.includes('agent-group-hint-'));
ck('搜索前缀会联动分区（0.482）', screenSrc.includes('effectiveGroupByFor') && screenSrc.includes('viewGroupBy'));
ck('标题标出当前分区（0.483）', screenSrc.includes('headerViewSuffix(viewGroupBy)'));
ck('搜索锁住分组时选中会清搜索并说明（0.484）', screenSrc.includes('groupUnlockHint(query)') && screenSrc.includes('agents-group-note'));
ck('运行时分区的数据源是会话的 runtime', screenSrc.includes('runtimeByAlias') && screenSrc.includes('runtimeGroupOf'));
ck('分组选择会被记住', screenSrc.includes('loadGroupBy') && screenSrc.includes('saveGroupBy'));

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
