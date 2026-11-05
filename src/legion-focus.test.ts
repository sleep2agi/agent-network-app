// 「只看某个部门」的断言(2026-11-05)。
// 过滤是集合运算,错了的表现是「人数不对但图还是画出来了」—— 所以钉住:范围、边、圆心、不猜。
import { buildLegionLayout } from './legion/legion-layout';
import { copyA11yLabel, refreshNotice, focusEmptyText, focusHint, focusIdFromStored, focusLabel, focusLayout, focusOutline, focusStats, focusStatsLine, focusTrail, legionA11yLabel, nodeDepartmentPath, subtreeIds, tapOutcome } from './legion/legion-focus';
import { legionInputFromOrg } from './legion-input-from-org';

let pass = 0;
const names: string[] = [];
function ck(name: string, ok: boolean) {
  names.push(name);
  if (ok) { pass += 1; return; }
  console.log(`FAIL: ${name}`);
}

const dept = (id: string, name: string, parentId: string | null = null, sort = 0) => ({
  id, name, parent_id: parentId, leader_user_id: null, sort, member_count: 0,
});

const org = {
  departments: [dept('d1', '平台', null, 0), dept('d2', '前端', 'd1', 1), dept('d9', '别的部门', null, 2)],
  owners: [
    { userId: 'u1', username: 'v', displayName: 'V', departmentId: 'd2', agents: [{ nodeId: 'n1', alias: 'A1' }] },
    { userId: 'u2', username: 'w', displayName: 'W', departmentId: 'd9', agents: [{ nodeId: 'n2', alias: 'A2' }] },
  ],
  unowned: [], directory: true, departmentsApi: true, agentDepartmentSupported: true,
} as never;

const layout = buildLegionLayout(legionInputFromOrg(org));
const focused = focusLayout(layout, 'dept:d1');

ck('聚焦部门保留自己与所有下级（父部门含子部门的人与 Agent）', (() => {
  const ids = new Set(focused.nodes.map((n) => n.id));
  return ids.has('dept:d1') && ids.has('dept:d2') && ids.has('person:u1') && ids.has('agent:n1');
})());

ck('聚焦裁掉范围外的部门与人', (() => {
  const ids = new Set(focused.nodes.map((n) => n.id));
  return !ids.has('dept:d9') && !ids.has('person:u2') && !ids.has('agent:n2');
})());

ck('圆心始终保留（没有它就没有军团锚点）',
  focused.nodes.some((n) => n.kind === 'core'));

ck('边按两端裁剪，不留半截线',
  focused.edges.every((e) => {
    const ids = new Set(focused.nodes.map((n) => n.id));
    return ids.has(e.from) && ids.has(e.to);
  }) && focused.edges.length > 0);

ck('聚焦到人/Agent 也成立（子集就是它自己）', (() => {
  const one = focusLayout(layout, 'person:u1');
  const ids = new Set(one.nodes.map((n) => n.id));
  return ids.has('person:u1') && !ids.has('person:u2');
})());

ck('聚焦不存在的 id ⇒ 原样返回（不猜、不清空）',
  focusLayout(layout, 'dept:nope') === layout && focusLayout(layout, null) === layout
  && focusLayout(layout, '') === layout);

ck('subtreeIds 不会因为环状 parentId 死循环', (() => {
  const nodes = [
    { id: 'a', parentId: 'b' },
    { id: 'b', parentId: 'a' },
  ] as never;
  const ids = subtreeIds(nodes, 'a');
  return ids.has('a') && ids.has('b') && ids.size === 2;
})());

ck('标签取名字；取不到时退回 id 后半截', (() => {
  return focusLabel(layout, 'dept:d1') === '平台'
    && focusLabel(layout, 'person:zzz') === 'zzz'
    && focusLabel(layout, null) === null;
})());

ck('聚焦后 stats 仍是全量口径（不谎报人数）',
  focused.stats.people === layout.stats.people && focused.stats.agents === layout.stats.agents);

ck('聚焦统计只数这个部门（人/Agent/部门）', (() => {
  const st = focusStats(layout, 'dept:d1');
  return st.people === 1 && st.agents === 1 && st.groups === 2;   // 平台(含前端)，1 人 1 Agent
})());

ck('不聚焦时统计退回全量（不误报）', (() => {
  const all = focusStats(layout, null);
  return all.people === layout.stats.people && all.agents === layout.stats.agents;
})());

