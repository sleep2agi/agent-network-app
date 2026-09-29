// 手机看板宽度模型 + 横向分页里不许出现 flex / flexBasis / 百分比宽的静态检查。
// 起因:0.2.143 安卓真机看板列塌成约 10px 竖条(原生 Yoga:flex: 1 + flexBasis: 'auto' ⇒ 基准 0,width 被忽略)。
import { readFileSync } from 'node:fs';
import { boardLayout, boardWidth, FALLBACK_WIDTH, MIN_PHONE_COLUMN, NARROW, pageAt } from './task-board-layout';
let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const G = 16;

// ── 宽度来源 ──
ck('container 0 ⇒ window width', boardWidth(0, 390) === 390);
ck('container undefined ⇒ window width', boardWidth(undefined, 412) === 412);
ck('container null ⇒ window width', boardWidth(null, 360) === 360);
ck('container NaN / negative ⇒ window width', boardWidth(NaN, 393) === 393 && boardWidth(-5, 393) === 393);
ck('both unusable ⇒ fallback 390', boardWidth(0, 0) === FALLBACK_WIDTH && boardWidth(undefined, undefined) === FALLBACK_WIDTH && FALLBACK_WIDTH === 390);
ck('measured container wins over window', boardWidth(360, 1200) === 360);

// ── 第一帧(onLayout 之前 0)就是一列一屏,不是三列挤在一起 ──
const first = boardLayout(0, 390, G);
ck('first native pass (0) on a 390 phone is paged', first.mode === 'paged');
ck('first pass column = 390 − 2×16 = 358', first.mode === 'paged' && first.columnWidth === 358 && first.pageWidth === 390);
const noWindow = boardLayout(undefined, 0, G);
ck('no width at all still pages at ≥ 240', noWindow.mode === 'paged' && noWindow.columnWidth >= MIN_PHONE_COLUMN);

// ── 全部手机宽:列 ≥ 240,列 + 两侧留白 == 页宽(snap 一页正好一列)──
let minCol = Infinity, aligned = true, paged = true;
for (let w = 1; w < NARROW; w++) {
  const l = boardLayout(w, 0, G);
  if (l.mode !== 'paged') { paged = false; continue; }
  minCol = Math.min(minCol, l.columnWidth);
  if (Math.abs(l.columnWidth + 2 * l.gutter - l.pageWidth) > 1e-9 || l.gutter < 0) aligned = false;
}
ck('every width < 700 is paged', paged);
ck(`phone column never under ${MIN_PHONE_COLUMN}dp (min seen ${minCol})`, minCol >= MIN_PHONE_COLUMN && MIN_PHONE_COLUMN === 240);
ck('column + gutters == page width for every phone width', aligned);
ck('360 phone: page 360 / column 328', (() => { const l = boardLayout(360, 0, G); return l.mode === 'paged' && l.pageWidth === 360 && l.columnWidth === 328; })());

// ── 折叠屏展开 / 平板 / 桌面:三列等分 ──
ck('700 ⇒ equal columns', boardLayout(700, 0, G).mode === 'columns');
ck('foldable 884 ⇒ equal columns', boardLayout(884, 0, G).mode === 'columns');
ck('fold change: 0 container + unfolded window 884 ⇒ columns', boardLayout(0, 884, G).mode === 'columns');
ck('rotation: 0 container + landscape phone 844 ⇒ columns', boardLayout(0, 844, G).mode === 'columns');

// ── 偏移 → 页 ──
ck('pageAt 0 / 390 / 780', pageAt(0, 390, 3) === 0 && pageAt(390, 390, 3) === 1 && pageAt(780, 390, 3) === 2);
ck('pageAt rounds mid-swipe', pageAt(200, 390, 3) === 1 && pageAt(190, 390, 3) === 0);
ck('pageAt clamps overscroll', pageAt(-40, 390, 3) === 0 && pageAt(5000, 390, 3) === 2);
ck('pageAt with 0 page width / NaN offset', pageAt(100, 0, 3) === 0 && pageAt(NaN, 390, 3) === 0);

// ── 静态检查:横向分页里只有数值宽度 ──
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const board = norm('./RequirementBoard.tsx');
const parts = norm('./TaskBoardParts.tsx');
const a = board.indexOf('paged-board:start'), b = board.indexOf('paged-board:end');
ck('paged board markers present', a > 0 && b > a);
const block = board.slice(a, b);
const tagEnd = block.indexOf('testID="req-board"');
const children = tagEnd > 0 ? block.slice(block.indexOf('>', tagEnd) + 1, block.lastIndexOf('</ScrollView>')) : '';
ck('paged ScrollView children found', children.includes('renderColumn(col)'));
ck('no flex shorthand inside the horizontal ScrollView', !/\bflex\s*:/.test(children));
ck('no flexBasis inside the horizontal ScrollView', !/flexBasis/.test(children));
ck('no percentage width inside the horizontal ScrollView', !/['"`][\d.]+%['"`]/.test(children) && !/%`/.test(children));
ck('page width and column width are the numeric layout values', /width:\s*pw\b/.test(children) && /width:\s*columnWidth\b/.test(children));
ck('snap interval is the page width', /snapToInterval=\{pw\}/.test(block));
ck('paged columns use columnPaged, not the desktop flex column', /layout\.mode === 'paged' \? s\.columnPaged : s\.column\b/.test(board));
ck("the old flexBasis: 'auto' override is gone (it is ignored by native Yoga when flex > 0)", !/flexBasis:\s*'auto'/.test(board));
ck('narrow comes from the width model, not width > 0', /const narrow = layout\.mode === 'paged'/.test(board) && !/width > 0 && width < NARROW/.test(board));
ck('board width falls back to the window width', /boardLayout\(measured, windowWidth,/.test(board) && /useWindowDimensions\(\)\.width/.test(board));
const style = (name: string) => { const m = parts.match(new RegExp(`\\n\\s*${name}: \\{([^\\n]*)\\},\\n`)); return m ? m[1] : null; };
for (const name of ['columnPaged', 'boardPaged']) {
  const body = style(name);
  ck(`${name} style exists`, body !== null);
  ck(`${name} has no flex / flexBasis / % width`, body !== null && !/\bflex\s*:/.test(body) && !/flexBasis/.test(body) && !/%/.test(body));
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
