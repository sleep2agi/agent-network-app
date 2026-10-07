// Time stamps are never cut (board #683). Owner 2026-10-07, iPhone: the time pill read 「09:0」 and
// the author line 「<agent> · 主动汇报 · 09:…」. See chat-time-layout.ts for the defect and the rule.
//
// Native half: the view tree the app renders on a device (author line in a reply row; the centred
// pill), laid out with yoga-layout — the layout engine of the native app — using the real fragments
// from chat-time-layout.ts / bubble-layout.ts. The web half is tests/test-chat-time-visible/drive.mjs.
//
// Text measurement: a deterministic stand-in for the device font (CJK = 1 em, digits 0.58 em,
// colon / dot 0.3 em, spaces 0.28 em, latin 0.55 em). The device DRAWS the true width; the native
// measurement may come back `short` × narrower (0 = exact, 0.12 = the owner's screenshot). A time
// is cut when the box it is drawn in is narrower than the true width of its string.
//
// For phone widths 375 / 390, font multipliers 0.9 / 1 / 1.15, short = 0 / 0.12:
//   (a) author line, short name (the owner's 「示例-A · 主动汇报」) — time box ≥ drawn time
//   (b) author line, 「scheduler → <long>」 and 「<long> → <long>」 — time box ≥ drawn time, the
//       NAME is what got narrower than its text, and the line stays inside its column
//   (c) the centred pill — the time's box ≥ drawn time
// Negative controls (must go red, every run): the pre-#683 shapes — one <Text numberOfLines={1}>
// for 「name · time」, and the pill as a padded content-sized Text.
// Source contracts: every chat surface goes through ChatMetaLine / ChatTimePill, and no `· ${time}`
// is glued onto a name inside one Text anywhere in src/.
import fs from 'node:fs';
import path from 'node:path';
import Yoga, { Align, Direction, Edge, FlexDirection, Gutter, Justify, MeasureMode, type Node } from 'yoga-layout';
import { bubbleLayout } from './bubble-layout';
import { chatTimeLayout, META_SEPARATOR, timeTextFloor } from './chat-time-layout';

let p = 0, t = 0;
const ck = (n: string, c: boolean, detail = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, detail); };

type Style = Record<string, any>;
const ALIGN: Record<string, Align> = { 'flex-start': Align.FlexStart, 'flex-end': Align.FlexEnd, center: Align.Center, stretch: Align.Stretch };
const JUSTIFY: Record<string, Justify> = { 'flex-start': Justify.FlexStart, 'flex-end': Justify.FlexEnd, center: Justify.Center };
function apply(n: Node, s: Style) {
  for (const [k, v] of Object.entries(s)) {
    switch (k) {
      case 'flexDirection': n.setFlexDirection(v === 'row' ? FlexDirection.Row : FlexDirection.Column); break;
      case 'alignItems': n.setAlignItems(ALIGN[v]); break;
      case 'alignSelf': n.setAlignSelf(ALIGN[v]); break;
      case 'justifyContent': n.setJustifyContent(JUSTIFY[v]); break;
      case 'flexShrink': n.setFlexShrink(v); break;
      case 'width': n.setWidth(v); break;
      case 'height': n.setHeight(v); break;
      case 'minWidth': n.setMinWidth(v); break;
      case 'maxWidth': n.setMaxWidth(v); break;
      case 'gap': n.setGap(Gutter.All, v); break;
      case 'padding': n.setPadding(Edge.All, v); break;
      case 'paddingHorizontal': n.setPadding(Edge.Horizontal, v); break;
      case 'paddingVertical': n.setPadding(Edge.Vertical, v); break;
      case 'textAlign': break; // paint-only
      default: throw new Error(`chat-time-visible.test: no Yoga mapping for style key "${k}" — add one`);
    }
  }
}

// ── device font stand-in ────────────────────────────────────────────────────────────────────────
const em = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x2e80) return 1;
  if (c >= 0x30 && c <= 0x39) return 0.58;
  if (ch === ':' || ch === '·' || ch === '.') return 0.3;
  if (ch === ' ' || ch === ' ') return 0.28;
  return 0.55;
};
const drawn = (s: string, f: number) => [...s].reduce((a, ch) => a + em(ch), 0) * f;

function view(style: Style | Style[], kids: Node[] = []) {
  const n = Yoga.Node.create();
  for (const s of ([] as Style[]).concat(style)) if (s) apply(n, s);
  kids.forEach((k, i) => n.insertChild(k, i));
  return n;
}
/** A one-line Text: measures `short`× narrow, never wider than it is offered. */
function text(s: string, f: number, short: number, style: Style | Style[] = []) {
  const n = view(style);
  n.setMeasureFunc((w, wm) => {
    const m = drawn(s, f) * (1 - short);
    return { width: wm === MeasureMode.Undefined ? m : wm === MeasureMode.Exactly ? w : Math.min(w, m), height: Math.round(f * 1.45) };
  });
  return n;
}
const absR = (n: Node) => { let x = 0; for (let q: Node | null = n; q; q = q.getParent()) x += q.getComputedLeft(); return x + n.getComputedWidth(); };
const contentW = (n: Node) => n.getComputedWidth() - n.getComputedPadding(Edge.Left) - n.getComputedPadding(Edge.Right);

