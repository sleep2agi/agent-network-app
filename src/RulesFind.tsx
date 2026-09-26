// 规则文件区块里的「查找 / 替换」(Vincent 09-25:「规则文件，你不能 Ctrl+F 去搜索定位里面的内容…
// 你支持一下 Ctrl+F 去搜索…这样的话方便我去改」)。
//
// Tauri 的 webview 没有可用的页内查找;就算有,阅读区是 React 渲染的 markdown、编辑区是 textarea,
// 原生查找也高亮不到 textarea 里面。这里自己做,只在规则区块里生效:
//
// - 快捷键:macOS ⌘F / 其余 Ctrl+F。只在规则区块可见(或全屏打开)时拦截;焦点在别处的输入框里时不拦。
// - 阅读:遍历渲染结果的文本节点找匹配。优先用 CSS Custom Highlight API(不改 DOM,不会和 React 打架);
//   webview 不支持时退回 <mark> 包裹 —— 包之前记下原文本节点,清掉时原样放回,内容一变整块重新挂载
//   (NodeRulesSection 给 MarkdownMessage 挂了 contentKey),所以 React 手里的节点永远是它自己的。
// - 编辑:在 textarea 的值(未保存草稿)上找;textarea 自己画不了高亮,就在它上面盖一层同字体、同宽、
//   同滚动位置的透明镜像层,只给匹配处上底色(和 #349 双击跳源码量折行用的是同一个镜像思路)。
//   当前那处用 setSelectionRange 选中,并按镜像层里量到的真实 y 滚到框中间。
// - 替换只改草稿,保存还是用户自己点「保存」。
//
// 纯逻辑(偏移、绕回、替换、跨节点切分、模式切换对应)在 rules-find.ts,有自执行测试。

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';

import { colors, spacing, themeMode } from './theme';
import type { RulesViewMode } from './node-rules-view';
import { lineStartOffset, sourceRangeFromDataset } from './node-rules-view';
import {
  findCountLabel, findKeyAction, findMatches, isFindShortcut, isMacPlatform, isTruncated, joinSegments, matchAtOrAfter,
  matchLines, ordinalInGroup, pickCorresponding, piecesForMatch, replaceAll, replaceMatch, sourceKeysForBlock, stepMatch,
  type FindMatch, type TextSegment,
} from './rules-find';

const WEB = Platform.OS === 'web';

/** 当前那一处在哪儿 —— 切换阅读/编辑时拿它去另一边找「对应的那一处」。 */
type Loc =
  | { mode: 'read'; key: number; end: number; ordinal: number }
  | { mode: 'edit'; index: number; line: number; lines: number[] };

type Nav =
  | { kind: 'first' }
  | { kind: 'incremental' }
  | { kind: 'index'; index: number }
  | { kind: 'from'; loc: Loc }
  | { kind: 'silentLine'; line: number };

export interface RulesFindController {
  open: boolean;
  mode: RulesViewMode;
  editable: boolean;
  query: string;
  setQuery: (q: string) => void;
  caseSensitive: boolean;
  toggleCase: () => void;
  replaceText: string;
  setReplaceText: (s: string) => void;
  showReplace: boolean;
  toggleReplace: () => void;
  count: number;
  label: string;
  note: string;
  next: () => void;
  prev: () => void;
  close: () => void;
  replaceOne: () => void;
  replaceEvery: () => void;
  focusTick: number;
  /** 阅读区容器(MarkdownMessage 外面那层)的 ref 回调。 */
  readRef: (el: any) => void;
}

export interface UseRulesFindArgs {
  mode: RulesViewMode;
  draft: string;
  setDraft: (s: string) => void;
  editable: boolean;
  hasContent: boolean;
  full: boolean;
  editorRef: { current: any };
  sectionRef: { current: any };
  /** 双击跳源码正在进行(要选中的原文首行)。这时切到编辑不抢选区,只把「当前」挪到那附近。 */
  jumpLine: number | null;
  onRequestEdit: () => void;
}

// ── 阅读区:文本节点 → 匹配 ────────────────────────────────────────────────────

interface ReadHit {
  pieces: { node: any; start: number; end: number }[];
  key: number;
  end: number;
}

