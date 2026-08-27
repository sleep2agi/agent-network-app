export interface SideThreadRequestToken {
  scopeKey: string;
  lane: string;
  sequence: number;
}

/** Per-drawer async ownership gate. `render` is deliberately synchronous so
 * a late response from scope A is rejected during the render that selects B,
 * before React runs cleanup effects. */
export const createSideThreadScopeGate = () => {
  let renderedScope = '';
  const sequences = new Map<string, number>();
  return {
    render(scopeKey: string) {
      renderedScope = scopeKey;
    },
    begin(scopeKey: string, lane: string): SideThreadRequestToken {
      const key = `${scopeKey}\u0000${lane}`;
      const sequence = (sequences.get(key) ?? 0) + 1;
      sequences.set(key, sequence);
      return { scopeKey, lane, sequence };
    },
    isCurrent(token: SideThreadRequestToken): boolean {
      return renderedScope === token.scopeKey && sequences.get(`${token.scopeKey}\u0000${token.lane}`) === token.sequence;
    },
  };
};
