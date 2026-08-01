/**
 * Avatar render module — owns the bundled asset handles and the hub-avatar
 * store, and materialises the pure resolution plan from ./avatar-resolve.
 *
 * Chain (mirrors the web dashboard app/lib/avatars.ts @ origin/main):
 *   1. hub avatar_url (node-backed aliases) — cross-device truth, from
 *      GET /api/nodes via hydrateHubAvatars(). Sits ABOVE the local layer;
 *      when cleared, a node-backed alias uses the designed default chain and
 *      SKIPS local (clear-consistency — see avatar-resolve.ts).
 *   2. local echo (R2, session-only aliases only) — per-device persisted store
 *      of what the user set, seeded via initLocalAvatars/setLocalAvatarEcho.
 *   3. named override  4. djb2 pool pick.
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

// ── Local echo store (persisted (FileSystem)) — session-only aliases' only layer.
// Written after a successful hub PUT (mirrors web's setAvatarUrl localStorage echo)
// so the chosen avatar shows immediately, before the next /api/nodes poll.
// 🔴 planAvatarFile consults this ONLY for session-only aliases; node-backed skip
// it (clear-consistency). Persistence is injected so this module stays testable.
let localMap: Record<string, string> = {};
let persistLocal: ((map: Record<string, string>) => void) | null = null;

/** Seed from disk + wire the persistence writer (called once on boot). */
export function initLocalAvatars(
  saved: Record<string, string> | null,
  persist: (m: Record<string, string>) => void,
): void {
  localMap = saved && typeof saved === 'object' ? { ...saved } : {};
  persistLocal = persist;
  emitAvatarsChanged();
}

/** Set/clear a per-device local echo (url falsy/blank → remove), persist, re-render. */
export function setLocalAvatarEcho(alias: string, url: string | null): void {
  if (!alias) return;
  const next = { ...localMap };
  if (url && url.trim()) next[alias] = url.trim();
  else delete next[alias];
  localMap = next;
  if (persistLocal) {
    try { persistLocal(next); } catch {}
  }
  emitAvatarsChanged();
}

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
  const plan = planAvatarFile(alias, { nodeAliases: hubNodeAliases, map: hubMap }, localMap);
  if (plan === 'none') return null;
  if (plan.startsWith('remote:')) return { uri: plan.slice('remote:'.length) };
  return BUNDLED_BY_FILENAME[plan.slice('file:'.length)] ?? null;
}

/** Materialise a bundled filename ('avatar-09.webp' / 'intern_avatar.png') to its
 *  image source — for the pool picker UI to render each choice. */
export function sourceForFile(filename: string): ImageSourcePropType | null {
  return BUNDLED_BY_FILENAME[filename] ?? null;
}

/** Is this alias node-backed (has a hub nodes row) right now? Drives the R2 edit
 *  disclosure — only node-backed aliases can set a hub avatar (session-only 404).
 *  Read after useAvatarsVersion() so it reflects the latest /api/nodes hydration. */
export function isNodeBacked(alias?: string | null): boolean {
  return !!alias && hubNodeAliases.has(alias);
}

// Re-exported for existing callers + parity smoke checks.
export { poolIndexForAlias, poolFileNameForAlias };

/** Test-only: reset hub state between cases. */
export function __resetHubAvatarsForTest(): void {
  hubMap = {};
  hubNodeAliases = new Set<string>();
  hubMapKey = '';
  localMap = {};
  persistLocal = null;
}
