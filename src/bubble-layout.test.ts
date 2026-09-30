// Chat bubble geometry under Yoga — the layout engine of the native app — with the real style
// fragments from bubble-layout.ts. Owner 2026-09-30 (Android tablet, landscape, 0.2.161): a long
// markdown reply's bubble ended a few lines early, the text ran on below it, and the quote row
// (「scheduler: …」) was drawn over the body. The web export can't show this (the browser does its
// own CSS layout and gets it right — tests/test-chat-bubble-geometry measures that side), so this
// builds the same view tree the app renders on a device and lays it out with yoga-layout.
//
// For every bubble × {phone 390, tablet two-pane panes 700 / 904 / 1100, desktop pane 924}:
//   (a) bottom  every text line fits inside the bubble: bubble content bottom ≥ each text's bottom,
//               with the text re-wrapped at the width it was finally given (that is what a TextView
//               draws), and the bubble is not taller than its content either — both directions are
//               the same defect: the bubble's size was negotiated from a different text measurement.
//   (b) right   bubble content right ≥ every text's right
//   (c) quote   the quote row starts at/below the bubble bottom and intersects no body text
// Negative controls (must go red, every run): the pre-fix list / table styles (`flexBasis: 0`).
//
// Text is measured with a fixed per-character advance (CJK = font size, others ≈ 0.55×) and a
// greedy character wrap — not Android's real metrics, but a deterministic, monotone stand-in; what
// the guard checks is agreement between the text and its container, which doesn't depend on metrics.
import Yoga, { Align, Direction, Edge, FlexDirection, Gutter, Justify, MeasureMode, PositionType, type Node } from 'yoga-layout';
import { bubbleLayout, desktopBubbleCap, gridCellWidth, listIndent, markdownLayout } from './bubble-layout';
import { parseMarkdownBlocks } from './markdown-model';
import { stackedRows, tableLayoutFor } from './table-layout';

let p = 0, t = 0;
const ck = (n: string, c: boolean, detail = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, detail); };

type Style = Record<string, any>;
type Leaf = { node: Node; text: string; font: number; lh: number; maxLines?: number; group: string };

// ── RN style → Yoga (the subset these fragments use) ─────────────────────────────────────────────
const ALIGN: Record<string, Align> = { 'flex-start': Align.FlexStart, 'flex-end': Align.FlexEnd, center: Align.Center, stretch: Align.Stretch };
const JUSTIFY: Record<string, Justify> = { 'flex-start': Justify.FlexStart, 'flex-end': Justify.FlexEnd, center: Justify.Center };
function apply(n: Node, s: Style) {
  for (const [k, v] of Object.entries(s)) {
    switch (k) {
      case 'flexDirection': n.setFlexDirection(v === 'row' ? FlexDirection.Row : FlexDirection.Column); break;
      case 'alignItems': n.setAlignItems(ALIGN[v]); break;
      case 'alignSelf': n.setAlignSelf(ALIGN[v]); break;
      case 'justifyContent': n.setJustifyContent(JUSTIFY[v]); break;
      case 'flex': n.setFlex(v); break; // RN semantics = Yoga's: flex > 0 → grow v, shrink 1, basis 0
      case 'flexGrow': n.setFlexGrow(v); break;
      case 'flexShrink': n.setFlexShrink(v); break;
      case 'flexBasis': n.setFlexBasis(v); break;
      case 'width': n.setWidth(v); break;
      case 'minWidth': n.setMinWidth(v); break;
      case 'maxWidth': n.setMaxWidth(v); break;
      case 'gap': n.setGap(Gutter.All, v); break;
      case 'padding': n.setPadding(Edge.All, v); break;
      case 'paddingHorizontal': n.setPadding(Edge.Horizontal, v); break;
      case 'paddingVertical': n.setPadding(Edge.Vertical, v); break;
      case 'paddingLeft': n.setPadding(Edge.Left, v); break;
      case 'position': n.setPositionType(v === 'absolute' ? PositionType.Absolute : PositionType.Relative); break;
      case 'left': n.setPosition(Edge.Left, v); break;
      case 'top': n.setPosition(Edge.Top, v); break;
      case 'marginTop': n.setMargin(Edge.Top, v); break;
      case 'marginBottom': n.setMargin(Edge.Bottom, v); break;
      case 'borderWidth': n.setBorder(Edge.All, v); break;
      case 'borderLeftWidth': n.setBorder(Edge.Left, v); break;
      case 'borderRightWidth': n.setBorder(Edge.Right, v); break;
      case 'borderBottomWidth': n.setBorder(Edge.Bottom, v); break;
      default: throw new Error(`bubble-layout.test: no Yoga mapping for style key "${k}" — add one`);
    }
  }
}

