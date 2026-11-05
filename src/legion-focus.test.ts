// 「只看某个部门」的断言(2026-11-05)。
// 过滤是集合运算,错了的表现是「人数不对但图还是画出来了」—— 所以钉住:范围、边、圆心、不猜。
import { buildLegionLayout } from './legion/legion-layout';
import { focusLayout, focusLabel, focusStats, focusTrail, subtreeIds } from './legion/legion-focus';
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

console.log(`legion-focus: ${pass} passed`);
if (pass !== names.length) process.exit(1);
