import { describe, expect, test, finish } from './test-shim';
import {
  RING_HEIGHT,
  departmentDisc,
  fitProjectedBodies,
  fog,
  hitTest,
  jitterHeight,
  nodeToVec3,
  depthDrop,
  dropSag,
  DEPTH_STEP,
  DEPT_DISC_MIN_RX,
  DEPT_DISC_ASPECT,
  projectPoint,
  projectScene,
  ringPath,
} from './legion-3d';
import { buildLegionLayout, deptWorldRadius } from './legion-layout';

const SIZE = { width: 800, height: 600 };
const CAM = { yaw: 0, pitch: 0, dist: 4, focal: 600 };

describe('#3D 军团拓扑 — 投影/深度/命中必须可断言，不能靠截图判断', () => {
  test('原点永远落在画布中心（与 yaw/pitch 无关）', () => {
    for (const yaw of [0, 0.7, Math.PI, -2.1]) {
      for (const pitch of [0, 0.9, 1.4]) {
        const p = projectPoint({ x: 0, y: 0, z: 0 }, { ...CAM, yaw, pitch }, SIZE);
        expect(p).not.toBeNull();
        expect(p.x).toBeCloseTo(SIZE.width / 2, 6);
        expect(p.y).toBeCloseTo(SIZE.height / 2, 6);
        expect(p.depth).toBeCloseTo(CAM.dist, 6);
      }
    }
  });

  test('平视时水平方向不翻：+x 在右，+y 在上', () => {
    const right = projectPoint({ x: 1, y: 0, z: 0 }, CAM, SIZE);
    const up = projectPoint({ x: 0, y: 1, z: 0 }, CAM, SIZE);
    expect(right.x).toBeGreaterThan(SIZE.width / 2);
    expect(right.y).toBeCloseTo(SIZE.height / 2, 6);
    expect(up.y).toBeLessThan(SIZE.height / 2);
    expect(up.x).toBeCloseTo(SIZE.width / 2, 6);
  });

  test('yaw = 90° 把 +x 转到相机近侧（深度变小、屏幕居中）', () => {
    const a = projectPoint({ x: 1, y: 0, z: 0 }, CAM, SIZE);
    const b = projectPoint({ x: 1, y: 0, z: 0 }, { ...CAM, yaw: Math.PI / 2 }, SIZE);
    expect(b.depth).toBeCloseTo(a.depth - 1, 6);
    expect(b.x).toBeCloseTo(SIZE.width / 2, 6);
  });

  test('相机背后返回 null，不产出 NaN 坐标', () => {
    // 相机在 +z=4 处看向 -z：z=+10 已经跑到相机背后。
    const behind = projectPoint({ x: 0, y: 0, z: 10 }, CAM, SIZE);
    expect(behind).toBeNull();
    const scene = projectScene(
      [{ id: 'a', p: { x: 0, y: 0, z: 0 } }, { id: 'b', p: { x: 0, y: 0, z: 99 } }],
      n => n.p,
      CAM,
      SIZE,
    );
    expect(scene).toHaveLength(1);
    for (const n of scene) {
      expect(Number.isFinite(n.projected.x)).toBe(true);
      expect(Number.isFinite(n.projected.y)).toBe(true);
    }
  });

  test('整场景按远→近排序：先画远的，近的才能盖在上面', () => {
    const items = [
      { id: 'near', p: { x: 0, y: 0, z: 2 } },
      { id: 'far', p: { x: 0, y: 0, z: -2 } },
      { id: 'mid', p: { x: 0, y: 0, z: 0 } },
    ];
    const scene = projectScene(items, n => n.p, CAM, SIZE);
    expect(scene.map(s => s.item.id)).toEqual(['far', 'mid', 'near']);
    for (let i = 1; i < scene.length; i++) {
      expect(scene[i].projected.depth).toBeLessThanOrEqual(scene[i - 1].projected.depth);
    }
  });

  test('命中测试取离相机最近的一个（重叠时选前面的，不是数组第一个）', () => {
    const items = [
      { id: 'near', p: { x: 0, y: 0, z: 2 } },
      { id: 'far', p: { x: 0, y: 0, z: -2 } },
    ];
    const scene = projectScene(items, n => n.p, CAM, SIZE);
    const hit = hitTest(scene, SIZE.width / 2 + 1, SIZE.height / 2 + 1, 8);
    expect(hit?.item.id).toBe('near');
    expect(hitTest(scene, 5, 5, 8)).toBeNull();
  });

  test('层级高度：圆心最高，Agent 最低（视觉上是一叠轨道，不是平饼）', () => {
    expect(RING_HEIGHT[0]).toBe(0);
    expect(RING_HEIGHT[1]).toBeLessThan(RING_HEIGHT[0]);
    expect(RING_HEIGHT[2]).toBeLessThan(RING_HEIGHT[1]);
    expect(RING_HEIGHT[3]).toBeLessThan(RING_HEIGHT[2]);
    const core = nodeToVec3({ x: 0, y: 0, ring: 0, order: 0 });
    const agent = nodeToVec3({ x: 1, y: 0, ring: 3, order: 7 });
    // 子部门按层级下沉：一级部门不降、二级降一级、更深的最多降两级。
    expect(depthDrop('group', 1)).toBe(0);
    expect(depthDrop('group', 2)).toBe(-DEPTH_STEP);
    expect(depthDrop('group', 5)).toBe(-2 * DEPTH_STEP);
    expect(depthDrop('person', 3)).toBe(0);
    const parent = nodeToVec3({ x: 1, y: 0, ring: 1, order: 1, kind: 'group', depth: 1 });
    const child = nodeToVec3({ x: 1, y: 0, ring: 1, order: 2, kind: 'group', depth: 2 });
    expect(child.y - parent.y).toBeLessThan(-0.3);
    // 父子部门的连线要垂一层；同级或非部门之间不垂。
    expect(dropSag(1, 1, 120)).toBe(0);
    expect(dropSag(undefined, 2, 120)).toBe(0);
    expect(dropSag(1, 2, 0)).toBe(10);
    expect(dropSag(1, 2, 40)).toBeGreaterThan(10);
    expect(dropSag(1, 4, 400)).toBe(30);
    expect(core.y).toBeGreaterThan(agent.y);
  });

  test('高度抖动是确定性的：同一 order 恒定，不同 order 不同', () => {
    expect(jitterHeight(3, 2)).toBe(jitterHeight(3, 2));
    expect(jitterHeight(3, 2)).not.toBe(jitterHeight(4, 2));
    expect(Math.abs(jitterHeight(9, 1))).toBeLessThan(0.05);
    expect(jitterHeight(9, 0)).toBe(0);
  });

  test('深度雾化被夹在 [0,1]，far<=near 时退化为 0 而不是 NaN', () => {
    expect(fog(2, 2, 6)).toBe(0);
    expect(fog(4, 2, 6)).toBeCloseTo(0.5, 6);
    expect(fog(99, 2, 6)).toBe(1);
    expect(fog(1, 6, 2)).toBe(0);
  });

  test('轨道环采样点数固定，且每点都在画布附近（不飞出视图）', () => {
    const pts = ringPath(1, -0.3, { ...CAM, pitch: 0.9 }, SIZE, 48);
    expect(pts.length).toBe(49);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Math.abs(p.x - SIZE.width / 2)).toBeLessThan(SIZE.width);
    }
  });

  test('单成员自动取景将完整中枢与头像留在工具栏和图例之间，桌面与手机均成立', () => {
    const layout = buildLegionLayout({ people: [{ user_id: 'sparse', username: 'sparse', display_name: 'Sparse',
      role: 'owner', department: null, agents: [] }] });
    const radius = (n) => (n.item.kind === 'group' ? deptWorldRadius(n.item.depth ?? 1)
      : n.item.kind === 'core' ? 0.085 : 0.033) * n.projected.scale;
    for (const size of [{ width: 1232, height: 870 }, { width: 390, height: 720 }]) {
      const bounds = { x1: 24, x2: size.width - 24, y1: size.width < 640 ? 208 : 116, y2: size.height - 96 };
      for (const yaw of [0.62, 1.8, 3.1]) {
        for (const pan of [0, 175]) {
          const view = { zoom: 1.12, panX: pan, panY: -pan };
          const camera = v => ({ yaw, pitch: 0.52, dist: 6,
            focal: Math.min(size.width, size.height) * (size.width < 640 ? 2.4 : 1.73) * v.zoom,
            cx: size.width / 2 + v.panX, cy: size.height / 2 + v.panY });
          const nodes = projectScene(layout.nodes, n => nodeToVec3(n), camera(view), size);
          const bodies = nodes.map(n => ({ ...n.projected, radius: radius(n) + 4 }));
          for (const ring of layout.rings) {
            bodies.push(...ringPath(ring.radius, RING_HEIGHT[ring.ring], camera(view), size, 64)
              .map(p => ({ ...p, radius: 4 })));
          }
          const fit = fitProjectedBodies(bodies,
            view, size, bounds, { min: 0.25, max: 8 });
          expect(fit).not.toBeNull();
          const framed = projectScene(layout.nodes, n => nodeToVec3(n), camera(fit), size);
          for (const n of framed) {
            expect(n.projected.x - radius(n)).toBeGreaterThanOrEqual(bounds.x1);
            expect(n.projected.x + radius(n)).toBeLessThanOrEqual(bounds.x2);
            expect(n.projected.y - radius(n)).toBeGreaterThanOrEqual(bounds.y1);
            expect(n.projected.y + radius(n)).toBeLessThanOrEqual(bounds.y2);
          }
          for (const ring of layout.rings) {
            for (const p of ringPath(ring.radius, RING_HEIGHT[ring.ring], camera(fit), size, 64)) {
              expect(p.x).toBeGreaterThanOrEqual(bounds.x1);
              expect(p.x).toBeLessThanOrEqual(bounds.x2);
              expect(p.y).toBeGreaterThanOrEqual(bounds.y1);
              expect(p.y).toBeLessThanOrEqual(bounds.y2);
            }
          }
        }
      }
    }
  });

  test('取景跳过空场景/控件占满画布，且遵守缩放上限', () => {
    const view = { zoom: 1, panX: 0, panY: 0 };
    const bounds = { x1: 24, y1: 100, x2: 776, y2: 520 };
    const limits = { min: 0.25, max: 8 };
    expect(fitProjectedBodies([], view, SIZE, bounds, limits)).toBeNull();
    const body = [{ x: 400, y: 300, radius: 1 }];
    expect(fitProjectedBodies(body, view, SIZE, { ...bounds, y1: 520 }, limits)).toBeNull();
    expect(fitProjectedBodies(body, view, SIZE, bounds, limits).zoom).toBe(8);
  });

  test('部门盘双轴命中保留近景优先与容差，不把盘上下空白当成大圆', () => {
    const scene = projectScene([{ id: 'near', z: 1 }, { id: 'far', z: -1 }], n => ({ x: 0, y: 0, z: n.z }), CAM, SIZE);
    const shape = () => { const { rx, ry } = departmentDisc(20); return { rx: rx + 6, ry: ry + 6 }; };
    expect(hitTest(scene, 441, 300, 18, shape)?.item.id).toBe('near');
    expect(hitTest(scene, 400, 330, 18, shape)).toBeNull();
    expect(hitTest(scene, 447, 300, 18, shape)?.item.id).toBe('near');
    expect(hitTest(scene, 449, 300, 18, shape)).toBeNull();
    expect(hitTest(scene, 400, 317, 18, () => departmentDisc(1))?.item.id).toBe('near');
    expect(hitTest(scene, 400, 319, 18, () => departmentDisc(1))).toBeNull();
  });

  test('最终zoom重投影保持16px盘下限、双轴描边及完整轨道，并移除旧pan', () => {
    const layout = buildLegionLayout({ people: [{ user_id: 'p', username: 'p', display_name: 'Person', role: 'owner',
      department: { id: 'deep', name: 'Deep' }, agents: [{ node_id: 'a', alias: 'Agent' }] }],
      departments: [{ id: 'root', name: 'Root' }, { id: 'deep', name: 'Deep', parent_id: 'root' }, { id: 'empty', name: 'Empty' }] });
    for (const size of [{ width: 1232, height: 870 }, { width: 390, height: 520 }]) {
      const bounds = { x1: 24, y1: 170, x2: size.width - 24, y2: size.height - 110 };
      for (const yaw of [0.62, 2.1]) for (const pitch of [0.12, 0.52, 1.4]) for (const zoom of [0.25, 8]) {
        const view = { zoom, panX: 173, panY: -92 };
        const bodiesAt = v => {
          const camera = { yaw, pitch, dist: 6, focal: Math.min(size.width, size.height) * 2.4 * v.zoom,
            cx: size.width / 2 + v.panX, cy: size.height / 2 + v.panY };
          const bodies = projectScene(layout.nodes, nodeToVec3, camera, size).map(sn => {
            const radius = Math.max(1.4, (sn.item.kind === 'group' ? deptWorldRadius(sn.item.depth ?? 1)
              : sn.item.kind === 'core' ? 0.085 : sn.item.kind === 'person' ? 0.033 : 0.021) * sn.projected.scale);
            const axes = sn.item.kind === 'group' ? departmentDisc(radius) : { rx: radius, ry: radius };
            if (sn.item.kind === 'group') { expect(axes.rx).toBeGreaterThanOrEqual(DEPT_DISC_MIN_RX); expect(axes.ry).toBeCloseTo(axes.rx * DEPT_DISC_ASPECT); }
            return { x: sn.projected.x, y: sn.projected.y, rx: axes.rx + 6, ry: axes.ry + 6 };
          });
          for (const ring of layout.rings) bodies.push(...ringPath(ring.radius, RING_HEIGHT[ring.ring], camera, size, 64)
            .map(p => ({ ...p, rx: 4, ry: 4 })));
          return bodies;
        };
        const fit = fitProjectedBodies(z => bodiesAt({ ...view, zoom: z }), view, size, bounds, { min: 0.25, max: 8 });
        expect(fit).not.toBeNull();
        for (const b of bodiesAt(fit)) {
          expect(b.x - b.rx).toBeGreaterThanOrEqual(bounds.x1);
          expect(b.x + b.rx).toBeLessThanOrEqual(bounds.x2);
          expect(b.y - b.ry).toBeGreaterThanOrEqual(bounds.y1);
          expect(b.y + b.ry).toBeLessThanOrEqual(bounds.y2);
        }
      }
    }
  });

  test('只靠zoom无法容纳盘最小实体时返回null，不假报取景成功', () => {
    expect(fitProjectedBodies(() => [{ x: 100, y: 100, ...departmentDisc(1) }],
      { zoom: 1, panX: 0, panY: 0 }, SIZE, { x1: 0, y1: 0, x2: 30, y2: 12 }, { min: 0.25, max: 8 })).toBeNull();
  });
});

finish('3d');