// ── text measurement stand-in ─────────────────────────────────────────────────────────────────────
const adv = (ch: string, font: number) => (ch.charCodeAt(0) >= 0x2e80 ? font : Math.round(font * 0.55)); // integer advances: no sub-pixel rounding artefacts
function wrap(text: string, font: number, w: number): { lines: number; widest: number } {
  let lines = 0, widest = 0;
  for (const para of text.split('\n')) {
    let cur = 0; lines++;
    for (const ch of para) {
      const a = adv(ch, font);
      if (cur > 0 && cur + a > w) { lines++; widest = Math.max(widest, cur); cur = 0; }
      cur += a;
    }
    widest = Math.max(widest, cur);
  }
  return { lines, widest };
}
const fullWidth = (text: string, font: number) => wrap(text, font, Infinity).widest;

class Tree {
  leaves: Leaf[] = [];
  bubbles: { node: Node; group: string; chip?: Node }[] = [];
  lists: { group: string; rows: { marker: Node; text: Node }[] }[] = [];
  view(style: Style | Style[], kids: Node[] = []) {
    const n = Yoga.Node.create();
    for (const s of ([] as Style[]).concat(style)) if (s) apply(n, s);
    kids.forEach((k, i) => n.insertChild(k, i));
    return n;
  }
  text(group: string, text: string, style: Style | Style[] = [], font = 14, lh = 21, maxLines?: number) {
    const n = this.view(style);
    n.setMeasureFunc((w, wm) => {
      const full = fullWidth(text, font);
      if (wm === MeasureMode.Undefined || full <= w) return { width: wm === MeasureMode.Exactly ? w : full, height: lh };
      const r = wrap(text, font, w);
      return { width: wm === MeasureMode.Exactly ? w : Math.min(w, r.widest), height: Math.min(r.lines, maxLines ?? Infinity) * lh };
    });
    this.leaves.push({ node: n, text, font, lh, maxLines, group });
    return n;
  }
}

// ── the view tree ChatScreen / MarkdownMessage render on a device (NATIVE branches) ───────────────
function markdown(T: Tree, g: string, md: string, L: ReturnType<typeof markdownLayout>) {
  const kids = parseMarkdownBlocks(md, {}).map(block => {
    if (block.kind === 'heading') return T.text(g, block.text, L.heading, Math.max(15, 20 - block.level));
    if (block.kind === 'list') {
      // origin/main's marker | text flex row (negative control) has no hanging indent
      const indent = (L.marker as Style).position === 'absolute' ? listIndent(block.items.length, block.ordered) : { marker: {}, row: {} };
      const rows = block.items.map((item, i) => ({ marker: T.text(g, block.ordered ? `${i + 1}.` : '•', [L.marker, indent.marker], 14, 21, 1), text: T.text(g, item, L.listText) }));
      if (block.ordered) T.lists.push({ group: g, rows });
      return T.view(L.block, rows.map(r => T.view([L.listRow, indent.row], [r.marker, r.text])));
    }
    if (block.kind === 'quote') return T.view(L.quote, [T.text(g, block.text)]);
    if (block.kind === 'code') return T.view(L.code, [T.text(g, block.text, [], 12, 18)]);
    if (block.kind === 'table') {
      const cols = block.rows.reduce((m, r) => Math.max(m, r.length), 0);
      if (tableLayoutFor(cols, true) === 'stacked') {
        return T.view(L.tableStack, stackedRows(block.rows).map(cells => T.view(L.tableCard, cells.map(cell =>
          (L as Style).tableCardLine // pre-fix shape (negative control): a label / value flex row
            ? T.view((L as Style).tableCardLine, [T.text(g, cell.label, (L as Style).tableCardLabel, 12, 20, 2), T.text(g, cell.value, (L as Style).tableCardValue)])
            : T.text(g, `${cell.label}  ${cell.value}`)))));
      }
      return T.view(L.table, [T.view({}, block.rows.map(row => T.view(L.tableRow, row.map(cell => T.text(g, cell, (L as Style).preFix ? L.tableCellFlex : [L.tableCellFlex, gridCellWidth(cols)])))))]);
    }
    if (block.kind === 'image') return T.view({});
    return T.text(g, block.text, L.block);
  });
  return T.view(L.root, kids);
}