ck('聚焦不存在的 id 也退回全量（不猜）',
  focusStats(layout, 'dept:nope').people === layout.stats.people);

console.log(`legion focus: ${pass}/${names.length} checks passed`);
if (pass !== names.length) process.exit(1);

// 面包屑(2026-11-05):二级部门聚焦时能逐级退回,不用先回全图。
ck('面包屑给出 军团 → 父部门 → 当前部门 的完整祖先链', (() => {
  const trail = focusTrail(layout, 'dept:d2');
  return trail.length === 3
    && trail[0].id === null && trail[0].label === '军团'
    && trail[1].id === 'dept:d1'
    && trail[2].id === 'dept:d2';
})());

ck('一级部门聚焦时面包屑是两级（军团 → 部门）', (() => {
  const trail = focusTrail(layout, 'dept:d1');
  return trail.length === 2 && trail[0].id === null && trail[1].id === 'dept:d1';
})());

ck('没聚焦只给「军团」一项', (() => {
  const trail = focusTrail(layout, null);
  return trail.length === 1 && trail[0].id === null && trail[0].label === '军团';
})());

ck('聚焦不存在的 id 时只给「军团」，不猜也不清空', (() => {
  const trail = focusTrail(layout, 'dept:nope');
  return trail.length === 1 && trail[0].id === null;
})());

ck('面包屑不会把圆心写进链里（军团已是第一项）', (() => {
  return focusTrail(layout, 'dept:d2').every((crumb) => crumb.id !== 'core');
})());


// 聚焦轮廓(0.2.456):范围外的部门留着但变暗,人和 Agent 仍裁掉。
ck('聚焦轮廓保留范围外部门并标记为暗色', (() => {
  const view = focusOutline(layout, 'dept:d1');
  const ids = new Set(view.layout.nodes.map((n) => n.id));
  return ids.has('dept:d9') && view.dimmedIds.has('dept:d9');
})());

ck('聚焦轮廓里范围外的「人」仍然被裁掉（否则还是满屏）', (() => {
  const ids = new Set(focusOutline(layout, 'dept:d1').layout.nodes.map((n) => n.id));
  return !ids.has('person:u2') && !ids.has('agent:n2');
})());

ck('聚焦轮廓不把范围内的节点标成暗色', (() => {
  const view = focusOutline(layout, 'dept:d1');
  return !view.dimmedIds.has('dept:d1') && !view.dimmedIds.has('dept:d2') && !view.dimmedIds.has('person:u1');
})());

ck('没聚焦时没有暗色节点、布局原样', (() => {
  const view = focusOutline(layout, null);
  return view.dimmedIds.size === 0 && view.layout.nodes.length === layout.nodes.length;
})());

ck('聚焦不存在的 id 时不产生暗色节点（不猜）', (() => {
  const view = focusOutline(layout, 'dept:nope');
  return view.dimmedIds.size === 0 && view.layout.nodes.length === layout.nodes.length;
})());

ck('暗色部门不带来额外的边（边只保留范围内的）', (() => {
  const view = focusOutline(layout, 'dept:d1');
  return view.layout.edges.every((e) => !view.dimmedIds.has(e.from) && !view.dimmedIds.has(e.to));
})());

// 点选(0.2.457):点暗色部门直接切过去,其他情况只改选中。
ck('点中暗色部门 ⇒ 聚焦并选中它', (() => {
  const view = focusOutline(layout, 'dept:d1');
  const out = tapOutcome('dept:d9', view.dimmedIds);
  return out.focusId === 'dept:d9' && out.selectedId === 'dept:d9';
})());

ck('点中范围内节点 ⇒ 只改选中,不动聚焦', (() => {
  const view = focusOutline(layout, 'dept:d1');
  const out = tapOutcome('person:u1', view.dimmedIds);
  return out.focusId === undefined && out.selectedId === 'person:u1';
})());

ck('点空白 ⇒ 清空选中,不动聚焦', (() => {
  const out = tapOutcome(null, new Set(['dept:d9']));
  return out.focusId === undefined && out.selectedId === null;
})());

ck('没聚焦(没有暗色节点)时点谁都只改选中', (() => {
  const out = tapOutcome('dept:d9', new Set());
  return out.focusId === undefined && out.selectedId === 'dept:d9';
})());

