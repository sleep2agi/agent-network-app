/**
 * Pure avatar-resolution logic (NO react-native / no asset require()s) so the
 * resolution chain is node-unit-testable. `avatars.ts` owns the bundled asset
 * handles (require('.webp')) and materialises the plan this module returns.
 *
 * Split rationale (2026-08-01, R1 avatar 接线): avatars.ts require()s .webp at
 * module scope — those only resolve under Metro, so importing it in a node test
 * throws. Keeping the decision here (strings only) lets the bidirectional test
 * run in plain node while the render module stays a thin materialiser.
 *
 * Resolution order mirrors the web dashboard (app/lib/avatars.ts @ origin/main):
 *   1. hub avatar_url (node-backed aliases only) — cross-device truth
 *   2. named override
 *   3. djb2 pool pick
 */

// MUST equal AVATAR_POOL.length in avatars.ts — asserted there at module load.
export const POOL_SIZE = 20;

// Named overrides: alias → bundled filename. Mirror manifest.json non-`_pool`.
export const NAMED_ALIAS_TO_FILE: Record<string, string> = {
  '通信N站马': 'intern_avatar.png',
};

const POOL_FILENAMES: string[] = Array.from(
  { length: POOL_SIZE },
  (_, i) => `avatar-${String(i + 1).padStart(2, '0')}.webp`,
);

// Filenames the App actually bundles — a relative avatar_url must map to one of
// these to render (else it falls through, avoiding a broken relative reference).
export const KNOWN_BUNDLED_FILES: Set<string> = new Set([
  ...POOL_FILENAMES,
  ...Object.values(NAMED_ALIAS_TO_FILE),
]);

/** Stable per-alias pool index. djb2 over UTF-16 code units — byte-matches the
 *  web dashboard's poolPick (verified). NOT the h*31 color-palette hash. */
export function poolIndexForAlias(alias: string): number {
  if (!alias) return 0;
  let h = 5381;
  for (let i = 0; i < alias.length; i++) h = ((h << 5) + h + alias.charCodeAt(i)) >>> 0;
  return h % POOL_SIZE;
}

export function poolFileNameForAlias(alias: string): string {
  return `avatar-${String(poolIndexForAlias(alias) + 1).padStart(2, '0')}.webp`;
}

function basenameOf(url: string): string {
  const noHashQuery = url.split(/[?#]/)[0];
  const parts = noHashQuery.split('/');
  return parts[parts.length - 1] || '';
}

/** Hub state, passed in explicitly so this stays pure. */
export interface HubAvatarState {
  nodeAliases: Set<string>; // aliases that HAVE a nodes row (node-backed)
  map: Record<string, string>; // alias → non-empty avatar_url
}

/**
 * Decide what an alias's avatar should be, as a materialiser-agnostic tag:
 *   'remote:<uri>'  — absolute http(s) URL, render remotely
 *   'file:<name>'   — a bundled asset filename (pool or named)
 *   'none'          — nothing resolves; caller shows the letter pill
 *
 * Semantic fork (identical to web):
 *   - Node-backed (alias ∈ nodeAliases): hub is the whole truth. A set url wins
 *     (a set-but-unresolvable relative → 'none' = pill, matching web's 404→pill,
 *     NOT a silent divergence to the pool). Cleared/none (alias ∈ nodeAliases
 *     but no map entry) → designed default chain (named → pool), SKIPPING any
 *     local layer. 🔴 There is NO local layer in this App, so "skip local on
 *     clear" holds structurally — this function takes no local override at all.
 *   - Session-only (alias ∉ nodeAliases): named → pool (unchanged from before).
 */
export function planAvatarFile(alias: string | null | undefined, hub: HubAvatarState): string {
  if (!alias) return 'none';
  if (hub.nodeAliases.has(alias)) {
    const url = (hub.map[alias] || '').trim();
    if (url) {
      if (/^https?:\/\//i.test(url)) return `remote:${url}`;
      const f = basenameOf(url);
      return KNOWN_BUNDLED_FILES.has(f) ? `file:${f}` : 'none';
    }
    // cleared/none → fall through to the designed default chain below
  }
  const namedFile = NAMED_ALIAS_TO_FILE[alias];
  if (namedFile) return `file:${namedFile}`;
  return `file:${poolFileNameForAlias(alias)}`;
}
