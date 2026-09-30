// 任务列表「标题」列整列空白(owner 09-30,Windows 桌面 0.2.161;0.2.159–0.2.162 都有):标题文字的 style 带 `flex: 0`,
// react-native-web 把它原样写成 CSS `flex: 0` = `0 1 0%` —— 基准宽 0、不伸长,再加 numberOfLines 的 overflow:hidden,
// 字宽 0。textContent 还在,所以只查文字的检查一直绿。
//   web    : 把标题文字真正的 style 过一遍 react-native-web 的样式编译,断言不是 0 基准宽(画出来的宽由
//            tests/test-task-title-visible/drive.mjs 在浏览器里量)。
//   native : 同一棵行 → 标题格 → 文字的树用 yoga-layout(原生 app 的布局引擎)排一遍:修前 / 修后标题都和负责人格
//            同一中线(#564 的垂直居中不变),文字有宽,长标题不超出格子。
// ck 风格自执行,不是 bun:test。
import { readFileSync } from 'node:fs';
import Yoga, { Align, Edge, FlexDirection, Gutter, MeasureMode, type Node } from 'yoga-layout';
import createReactDOMStyle from 'react-native-web/dist/cjs/exports/StyleSheet/compiler/createReactDOMStyle';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
type Style = Record<string, any>;

// ── the real styles ──────────────────────────────────────────────────────────────────────────────
const table = src('./TaskListTable.tsx');
const titleCase = table.split('\n').find(l => l.includes("case 'title':")) ?? '';
const m = titleCase.match(/<Text style=\{\[s\.tdTitle, (\{[^}]*\})/);
const obj = (literal: string): Style => Function('colors', 'typeScale', 'spacing', 'StyleSheet', `return ${literal}`)({}, { body: 14 }, { lg: 16, md: 12 }, { hairlineWidth: 1 });
const parts = src('./TaskBoardParts.tsx');
const tdTitle = obj((parts.match(/tdTitle: (\{[^}]*\})/) ?? [])[1] ?? '{}');
const tr = obj((parts.match(/ {2}tr: (\{[^}]*\})/) ?? [])[1] ?? '{}');
const layoutOnly = (s: Style) => Object.fromEntries(Object.entries(s).filter(([k]) => /^(flex|minWidth|minHeight|gap|padding|alignItems|alignSelf)/.test(k)));
const OLD = { flex: 0, flexShrink: 1 }; // 0.2.159–0.2.162
const NOW: Style = m ? obj(m[1]) : {};
ck('找到标题文字的 style 覆盖', !!m, titleCase.slice(0, 80));

// ── web: what react-native-web writes ────────────────────────────────────────────────────────────
const web = (style: Style) => createReactDOMStyle(style) as Record<string, unknown>;
const zeroBasis = (css: Record<string, unknown>) => {
  const grow = css.flexGrow ?? (typeof css.flex === 'number' ? css.flex : 0);
  const basis = css.flexBasis ?? (typeof css.flex === 'number' ? '0%' : 'auto');
  return Number(grow) === 0 && (basis === '0%' || basis === 0 || basis === '0px');
};
console.log('\nweb(react-native-web 样式编译)');
ck('判据自检:修前 flex:0 → 0 基准宽(这就是那个坑)', zeroBasis(web({ ...tdTitle, ...OLD })));
ck('判据自检:flex:1 会伸长,不算 0 宽', !zeroBasis(web({ flex: 1 })));
const css = web({ ...tdTitle, ...NOW });
ck('现在的标题文字不是 0 基准宽', !zeroBasis(css), JSON.stringify({ flex: css.flex, flexGrow: css.flexGrow, flexBasis: css.flexBasis }));
ck('能缩(长标题省略号,不撑破列宽)', Number(css.flexShrink ?? 1) >= 1 && parseFloat(String(css.minWidth)) === 0, JSON.stringify({ flexShrink: css.flexShrink, minWidth: css.minWidth }));
ck("没用 flexBasis:'auto'(原生上叠在 flex 上不生效,见 flex-basis-auto-rule.test.ts)", !('flexBasis' in NOW));