// 行内元素(粗体、行内代码、链接…,react-native-web 里嵌套的 <Text> 是 span)不算分段;
// 其余(顶层 <Text> 是 div、View 是 div)各算一段 —— 段与段之间的文字不会拼成一个匹配。
const INLINE_TAGS = new Set(['SPAN', 'A', 'CODE', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'SMALL', 'SUB', 'SUP', 'MARK']);
function blockOf(el: any, root: any): any {
  let cur = el;
  while (cur && cur !== root && INLINE_TAGS.has(cur.tagName)) cur = cur.parentElement;
  return cur;
}

function collectReadHits(root: any, query: string, caseSensitive: boolean): ReadHit[] {
  const doc = (globalThis as any).document;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: any[] = [];
  const segs: TextSegment[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue) continue;
    nodes.push(n);
    segs.push({ text: n.nodeValue, group: blockOf(n.parentElement, root) });
  }
  const { text, starts } = joinSegments(segs);
  const lengths = nodes.map((n) => n.nodeValue.length);
  return findMatches(text, query, { caseSensitive }).map((m) => {
    const pieces = piecesForMatch(starts, lengths, m).map((p) => ({ node: nodes[p.segment], start: p.start, end: p.end }));
    const lineEl = pieces[0]?.node.parentElement?.closest?.('[data-md-line]');
    const range = sourceRangeFromDataset(lineEl?.dataset);
    return { pieces, key: range ? range.start : -1, end: range ? range.end : -1 };
  }).filter((h) => h.pieces.length > 0);
}

// ── 高亮颜色 ───────────────────────────────────────────────────────────────────

function palette() {
  return themeMode() === 'light'
    ? { all: 'rgba(255, 208, 0, 0.45)', current: '#ff9632', currentText: '#1d2026', overlayCurrent: 'rgba(255, 140, 30, 0.55)' }
    : { all: 'rgba(255, 196, 0, 0.32)', current: '#f59e0b', currentText: '#111113', overlayCurrent: 'rgba(255, 150, 40, 0.55)' };
}

const HL_ALL = 'rules-find';
const HL_CUR = 'rules-find-current';

function highlightApi(): { registry: any; Highlight: any } | null {
  const g = globalThis as any;
  if (g.__RULES_FIND_FORCE_MARK) return null; // 验证 <mark> 退路用
  if (typeof g.Highlight !== 'function' || !g.CSS?.highlights) return null;
  return { registry: g.CSS.highlights, Highlight: g.Highlight };
}

function ensureHighlightStyle() {
  const doc = (globalThis as any).document;
  if (!doc?.head) return;
  let el = doc.getElementById('rules-find-style');
  if (!el) { el = doc.createElement('style'); el.id = 'rules-find-style'; doc.head.appendChild(el); }
  const p = palette();
  const css = `::highlight(${HL_ALL}){background-color:${p.all};}::highlight(${HL_CUR}){background-color:${p.current};color:${p.currentText};}`;
  if (el.textContent !== css) el.textContent = css;
}

// 从 from 往上:先把横向滚动的祖先(代码块、表格)滚到能看见,再把第一个纵向滚动的祖先滚到让它居中。
function centerInScrollers(getRect: () => { top: number; bottom: number; left: number; right: number } | null, from: any) {
  const win = globalThis as any;
  let el = from?.parentElement;
  while (el && el !== win.document?.body) {
    const cs = win.getComputedStyle(el);
    const rect = getRect();
    if (!rect) return;
    if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      const r = el.getBoundingClientRect();
      if (rect.left < r.left || rect.right > r.right) el.scrollLeft += (rect.left + rect.right) / 2 - (r.left + el.clientWidth / 2);
    }
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      const r2 = getRect();
      if (!r2) return;
      const box = el.getBoundingClientRect();
      el.scrollTop += (r2.top + r2.bottom) / 2 - (box.top + el.clientHeight / 2);
      return;
    }
    el = el.parentElement;
  }
}

// ── 编辑区:textarea 上面盖一层镜像 ────────────────────────────────────────────────

interface Overlay { el: any; ta: any; marks: any[]; dispose: () => void }