type Msg = { id: string; side: 'sent' | 'reply'; md: string; quote?: string };
function row(T: Tree, m: Msg, desktop: boolean, pane: number, B: ReturnType<typeof bubbleLayout>, L: ReturnType<typeof markdownLayout>) {
  const cap = desktopBubbleCap(desktop, pane);
  const sent = m.side === 'sent';
  const bubble = T.view(sent ? [B.bubble] : [B.bubble, B.replyBubble, desktop ? B.replyBubbleDesktop : {}], [markdown(T, m.id, m.md, L)]);
  const chip = m.quote ? T.view([B.quoteChip, sent ? B.quoteChipSent : B.quoteChipReply], [T.text(`${m.id}:quote`, m.quote, [], 12, 16, 1)]) : undefined;
  T.bubbles.push({ node: bubble, group: m.id, chip });
  const pressable = T.view(sent ? B.bubblePressable : B.replyPressable, chip ? [bubble, chip] : [bubble]);
  const author = T.text(`${m.id}:author`, `示例-A · 13:47`, { marginBottom: 3 }, 11, 16, 1);
  const content = T.view([B.messageContent, sent ? B.sentContent : {}, cap ?? {}], [author, pressable]);
  const avatar = T.view({ width: 36 });
  avatar.setHeight(36);
  return T.view([B.messageRow, sent ? B.sentRow : B.replyRow], sent ? [content, avatar] : [avatar, content]);
}

// ── fixtures (synthetic text, shaped like the owner's screenshot) ─────────────────────────────────
const LONG_MD = [
  '【最新进展】', '',
  '- 示例版本 9.9.9 全平台发布完成。电脑端正式版已上线,镜像 VERSION=9.9.9,5 个平台的更新签名逐一核对通过,9 个安装文件的校验值和镜像一致,下载接口返回 9.9.9。',
  '- 看板已更新并回读确认:',
  '- #101 更新说明、#102 任务搜索、#103 日历视图 → 已完成(写明发布版本和 PR)。',
  '- #104 人员放上面 → 写进展「#105 已合入,随 9.9.10」。', '',
  '【下一轮目标 / 预计完成(东八区)】', '',
  '- 示例页面更新:14:10。',
  '- 9.9.10(连接复用 + 人员放上面 + 账号复制/编辑):安卓 APK 15:30。',
  '- 账号复制/编辑 PR:15:00。任务权限设计文档:16:00。',
  '- 苹果构建在安卓和电脑端都发完之后再排,优先级最低,预计今天晚些时候。',
].join('\n');
const TABLES_MD = [
  '## 对照', '',
  '| 项 | 说明 |', '|---|---|', '| 连接复用 | 同一条长连接承载所有节点的推送,断线后按指数退避重连,最长 30 秒 |', '| 人员 | 放上面 |', '',
  '| 平台 | 版本 | 状态 |', '|---|---|---|', '| 安卓 | 9.9.10 | 已上传镜像,等待真机验证后再对外公布下载地址 |', '| 电脑端 | 9.9.10 | 已发布 |', '',
  '> 引用一段说明:以上都是示例数据,只用于布局测量,不代表真实发布进度或真实节点。', '',
  '```', 'const x = 1;', '```',
].join('\n');
// 12 numbered items: two-digit markers must get the same hanging indent as one-digit ones (owner review 2026-09-30)
const ORDERED_MD = ['【步骤】', '', ...Array.from({ length: 12 }, (_, i) => `${i + 1}. 第 ${i + 1} 步:核对示例清单里的这一项,确认无误后在看板上回写进展,再继续下一步。`)].join('\n');
const SCHED = 'scheduler: 和示例-B 一起推进 (1) 示例网络支持任务页面支持用户自定义字段 (2) 看板状态回读 (3) 每轮汇报写清预计完成时间';
const MSGS: Msg[] = [
  { id: 'reply+md+quote', side: 'reply', md: LONG_MD, quote: SCHED },
  { id: 'sent+md', side: 'sent', md: LONG_MD },
  { id: 'sent+md+quote', side: 'sent', md: LONG_MD, quote: '示例-C: 上一条消息的引用' },
  { id: 'reply+short+quote', side: 'reply', md: '收到,马上处理。', quote: SCHED },
  { id: 'reply+tables', side: 'reply', md: TABLES_MD, quote: SCHED },
  { id: 'reply+ordered12', side: 'reply', md: ORDERED_MD, quote: SCHED },
];
const LAYOUTS = [
  { name: 'phone', pane: 390, desktop: false },
  { name: 'tablet-700', pane: 700, desktop: false },
  { name: 'tablet-904', pane: 904, desktop: false },
  { name: 'tablet-1100', pane: 1100, desktop: false },
  { name: 'desktop-924', pane: 924, desktop: true },
];