// ── native: yoga ─────────────────────────────────────────────────────────────────────────────────
const ALIGN: Record<string, Align> = { 'flex-start': Align.FlexStart, 'flex-end': Align.FlexEnd, center: Align.Center, stretch: Align.Stretch };
function node(s: Style, kids: Node[] = []): Node {
  const n = Yoga.Node.create();
  for (const [k, v] of Object.entries(s)) {
    switch (k) {
      case 'flexDirection': n.setFlexDirection(v === 'row' ? FlexDirection.Row : FlexDirection.Column); break;
      case 'alignItems': n.setAlignItems(ALIGN[v]); break;
      case 'alignSelf': n.setAlignSelf(ALIGN[v]); break;
      case 'flex': n.setFlex(v); break;
      case 'flexGrow': n.setFlexGrow(v); break;
      case 'flexShrink': n.setFlexShrink(v); break;
      case 'width': n.setWidth(v); break;
      case 'height': n.setHeight(v); break;
      case 'minWidth': n.setMinWidth(v); break;
      case 'minHeight': n.setMinHeight(v); break;
      case 'gap': n.setGap(Gutter.All, v); break;
      case 'paddingHorizontal': n.setPadding(Edge.Horizontal, v); break;
      default: throw new Error(`task-title-web-width.test: no Yoga mapping for "${k}"`);
    }
  }
  kids.forEach((c, i) => n.insertChild(c, i));
  return n;
}
// One-line Text (numberOfLines=1): as wide as its characters (CJK = font size, others ≈ 0.55×) or the width offered.
const oneLine = (text: string, s: Style) => {
  const n = node(s);
  const natural = [...text].reduce((w, ch) => w + (ch.charCodeAt(0) >= 0x2e80 ? 14 : 8), 0);
  n.setMeasureFunc((w, wm) => ({ width: wm === MeasureMode.Undefined ? natural : Math.min(natural, w), height: 20 }));
  return { n, natural };
};
const abs = (n: Node) => { let x = 0, y = 0; for (let q: Node | null = n; q; q = q.getParent()) { x += q.getComputedLeft(); y += q.getComputedTop(); } return { x, y, w: n.getComputedWidth(), h: n.getComputedHeight(), cy: y + n.getComputedHeight() / 2 }; };
// TaskListTable row: tr > [title cell > title view > name row > Text (+ archived tag)] [owner cell > avatars]
function row(textStyle: Style, name: string, cellW: number, opts: { archived?: boolean; tags?: boolean } = {}) {
  const text = oneLine(name, layoutOnly({ ...tdTitle, ...textStyle }));
  const nameRow = node({ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }, [text.n, ...(opts.archived ? [node({ width: 44, height: 18, flexShrink: 0 })] : [])]);
  const titleView = node({ flex: 1, minWidth: 0, gap: 4, alignSelf: 'center' }, [nameRow, ...(opts.tags ? [node({ height: 18 })] : [])]);
  const cell = (w: number, kids: Node[]) => node({ width: w, minWidth: w, flexShrink: 0, flexDirection: 'row', alignItems: 'center' }, kids);
  const titleCell = cell(cellW, [titleView]);
  const owner = node({ width: 80, height: 18 });
  const root = node({ ...layoutOnly(tr), flexDirection: 'row', width: cellW + 150 + 12 + 32 }, [node({ width: 20 }), titleCell, cell(150, [owner])]);
  root.calculateLayout(undefined, undefined);
  const out = { text: abs(text.n), cell: abs(titleCell), owner: abs(owner), natural: text.natural };
  root.freeRecursive();
  return out;
}
console.log('\nnative(yoga-layout,平板横屏 / 手机横屏列宽)');
const SHORT = '示例门户 | 首页改版文案', LONG = '示例基建 | 一个比较长的任务标题,用来占满标题列,再长一点再长一点再长一点';
for (const w of [150, 220, 420]) for (const opts of [{}, { archived: true }, { tags: true }]) {
  const tag = `标题格 ${w}${'archived' in opts ? ' +归档标' : ''}${'tags' in opts ? ' +标签行' : ''}`;
  const before = row(OLD, SHORT, w, opts), after = row(NOW, SHORT, w, opts);
  ck(`${tag}:垂直中线和修前一致、和负责人格同一中线`, Math.abs(after.text.cy - before.text.cy) < 0.01 && Math.abs(after.text.cy - after.owner.cy) <= (('tags' in opts) ? 11 : 0.5), `${after.text.cy} / ${before.text.cy} / owner ${after.owner.cy}`);
  ck(`${tag}:短标题按内容宽(和修前同宽)`, after.text.w > 0 && Math.abs(after.text.w - Math.min(before.text.w, after.natural)) < 0.01, `${after.text.w} / ${before.text.w}`);
  const long = row(NOW, LONG, w, opts);
  ck(`${tag}:长标题收在格子里(省略号),不超出`, long.text.w > 0 && long.text.x + long.text.w <= long.cell.x + long.cell.w + 0.01, `${long.text.x + long.text.w} > ${long.cell.x + long.cell.w}`);
}

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