function createOverlay(ta: any): Overlay | null {
  const doc = (globalThis as any).document;
  const host = ta.offsetParent || ta.parentElement;
  if (!doc || !host) return null;
  const el = doc.createElement('div');
  el.setAttribute('data-rules-find-overlay', '');
  el.setAttribute('aria-hidden', 'true');
  const layout = () => {
    const cs = (globalThis as any).getComputedStyle(ta);
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent', 'textAlign', 'direction', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'whiteSpace', 'overflowWrap', 'wordBreak']) el.style[k] = cs[k];
    Object.assign(el.style, {
      position: 'absolute', pointerEvents: 'none', overflow: 'hidden', zIndex: '2', boxSizing: 'border-box', margin: '0', border: '0',
      color: 'transparent', background: 'transparent',
      left: `${ta.offsetLeft + ta.clientLeft}px`, top: `${ta.offsetTop + ta.clientTop}px`,
      width: `${ta.clientWidth}px`, height: `${ta.clientHeight}px`,
    });
    if (!/pre/.test(el.style.whiteSpace)) el.style.whiteSpace = 'pre-wrap';
    el.scrollTop = ta.scrollTop; el.scrollLeft = ta.scrollLeft;
  };
  layout();
  host.appendChild(el);
  const onScroll = () => { el.scrollTop = ta.scrollTop; el.scrollLeft = ta.scrollLeft; };
  ta.addEventListener('scroll', onScroll);
  const RO = (globalThis as any).ResizeObserver;
  const ro = RO ? new RO(() => layout()) : null;
  ro?.observe(ta);
  return { el, ta, marks: [], dispose: () => { ta.removeEventListener('scroll', onScroll); ro?.disconnect(); el.remove(); } };
}

function paintOverlay(ov: Overlay, text: string, matches: readonly FindMatch[], current: number) {
  const doc = (globalThis as any).document;
  const p = palette();
  const frag = doc.createDocumentFragment();
  const marks: any[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) frag.appendChild(doc.createTextNode(text.slice(cursor, m.start)));
    const mark = doc.createElement('mark');
    mark.textContent = text.slice(m.start, m.end);
    Object.assign(mark.style, { color: 'transparent', borderRadius: '2px', padding: '0', background: i === current ? p.overlayCurrent : p.all });
    if (i === current) mark.setAttribute('data-current', '');
    frag.appendChild(mark);
    marks.push(mark);
    cursor = m.end;
  });
  // 末尾的换行在 pre-wrap 的 div 里不占高度,补一个零宽字符让镜像和 textarea 一样高(滚到底时对得齐)。
  frag.appendChild(doc.createTextNode(text.slice(cursor) + '​'));
  ov.el.textContent = '';
  ov.el.appendChild(frag);
  ov.marks = marks;
  ov.el.scrollTop = ov.ta.scrollTop;
}

// ── 控制器 ─────────────────────────────────────────────────────────────────────