// ── measure + judge ───────────────────────────────────────────────────────────────────────────────
type Rect = { l: number; t: number; r: number; b: number };
const abs = (n: Node): Rect => {
  let x = 0, y = 0;
  for (let q: Node | null = n; q; q = q.getParent()) { x += q.getComputedLeft(); y += q.getComputedTop(); }
  return { l: x, t: y, r: x + n.getComputedWidth(), b: y + n.getComputedHeight() };
};
/** What the TextView actually draws: all its lines re-wrapped at the width it was finally given. */
const drawn = (leaf: Leaf): Rect => {
  const box = abs(leaf.node);
  const w = leaf.node.getComputedWidth() - leaf.node.getComputedPadding(Edge.Left) - leaf.node.getComputedPadding(Edge.Right) - leaf.node.getComputedBorder(Edge.Left) - leaf.node.getComputedBorder(Edge.Right);
  const r = wrap(leaf.text, leaf.font, Math.max(w, 0.0001));
  const lines = Math.min(r.lines, leaf.maxLines ?? Infinity);
  const top = box.t + leaf.node.getComputedPadding(Edge.Top) + leaf.node.getComputedBorder(Edge.Top);
  const left = box.l + leaf.node.getComputedPadding(Edge.Left) + leaf.node.getComputedBorder(Edge.Left);
  return { l: left, t: top, r: left + Math.min(w, r.widest), b: top + lines * leaf.lh };
};
const hit = (a: Rect, b: Rect) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;

