import assert from 'node:assert/strict';
import { buildClusters, buildEdges, bucketOf, CORE, deptHue, hueTable, packClusters, UNASSIGNED, type LiveAgent, type LiveDept } from './live-org-model';

const depts: LiveDept[] = [
  { id: 'tmai', name: 'TMAI', parent_id: null, sort: 0 },
  { id: 'tmwork', name: 'TMWork', parent_id: 'tmai', sort: 0 },
  { id: 'anet', name: 'ANet', parent_id: null, sort: 1 },
];
const byId = new Map(depts.map(d => [d.id, d]));
const agents: LiveAgent[] = [
  { alias: 'a1', departmentId: 'tmwork', online: true },
  { alias: 'a2', departmentId: 'tmai', online: false },
  { alias: 'b1', departmentId: 'anet', online: true },
  { alias: 'u1', departmentId: null, online: true },
];

// 色相：190 → 275，按 sort/id 稳定
assert.equal(deptHue(0, 1), 190);
assert.equal(deptHue(0, 8), 190); assert.equal(deptHue(7, 8), 275);
assert.deepEqual([...hueTable(depts).values()].length, 3);

// 归桶：顶层视图里子部门的人归到顶层部门；钻进 tmai 后，tmai 直属的人进 direct 桶，别的部门不在图上
assert.equal(bucketOf('tmwork', null, byId), 'tmai');
assert.equal(bucketOf(null, null, byId), UNASSIGNED);
assert.equal(bucketOf('tmwork', 'tmai', byId), 'tmwork');
assert.equal(bucketOf('tmai', 'tmai', byId), 'tmai::direct');
assert.equal(bucketOf('anet', 'tmai', byId), null);
assert.equal(bucketOf(null, 'tmai', byId), null);

// 摆放：不重叠、都在画布里
const pos = packClusters([{ id: 'a', r: 60 }, { id: 'b', r: 40 }, { id: 'c', r: 30 }, { id: 'd', r: 30 }], 900, 600);
const ps = [...pos.values()];
for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) >= ps[i].r + ps[j].r - 0.5, 'clusters overlap');
for (const p of ps) assert.ok(p.x - p.r >= 0 && p.x + p.r <= 900 && p.y - p.r >= 0 && p.y + p.r <= 600, 'cluster outside canvas');

const top = buildClusters(depts, agents, null, 900, 600, { unassigned: '未归属', direct: '直属' });
assert.deepEqual(top.map(c => c.id).sort(), ['anet', 'tmai', UNASSIGNED].sort());
assert.equal(top.find(c => c.id === 'tmai')!.agents.length, 2);
assert.equal(top.find(c => c.id === 'tmai')!.online, 1);
assert.equal(top.find(c => c.id === 'tmai')!.hasChildren, true);
assert.equal(top.find(c => c.id === UNASSIGNED)!.hue, -1);
const drill = buildClusters(depts, agents, 'tmai', 900, 600, { unassigned: '未归属', direct: '直属' });
assert.deepEqual(drill.map(c => c.id).sort(), ['tmai::direct', 'tmwork'].sort());
assert.equal(drill.find(c => c.id === 'tmai::direct')!.name, 'TMAI · 直属');

// 边：按 created_at 落窗；scheduler / 不在图上 → CORE；自环不画但计入总数；to 不在图上丢弃；同一对累加
const now = Date.parse('2026-11-19T12:10:00Z');
const t = (from: string, to: string, min: number) => ({ from_name: from, to_name: to, created_at: new Date(now - min * 60000).toISOString() });
const e = buildEdges([t('a1', 'b1', 1), t('a1', 'b1', 2), t('scheduler', 'a1', 3), t('a1', 'a2', 4), t('a1', 'ghost', 5), t('b1', 'a1', 30)], top, now, 10 * 60000, 200);
assert.deepEqual(e.edges, [{ from: 'tmai', to: 'anet', count: 2 }, { from: CORE, to: 'tmai', count: 1 }]);
assert.equal(e.total, 4);
assert.equal(e.truncated, false);
// 取满 limit 且最老一条仍在窗内 → 可能不全（≥N）
assert.equal(buildEdges([t('a1', 'b1', 1), t('a1', 'b1', 2)], top, now, 10 * 60000, 2).truncated, true);
console.log('live-org-model: ok');

{
  const { corePosition, edgeEnds } = await import('./live-org-model');
  const cs = [{ x: 450, y: 300, r: 120 }, { x: 150, y: 300, r: 60 }];
  const c = corePosition(cs, 900, 600);
  for (const k of cs) assert.ok(Math.hypot(k.x - c.x, k.y - c.y) >= k.r + 28 - 0.5, 'core overlaps a cluster');
  const e = edgeEnds({ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 20 });
  assert.equal(e.x1, 13); assert.equal(e.x2, 77);
  console.log('live-org-model edges: ok');
}