ck('空字符串 id 当成点空白（不聚焦到空节点）', (() => {
  const out = tapOutcome('   ', new Set(['  ']));
  return out.focusId === undefined && out.selectedId === null;
})());

// 汇总行文案(0.2.458):聚焦时把军团全量一起给出来。
ck('全图时汇总行只有本图口径,带前缀「聚焦」', (() => {
  const line = focusStatsLine(layout, null);
  return !line.startsWith('聚焦') && line === `${layout.stats.people} 人 · ${layout.stats.agents} 个 Agent · ${layout.stats.groups} 个部门`;
})());

ck('聚焦时前缀是「聚焦 <部门名>：」且带「军团共 N 人」', (() => {
  const line = focusStatsLine(layout, 'dept:d1');
  const inner = focusStats(layout, 'dept:d1');
  return line.startsWith('聚焦 平台：')
    && line.includes(`${inner.people} 人`)
    && line.endsWith(`（军团共 ${layout.stats.people} 人）`);
})());

ck('聚焦范围的规模与全量不同时才带全量后缀', (() => {
  const line = focusStatsLine(layout, 'dept:d1');
  return layout.stats.people > focusStats(layout, 'dept:d1').people && line.includes('军团共');
})());

ck('聚焦未知 id 时退回全图口径(不出现「聚焦」字样)', (() => {
  const line = focusStatsLine(layout, 'dept:nope');
  return !line.startsWith('聚焦') && line.includes(`${layout.stats.people} 人`);
})());

ck('没有布局时给空串(视图自己兜底成节点数)', (() => focusStatsLine(null, 'dept:d1') === ''));

// 可点提示(0.2.459):只在确实有暗色部门时出现。
ck('聚焦且存在暗色部门时给一句可点提示（带个数）', (() => {
  const n = focusOutline(layout, 'dept:d1').dimmedIds.size;
  return focusHint(n, 'dept:d1') === `点暗色部门可直接切过去（${n} 个）`;
})());

ck('没聚焦时不给提示（不占一行）', (() => focusHint(3, null) === null)());

ck('没有暗色部门时不给提示', (() => focusHint(0, 'dept:d1') === null)());

ck('个数为负或脏值时也不给提示', (() => focusHint(-1, 'dept:d1') === null)());

// 无障碍描述(0.2.460):读屏能听到聚焦范围、可点数量、能点节点。
ck('全图时无障碍描述带「军团 3D 视图」和「点节点可看是谁」', (() => {
  const s2 = legionA11yLabel({});
  return s2.startsWith('军团 3D 视图') && s2.endsWith('点节点可看是谁') && !s2.includes('聚焦');
})());

ck('聚焦时无障碍描述包含部门名与三项数字', (() => {
  const inner = focusStats(layout, 'dept:d1');
  const s2 = legionA11yLabel({ focusLabel: '平台', people: inner.people, agents: inner.agents, groups: inner.groups });
  return s2.includes('聚焦 平台：') && s2.includes(`${inner.people} 人`) && s2.includes(`${inner.agents} 个 Agent`) && s2.includes(`${inner.groups} 个部门`);
})());

ck('有暗色部门时无障碍描述说出可点数量', (() => {
  const s2 = legionA11yLabel({ dimmedCount: 3 });
  return s2.includes('点暗色部门可切过去（3 个）');
})());

ck('没有暗色部门时不提「可切过去」（不留噪音）', (() => {
  return !legionA11yLabel({ dimmedCount: 0 }).includes('切过去');
})());

ck('聚焦名与数字缺失时降级成「聚焦 X」而不是带上空数字', (() => {
  const s2 = legionA11yLabel({ focusLabel: '平台' });
  return s2.includes('聚焦 平台') && !s2.includes('NaN') && !s2.includes('undefined');
})());

// 所属部门路径(0.2.461):选中人/Agent 时看得出他属于哪条线。
ck('二级部门里的人给出 父部门 → 子部门 的路径', (() => {
  const p = nodeDepartmentPath(layout, 'person:u1');
  return p.length === 2 && p[0] === '平台' && p[1] === '前端';
})());

ck('一级部门里的人路径只有一层', (() => {
  const p = nodeDepartmentPath(layout, 'person:u2');
  return p.length === 1 && p[0] === '别的部门';
})());

ck('部门自己给出它的上级路径（不含自己）', (() => {
  const p = nodeDepartmentPath(layout, 'dept:d2');
  return p.length === 1 && p[0] === '平台';
})());

