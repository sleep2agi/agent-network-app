// #2064: view decisions for the read-only 「已登记节点」 block in the Agents list.
//
// Two defects were reported after 0.2.287 shipped:
//   1. Typing a query that only matches registered nodes left the block collapsed, so the
//      header said "N" while no row was visible — the match was unreachable.
//   2. With more than 8 rows the block cut the list at 8 and, on a short list (≤10 live
//      sessions) with no search box in view, the 9th+ nodes had no entry point at all.
//
// Both are pure decisions, so they live here and are unit-tested without rendering RN.

/** How many rows the block shows before it needs a "show more" control. */
export const REGISTERED_PAGE = 8;

/**
 * Should the block be expanded?
 * A non-empty query always wins: a search that matches a registered node must be visible,
 * even if the user collapsed the block earlier.
 */
export function registeredExpanded(query: string, collapsed: boolean): boolean {
  return query.trim().length > 0 ? true : !collapsed;
}

/** Rows to render, honouring the page size and an explicit "show all" request. */
export function registeredVisibleCount(total: number, showAll: boolean): number {
  if (total <= 0) return 0;
  return showAll ? total : Math.min(total, REGISTERED_PAGE);
}

/**
 * Does the block need a visible way to reach the rest?
 * True whenever rows are hidden, which is exactly when the caller must render the
 * show-more control (and, on top of it, keep the search box reachable).
 */
export function registeredNeedsMore(total: number, showAll: boolean): boolean {
  return total > registeredVisibleCount(total, showAll);
}

/** Rows still hidden behind the control. */
export function registeredHiddenCount(total: number, showAll: boolean): number {
  return Math.max(0, total - registeredVisibleCount(total, showAll));
}

/**
 * Is the block's header still worth pressing? No: while a query is forcing the block
 * open, a tap cannot change what is on screen, so it must not silently flip the
 * persisted collapse preference either.
 */
export function registeredToggleEnabled(query: string): boolean {
  return query.trim().length === 0;
}

/**
 * Scope key for the "show all" expansion. Any change of query or of the row set
 * invalidates it, so a search cannot leave the whole unfiltered directory expanded.
 */
export function showAllScopeKey(query: string, keys: readonly string[]): string {
  return `${query.trim().toLocaleLowerCase()}\u0000${keys.join('\u001f')}`;
}

/**
 * Search counter for the Agents header. Registered-only matches are counted: reading
 * "0 / N" while matching rows are on screen is exactly the confusion being fixed.
 */
export function searchCountLabel(query: string, shown: number, total: number, registered: number): string | null {
  if (query.trim().length === 0) return null;
  return `${shown} / ${total} agents${registered > 0 ? ` + ${registered} 已登记` : ''}`;
}

/** True when the search matched anything at all — live sessions or registered nodes. */
export function searchHasMatches(shown: number, registered: number): boolean {
  return shown + registered > 0;
}
