// Where a count badge sits relative to the icon it annotates.
//
// 0.2.124, 服务器 → left nav: the 「99+」 badge on 节点 covered its icon. Every icon badge was placed
// with `right: -N` against the icon's box, so the badge's RIGHT edge was fixed and a wider text
// ("99+", ~26 px) grew leftward, over the glyph. The rule here anchors the badge's LEFT edge just
// inside the glyph's top-right corner, so wider text grows outward (away from the icon) and the
// overlap with the glyph is a small corner square whatever the count.
//
// Pure (no react-native) so the geometry is tested directly: badge-anchor.test.ts.

export interface Rect { x: number; y: number; w: number; h: number }

/** How far the badge tucks into the glyph, as a fraction of the badge height. */
export const BADGE_TUCK = 0.35;
/** At least this share of the glyph must stay uncovered by the badge. */
export const MIN_ICON_VISIBLE = 0.6;

/**
 * Absolute offsets (relative to the box the badge is positioned in) for a badge of height `badgeH`
 * next to a square glyph of `glyphSize` whose top-left sits at (glyphX, glyphY) in that box.
 * Use as `{ position: 'absolute', left, top }` — never `right`, which would grow the badge inward.
 */
export function badgeOffset(glyphX: number, glyphY: number, glyphSize: number, badgeH: number): { left: number; top: number } {
  const tuck = Math.round(badgeH * BADGE_TUCK);
  return { left: glyphX + glyphSize - tuck, top: glyphY - badgeH + tuck };
}

/** Same, for a glyph centred in a `boxW × boxH` container (how every icon slot here lays out). */
export function badgeOffsetCentered(boxW: number, boxH: number, glyphSize: number, badgeH: number): { left: number; top: number } {
  return badgeOffset((boxW - glyphSize) / 2, (boxH - glyphSize) / 2, glyphSize, badgeH);
}

export function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Share of the icon covered by the badge (0–1). */
export function coveredShare(icon: Rect, badge: Rect): number {
  const area = icon.w * icon.h;
  return area > 0 ? intersectionArea(icon, badge) / area : 0;
}

/**
 * Growing outward means growing toward whatever sits right of the icon (the 服务器 sidebar's row
 * label starts `gap` px after the icon box). Extra right margin the icon box needs so a badge up to
 * `maxBadgeW` wide ends at least `clearance` px before that label. 0 when it already fits.
 */
export function labelClearanceMargin(offsetLeft: number, maxBadgeW: number, boxW: number, gap: number, clearance = 2): number {
  return Math.max(0, Math.ceil(offsetLeft + maxBadgeW + clearance - boxW - gap));
}
