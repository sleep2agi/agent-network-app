/**
 * Avatar render module — owns the bundled asset handles and the hub-avatar
 * store, and materialises the pure resolution plan from ./avatar-resolve.
 *
 * Chain (mirrors the web dashboard app/lib/avatars.ts @ origin/main):
 *   1. hub avatar_url (node-backed aliases) — cross-device truth, from
 *      GET /api/nodes via hydrateHubAvatars(). Sits ABOVE any local layer;
 *      when cleared, a node-backed alias uses the designed default chain and
 *      SKIPS local (this App has no local layer — see avatar-resolve.ts).
 *   2. named override  3. djb2 pool pick.
 *
 * The pool + djb2 byte-match the web (20/20 sha256 == web manifest _pool,
 * verified 2026-08-01). djb2 (pool) is NOT the h*31 color hash in AliasAvatar —
 * do not merge them (would re-shuffle every assignment).
 */

import { useSyncExternalStore } from 'react';
import type { ImageSourcePropType } from 'react-native';

import {
  POOL_SIZE,
  planAvatarFile,
  poolIndexForAlias,
  poolFileNameForAlias,
} from './avatar-resolve';

// Order + count MUST match the web manifest.json "_pool" (index 0 = avatar-01).
// Metro bundles each require() at build time into an opaque asset handle.
const AVATAR_POOL: ImageSourcePropType[] = [
  require('../../assets/avatars/avatar-01.webp'),
  require('../../assets/avatars/avatar-02.webp'),
  require('../../assets/avatars/avatar-03.webp'),
  require('../../assets/avatars/avatar-04.webp'),
  require('../../assets/avatars/avatar-05.webp'),
  require('../../assets/avatars/avatar-06.webp'),
  require('../../assets/avatars/avatar-07.webp'),
  require('../../assets/avatars/avatar-08.webp'),
  require('../../assets/avatars/avatar-09.webp'),
  require('../../assets/avatars/avatar-10.webp'),
  require('../../assets/avatars/avatar-11.webp'),
  require('../../assets/avatars/avatar-12.webp'),
  require('../../assets/avatars/avatar-13.webp'),
  require('../../assets/avatars/avatar-14.webp'),
  require('../../assets/avatars/avatar-15.webp'),
  require('../../assets/avatars/avatar-16.webp'),
  require('../../assets/avatars/avatar-17.webp'),
  require('../../assets/avatars/avatar-18.webp'),
  require('../../assets/avatars/avatar-19.webp'),
  require('../../assets/avatars/avatar-20.webp'),
];

// Guard the pure/asset split: avatar-resolve's POOL_SIZE drives pool filenames
// and the djb2 modulus; a drift here would mis-map every relative avatar_url.
if (AVATAR_POOL.length !== POOL_SIZE) {
  throw new Error(`avatars: AVATAR_POOL.length ${AVATAR_POOL.length} !== POOL_SIZE ${POOL_SIZE}`);
}

// filename → bundled handle. Relative avatar_url (/avatars/<name>) and the
// named/pool plans resolve through here. Keys must equal avatar-resolve's
// KNOWN_BUNDLED_FILES (pool avatar-NN.webp + named files).
const BUNDLED_BY_FILENAME: Record<string, ImageSourcePropType> = {
  'intern_avatar.png': require('../../assets/intern_avatar.png'),
};
AVATAR_POOL.forEach((src, i) => {
  BUNDLED_BY_FILENAME[`avatar-${String(i + 1).padStart(2, '0')}.webp`] = src;
});

// ── Hub layer store — hydrated from GET /api/nodes ───────────────────────────
let hubMap: Record<string, string> = {}; // alias → non-empty avatar_url
let hubNodeAliases = new Set<string>(); // aliases that HAVE a nodes row (node-backed)
let hubMapKey = ''; // change detector — avoid re-render storms on every poll

/** Feed GET /api/nodes rows into the resolution chain (layer 1). Cheap to call
 *  on every poll: only bumps the version (→ re-render) when content changed. */
export function hydrateHubAvatars(
  nodes: Array<{ alias?: string; avatar_url?: string | null }> | undefined,
): void {
  if (!nodes) return;
  const nextMap: Record<string, string> = {};
  const nextAliases = new Set<string>();
  for (const n of nodes) {
    if (!n || !n.alias) continue;
    nextAliases.add(n.alias);
    if (typeof n.avatar_url === 'string' && n.avatar_url) nextMap[n.alias] = n.avatar_url;
  }
  const key = JSON.stringify(nextMap) + '|' + [...nextAliases].sort().join(',');
  if (key === hubMapKey) return;
  hubMapKey = key;
  hubMap = nextMap;
  hubNodeAliases = nextAliases;
  emitAvatarsChanged();
}

// ── re-render subscription (module store; mirrors web useAvatarsVersion) ──────
const AVATAR_LISTENERS = new Set<() => void>();
let avatarVersion = 0;
function emitAvatarsChanged(): void {
  avatarVersion++;
  AVATAR_LISTENERS.forEach((l) => l());
}
function subscribeAvatars(cb: () => void): () => void {
  AVATAR_LISTENERS.add(cb);
  return () => {
    AVATAR_LISTENERS.delete(cb);
  };
}
/** Subscribe a component so it re-resolves when the hub map hydrates/changes. */
export function useAvatarsVersion(): number {
  return useSyncExternalStore(subscribeAvatars, () => avatarVersion, () => avatarVersion);
}

/**
 * Resolve an alias to a renderable source, or null (caller shows the letter
 * pill). Materialises the pure plan from planAvatarFile against the current
 * hub store — see avatar-resolve.ts for the chain semantics.
 */
export function getAvatarSource(alias?: string | null): ImageSourcePropType | null {
  const plan = planAvatarFile(alias, { nodeAliases: hubNodeAliases, map: hubMap });
  if (plan === 'none') return null;
  if (plan.startsWith('remote:')) return { uri: plan.slice('remote:'.length) };
  return BUNDLED_BY_FILENAME[plan.slice('file:'.length)] ?? null;
}

// Re-exported for existing callers + parity smoke checks.
export { poolIndexForAlias, poolFileNameForAlias };

/** Test-only: reset hub state between cases. */
export function __resetHubAvatarsForTest(): void {
  hubMap = {};
  hubNodeAliases = new Set<string>();
  hubMapKey = '';
}
