// 3D 军团「图元层」的断言(2026-11-05)。
// 三端渲染器(桌面 WebView canvas / 手机 WebView 或 Skia)都吃同一份 SceneCommand,
// 所以这张表的语义一旦错了,三端一起错 —— 这正是要在这里钉住的原因。
import { buildLegionLayout, type LegionInput } from './legion/legion-layout';
import { buildLegionScene, sceneCounts, wantsLabel, RING_SEGMENTS, LABEL_BUDGET } from './legion3d-scene';

let pass = 0;
const total: string[] = [];
function ck(name: string, ok: boolean) {
  total.push(name);
  if (ok) { pass += 1; return; }
  console.log(`FAIL: ${name}`);
}

const cam = { yaw: 0.6, pitch: 0.45, dist: 6, focal: 700, cx: 400, cy: 300 };
const size = { width: 800, height: 600 };

const person = (id: string, name: string, dept: string, agents: string[] = []) => ({
  user_id: id,
  username: id,
  display_name: name,
  role: 'member',
  department: { id: `d-${dept}`, name: dept },
  agents: agents.map((a) => ({ node_id: a, alias: a })),
});

const input: LegionInput = {
  people: [person('u1', 'Vincent', '平台', ['n_alpha']), person('u2', '小明', '前端'), person('u3', '小红', '前端')],
  departments: [],
} as unknown as LegionInput;

const layout = buildLegionLayout(input);
const commands = buildLegionScene(layout, cam, size);
const counts = sceneCounts(commands);

ck('三种图元都产出（环 / 体 / 标签）',
  counts.rings > 0 && counts.bodies === layout.nodes.length && counts.labels > 0);

ck('每层环都是一条闭合路径（点数 = 段数+1，首尾重合）', (() => {
  const rings = commands.filter((c) => c.kind === 'ring');
  return rings.every((r) => {
    const pts = (r as { points: Array<{ x: number; y: number }> }).points;
    if (pts.length !== RING_SEGMENTS + 1) return false;
    const a = pts[0];
    const b = pts[pts.length - 1];
    return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  });
})());

ck('体按深度从远到近排列（远的先画，近的盖住远的）', (() => {
  const bodies = commands.filter((c) => c.kind === 'body') as Array<{ depth: number }>;
  return bodies.every((b, i) => i === 0 || bodies[i - 1].depth >= b.depth);
})());

ck('环画在体之前（不会被节点压在下面看不见）', (() => {
  const firstBody = commands.findIndex((c) => c.kind === 'body');
  const lastRing = commands.map((c) => c.kind).lastIndexOf('ring');
  return lastRing < 0 || firstBody > lastRing;
})());

ck('标签在体之后，且不超出预算', (() => {
  const labels = commands.filter((c) => c.kind === 'label') as Array<{ depth: number }>;
  const lastBody = commands.map((c) => c.kind).lastIndexOf('body');
  const firstLabel = commands.findIndex((c) => c.kind === 'label');
  return labels.length <= LABEL_BUDGET && (firstLabel === -1 || firstLabel > lastBody);
})());

ck('标签跟随体的位置（贴在体下方，不飘到别处）', (() => {
  const bodies = new Map<string, { x: number; y: number; ry: number }>();
  for (const c of commands) if (c.kind === 'body') bodies.set(c.id, c as never);
  const labels = commands.filter((c) => c.kind === 'label') as Array<{ id: string; x: number; y: number }>;
  return labels.every((l) => {
    const b = bodies.get(l.id);
    return !!b && Math.abs(l.x - b.x) < 1e-9 && l.y > b.y;
  });
})());

ck('部门盘比圆更扁（rx > ry），节点不是正圆', (() => {
  const groupBodies = (commands.filter((c) => c.kind === 'body') as Array<{ nodeKind: string; rx: number; ry: number }>)
    .filter((b) => b.nodeKind === 'group');
  return groupBodies.length > 0 && groupBodies.every((b) => b.rx > b.ry);
})());

ck('空布局不炸：只有环，没有体/标签', (() => {
  const empty = buildLegionScene(
    { nodes: [], edges: [], stats: { groups: 0, people: 0, agents: 0, orphans: 0, depth: 0, collapsed: 0 }, rings: [{ ring: 1, radius: 0.5 }, { ring: 2, radius: 0.84 }, { ring: 3, radius: 1 }] },
    cam,
    size,
  );
  const c = sceneCounts(empty);
  return c.bodies === 0 && c.labels === 0 && c.rings === 3;
})());

ck('折叠的部门会被标记为减淡（渲染端据此变暗）', (() => {
  const target = layout.nodes.find((n) => n.kind === 'group');
  if (!target) return false;
  const folded = buildLegionScene(layout, cam, size, { dimmedIds: new Set([target.id]) });
  const body = folded.find((c) => c.kind === 'body' && c.id === target.id) as { dimmed: boolean } | undefined;
  return !!body && body.dimmed === true;
})());

ck('Agent 标签只在靠近相机时出现（数量最多，不能全画）',
  wantsLabel({ kind: 'agent' }, 1.0) === false && wantsLabel({ kind: 'agent' }, 1.2) === true
  && wantsLabel({ kind: 'person' }, 0.8) === true);

ck('命令数有上界（200 节点不至于每帧画上万条）', (() => {
  const big: LegionInput = {
    people: Array.from({ length: 60 }, (_, i) => person(`u${i}`, `人${i}`, `部门${i % 12}`, [`n${i}`])),
    departments: [],
  } as unknown as LegionInput;
  const bigLayout = buildLegionLayout(big);
  const scene = buildLegionScene(bigLayout, cam, size);
  const c = sceneCounts(scene);
  // 体数 = 布局节点数(圆心 + 12 部门 + 60 人 + 60 Agent = 133),标签受预算约束
  return c.bodies === bigLayout.nodes.length && bigLayout.nodes.length === 133
    && c.labels <= LABEL_BUDGET && c.rings === 3;
})());

console.log(`legion 3d scene: ${pass}/${total.length} checks passed`);
if (pass !== total.length) process.exit(1);
