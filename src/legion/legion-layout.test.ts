import { describe, expect, test, finish } from './test-shim';
import { buildLegionLayout, toPixel, RING_RADIUS, ORPHAN_GROUP, UNGROUPED, UNKNOWN_DEPT, nearestDept, tourOrder } from './legion-layout';

const person = (over = {}) => ({
  user_id: 'u1', username: 'vansin', display_name: 'Vincent', role: 'owner',
  department: { id: 'd1', name: '平台' }, agents: [], ...over,
});

const agent = (i) => ({ node_id: `n_${i}`, alias: `agent-${i}` });

function angleDelta(a, b) {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}

describe('#1636 军团布局 — 纯函数，同一份数据必须永远画出同一张图', () => {
  test('空输入：只有圆心，统计全 0，不出 NaN', () => {
    const layout = buildLegionLayout({ people: [] });
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].kind).toBe('core');
    expect(layout.stats).toEqual({ groups: 0, people: 0, agents: 0, orphans: 0, depth: 1, collapsed: 0 });
    expect(Number.isFinite(layout.nodes[0].x)).toBe(true);
  });

  test('三层环半径固定：部门 < 人 < Agent', () => {
    expect(RING_RADIUS.group).toBeLessThan(RING_RADIUS.person);
    expect(RING_RADIUS.person).toBeLessThan(RING_RADIUS.agent);
    expect(RING_RADIUS.agent).toBe(1);
  });

  test('分组顺序固定：命名部门 → 未分组 → 无主 Agent，与输入顺序无关', () => {
    const a = buildLegionLayout({
      people: [
        person({ user_id: 'u1', display_name: 'B', department: { id: 'd2', name: '平台' } }),
        person({ user_id: 'u2', display_name: 'A', department: { id: 'd1', name: '客户端' } }),
        person({ user_id: 'u3', display_name: 'C', department: null }),
      ],
      orphans: [agent(9)],
    });
    const b = buildLegionLayout({
      people: [
        person({ user_id: 'u3', display_name: 'C', department: null }),
        person({ user_id: 'u1', display_name: 'B', department: { id: 'd2', name: '平台' } }),
        person({ user_id: 'u2', display_name: 'A', department: { id: 'd1', name: '客户端' } }),
      ],
      orphans: [agent(9)],
    });
    const groups = a.nodes.filter(n => n.kind === 'group').map(n => n.label);
    expect(groups[groups.length - 2]).toBe(UNGROUPED);
    expect(groups[groups.length - 1]).toBe(ORPHAN_GROUP);
    // 同一份数据、不同输入顺序 → 坐标逐点一致
    expect(b.nodes.map(n => [n.id, n.x.toFixed(6), n.y.toFixed(6)]))
      .toEqual(a.nodes.map(n => [n.id, n.x.toFixed(6), n.y.toFixed(6)]));
  });

  test('每个人挂在自己的部门下，Agent 挂在自己的 owner 下', () => {
    const layout = buildLegionLayout({
      people: [person({ agents: [agent(1), agent(2)] })],
    });
    const group = layout.nodes.find(n => n.kind === 'group');
    const owner = layout.nodes.find(n => n.kind === 'person');
    const agents = layout.nodes.filter(n => n.kind === 'agent');
    expect(owner.parentId).toBe(group.id);
    expect(agents).toHaveLength(2);
    for (const a of agents) expect(a.parentId).toBe(owner.id);
    expect(group.agentCount).toBe(2);
    expect(layout.stats).toEqual({ groups: 1, people: 1, agents: 2, orphans: 0, depth: 1, collapsed: 0 });
  });

  // 2026-10-27（admin 第二轮反馈「半边糊、半边空」）：Agent 不再挤在 owner 的小扇形里，
  // 而是**按 owner 方位排序后均分整圈**。契约：
  //   1) 同一 owner 的 Agent 连续；2) 相邻间隔 ≈ 2π/n；3) 半径交错。
  test('Agent 环按成员方位均分整圈（同一 owner 连续）', () => {
    const people = [
      person({ user_id: 'u1', agents: Array.from({ length: 8 }, (_, i) => agent(i)) }),
      person({ user_id: 'u2', agents: Array.from({ length: 4 }, (_, i) => agent(100 + i)) }),
    ];
    const layout = buildLegionLayout({ people });
    const agents = layout.nodes.filter(n => n.kind === 'agent');
    expect(agents).toHaveLength(12);
    const owners = agents.map(a => a.parentId);
    for (const owner of new Set(owners)) {
      const idx = owners.map((o, i) => (o === owner ? i : -1)).filter(i => i >= 0);
      expect(Math.max(...idx) - Math.min(...idx) + 1).toBe(idx.length);
    }
    const step = (Math.PI * 2) / agents.length;
    for (let i = 1; i < agents.length; i++) {
      expect(Math.abs(angleDelta(agents[i].angle, agents[i - 1].angle) - step)).toBeLessThan(0.02);
    }
    for (let i = 1; i < agents.length; i++) {
      expect(agents[i].radius).not.toBe(agents[i - 1].radius);
    }
  });

  test('节点 id 唯一，角标归一化到 [0, 2π)', () => {
    const layout = buildLegionLayout({
      people: [
        person({ user_id: 'u1', agents: [agent(1), agent(2), agent(3)] }),
        person({ user_id: 'u2', username: 'tmai', display_name: 'TMAI', department: { id: 'd2', name: '文档' }, agents: [agent(4)] }),
        person({ user_id: 'u3', department: null }),
      ],
      orphans: [agent(5)],
    });
    const ids = layout.nodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of layout.nodes) {
      expect(n.angle).toBeGreaterThanOrEqual(0);
      expect(n.angle).toBeLessThan(Math.PI * 2);
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
  });

  test('每条边都指向真实节点，且没有孤立节点', () => {
    const layout = buildLegionLayout({ people: [person({ agents: [agent(1)] })], orphans: [agent(7)] });
    const ids = new Set(layout.nodes.map(n => n.id));
    for (const e of layout.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
    for (const n of layout.nodes.filter(n => n.kind !== 'core')) {
      expect(layout.edges.some(e => e.to === n.id)).toBe(true);
    }
  });

  test('部门扇区：总弧度 2π、互不重叠、中心角与起点自洽', () => {
    const layout = buildLegionLayout({
      people: [
        person({ user_id: 'u1', department: { id: 'd1', name: '平台' }, agents: [agent(1), agent(2)] }),
        person({ user_id: 'u2', display_name: 'A', department: { id: 'd1', name: '平台' } }),
        person({ user_id: 'u3', display_name: 'B', department: { id: 'd2', name: '设计' } }),
        person({ user_id: 'u4', display_name: 'C', department: null }),
      ],
      orphans: [agent(8)],
    });
    const groups = layout.nodes.filter(n => n.kind === 'group');
    expect(groups.length).toBe(4);
    const total = groups.reduce((n, g) => n + g.span, 0);
    expect(total).toBeCloseTo(Math.PI * 2, 6);
    for (const g of groups) {
      expect(g.spanStart).toBeGreaterThanOrEqual(0);
      expect(g.spanStart).toBeLessThan(Math.PI * 2);
      // 中心角 = 起点 + 半跨度（模 2π）
      expect(angleDelta(g.angle, g.spanStart + g.span / 2)).toBeLessThan(1e-6);
      expect(g.spanStart + g.span).toBeLessThanOrEqual(Math.PI * 2 + 1e-9);
    }
    const sorted = [...groups].sort((a, b) => a.spanStart - b.spanStart);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].spanStart + sorted[i - 1].span).toBeLessThanOrEqual(sorted[i].spanStart + 1e-9);
    }
  });

  test('真实部门树：子部门更靠外、角度落在父扇区内、人挂到最深层部门', () => {
    const departments = [
      { id: 'd1', name: '平台', parent_id: null, sort: 1 },
      { id: 'd11', name: '前端', parent_id: 'd1', sort: 1 },
      { id: 'd12', name: '后端', parent_id: 'd1', sort: 2 },
      { id: 'd2', name: '文档', parent_id: null, sort: 2 },
    ];
    const people = [
      person({ user_id: 'u1', display_name: 'A', department: { id: 'd11', name: '前端' }, agents: [agent(1)] }),
      person({ user_id: 'u2', display_name: 'B', department: { id: 'd12', name: '后端' } }),
      person({ user_id: 'u3', display_name: 'C', department: { id: 'd2', name: '文档' } }),
    ];
    const layout = buildLegionLayout({ people, departments });
    const dept = (id) => layout.nodes.find(n => n.id === `dept:${id}`);
    expect(layout.stats.depth).toBe(2);
    expect(layout.stats.groups).toBe(4);

    // 半径随深度递增，人比最深的部门更外，Agent 最外
    expect(dept('d11').radius).toBeGreaterThan(dept('d1').radius);
    expect(dept('d12').radius).toBeGreaterThan(dept('d1').radius);
    expect(layout.nodes.find(n => n.id === 'person:u1').radius).toBeGreaterThan(dept('d11').radius);

    // 子部门角度落在父部门扇区内
    const rel = (a, start) => (((a - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    for (const [parent, child] of [['d1', 'd11'], ['d1', 'd12']]) {
      expect(rel(dept(child).angle, dept(parent).spanStart)).toBeLessThanOrEqual(dept(parent).span + 1e-9);
    }
    // 根层扇区铺满 2π
    const roots = [dept('d1'), dept('d2')];
    expect(roots.reduce((n, d) => n + d.span, 0)).toBeCloseTo(Math.PI * 2, 6);

    // 人挂到自己的部门，不是顶层
    expect(layout.nodes.find(n => n.id === 'person:u1').parentId).toBe('dept:d11');
    expect(layout.nodes.find(n => n.id === 'person:u3').parentId).toBe('dept:d2');
    // 部门成员数按子树累计
    expect(dept('d1').memberCount).toBe(2);
    expect(dept('d1').agentCount).toBe(1);
  });

  test('成员表覆盖 person.department（调动后以 Hub 落位为准）', () => {
    const departments = [
      { id: 'd1', name: '平台', parent_id: null },
      { id: 'd2', name: '文档', parent_id: null },
    ];
    const layout = buildLegionLayout({
      people: [person({ user_id: 'u1', department: { id: 'd1', name: '平台' } })],
      departments,
      members: [{ user_id: 'u1', department_id: 'd2' }],
    });
    expect(layout.nodes.find(n => n.id === 'person:u1').parentId).toBe('dept:d2');
  });

  test('脏数据不丢人：部门不存在 / 父部门缺失时落到未分组或顶层', () => {
    const departments = [{ id: 'd1', name: '平台', parent_id: 'missing-parent' }];
    const layout = buildLegionLayout({
      people: [
        person({ user_id: 'u1', department: { id: 'ghost', name: '幽灵部门' } }),
        person({ user_id: 'u2', department: { id: 'd1', name: '平台' } }),
      ],
      departments,
    });
    const people = layout.nodes.filter(n => n.kind === 'person');
    expect(people).toHaveLength(2);
    // 找不到部门的人进「未分组」，父部门缺失的部门当顶层
    expect(layout.nodes.find(n => n.id === 'person:u1').parentId).toBe('dept:none');
    expect(layout.nodes.find(n => n.id === 'person:u2').parentId).toBe('dept:d1');
    expect(layout.nodes.find(n => n.id === 'dept:d1').parentId).toBe('core');
  });

  test('toPixel 把归一化坐标映射到容器中心与半径内', () => {
    const size = { width: 800, height: 600 };
    const center = toPixel({ x: 0, y: 0 }, size);
    expect(center).toEqual({ x: 400, y: 300 });
    const top = toPixel({ x: 0, y: -1 }, size);
    expect(top.y).toBeLessThan(300);
    expect(top.x).toBeCloseTo(400, 5);
    const right = toPixel({ x: 1, y: 0 }, size);
    // 半径取 min(w,h)/2 * 0.92 = 276
    expect(right.x).toBeCloseTo(676, 5);
  });
});

describe('#1636 军团折叠 — 折叠只影响可见节点，不改变统计口径', () => {
  // 平台（1 人 + 2 Agent，下挂前端 1 人） / 运营（1 人）
  const depts = [
    { id: 'd1', name: '平台', parent_id: null, sort: 0 },
    { id: 'd2', name: '前端', parent_id: 'd1', sort: 0 },
    { id: 'd3', name: '运营', parent_id: null, sort: 1 },
    { id: 'd4', name: '空部门', parent_id: null, sort: 2 },
  ];
  const people = [
    person({ user_id: 'u1', username: 'vansin', display_name: 'Vincent', department: { id: 'd1', name: '平台' }, agents: [agent(1), agent(2)] }),
    person({ user_id: 'u2', username: 'lin', display_name: '林亦', department: { id: 'd2', name: '前端' }, agents: [] }),
    person({ user_id: 'u3', username: 'meng', display_name: '孟然', department: { id: 'd3', name: '运营' }, agents: [] }),
  ];
  const input = { people, departments: depts };

  test('折叠父部门：子部门与成员/Agent 全部不出现，隐藏数如实记录', () => {
    const full = buildLegionLayout(input);
    const folded = buildLegionLayout({ ...input, collapsed: ['dept:d1'] });
    const target = folded.nodes.find(n => n.id === 'dept:d1');

    expect(target.collapsed).toBe(true);
    expect(target.hiddenMembers).toBe(2);   // 自己 + 前端
    expect(target.hiddenAgents).toBe(2);
    expect(folded.nodes.find(n => n.id === 'dept:d2')).toBeUndefined();
    expect(folded.nodes.find(n => n.id === 'person:u2')).toBeUndefined();
    expect(folded.nodes.filter(n => n.kind === 'agent')).toHaveLength(0);
    // 统计仍是全量口径：折叠不该把「军团有多少人」算错
    expect(folded.stats.people).toBe(full.stats.people);
    expect(folded.stats.agents).toBe(full.stats.agents);
    expect(folded.stats.collapsed).toBe(1);
    // 同级兄弟照常画
    expect(folded.nodes.find(n => n.id === 'dept:d3')).toBeTruthy();
  });

  test('折叠把角度让给同级：兄弟扇区变大，且扇区总和仍是整圈', () => {
    const full = buildLegionLayout(input);
    const folded = buildLegionLayout({ ...input, collapsed: ['dept:d1'] });
    const ops = id => folded.nodes.find(n => n.id === `dept:${id}`);
    const opsFull = full.nodes.find(n => n.id === 'dept:d3');
    expect(ops('d3').span).toBeGreaterThan(opsFull.span);

    const groups = folded.nodes.filter(n => n.kind === 'group' && n.parentId === 'core');
    const total = groups.reduce((n, g) => n + (g.span ?? 0), 0);
    expect(total).toBeCloseTo(Math.PI * 2, 6);
  });

  test('折叠空部门是空操作（没有下级就没有可折叠的东西）', () => {
    const folded = buildLegionLayout({ ...input, collapsed: ['dept:d4'] });
    expect(folded.nodes.find(n => n.id === 'dept:d4')?.collapsed).toBeUndefined();
    expect(folded.stats.collapsed).toBe(0);
  });

  test('折叠顺序不影响结果：同一份输入两次构建完全相等', () => {
    const a = buildLegionLayout({ ...input, collapsed: ['dept:d1', 'dept:d3'] });
    const b = buildLegionLayout({ ...input, collapsed: ['dept:d3', 'dept:d1'] });
    expect(a.nodes.map(n => [n.id, n.angle, n.radius])).toEqual(b.nodes.map(n => [n.id, n.angle, n.radius]));
  });

  test('nearestDept：Agent/成员能找回真实部门；合成分组返回 null', () => {
    const layout = buildLegionLayout({
      people: [
        person({ user_id: 'u1', display_name: 'A', department: { id: 'd1', name: '平台' }, agents: [agent(1)] }),
        person({ user_id: 'u2', display_name: 'B', department: null, agents: [agent(2)] }),
      ],
      orphans: [{ node_id: 'n_99', alias: '野节点' }],
    });
    const dept = layout.nodes.find(n => n.kind === 'group' && n.label === '平台');
    const agentNode = layout.nodes.find(n => n.kind === 'agent' && n.label === 'agent-1');
    const ungroupedAgent = layout.nodes.find(n => n.kind === 'agent' && n.label === 'agent-2');
    const orphanAgent = layout.nodes.find(n => n.kind === 'agent' && n.label === '野节点');

    expect(nearestDept(agentNode.id, layout.nodes)?.id).toBe(dept.id);
    // 未分组 / 无主 Agent 是合成节点，不是部门
    expect(nearestDept(ungroupedAgent.id, layout.nodes)).toBeNull();
    expect(nearestDept(orphanAgent.id, layout.nodes)).toBeNull();
    expect(nearestDept('missing', layout.nodes)).toBeNull();
  });

  // 2026-10-30（通信设计师真实部门树下 4/6 失败复现）：无主 Agent 不是「老 Hub 才有」。
  // 真实部门树分支曾只放 people 就 return，2D/3D 直接漏画整类 Agent。
  test('真实部门树：无主 Agent 全部可见，自己的部门优先、未知部门单独成组', () => {
    const departments = [
      { id: 'd1', name: '平台', parent_id: null },
      { id: 'd2', name: '设计', parent_id: null },
    ];
    const layout = buildLegionLayout({
      people: [person({ user_id: 'u1', display_name: 'A', department: { id: 'd1', name: '平台' }, agents: [agent(1)] })],
      departments,
      orphans: [
        { node_id: 'n_none', alias: '无部门无主', department_id: null },
        { node_id: 'n_known', alias: '已知部门无主', department_id: 'd2' },
        { node_id: 'n_unknown', alias: '未知部门无主', department_id: 'd_gone' },
      ],
    });
    const groups = layout.nodes.filter(n => n.kind === 'group');
    const platform = groups.find(g => g.label === '平台');
    const design = groups.find(g => g.label === '设计');
    const orphanGroup = groups.find(g => g.label === ORPHAN_GROUP);
    const unknownGroup = groups.find(g => g.label.startsWith(UNKNOWN_DEPT));
    const byId = new Map(layout.nodes.map(n => [n.id, n]));

    expect(byId.get('agent:n_known')?.parentId).toBe(design.id);
    expect(byId.get('agent:n_none')?.parentId).toBe(orphanGroup.id);
    expect(byId.get('agent:n_unknown')?.parentId).toBe(unknownGroup.id);
    expect(unknownGroup.label).toContain('d_gone');
    // 计数与折叠角标按真实可见内容算，不能只算 people。
    expect(design.agentCount).toBe(1);
    expect(orphanGroup.agentCount).toBe(1);
    expect(unknownGroup.agentCount).toBe(1);
    expect(platform.agentCount).toBe(1);
    expect(layout.stats).toMatchObject({ people: 1, agents: 4, orphans: 3 });
    expect(nearestDept('agent:n_unknown', layout.nodes)).toBeNull();
    expect(nearestDept('agent:n_known', layout.nodes)?.id).toBe(design.id);
  });

  test('真实部门树：无主 Agent 折叠在部门里时计入隐藏角标，不另起孤立节点', () => {
    const layout = buildLegionLayout({
      people: [],
      departments: [{ id: 'd1', name: '平台', parent_id: null }],
      orphans: [{ node_id: 'n_1', alias: '被折叠的野生节点', department_id: 'd1' }],
      collapsed: ['dept:d1'],
    });
    const group = layout.nodes.find(n => n.id === 'dept:d1');
    expect(group.collapsed).toBe(true);
    expect(group.hiddenAgents).toBe(1);
    expect(layout.nodes.filter(n => n.kind === 'agent')).toHaveLength(0);
    expect(layout.stats.collapsed).toBe(1);
  });

  test('真实部门树：合成分组 id 不与真实部门 id 相撞', () => {
    const layout = buildLegionLayout({
      people: [person({ user_id: 'u1', display_name: 'A', department: { id: 'orphans', name: '真orphans' }, agents: [agent(1)] })],
      departments: [{ id: 'orphans', name: '真orphans', parent_id: null }],
      orphans: [{ node_id: 'n_x', alias: '无主X', department_id: null }],
    });
    const groups = layout.nodes.filter(n => n.kind === 'group');
    const ids = groups.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups.find(g => g.label === '真orphans')?.id).toBe('dept:orphans');
    const orphanGroup = groups.find(g => g.label === ORPHAN_GROUP);
    expect(orphanGroup.id).not.toBe('dept:orphans');
    expect(layout.nodes.find(n => n.id === 'agent:n_x')?.parentId).toBe(orphanGroup.id);
    expect(layout.nodes.find(n => n.id === 'agent:n_1')?.parentId).toBe('person:u1');
  });

  test('真实部门树：无主 Agent 的插入顺序不影响布局', () => {
    const base = {
      people: [],
      departments: [{ id: 'd1', name: '平台', parent_id: null }],
      orphans: [
        { node_id: 'n_a', alias: 'A', department_id: null },
        { node_id: 'n_b', alias: 'B', department_id: 'd1' },
      ],
    };
    const a = buildLegionLayout(base);
    const b = buildLegionLayout({ ...base, orphans: [...base.orphans].reverse() });
    expect(a.nodes.map(n => [n.id, n.x.toFixed(6), n.y.toFixed(6)]))
      .toEqual(b.nodes.map(n => [n.id, n.x.toFixed(6), n.y.toFixed(6)]));
  });

  test('圆心与导出统计把无主 Agent 算进 Agent 总数', () => {
    const layout = buildLegionLayout({
      people: [person({ agents: [agent(1)] })],
      departments: [{ id: 'd1', name: '平台', parent_id: null }],
      orphans: [{ node_id: 'n_2', alias: '野生', department_id: null }],
    });
    expect(layout.stats.agents).toBe(2);
    expect(layout.stats.orphans).toBe(1);
    expect(layout.nodes.find(n => n.id === 'core').agentCount).toBe(2);
  });

  test('真实部门恰好叫「未知部门」时不被当成合成分组', () => {
    const layout = buildLegionLayout({
      people: [person({ user_id: 'u1', department: { id: 'd1', name: '未知部门' }, agents: [agent(1)] })],
      departments: [{ id: 'd1', name: '未知部门', parent_id: null }],
    });
    const dept = layout.nodes.find(n => n.kind === 'group');
    expect(nearestDept('agent:n_1', layout.nodes)?.id).toBe(dept.id);
  });
});

describe('演示巡礼顺序', () => {
  test('先按楼层、再按方位角，非部门节点不参与', () => {
    const nodes = [
      { kind: 'group', id: 'b2', depth: 2, angle: 0.2 },
      { kind: 'person', id: 'p', depth: 1, angle: 0.1 },
      { kind: 'group', id: 'a1', depth: 1, angle: 1.5 },
      { kind: 'group', id: 'b1', depth: 2, angle: 0.1 },
      { kind: 'group', id: 'a2', depth: 1, angle: 0.4 },
    ];
    expect(tourOrder(nodes).map(n => n.id)).toEqual(['a2', 'a1', 'b1', 'b2']);
  });
});

finish('layout');
