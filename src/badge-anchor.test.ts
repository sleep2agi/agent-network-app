// Badge anchoring: the math (badge-anchor.ts) and the sweep (every icon badge uses it).
import { readFileSync as readRaw } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BADGE_TUCK, MIN_ICON_VISIBLE, badgeOffset, badgeOffsetCentered, coveredShare, intersectionArea, labelClearanceMargin } from './badge-anchor';

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
];
for (const site of STYLE_SITES) {
  const src = read(site.file);
  const m = src.match(new RegExp(`\\n\\s*${site.key}: \\{([\\s\\S]*?)\\n?\\s*\\},?\\n`));
  const body = m?.[1] ?? '';
  ck(`${posix(site.file)} ${site.key}: style found`, !!m);
  ck(`${posix(site.file)} ${site.key}: positioned with badgeOffset*`, /badgeOffset(Centered)?\(/.test(body), body.slice(0, 120));
  ck(`${posix(site.file)} ${site.key}: no right: anchor (grows inward)`, !/\bright\s*:/.test(body));
}
// Judge self-test: the old ServerSidebar line must be flagged.
const OLD = `\n  badge: { position: 'absolute', top: -6, right: -8, minWidth: 16, height: 16 },\n`;
const oldBody = OLD.match(/\n\s*badge: \{([\s\S]*?)\n?\s*\},?\n/)?.[1] ?? '';
ck('judge self-test: the 0.2.124 sidebar badge would be flagged', /\bright\s*:/.test(oldBody) && !/badgeOffset/.test(oldBody));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
