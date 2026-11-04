import { describe, expect, test, finish } from './test-shim';
import { labelOverlapsBody, legionLabelLeader, placeLegionLabel, wrapLegionLabel } from './legion-labels';
import { departmentDisc } from './legion-3d';

const bounds = { x1: 12, y1: 12, x2: 388, y2: 588 };
const anchor = { x: 240, y: 170, rx: 36, ry: 15 };
const core = { x: 200, y: 140, rx: 45, ry: 45 };
const base = { anchor, width: 190, height: 20, bounds, occupied: [], bodies: [anchor, core] };

describe('军团标签：完整名称与节点留白', () => {
  test('长部门名避开中枢和自己的盘面', () => {
    const rect = placeLegionLabel(base);
    expect(rect).not.toBeNull();
    expect(labelOverlapsBody(rect, core)).toBe(false);
    expect(labelOverlapsBody(rect, anchor)).toBe(false);
  });

  test('上一标签占位后改选另一侧，不覆盖优先标签', () => {
    const first = placeLegionLabel(base);
    const second = placeLegionLabel({ ...base, occupied: [first] });
    expect(second).not.toBeNull();
    expect(second.x2 < first.x1 || second.x1 > first.x2 || second.y2 < first.y1 || second.y1 > first.y2).toBe(true);
  });

  test('四个屏幕边缘的长名称均保留在画布内', () => {
    for (const point of [{ x: 25, y: 200 }, { x: 375, y: 200 }, { x: 200, y: 25 }, { x: 200, y: 575 }]) {
      const edge = { ...anchor, ...point };
      const rect = placeLegionLabel({ ...base, anchor: edge, bodies: [edge] });
      expect(rect).not.toBeNull();
      expect(rect.x1).toBeGreaterThanOrEqual(bounds.x1);
      expect(rect.y1).toBeGreaterThanOrEqual(bounds.y1);
      expect(rect.x2).toBeLessThanOrEqual(bounds.x2);
      expect(rect.y2).toBeLessThanOrEqual(bounds.y2);
      expect(labelOverlapsBody(rect, edge)).toBe(false);
    }
  });

  test('没有可读空间时跳过，既不越界也不强行叠字', () => {
    expect(placeLegionLabel({ ...base, occupied: [bounds] })).toBeNull();
    expect(placeLegionLabel({ ...base, width: 500 })).toBeNull();
  });

  test('椭圆角落的留白可用，不把整个外接矩形当作实心盘', () => {
    const disc = { x: 100, y: 100, rx: 40, ry: 16 };
    expect(labelOverlapsBody({ x1: 130, y1: 112, x2: 150, y2: 130 }, disc)).toBe(false);
    expect(labelOverlapsBody({ x1: 90, y1: 99, x2: 110, y2: 105 }, disc)).toBe(true);
  });

  test('超长名称换行保留每个字，emoji家庭不会被拆开', () => {
    const text = '超长部门👨‍👩‍👧‍👦名称完整展示';
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const measure = s => [...segmenter.segment(s)].length * 12;
    const lines = wrapLegionLabel(text, 60, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
    expect(lines.every(s => measure(s) <= 60)).toBe(true);
    expect(lines.some(s => s.includes('👨‍👩‍👧‍👦'))).toBe(true);
    expect(wrapLegionLabel('ANet', 100, measure)).toEqual(['ANet']);
  });

  test('引线只跨越留白，近距离标签不额外增加连线', () => {
    const disc = { x: 100, y: 100, rx: 20, ry: 10 };
    const line = legionLabelLeader(disc, { x1: 160, y1: 90, x2: 200, y2: 110 });
    expect(line.from).toEqual({ x: 120, y: 100 });
    expect(line.to).toEqual({ x: 160, y: 100 });
    expect(legionLabelLeader(disc, { x1: 126, y1: 90, x2: 166, y2: 110 })).toBeNull();
  });

  test('引线遇到核心标签、工具栏或成员实体时不画', () => {
    const disc = { x: 100, y: 100, rx: 20, ry: 10 };
    const label = { x1: 160, y1: 90, x2: 200, y2: 110 };
    expect(legionLabelLeader(disc, label, [{ x1: 130, y1: 95, x2: 145, y2: 105 }])).toBeNull();
    expect(legionLabelLeader(disc, label, [], [{ x: 140, y: 100, rx: 7, ry: 7 }])).toBeNull();
    expect(legionLabelLeader(disc, label, [label], [disc, { x: 140, y: 120, rx: 7, ry: 7 }])).not.toBeNull();
  });

  test('多行标签同时避开窄屏工具栏和成员实体', () => {
    const header = { x1: 12, y1: 12, x2: 388, y2: 200 };
    const person = { x: 280, y: 250, rx: 12, ry: 12 };
    const rect = placeLegionLabel({ ...base, anchor: { ...anchor, y: 270 }, width: 168, height: 34,
      occupied: [header], bodies: [core, person] });
    expect(rect).not.toBeNull();
    expect(rect.y1).toBeGreaterThan(header.y2);
    expect(labelOverlapsBody(rect, person)).toBe(false);
    expect(labelOverlapsBody(rect, core)).toBe(false);
  });

  test('盘外沿避让和引线共享实体引用，未标名的盘仍挡住文字', () => {
    const axes = departmentDisc(24);
    const disc = { x: 100, y: 100, rx: axes.rx + 2, ry: axes.ry + 2 };
    const label = { x1: 210, y1: 90, x2: 270, y2: 110 };
    const leader = legionLabelLeader(disc, label, [label], [disc]);
    expect(leader).not.toBeNull();
    expect(leader.from.x).toBeCloseTo(disc.x + disc.rx);
    expect(leader.from.y).toBe(100);
    const unlabeled = { x: 200, y: 180, ...departmentDisc(30) };
    const placed = placeLegionLabel({ anchor: disc, width: 180, height: 34, bounds,
      occupied: [], bodies: [disc, unlabeled] });
    expect(placed).not.toBeNull();
    expect(labelOverlapsBody(placed, unlabeled)).toBe(false);
    expect(labelOverlapsBody(placed, disc)).toBe(false);
  });
});

finish('labels');