type Row = { layout: string; bubble: string; width: number; bubbleBottom: number; textBottom: number; bubbleRight: number; textRight: number; quoteTop?: number; hits: number; fails: string[]; shapes?: { bubble: Rect; quote?: Rect; text: Rect[] }; markerLefts?: number[] };
function sweep(B = bubbleLayout(), L = markdownLayout()): Row[] {
  const out: Row[] = [];
  for (const lay of LAYOUTS) {
    const T = new Tree();
    // FlatList contentContainer padding lg → bubbleWrap per message
    const list = T.view({ padding: 16, width: lay.pane }, MSGS.map(m => T.view({ marginBottom: 12 }, [row(T, m, lay.desktop, lay.pane, B, L)])));
    list.calculateLayout(lay.pane, undefined, Direction.LTR);
    for (const bub of T.bubbles) {
      const box = abs(bub.node);
      const inner = { l: box.l + bub.node.getComputedPadding(Edge.Left), r: box.r - bub.node.getComputedPadding(Edge.Right), b: box.b - bub.node.getComputedPadding(Edge.Bottom) };
      const body = T.leaves.filter(x => x.group === bub.group).map(drawn);
      const textBottom = Math.max(...body.map(r => r.b)), textRight = Math.max(...body.map(r => r.r));
      const fails: string[] = [];
      if (inner.b + 0.5 < textBottom) fails.push(`(a) text runs ${Math.round(textBottom - inner.b)}px below the bubble`);
      // …and the other direction, node by node: every box inside the bubble (the bubble too) must be
      // exactly as tall as what it holds. A box sized from some other measurement is the defect even
      // when this particular text happens to still fit.
      const leafOf = new Map(T.leaves.map(x => [x.node, x] as const));
      const walk = (n: Node, path: string) => {
        const leaf = leafOf.get(n);
        const box = abs(n);
        if (leaf) {
          const d = drawn(leaf);
          if (Math.abs(box.b - n.getComputedPadding(Edge.Bottom) - n.getComputedBorder(Edge.Bottom) - d.b) > 1) fails.push(`(a) ${path} text box ${Math.round(box.b - d.b)}px off its lines`);
          return;
        }
        const kids: Node[] = [];
        for (let i = 0; i < n.getChildCount(); i++) kids.push(n.getChild(i));
        const flow = kids.filter(k => k.getPositionType() !== PositionType.Absolute);
        if (flow.length) {
          const contentB = box.b - n.getComputedPadding(Edge.Bottom) - n.getComputedBorder(Edge.Bottom);
          const kidsB = Math.max(...flow.map(k => abs(k).b + k.getComputedMargin(Edge.Bottom)));
          if (Math.abs(contentB - kidsB) > 1) fails.push(`(a) ${path} box ends ${Math.round(contentB - kidsB)}px from its content`);
        }
        kids.forEach((k, i) => walk(k, `${path}/${i}`));
      };
      walk(bub.node, 'bubble');
      if (inner.r + 0.5 < textRight) fails.push(`(b) text ${Math.round(textRight - inner.r)}px right of the bubble`);
      let quoteTop: number | undefined, hits = 0;
      if (bub.chip) {
        const c = abs(bub.chip);
        quoteTop = c.t;
        hits = body.filter(r => hit(r, c)).length;
        if (c.t + 0.5 < box.b) fails.push(`(c) quote row starts ${Math.round(box.b - c.t)}px above the bubble bottom`);
        if (hits) fails.push(`(c) quote row overlaps ${hits} text line box(es)`);
      }
      out.push({ layout: lay.name, bubble: bub.group, width: Math.round(box.r - box.l), bubbleBottom: Math.round(inner.b), textBottom: Math.round(textBottom), bubbleRight: Math.round(inner.r), textRight: Math.round(textRight), quoteTop: quoteTop === undefined ? undefined : Math.round(quoteTop), hits, fails, ...(process.env.BUBBLE_DUMP ? { shapes: { bubble: box, quote: bub.chip ? abs(bub.chip) : undefined, text: body } } : {}) });
    }
    for (const l of T.lists) {
      const lefts = l.rows.map(r => abs(r.text).l);
      const fails: string[] = [];
      if (Math.max(...lefts) - Math.min(...lefts) > 0.5) fails.push(`(d) item text starts at ${[...new Set(lefts.map(Math.round))].join(' / ')}px, not one column`);
      l.rows.forEach((r, i) => {
        const m = abs(r.marker), leaf = T.leaves.find(x => x.node === r.marker)!;
        const need = fullWidth(leaf.text, leaf.font);
        if (need > m.r - m.l + 0.5) fails.push(`(d) marker "${leaf.text}" needs ${need}px, has ${Math.round(m.r - m.l)}`);
        if (m.r > abs(r.text).l + 0.5) fails.push(`(d) marker ${i + 1} overlaps its text`);
      });
      out.push({ layout: lay.name, bubble: `${l.group}:markers`, width: 0, bubbleBottom: 0, textBottom: 0, bubbleRight: 0, textRight: 0, hits: 0, fails, markerLefts: lefts.map(Math.round) } as Row);
    }
    list.freeRecursive();
  }
  return out;
}

