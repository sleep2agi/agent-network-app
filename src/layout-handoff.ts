// Carries a screen's local UI state (unsent draft, selected node tab) across the
// remount that a fold/unfold causes.
//
// Why a store and not "keep the component mounted": the phone stack renders
// ChatScreen / NodeDetailScreen as direct children of the root, the two-pane
// renders them inside the right pane — different tree positions, so React
// remounts them and their useState is gone. Rewrapping the phone tree to make
// the positions line up would change the phone layout, which must stay as-is.
//
// Why generation-gated: on the phone today, leaving a chat drops its draft and
// re-entering starts empty. That must not change. So a value is only kept when
// the unmount happened because the layout changed (App bumps the generation in
// the render that switches layouts, i.e. before the old screen's cleanup runs);
// an ordinary back / navigate-away unmount discards it, exactly as before.

let generation = 0;
const kept = new Map<string, unknown>();

/** Called by App in the render where the layout (phone ⇄ two-pane) changes. */
export function bumpLayoutGeneration(): void {
  generation += 1;
}

export function layoutGeneration(): number {
  return generation;
}

/**
 * Call from a screen's unmount cleanup with the generation it mounted under.
 * Keeps `value` only if the layout switched since then; otherwise forgets the key.
 */
export function releaseOnUnmount(key: string, value: unknown, mountedGeneration: number): void {
  if (generation !== mountedGeneration) kept.set(key, value);
  else kept.delete(key);
}

/** Call once on mount: returns the handed-off value (and forgets it), or undefined. */
export function takeHandoff<T>(key: string): T | undefined {
  if (!kept.has(key)) return undefined;
  const value = kept.get(key) as T;
  kept.delete(key);
  return value;
}

/** Test-only reset. */
export function __resetLayoutHandoff(): void {
  generation = 0;
  kept.clear();
}
