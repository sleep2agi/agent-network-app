// Badge anchoring: the math (badge-anchor.ts) and the sweep (every icon badge uses it).
import { readFileSync as readRaw } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BADGE_TUCK, MIN_ICON_VISIBLE, badgeOffset, badgeOffsetCentered, clampBadge, coveredShare, intersectionArea, labelClearanceMargin, pillBadgeWidth } from './badge-anchor';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}${extra ? ` (${extra})` : ''}`); };

// ── geometry ──
ck('intersection: disjoint = 0', intersectionArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }) === 0);
ck('intersection: touching edge = 0', intersectionArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 }) === 0);
ck('intersection: overlap', intersectionArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }) === 25);
ck('covered share: full cover = 1', coveredShare({ x: 0, y: 0, w: 10, h: 10 }, { x: -1, y: -1, w: 20, h: 20 }) === 1);
ck('covered share: zero-size icon = 0', coveredShare({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 5, h: 5 }) === 0);

const o = badgeOffset(3, 3, 18, 16);
ck('offset: left edge tucked inside the glyph right edge', o.left === 3 + 18 - Math.round(16 * BADGE_TUCK));
ck('offset: bottom edge tucked inside the glyph top edge', o.top + 16 === 3 + Math.round(16 * BADGE_TUCK));
ck('centered: equals explicit glyph origin', JSON.stringify(badgeOffsetCentered(24, 24, 18, 16)) === JSON.stringify(o));

// Label clearance: the sidebar row (24 px icon box, 12 px gap) with a 29 px 「99+」.
const sb = badgeOffsetCentered(24, 24, 18, 16);
const extra = labelClearanceMargin(sb.left, 29, 24, 12);
ck('clearance: badge right edge ends ≥ 2 px before the label', sb.left + 29 + 2 <= 24 + extra + 12, `extra ${extra}`);
ck('clearance: tight (no more than needed)', sb.left + 29 + 2 > 24 + (extra - 1) + 12);
ck('clearance: 0 when the badge already fits', labelClearanceMargin(0, 10, 24, 12) === 0);

// The icon badges in the app, at the widest count text ("99+") and the narrowest ("1").
const SITES = [
  { name: 'server sidebar 节点', box: [24, 24], glyph: 18, h: 16 },
  { name: 'desktop rail', box: [40, 40], glyph: 22, h: 16 },
  { name: 'mobile nav rail', box: [52, 30], glyph: 24, h: 18 },
];
for (const s of SITES) {
  const gx = (s.box[0] - s.glyph) / 2, gy = (s.box[1] - s.glyph) / 2;
  const icon = { x: gx, y: gy, w: s.glyph, h: s.glyph };
  const off = badgeOffsetCentered(s.box[0], s.box[1], s.glyph, s.h);
  const shares = [s.h, 20, 26, 32, 40].map(w => coveredShare(icon, { x: off.left, y: off.top, w, h: s.h }));
  ck(`${s.name}: ≥ ${MIN_ICON_VISIBLE * 100}% of the icon visible at every badge width`, shares.every(x => x <= 1 - MIN_ICON_VISIBLE), shares.map(x => x.toFixed(2)).join('/'));
  ck(`${s.name}: coverage does not grow with the count text`, shares.every(x => x === shares[0]));
  // The old anchoring (right edge fixed) grew INTO the icon as the text widened.
  const oldRight = s.name.startsWith('server') ? -8 : s.name.startsWith('desktop') ? 3 : 4;
  const oldTop = s.name.startsWith('server') ? -6 : s.name.startsWith('desktop') ? 3 : -3;
  const old = (w: number) => coveredShare(icon, { x: s.box[0] - oldRight - w, y: oldTop, w, h: s.h });
  ck(`${s.name}: old right-anchored badge covered more at "99+" than new`, old(26) > shares[2], `old ${old(26).toFixed(2)} vs new ${shares[2].toFixed(2)}`);
}

// ── sweep: every icon badge style is anchored through badgeOffset*, never with `right:` ──
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const posix = (s: string) => s.split(sep).join('/');
const read = (rel: string) => readRaw(join(root, ...rel.split('/')), 'utf8').replace(/\r\n?/g, '\n');
const STYLE_SITES: Array<{ file: string; key: string }> = [
  { file: 'src/ServerSidebar.tsx', key: 'badge' },
  { file: 'App.tsx', key: 'railBadge' },
  { file: 'src/MobileNavRail.tsx', key: 'badge' },
  { file: 'src/app-styles.ts', key: 'tabBadge' },
];
for (const site of STYLE_SITES) {
  const src = read(site.file);
  const m = src.match(new RegExp(`\\n\\s*${site.key}: \\{([\\s\\S]*?)\\n?\\s*\\},?\\n`));
  const body = m?.[1] ?? '';
  ck(`${posix(site.file)} ${site.key}: style found`, !!m);
  ck(`${posix(site.file)} ${site.key}: positioned with badgeOffset*`, /badgeOffset(Centered)?\(/.test(body), body.slice(0, 120));
  ck(`${posix(site.file)} ${site.key}: no right: anchor (grows inward)`, !/\bright\s*:/.test(body));
}
// ── clamp into the rail item (#429) ──
ck('pill width: one digit = its height', pillBadgeWidth('3', 10, 18, 4, 2) === 18);
ck('pill width: 「99+」 at 10px ≈ 30 (measured 30 in the drive)', Math.abs(pillBadgeWidth('99+', 10, 18, 4, 2) - 30) <= 1);
ck('clamp: inside bounds = unchanged', JSON.stringify(clampBadge({ left: 10, top: -3 }, 18, { minTop: -5, maxRight: 40 })) === JSON.stringify({ left: 10, top: -3 }));
ck('clamp: too high → pulled down to minTop', clampBadge({ left: 10, top: -9 }, 18, { minTop: -4, maxRight: 40 }).top === -4);
ck('clamp: too wide → ends at maxRight', (() => { const o = clampBadge({ left: 30, top: 0 }, 30, { minTop: -4, maxRight: 48 }); return o.left + 30 === 48; })());
// MobileNavRail at every 界面密度 (item / rail sizes from nav-chrome.ts; 更紧凑 = aligned 44 dp items, no gap). Worst case
// 「99+」 still leaves ≥ MIN_ICON_VISIBLE of the glyph and ends inside the rail. Same formulas as MobileNavRail's badgeBox.
for (const [name, d, railW, itemH, labelH] of [['更紧凑', 0.75, 56, 44, 13], ['紧凑', 0.85, 62, 48, 13], ['标准', 1, 72, 56, 14], ['宽松', 1.15, 83, 64, 14]] as const) {
  const indW = Math.round(52 * d), indH = Math.round(30 * d), glyph = Math.round(24 * d), h = Math.max(14, Math.min(18, Math.round(18 * d))), font = h < 16 ? 9 : 10, pad = h < 16 ? 3 : 4;
  const freeAbove = (itemH - indH - 3 - labelH) / 2;
  for (const text of ['3', '99+']) {
    const w = pillBadgeWidth(text, font, h, pad, 2);
    const o = clampBadge(badgeOffsetCentered(indW, indH, glyph, h), w, { minTop: -freeAbove, maxRight: (railW + indW) / 2 - 1 });
    const g = { x: (indW - glyph) / 2, y: (indH - glyph) / 2, w: glyph, h: glyph };
    const share = coveredShare(g, { x: o.left, y: o.top, w, h });
    ck(`rail ${name} 「${text}」: glyph ≥ ${MIN_ICON_VISIBLE * 100}% visible (${Math.round((1 - share) * 100)}%)`, share <= 1 - MIN_ICON_VISIBLE);
    ck(`rail ${name} 「${text}」: stays inside the rail`, o.left + w <= (railW + indW) / 2);
  }
}

// Judge self-test: the old ServerSidebar line must be flagged.
const OLD = `\n  badge: { position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16 },\n`;
const oldBody = OLD.match(/\n\s*badge: \{([\s\S]*?)\n?\s*\},?\n/)?.[1] ?? '';
ck('judge self-test: the 0.2.124 sidebar badge would be flagged', /\bright\s*:/.test(oldBody) && !/badgeOffset/.test(oldBody));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