ck('圆心 / 未知 id / 空 id 一律给空数组（调用方不加这行）', (() => {
  return nodeDepartmentPath(layout, 'core').length === 0
    && nodeDepartmentPath(layout, 'dept:nope').length === 0
    && nodeDepartmentPath(layout, null).length === 0
    && nodeDepartmentPath(null, 'person:u1').length === 0;
})());

// 空聚焦提示(0.2.462):聚焦到空部门时不能什么都不说。
ck('聚焦到没人没 Agent 的部门时给空态提示（带退出口）', (() => {
  const t = focusEmptyText({ focusLabel: '后勤部', people: 0, agents: 0 });
  return t === '后勤部 下面还没有人 · 点面包屑返回上一级';
})());

ck('有人就不提示', (() => focusEmptyText({ focusLabel: '平台', people: 3, agents: 0 }) === null)());

ck('只有 Agent 也算「有人」', (() => focusEmptyText({ focusLabel: '平台', people: 0, agents: 1 }) === null)());

ck('没有聚焦名时不提示（不输出半句话）', (() => focusEmptyText({ focusLabel: null, people: 0, agents: 0 }) === null)());

ck('数字缺失按 0 处理并给提示', (() => (focusEmptyText({ focusLabel: '后勤部' }) ?? '').includes('还没有人'))());

// 恢复聚焦(0.2.463):存下来的部门 id 还在就用,不在就退回全图(不猜)。
ck('存下来的部门 id 仍存在 ⇒ 恢复它', (() => focusIdFromStored('dept:d1', layout) === 'dept:d1')());

ck('存下来的 id 已不存在 ⇒ 退回全图(null)', (() => focusIdFromStored('dept:gone', layout) === null)());

ck('没存过/空白串 ⇒ null', (() => focusIdFromStored('', layout) === null && focusIdFromStored('  ', layout) === null && focusIdFromStored(null, layout) === null)());

ck('布局还没算出来时不恢复(避免拿空布局做判断)', (() => focusIdFromStored('dept:d1', null) === null)());

// 无障碍里的「选中」(0.2.465):选中是视觉态,读屏过去听不到。
ck('有选中节点时无障碍描述会说「已选中 X」', (() => {
  const s2 = legionA11yLabel({ selectedLabel: '张三（人）' });
  return s2.includes('已选中 张三（人）');
})());

ck('没选中/空白时不提「已选中」（不留噪音）', (() => {
  return !legionA11yLabel({}).includes('已选中') && !legionA11yLabel({ selectedLabel: '   ' }).includes('已选中');
})());

ck('聚焦 + 选中 + 可点提示三段同时在，且顺序稳定（选中在可点提示之前）', (() => {
  const s2 = legionA11yLabel({ focusLabel: '平台', people: 3, agents: 1, groups: 1, selectedLabel: '张三', dimmedCount: 2 });
  const iFocus = s2.indexOf('聚焦 平台');
  const iSel = s2.indexOf('已选中 张三');
  const iDim = s2.indexOf('点暗色部门可切过去');
  return iFocus >= 0 && iSel > iFocus && iDim > iSel && s2.endsWith('点节点可看是谁');
})());

// 复制反馈的无障碍标签(0.2.466):读屏要能听出「复制成功没有」。
ck('未复制时标签是「复制这个节点的标识」', (() => copyA11yLabel(false) === '复制这个节点的标识')());

ck('已复制时标签明确说已复制、并说明可再点一次', (() => {
  const t = copyA11yLabel(true);
  return t.includes('已复制') && t.includes('再点一次');
})());

// 刷新回执(0.2.469):数据没变时也要证明「刷过了」。
ck('刷新回执带三项规模', (() => refreshNotice({ people: 210, agents: 88, groups: 12 }) === '已更新：210 人 · 88 个 Agent · 12 个部门')());

ck('规模全 0 时只说「已更新」，不编数字', (() => refreshNotice({}) === '已更新' && refreshNotice({ people: 0, agents: 0, groups: 0 }) === '已更新')());

ck('部分规模缺失按 0 处理但仍给出完整句式', (() => refreshNotice({ people: 5 }) === '已更新：5 人 · 0 个 Agent · 0 个部门')());

console.log(`legion-focus: ${pass} passed`);
if (pass !== names.length) process.exit(1);