const B = bubbleLayout();
const L = chatTimeLayout();
const AUTHOR_FONT = 11;
const PAD = 16; // list contentContainer padding (spacing.lg)

/** Reply row: [avatar 36] [content: author line, bubble 240 wide]. Returns the screen + the nodes to check. */
function replyRow(W: number, header: Node) {
  const content = view(B.messageContent as Style, [header, view({ width: 240, height: 60 })]);
  const row = view([B.messageRow as Style, B.replyRow as Style], [view({ width: 36, height: 36 }), content]);
  const screen = view({ width: W, padding: PAD }, [row]);
  screen.calculateLayout(W, undefined, Direction.LTR);
  return { screen, content };
}

/** NEW author line: the real ChatMetaLine fragments + the floor the component puts on the time. */
function metaLine(name: string, time: string, f: number, short: number) {
  const timeText = `${META_SEPARATOR}${time}`;
  const nameN = text(name, f, short, L.metaName as Style);
  const timeN = text(timeText, f, short, [L.metaTime as Style, { minWidth: timeTextFloor(timeText, f) }]);
  return { node: view(L.metaRow as Style, [nameN, timeN]), nameN, timeN, timeText };
}
/** OLD author line (pre-#683): 「name · time」 in ONE single-line Text — the tail is the time. */
function oldLine(name: string, time: string, f: number, short: number) {
  const s = `${name} · ${time}`;
  return { node: text(s, f, short), s };
}

const LONG = '示例-超长节点名称用于验证时间不被截断-ABCDEFGHIJKLMNOP';
const NAMES = [
  { key: 'short (owner)', name: '示例-A · 主动汇报', long: false },
  { key: 'foreign', name: `scheduler → ${LONG}`, long: true },
  { key: 'long → long', name: `${LONG} → ${LONG}`, long: true },
];
const TIMES = ['09:30', '昨天 09:30', '10月7日 09:30'];

let oldHeaderCut = 0, oldPillCut = 0, oldCases = 0;
for (const W of [375, 390]) {
  for (const m of [0.9, 1, 1.15]) {
    const f = Math.round(AUTHOR_FONT * m * 10) / 10;
    for (const short of [0, 0.12]) {
      const fails: string[] = [];
      for (const N of NAMES) for (const time of TIMES) {
        const ml = metaLine(N.name, time, f, short);
        const { screen, content } = replyRow(W, ml.node);
        const need = drawn(ml.timeText, f);
        if (ml.timeN.getComputedWidth() + 0.01 < need) fails.push(`${N.key}/${time}: time box ${ml.timeN.getComputedWidth().toFixed(1)} < drawn ${need.toFixed(1)}`);
        if (absR(ml.node) > absR(content) + 0.01) fails.push(`${N.key}/${time}: line overflows its column by ${(absR(ml.node) - absR(content)).toFixed(1)}`);
        if (N.long && ml.nameN.getComputedWidth() + 0.01 >= drawn(N.name, f)) fails.push(`${N.key}/${time}: long name was not the part truncated`);
        if (!N.long && short === 0 && ml.nameN.getComputedWidth() + 0.01 < drawn(N.name, f)) fails.push(`${N.key}/${time}: short name truncated with room to spare`);
        screen.freeRecursive();

        // negative control: the pre-#683 single Text
        const ol = oldLine(N.name, time, f, short);
        const o = replyRow(W, ol.node);
        oldCases++;
        if (ol.node.getComputedWidth() + 0.01 < drawn(ol.s, f)) oldHeaderCut++;
        o.screen.freeRecursive();
      }
      // the pill: View box (real fragments + the ChatScreen padding) → time Text with the floor
      for (const time of TIMES) {
        const tN = text(time, f, short, [L.pillText as Style, { minWidth: timeTextFloor(time, f) }]);
        const box = view([L.pillBox as Style, { paddingHorizontal: 8, paddingVertical: 2 }], [tN]);
        const screen = view({ width: W, padding: PAD }, [box]);
        screen.calculateLayout(W, undefined, Direction.LTR);
        if (tN.getComputedWidth() + 0.01 < drawn(time, f)) fails.push(`pill ${time}: time box ${tN.getComputedWidth().toFixed(1)} < drawn ${drawn(time, f).toFixed(1)}`);
        screen.freeRecursive();
        // negative control: the pre-#683 pill — the padded Text itself, content-sized
        const old = text(time, f, short, { alignSelf: 'center', flexShrink: 0, paddingHorizontal: 8, paddingVertical: 2 });
        const s2 = view({ width: W, padding: PAD }, [old]);
        s2.calculateLayout(W, undefined, Direction.LTR);
        if (contentW(old) + 0.01 < drawn(time, f)) oldPillCut++;
        s2.freeRecursive();
      }
      ck(`phone ${W} · font ×${m} · measured ${Math.round(short * 100)}% short: every time fully drawn, long names truncated instead`, fails.length === 0, fails.slice(0, 4).join(' | '));
    }
  }
}
// the model can see the defect (if these go green, the checks above prove nothing)
ck(`control: pre-#683 one-Text author line cuts the time (${oldHeaderCut}/${oldCases} cases)`, oldHeaderCut > 0);
ck(`control: pre-#683 pill cuts the time when the measurement is short (${oldPillCut} cases)`, oldPillCut > 0);
ck('floor holds even if the device font draws 1/0.88 × wider than the stand-in, for every time shape',
  TIMES.concat(['00:00', 'Yesterday 09:30', 'Oct 7 09:30', `${META_SEPARATOR}09:30`]).every(s => timeTextFloor(s, 11) >= drawn(s, 11 / 0.88)));