const rows = sweep();
if (process.env.BUBBLE_TABLE) {
  console.log('| layout | bubble | width | bubble bottom | text bottom | bubble right | text right | quote top | overlaps |\n|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.layout} | ${r.bubble} | ${r.width} | ${r.bubbleBottom} | ${r.textBottom} | ${r.bubbleRight} | ${r.textRight} | ${r.quoteTop ?? '-'} | ${r.hits} |`);
}
ck(`swept ${LAYOUTS.length} layouts × ${MSGS.length} bubbles`, rows.filter(r => !r.bubble.endsWith(':markers')).length === LAYOUTS.length * MSGS.length, `got ${rows.length}`);
for (const lay of ['phone', 'tablet-904']) {
  const m = rows.find(r => r.layout === lay && r.bubble === 'reply+ordered12:markers');
  ck(`${lay}: 12-item ordered list — items 1…12 share one text left edge, no marker spills or overlaps`, !!m && m.fails.length === 0, m ? m.fails.join('; ') : 'list not measured');
}
ck('marker column fits the widest number: 9 / 12 / 99 / 100 / 150 / 1000 items', [9, 12, 99, 100, 150, 1000].every(n => fullWidth(`${n}.`, 14) <= listIndent(n, true).marker.width) && listIndent(3, false).marker.width === 16);
for (const lay of LAYOUTS) {
  const bad = rows.filter(r => r.layout === lay.name && r.fails.length);
  ck(`${lay.name}: every bubble contains its text, quote row clear of the body`, bad.length === 0, bad.map(r => `${r.bubble}: ${r.fails.join('; ')}`).join(' | '));
}
// the fix must not have collapsed the tablet bubble either: a long list reply uses the width it has
const tab = rows.find(r => r.layout === 'tablet-904' && r.bubble === 'reply+md+quote');
ck('tablet: the long markdown reply is wider than its widest heading (not heading-sized)', !!tab && tab.width > fullWidth('【下一轮目标 / 预计完成(东八区)】', 14) + 32 + 40, JSON.stringify(tab));

// ── negative controls: origin/main's styles (verbatim, 0.2.161) must go red, or this guard can't see the defect ──
const PRE_FIX_B = bubbleLayout(); // the bubble chain itself is unchanged
const PRE_FIX_L = {
  preFix: true,
  root: { gap: 8, minWidth: 0, maxWidth: '100%' }, block: { marginBottom: 2 }, heading: { marginTop: 4 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, minWidth: 0 }, marker: { minWidth: 16 },
  listText: { flexShrink: 1, flexGrow: 1, flexBasis: 0, minWidth: 0 },
  quote: { borderLeftWidth: 3, paddingLeft: 12, minWidth: 0 }, code: { maxWidth: '100%', padding: 12 },
  table: { maxWidth: '100%', borderWidth: 1 }, tableRow: { flexDirection: 'row' },
  tableCellFlex: { flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 4, borderRightWidth: 1, borderBottomWidth: 1 },
  tableStack: { gap: 8 }, tableCard: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  tableCardLine: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tableCardLabel: { minWidth: 64, maxWidth: '40%', flexShrink: 0 }, tableCardValue: { flex: 1, minWidth: 0 },
} as any;
const pre = sweep(PRE_FIX_B, PRE_FIX_L);
if (process.env.BUBBLE_TABLE) {
  console.log('\npre-fix (origin/main styles):');
  for (const r of pre) console.log(`| ${r.layout} | ${r.bubble} | ${r.width} | ${r.bubbleBottom} | ${r.textBottom} | ${r.fails.length ? 'FAIL ' + r.fails.slice(0, 2).join('; ') : 'ok'} |`);
}
ck('control: origin/main styles are caught on the tablet long-markdown reply (the owner\'s case)', pre.some(r => r.layout.startsWith('tablet') && r.bubble === 'reply+md+quote' && r.fails.length), `${pre.filter(r => r.fails.length).length} failing`);
ck('control: origin/main table styles are caught', pre.some(r => r.bubble === 'reply+tables' && r.fails.length));
ck('control: origin/main list row alone is caught', sweep(bubbleLayout(), { ...markdownLayout(), listRow: PRE_FIX_L.listRow, marker: PRE_FIX_L.marker, listText: PRE_FIX_L.listText }).some(r => r.fails.length));
// the obvious one-line fix (drop flexBasis 0, keep the marker | text flex row) is NOT enough: the row measures the text
// at the full row width for its basis, then shrinks it by the marker — one line short, the device's direction.
const basisAuto = sweep(bubbleLayout(), { ...markdownLayout(), listRow: PRE_FIX_L.listRow, marker: PRE_FIX_L.marker, listText: { flexShrink: 1, flexGrow: 1, minWidth: 0 } });
ck('control: a basis-auto marker | text flex row is caught too', basisAuto.some(r => r.fails.length));
// BUBBLE_DUMP=<file>: the laid-out boxes (fixed / origin/main / basis-auto) for drawing the PR's before-after pictures
if (process.env.BUBBLE_DUMP) (await import('node:fs')).writeFileSync(process.env.BUBBLE_DUMP, JSON.stringify({ fixed: rows, pre, basisAuto }));
// and the class rule, statically: no basis-0 anywhere in the fragments that live inside a bubble
const basis0 = [...Object.entries(bubbleLayout()), ...Object.entries(markdownLayout())].filter(([, s]) => (s as Style).flexBasis === 0 || ((s as Style).flex ?? 0) > 0).map(([k]) => k);
ck('no bubble / markdown fragment uses flexBasis 0 or flex: n', basis0.length === 0, basis0.join(','));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