export function useRulesFind(args: UseRulesFindArgs): RulesFindController {
  const { mode, draft, setDraft, editable, hasContent, full, editorRef, sectionRef, jumpLine, onRequestEdit } = args;
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [count, setCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [note, setNote] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  const [navTick, setNavTick] = useState(0);
  const [readVersion, setReadVersion] = useState(0);

  const readEl = useRef<any>(null);
  const pendingNav = useRef<Nav | null>(null);
  const lastLoc = useRef<Loc | null>(null);
  const currentRef = useRef(-1);
  const countRef = useRef(0);
  const restores = useRef<{ node: any; inserted: any[] }[]>([]);
  const overlay = useRef<Overlay | null>(null);
  const paintedRoot = useRef<any>(null);
  const latest = useRef(args);
  latest.current = args;

  const readRef = useCallback((el: any) => {
    if (el && el !== readEl.current) { readEl.current = el; setReadVersion((v) => v + 1); }
    else if (!el) readEl.current = null;
  }, []);

  const clearRead = useCallback(() => {
    const hl = highlightApi();
    if (hl) { hl.registry.delete(HL_ALL); hl.registry.delete(HL_CUR); }
    // <mark> 退路:把原来的文本节点放回原位,删掉插进去的碎片。倒序,嵌套的先还原。
    for (const r of restores.current.reverse()) {
      const first = r.inserted[0];
      if (first?.parentNode) first.parentNode.insertBefore(r.node, first);
      for (const n of r.inserted) n.parentNode?.removeChild(n);
    }
    restores.current = [];
  }, []);

  const clearEdit = useCallback(() => { overlay.current?.dispose(); overlay.current = null; }, []);
  const clearAll = useCallback(() => { clearRead(); clearEdit(); }, [clearRead, clearEdit]);
  useEffect(() => clearAll, [clearAll]);

  const request = (nav: Nav) => { pendingNav.current = nav; setNavTick((t) => t + 1); };

  // 切阅读/编辑时(查找栏开着),把「当前那一处」带过去。先于下面的重算 effect 声明 ⇒ 先跑。
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    if (!open) return;
    if (mode === 'edit' && jumpLine != null) pendingNav.current = { kind: 'silentLine', line: jumpLine };
    else if (lastLoc.current) pendingNav.current = { kind: 'from', loc: lastLoc.current };
    else pendingNav.current = { kind: 'first' };
  }, [mode]);

  // 重算:查找词、大小写、模式、草稿、阅读容器、全屏切换、导航请求,任何一个变了都整体重来一遍。
  useEffect(() => {
    if (!WEB) return;
    let cancelled = false;
    let timer: any = null;
    const run = (attempt: number) => {
      if (cancelled) return;
      if (!open || !query || !hasContent) {
        clearAll();
        pendingNav.current = null;
        currentRef.current = -1; countRef.current = 0;
        setCurrent(-1); setCount(0); setTruncated(false);
        return;
      }
      const nav = pendingNav.current;
      if (mode === 'read') {
        clearEdit();
        const root = readEl.current;
        if (!root?.isConnected) { if (attempt < 20) timer = setTimeout(() => run(attempt + 1), 50); return; }
        clearRead();
        const hits = collectReadHits(root, query, caseSensitive);
        const keys = hits.map((h) => h.key);
        pendingNav.current = null;
        let idx = -1;
        let move = !!nav || paintedRoot.current !== root;
        if (hits.length) {
          if (!nav || nav.kind === 'incremental') {
            const loc = lastLoc.current;
            idx = loc && loc.mode === 'read' ? pickCorresponding(keys, loc.key, loc.ordinal) : (nav ? 0 : Math.min(Math.max(0, currentRef.current), hits.length - 1));
          } else if (nav.kind === 'first') idx = 0;
          else if (nav.kind === 'index') idx = Math.min(Math.max(0, nav.index), hits.length - 1);
          else if (nav.kind === 'silentLine') { idx = pickCorresponding(keys, nav.line, 0); move = false; }
          else idx = correspondingInRead(nav.loc, hits, root);
        }
        paintedRoot.current = root;
        paintRead(hits, idx);
        currentRef.current = idx; countRef.current = hits.length;
        setCurrent(idx); setCount(hits.length); setTruncated(isTruncated(hits));
        lastLoc.current = idx >= 0 ? { mode: 'read', key: hits[idx].key, end: hits[idx].end, ordinal: ordinalInGroup(keys, idx) } : lastLoc.current;
        if (move && idx >= 0) scrollReadHit(hits[idx]);
        return;
      }
      // 编辑
      clearRead();
      paintedRoot.current = null;
      const ta = latest.current.editorRef.current;
      if (!ta || typeof ta.value !== 'string' || !ta.isConnected) { if (attempt < 20) timer = setTimeout(() => run(attempt + 1), 50); return; }
      const text: string = ta.value;
      const ms = findMatches(text, query, { caseSensitive });
      const lines = matchLines(text, ms);
      pendingNav.current = null;
      let idx = -1;
      let move = !!nav;
      if (ms.length) {
        if (!nav) {
          const loc = lastLoc.current;
          idx = loc && loc.mode === 'edit' ? Math.min(Math.max(0, loc.index), ms.length - 1) : 0;
        } else if (nav.kind === 'incremental') {
          // 边打边找:从当前这处(没有就从光标)开始往后找,和浏览器一样。
          const loc = lastLoc.current;
          const from = loc && loc.mode === 'edit' && loc.index >= 0 ? lineStartOffset(text, loc.line) : (ta.selectionStart ?? 0);
          idx = matchAtOrAfter(ms, from);
        } else if (nav.kind === 'first') idx = 0;
        else if (nav.kind === 'index') idx = Math.min(Math.max(0, nav.index), ms.length - 1);
        else if (nav.kind === 'silentLine') { idx = matchAtOrAfter(ms, lineStartOffset(text, nav.line)); move = false; }
        else {
          const loc = nav.loc;
          idx = loc.mode === 'read' && loc.key >= 0
            ? pickCorresponding(sourceKeysForBlock(lines, { start: loc.key, end: loc.end }), loc.key, loc.ordinal)
            : 0;
        }
      }
      if (!overlay.current || overlay.current.ta !== ta || !overlay.current.el.isConnected) { clearEdit(); overlay.current = createOverlay(ta); }
      if (overlay.current) paintOverlay(overlay.current, text, ms, idx);
      currentRef.current = idx; countRef.current = ms.length;
      setCurrent(idx); setCount(ms.length); setTruncated(isTruncated(ms));
      if (idx >= 0) lastLoc.current = { mode: 'edit', index: idx, line: lines[idx], lines };
      if (move && idx >= 0) selectInEditor(ta, ms[idx], overlay.current?.marks[idx]);
    };
    timer = setTimeout(() => run(0), 0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [open, query, caseSensitive, mode, draft, readVersion, navTick, full, hasContent]);

  function correspondingInRead(loc: Loc, hits: ReadHit[], root: any): number {
    const keys = hits.map((h) => h.key);
    if (loc.mode !== 'edit') return pickCorresponding(keys, loc.key, loc.ordinal);
    // 编辑 → 阅读:找包含那一行的块(最里层 = 起始行最大的那个),数当前这处在块里是第几处,再到阅读区的同一块里挑同一个序号。
    let block: { start: number; end: number } | null = null;
    for (const el of Array.from(root.querySelectorAll('[data-md-line]')) as any[]) {
      const r = sourceRangeFromDataset(el.dataset);
      if (r && r.start <= loc.line && loc.line <= r.end && (!block || r.start >= block.start)) block = r;
    }
    if (!block) return pickCorresponding(keys, loc.line, 0);
    let ordinal = 0;
    for (let i = 0; i < loc.index; i++) if (loc.lines[i] >= block.start && loc.lines[i] <= block.end) ordinal++;
    return pickCorresponding(keys, block.start, ordinal);
  }

  function paintRead(hits: ReadHit[], idx: number) {
    const hl = highlightApi();
    const doc = (globalThis as any).document;
    if (hl) {
      ensureHighlightStyle();
      const all: any[] = [];
      const cur: any[] = [];
      hits.forEach((h, i) => {
        for (const p of h.pieces) {
          const r = doc.createRange();
          r.setStart(p.node, p.start); r.setEnd(p.node, p.end);
          (i === idx ? cur : all).push(r);
        }
      });
      hl.registry.set(HL_ALL, new hl.Highlight(...all));
      const curHl = new hl.Highlight(...cur);
      curHl.priority = 1;
      hl.registry.set(HL_CUR, curHl);
      return;
    }
    // 退路:<mark> 包裹。按文本节点分组,每个节点一次性换成「文字 + mark + 文字…」,原节点留着以便还原。
    const p = palette();
    const byNode = new Map<any, { start: number; end: number; hit: number }[]>();
    hits.forEach((h, i) => { for (const piece of h.pieces) { const list = byNode.get(piece.node) ?? []; list.push({ start: piece.start, end: piece.end, hit: i }); byNode.set(piece.node, list); } });
    for (const [node, list] of byNode) {
      const parent = node.parentNode;
      if (!parent) continue;
      const value: string = node.nodeValue;
      const inserted: any[] = [];
      let cursor = 0;
      for (const piece of list.sort((a, b) => a.start - b.start)) {
        if (piece.start > cursor) inserted.push(doc.createTextNode(value.slice(cursor, piece.start)));
        const mark = doc.createElement('mark');
        mark.setAttribute('data-rules-find', piece.hit === idx ? 'current' : '');
        mark.textContent = value.slice(piece.start, piece.end);
        Object.assign(mark.style, piece.hit === idx
          ? { background: p.current, color: p.currentText, borderRadius: '2px' }
          : { background: p.all, color: 'inherit', borderRadius: '2px' });
        inserted.push(mark);
        cursor = piece.end;
      }
      if (cursor < value.length) inserted.push(doc.createTextNode(value.slice(cursor)));
      for (const n of inserted) parent.insertBefore(n, node);
      parent.removeChild(node);
      restores.current.push({ node, inserted });
    }
  }

  function scrollReadHit(hit: ReadHit) {
    const doc = (globalThis as any).document;
    const first = hit.pieces[0];
    // <mark> 退路下原文本节点已经被换掉,用当前那个 mark 量位置。
    const mark = restores.current.length ? readEl.current?.querySelector?.('mark[data-rules-find="current"]') : null;
    const getRect = () => {
      if (mark) return mark.getBoundingClientRect();
      if (!first.node.isConnected) return null;
      const r = doc.createRange();
      r.setStart(first.node, first.start); r.setEnd(first.node, first.end);
      return r.getBoundingClientRect();
    };
    centerInScrollers(getRect, mark ?? first.node);
  }

  function selectInEditor(ta: any, m: FindMatch, mark: any) {
    try { ta.setSelectionRange?.(m.start, m.end); } catch { /* 只读或未挂载 */ }
    if (mark && ta.clientHeight) {
      const lh = parseFloat((globalThis as any).getComputedStyle?.(ta)?.lineHeight) || 19;
      ta.scrollTop = Math.max(0, mark.offsetTop - ta.clientHeight / 2 + lh / 2);
      if (overlay.current) overlay.current.el.scrollTop = ta.scrollTop;
    }
  }

  // ── 快捷键:只在规则区块可见(或全屏)时拦 ⌘F / Ctrl+F ──
  useEffect(() => {
    if (!WEB) return;
    const doc = (globalThis as any).document;
    const nav = (globalThis as any).navigator;
    const mac = isMacPlatform(nav?.platform, nav?.userAgent);
    const onKey = (e: any) => {
      if (e.defaultPrevented || !isFindShortcut(e, mac)) return;
      const cur = latest.current;
      if (!cur.hasContent) return;
      const sec = cur.sectionRef.current;
      const active = doc.activeElement;
      if (!cur.full) {
        if (!sec || !isOnScreen(sec)) return;
        // 焦点在规则区块之外的输入框里(比如别处的搜索框)⇒ 那是别人的 Ctrl+F,不抢。
        if (active && active !== doc.body && isEditable(active) && !sec.contains(active)) return;
      }
      e.preventDefault();
      const seed = selectionSeed(cur.mode, cur.editorRef.current, readEl.current, doc);
      if (seed) { setQueryState(seed); pendingNav.current = { kind: 'incremental' }; setNote(''); }
      if (!open) { lastLoc.current = null; pendingNav.current = { kind: 'incremental' }; }
      setOpen(true);
      setFocusTick((t) => t + 1);
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [open]);

  const setQuery = useCallback((q: string) => { setQueryState(q); setNote(''); pendingNav.current = { kind: 'incremental' }; }, []);
  const toggleCase = useCallback(() => { setCaseSensitive((v) => !v); setNote(''); pendingNav.current = { kind: 'incremental' }; }, []);
  // 连按回车时,重算还没跑完下一次按键就到了 ⇒ 先把 currentRef 挪过去,不然几次按键会从同一处起步、丢步。
  const step = useCallback((dir: 1 | -1) => {
    if (!countRef.current) return;
    const index = stepMatch(currentRef.current, countRef.current, dir);
    currentRef.current = index;
    request({ kind: 'index', index });
  }, []);
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);
  const close = useCallback(() => {
    setOpen(false); setNote(''); pendingNav.current = null; lastLoc.current = null;
    clearAll();
    // 编辑模式下把焦点还给编辑框:当前那处已经选中,直接打字就是改它。
    const cur = latest.current;
    if (cur.mode === 'edit') setTimeout(() => cur.editorRef.current?.focus?.(), 0);
  }, [clearAll]);
  const toggleReplace = useCallback(() => {
    const cur = latest.current;
    if (cur.mode !== 'edit') { setShowReplace(true); cur.onRequestEdit(); return; }
    setShowReplace((v) => !v);
  }, []);

  const replaceOne = useCallback(() => {
    const cur = latest.current;
    if (cur.mode !== 'edit' || !cur.editable || !query) return;
    const opts = { caseSensitive, limit: Number.POSITIVE_INFINITY };
    const ms = findMatches(cur.draft, query, opts);
    const idx = currentRef.current >= 0 && currentRef.current < ms.length ? currentRef.current : 0;
    const r = replaceMatch(cur.draft, ms, idx, replaceText);
    if (!r) return;
    const nextIdx = matchAtOrAfter(findMatches(r.text, query, opts), r.resumeAt);
    cur.setDraft(r.text);
    setNote('');
    pendingNav.current = { kind: 'index', index: Math.max(0, nextIdx) };
    setNavTick((t) => t + 1);
  }, [query, caseSensitive, replaceText]);

  const replaceEvery = useCallback(() => {
    const cur = latest.current;
    if (cur.mode !== 'edit' || !cur.editable || !query) return;
    const r = replaceAll(cur.draft, query, replaceText, { caseSensitive });
    if (!r.count) return;
    cur.setDraft(r.text);
    setNote(`已替换 ${r.count} 处`);
    pendingNav.current = { kind: 'first' };
    setNavTick((t) => t + 1);
  }, [query, caseSensitive, replaceText]);

  return {
    open, mode, editable, query, setQuery, caseSensitive, toggleCase, replaceText, setReplaceText, showReplace, toggleReplace,
    count, label: findCountLabel(query, current, count, truncated), note, next, prev, close, replaceOne, replaceEvery, focusTick, readRef,
  };
}

function isOnScreen(el: any): boolean {
  if (!el.getClientRects?.().length) return false;
  const r = el.getBoundingClientRect();
  const win = globalThis as any;
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < (win.innerHeight ?? Infinity) && r.left < (win.innerWidth ?? Infinity);
}

function isEditable(el: any): boolean {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
}

// 按 ⌘F 时已经选中了一段(单行、不太长)⇒ 直接拿来当查找词,和浏览器一样。
function selectionSeed(mode: RulesViewMode, ta: any, readRoot: any, doc: any): string {
  let s = '';
  if (mode === 'edit') {
    if (ta && doc.activeElement === ta && ta.selectionEnd > ta.selectionStart) s = String(ta.value).slice(ta.selectionStart, ta.selectionEnd);
  } else {
    const sel = (globalThis as any).getSelection?.();
    if (sel && !sel.isCollapsed && readRoot?.contains?.(sel.anchorNode)) s = String(sel.toString());
  }
  return s && s.length <= 200 && !/[\r\n]/.test(s) ? s : '';
}

// ── 查找栏 ─────────────────────────────────────────────────────────────────────

function BarBtn({ label, onPress, accessibilityLabel, active, disabled, wide }: { label: string; onPress: () => void; accessibilityLabel: string; active?: boolean; disabled?: boolean; wide?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={(state: any) => [
        { height: 24, minWidth: 24, paddingHorizontal: wide ? spacing.sm : 4, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
        active ? { backgroundColor: colors.subtleFill, borderWidth: 1, borderColor: colors.accent } : null,
        state.hovered && !disabled ? { backgroundColor: colors.rowHover } : null,
        state.focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 0 } as any : null,
        disabled ? { opacity: 0.35 } : null,
      ]}
    >
      <Text style={{ fontSize: 12, color: active ? colors.text : colors.textSecondary, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

const inputStyle = () => ({
  height: 24, paddingHorizontal: 6, fontSize: 12, color: colors.text, backgroundColor: colors.card,
  borderRadius: 5, borderWidth: 1, borderColor: colors.border, outlineStyle: 'none',
} as any);

export function RulesFindBar({ find }: { find: RulesFindController }) {
  const findEl = useRef<any>(null);
  const replaceEl = useRef<any>(null);
  const latest = useRef(find);
  latest.current = find;

  useEffect(() => {
    const el = findEl.current;
    if (!el) return;
    el.focus?.();
    el.select?.();
  }, [find.focusTick]);

  // 原生 keydown 直接挂在输入框上:Enter/↓ 下一个,Shift+Enter/↑ 上一个,Esc 关闭。
  // stopPropagation ⇒ Esc 只关查找栏,不会顺带把全屏也关了:全屏自己的 Esc 监听挂在 document 的 keydown 上,
  // react-native-web 的 Modal 还在 document 的 keyup 上监听 Esc(onRequestClose)⇒ keyup 的 Esc 也要拦。
  useEffect(() => {
    if (!WEB) return;
    let escArmed = false; // 只有「不在组字中」按下的 Esc,松开时才关(组字中的 Esc 是取消输入法)
    const onFindKey = (e: any) => {
      const action = findKeyAction(e);
      if (!action) return;
      if (action === 'close') escArmed = true;
      e.preventDefault(); e.stopPropagation();
      if (action === 'next') latest.current.next();
      else if (action === 'prev') latest.current.prev();
      // 'close' 等 keyup 再关:keydown 就关的话输入框当场卸掉,随后的 keyup 落到 body 上冒泡到 document,
      // 被 Modal 当成「Esc 退出全屏」。
    };
    const onReplaceKey = (e: any) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); escArmed = true; }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (e.metaKey || e.ctrlKey) latest.current.replaceEvery(); else latest.current.replaceOne(); }
    };
    const onEscUp = (e: any) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (escArmed) { escArmed = false; latest.current.close(); }
    };
    const f = findEl.current;
    const r = replaceEl.current;
    f?.addEventListener?.('keydown', onFindKey);
    r?.addEventListener?.('keydown', onReplaceKey);
    f?.addEventListener?.('keyup', onEscUp);
    r?.addEventListener?.('keyup', onEscUp);
    return () => {
      f?.removeEventListener?.('keydown', onFindKey); r?.removeEventListener?.('keydown', onReplaceKey);
      f?.removeEventListener?.('keyup', onEscUp); r?.removeEventListener?.('keyup', onEscUp);
    };
  }, [find.showReplace, find.mode]);

  const none = !!find.query && find.count === 0;
  const canReplace = find.mode === 'edit' && find.editable && find.count > 0;
  return (
    <View accessibilityRole={'search' as any} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 7, padding: 2, gap: 2, backgroundColor: colors.inputBg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <TextInput
          ref={findEl}
          value={find.query}
          onChangeText={find.setQuery}
          placeholder="查找"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="在规则文件中查找"
          autoCapitalize="none"
          autoCorrect={false}
          style={[inputStyle(), { width: 150 }, none ? { borderColor: colors.failed } : null]}
        />
        <BarBtn label="Aa" active={find.caseSensitive} onPress={find.toggleCase} accessibilityLabel="区分大小写" />
        <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ minWidth: 46, textAlign: 'center', fontSize: 11, color: none ? colors.failed : colors.textMuted }}>
          {find.note || find.label}
        </Text>
        <BarBtn label="↑" disabled={!find.count} onPress={find.prev} accessibilityLabel="上一个 (Shift+Enter)" />
        <BarBtn label="↓" disabled={!find.count} onPress={find.next} accessibilityLabel="下一个 (Enter)" />
        <BarBtn label="替换" wide active={find.showReplace && find.mode === 'edit'} onPress={find.toggleReplace} accessibilityLabel={find.mode === 'edit' ? '显示替换' : '切到编辑并替换'} />
        <BarBtn label="✕" onPress={find.close} accessibilityLabel="关闭查找 (Esc)" />
      </View>
      {find.showReplace && find.mode === 'edit' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <TextInput
            ref={replaceEl}
            value={find.replaceText}
            onChangeText={find.setReplaceText}
            placeholder="替换为"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="替换为"
            autoCapitalize="none"
            autoCorrect={false}
            editable={find.editable}
            style={[inputStyle(), { width: 150 }]}
          />
          <BarBtn label="替换" wide disabled={!canReplace} onPress={find.replaceOne} accessibilityLabel="替换当前这处 (Enter)" />
          <BarBtn label="全部替换" wide disabled={!canReplace} onPress={find.replaceEvery} accessibilityLabel="全部替换" />
        </View>
      ) : null}
    </View>
  );
}