ck('floor is not a fixed width: grows with the string and with the font size',
  timeTextFloor('10月7日 09:30', 11) > timeTextFloor('09:30', 11) && timeTextFloor('09:30', 16.5) > timeTextFloor('09:30', 11));

// ── source contracts: every chat surface uses the components; nothing glues 「· time」 onto a name ──
const read = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n?/g, '\n');
const chat = read('ChatScreen.tsx');
const dm = read('DmChatScreen.tsx');
const comp = read('ChatTimeText.tsx');
const count = (s: string, needle: string) => s.split(needle).length - 1;
ck('ChatScreen: 4 author lines (sent / foreign / reply / search result) are ChatMetaLine', count(chat, '<ChatMetaLine ') === 4);
ck('ChatScreen: the gap header is ChatTimePill', count(chat, '<ChatTimePill ') === 1 && !/styles\.timeHeader/.test(chat));
ck('DmChatScreen: author line is ChatMetaLine, gap header is ChatTimePill', count(dm, '<ChatMetaLine ') === 1 && count(dm, '<ChatTimePill ') === 1 && !/styles\.timeHeader/.test(dm));
ck('ChatMetaLine: name ellipsizes, time carries metaTime + the floor', /style=\{\[textStyle, L\.metaName\]\} numberOfLines=\{1\} ellipsizeMode="tail"/.test(comp) && /L\.metaTime, timeStyle\(floorFor\(timeText, textStyle\)/.test(comp));
ck('ChatTimePill: the box is a View, the Text inside carries the floor', /<View style=\{\[L\.pillBox, boxStyle\]\}/.test(comp) && /L\.pillText, timeStyle\(floorFor\(time, textStyle\)/.test(comp) && /\{ minWidth, fontVariant/.test(comp));
ck('the floor applies on native (iOS / Android), not on web where text is laid out at its painted width', /if \(Platform\.OS === 'web'\) return 0;/.test(comp));
ck('fragments: name shrinks (flexShrink 1, minWidth 0), time never does (flexShrink 0)',
  L.metaName.flexShrink === 1 && L.metaName.minWidth === 0 && L.metaTime.flexShrink === 0 && L.pillText.flexShrink === 0);
// class-wide: no `· ${<time>}` appended to a name inside a Text, in any screen
const glued: string[] = [];
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.tsx'))) {
  const src = read(f);
  const re = /<Text\b[^>]*numberOfLines=\{1\}[^>]*>[^<]*`[^`]*· \$\{(?:formatChatHeader|formatTime|relativeTaskTime|hm)\(/g;
  for (const m of src.matchAll(re)) glued.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
}
ck('no single-line Text glues 「· time」 onto a name anywhere in src/', glued.length === 0, glued.join(', '));
// the other time cells of the class (inventory in the PR): they never shrink, and no fixed width is narrower than the time
const style = (f: string, key: string) => (read(f).match(new RegExp(`\\n\\s+${key}: \\{[^\\n]*`)) ?? [''])[0];
for (const [f, key] of [['AgentsScreen.tsx', 'time'], ['UiScaleSettings.tsx', 'time'], ['MessagesScreen.tsx', 'time'], ['TasksScreen.tsx', 'time'], ['TaskActivity.tsx', 'time'], ['TaskCalendar.tsx', 'time']] as const) {
  ck(`${f} ${key}: flexShrink 0`, /flexShrink: 0/.test(style(f, key)), style(f, key).trim());
}
for (const key of ['timeCol', 'detailTime']) {
  const s = style('TaskActivity.tsx', key);
  ck(`TaskActivity ${key}: width follows the time at the drawn size (no bare fixed width)`, /width: Math\.max\(\d+, timeTextFloor\(/.test(s) && !/width: \d+,/.test(s), s.trim());
}

console.log(`\n${p}/${t} passed`);
// explicit exit: yoga-layout (wasm) may keep the process alive on windows-latest (yoga-explicit-exit.test.ts)
process.exit(p === t ? 0 : 1);
