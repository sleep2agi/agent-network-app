// 更紧凑: the Android two-pane nav rail lines up with the agent list next to it (0.2.116, the owner
// on 0.2.115: 「这里面的各个节点，你是不是可以跟左边那个 agent、定时任务那些东西对齐一下」).
//
// What "aligned" means here, concretely:
//   1. Same pitch. Every agent row is one fixed height (denserRowPitch: 44 dp at OS font 1.0 =
//      the touch minimum; two text lines decide it above that, e.g. 49.1 dp at OS 1.15, and a
//      one-line row is padded to the same height), the list separators overlap the row above
//      instead of adding height, and each rail item is exactly that tall with no gap between items.
//   2. Same starting line. The first rail item starts at the same y as the first list row — list
//      head + filter bar + first group header, as *laid out* (AgentsScreen publishes it), not
//      guessed — so rail item n and list row n share one horizontal band: the rail icon sits level
//      with the avatar and its label under it, both centred on the row's centre line.
//   3. Same text size. Row time, group header and rail label are one size (ui-scale listText).
// It is the list's *resting* position: rows scroll, the rail does not. Pure (no react-native) so
// the math is unit-tested; AgentsScreen and MobileNavRail do the wiring.
import { AGENT_ROW_DENSER, AGENT_ROW_TOUCH_MIN } from './agent-row-model';
import { LIST_TEXT_DENSER } from './ui-scale';

/** Same 0.1 dp rounding src/ui-text.tsx applies to a scaled lineHeight (scaleTextStyle). */
const scaled = (n: number, m: number) => Math.round(n * m * 10) / 10;

/**
 * Row height = row pitch at 更紧凑, for a dense-text multiplier `m` (uiScale().denseFontMultiplier):
 * two lines (name + preview line heights) + the line gap + vertical padding, never under 44.
 */
export function denserRowPitch(m: number): number {
  const mm = Number.isFinite(m) && m > 0 ? m : 1;
  const g = AGENT_ROW_DENSER;
  const lines = Math.max(g.lineMin, scaled(LIST_TEXT_DENSER.name.lineHeight ?? 18, mm))
    + Math.max(g.lineMin, scaled(LIST_TEXT_DENSER.preview.lineHeight ?? 16, mm));
  return Math.max(AGENT_ROW_TOUCH_MIN, Math.round((2 * g.padY + g.bodyGap + lines) * 10) / 10);
}

let firstRowTop: number | null = null;
const listeners = new Set<() => void>();
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Top of the first agent row, in dp from the top of the list pane (unscrolled). Jitter < 0.5 dp is ignored. */
export function publishListFirstRowTop(top: number): void {
  if (!valid(top)) return;
  if (firstRowTop !== null && Math.abs(firstRowTop - top) < 0.5) return;
  firstRowTop = top;
  listeners.forEach(l => l());
}
export const listFirstRowTop = (): number | null => firstRowTop;
export function onListFirstRowTopChange(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/**
 * Rail layout that puts rail item n beside list row n. `above` = what the rail draws above its
 * tabs (its own top padding + the brand mark). null when the list has not been laid out yet — the
 * rail keeps its ordinary layout. If the brand block is taller than the list head, the first item
 * cannot move up: `aligned` is false and the rail starts right under the brand.
 */
export function alignedRailLayout(top: number | null, pitch: number, above: number): { tabsPaddingTop: number; itemHeight: number; gap: number; aligned: boolean } | null {
  if (!valid(top) || !valid(pitch) || pitch <= 0 || !valid(above)) return null;
  const want = top - above;
  return { tabsPaddingTop: Math.max(0, Math.round(want * 10) / 10), itemHeight: pitch, gap: 0, aligned: want >= 0 };
}

/** Test-only. */
export function __resetListFirstRowTop(): void {
  firstRowTop = null;
}
