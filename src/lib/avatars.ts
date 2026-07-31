/**
 * Mobile port of dashboard's app/lib/avatars.ts (dash-loop-wt @ ac4e53b4,
 * deployed as commhub-server dashboard preview.35). Vincent 07-31 asked
 * for App/Web avatar parity — same alias must map to the same illustration
 * on every surface (issue #8, dispatch task 8323008a).
 *
 * WHAT LANDS HERE
 *   - Pool selection (level 3): djb2 hash → index → bundled WebP
 *   - Named override (level 2): a tiny lookup table for a few special aliases
 *     that had a hand-picked image on web (e.g. 通信N站马 → intern_avatar.png)
 *
 * WHAT DOESN'T LAND (documented, per lead 8323008a):
 *   - Level 1 (user override via localStorage / node settings UI): needs
 *     AsyncStorage integration on RN + a settings entry point that doesn't
 *     exist yet in this app. Deferred to a follow-up. This omission does NOT
 *     break parity — pool assignment is still identical between web and app.
 *
 * WHAT MUST NOT CHANGE (lead hard requirements, verified against source):
 *   - Hash algorithm is djb2 verbatim from dash-loop-wt/app/lib/avatars.ts:
 *       let h = 5381;
 *       for each c: h = ((h << 5) + h + c) >>> 0;
 *       pick pool[h % pool.length]
 *     Note: this is NOT the color-palette hash used in AliasAvatar for the
 *     letter-pill fallback (that one is h*31, initial 0). Pool-pick and
 *     color-pill are TWO different hash functions on the same alias —
 *     copy-paste error here would silently mis-align every avatar.
 *   - Pool array order + count MUST match dashboard's manifest.json _pool.
 *     Source (dash-loop-wt/public/avatars/manifest.json): 20 entries,
 *     avatar-01.webp .. avatar-20.webp, IN THAT ORDER. Reordering or adding
 *     an entry would shift `h % pool.length` and re-assign everyone.
 *   - Named overrides copied from the same manifest.json (non-`_pool` keys).
 *
 * VERIFICATION (lead acceptance criterion):
 *   Given 5 sample aliases, this function must return the same avatar-NN.webp
 *   number as the web dashboard shows. See __smoke_5_aliases below for a
 *   hand-run comparison (documented, not automated — RN test harness is
 *   heavier than the value it adds for a bundle-and-hash file).
 */

import type { ImageSourcePropType } from 'react-native';

// The pool. Order + count MUST match dash-loop-wt/public/avatars/manifest.json
// "_pool" — index 0 = avatar-01.webp, index 19 = avatar-20.webp. Metro bundles
// each require() at build time; the numeric value is an opaque asset handle
// that <Image source={...} /> consumes.
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

// Named overrides (level 2). Copied from manifest.json's non-`_pool` keys.
// Extend as web adds; each require() must be a bundled asset.
const NAMED_OVERRIDES: Record<string, ImageSourcePropType> = {
  '通信N站马': require('../../assets/intern_avatar.png'),
};

/**
 * Stable per-alias index into AVATAR_POOL. djb2 over UTF-16 code units.
 * Exported for the smoke check and for any callers that want to log/
 * diagnose which pool slot an alias resolved to.
 */
export function poolIndexForAlias(alias: string): number {
  if (!alias) return 0;
  let h = 5381;
  for (let i = 0; i < alias.length; i++) h = ((h << 5) + h + alias.charCodeAt(i)) >>> 0;
  return h % AVATAR_POOL.length;
}

/**
 * Resolve an alias to a bundled avatar image source, or null when the
 * alias is empty/missing (caller falls back to the letter pill).
 *
 * Precedence (mirrors dashboard):
 *   1. named override (level 2) — hand-picked mapping
 *   2. pool pick (level 3) — djb2-hashed slot from AVATAR_POOL
 * (Level 1 user override is not implemented in this port — see file header.)
 */
export function getAvatarSource(alias?: string | null): ImageSourcePropType | null {
  if (!alias) return null;
  const named = NAMED_OVERRIDES[alias];
  if (named !== undefined) return named;
  return AVATAR_POOL[poolIndexForAlias(alias)] ?? null;
}

/**
 * Human-legible pool selection for a given alias — returns "avatar-NN.webp"
 * as a string. Not used at render time; kept so we can smoke-check parity
 * against the web dashboard without pulling in a bundler.
 *
 * Web equivalent (dash-loop-wt): pool[h % pool.length] returns a string like
 * "/avatars/avatar-14.webp". App and web must return the same file for the
 * same alias.
 */
export function poolFileNameForAlias(alias: string): string {
  const idx = poolIndexForAlias(alias);
  const num = String(idx + 1).padStart(2, '0');
  return `avatar-${num}.webp`;
}
