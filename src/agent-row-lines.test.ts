import assert from 'node:assert/strict';
import Yoga from 'yoga-layout';
import { hasAgentDetailLine } from './agent-row-lines';

// Model the content area after avatar/padding, including a name wider than the pane.
for (const width of [238, 306, 450]) {
  for (const [label, preview, draft, expectedDetail] of [
    ['', '', '', false], ['', 'message', '', true], ['工作中', '', '', true], ['', '', 'draft', true],
  ] as const) {
    const detail = hasAgentDetailLine(label, preview, draft);
    const body = Yoga.Node.create();
    body.setWidth(width); body.setHeight(64); body.setJustifyContent(Yoga.JUSTIFY_CENTER);
    const line = () => {
      const n = Yoga.Node.create(); n.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
      n.setAlignItems(Yoga.ALIGN_CENTER); n.setHeight(20); body.insertChild(n, body.getChildCount()); return n;
    };
    const top = line(), name = Yoga.Node.create();
    name.setWidth(600); name.setHeight(18); name.setFlexShrink(1); top.insertChild(name, 0);
    const slot = detail ? line() : top;
    const badge = Yoga.Node.create(); badge.setWidth(24); badge.setHeight(16);
    badge.setFlexShrink(0); badge.setMarginAuto(Yoga.EDGE_LEFT); slot.insertChild(badge, slot.getChildCount());
    try {
      body.calculateLayout(width, 64, Yoga.DIRECTION_LTR);
      const nameY = top.getComputedTop() + name.getComputedTop() + 9;
      const badgeY = slot.getComputedTop() + badge.getComputedTop() + 8;
      assert.equal(badgeY - nameY, expectedDetail ? 20 : 0);
      assert.equal(badge.getComputedLeft() + badge.getComputedWidth(), width);
      if (!expectedDetail) { assert.equal(nameY, 32); assert.ok(name.getComputedWidth() <= width - 24); }
    } finally { body.freeRecursive(); }
  }
}

// yoga-layout 的 wasm 会留住事件循环：断言都过了就显式退出（仓库约定，见 yoga-explicit-exit.test.ts）。任一断言失败会先抛错，走不到这里。
console.log("agent-row-lines: all layout combinations ok"); process.exit(0);
