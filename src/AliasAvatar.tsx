import { useState } from 'react';
import { Image, Text, View } from 'react-native';

import { getAvatarSource } from './lib/avatars';

// Port of the dashboard's AliasAvatar (same hash, same palette): the
// same alias renders the same color on web and mobile (#220 round 27,
// Vincent tg 734 参考 Web 端设计).
//
// 2026-07-31 (issue #8, Vincent 07-31 「安卓和苹果App都更新一下头像」):
// dashboard now shows a real illustration for every alias (R47-R49
// avatar-illustration pool, preview.35). This file was pure hash-palette
// + letter-initial before. Now:
//   1. Try to resolve the alias to a bundled illustration via
//      lib/avatars.ts (djb2 pool pick, byte-matches dashboard).
//   2. While the image loads, show the letter pill so the layout doesn't
//      flash a blank circle.
//   3. On image error, fall back to the letter pill silently — matches
//      the dashboard's "silent fallback to the pill on error" contract.
//   4. When getAvatarSource returns null (empty alias, or in the future
//      when the pool is empty), always use the letter pill.
//
// HARD requirements (lead 8323008a, do NOT change without lead sign):
//   - aliasAvatarColors hash MUST stay h*31 (color palette; used ONLY for
//     the letter-pill fallback). Vincent required web+mobile letter-pill
//     colors align, and any drift here breaks that (round 27 baseline).
//   - Pool selection lives in lib/avatars.ts and uses djb2 — DIFFERENT hash
//     from aliasAvatarColors. Do not merge them; that would re-shuffle
//     every avatar assignment (which is the mistake Vincent explicitly
//     asked NOT to make).
//   - Circle mask on RN: borderRadius on both the outer View AND the Image,
//     plus overflow:'hidden' on the View, so the image is clipped even
//     when it renders at an unexpected aspect ratio. RN <Image> does not
//     inherit borderRadius clipping the way <img> in a rounded div does.

const AVATAR_HUES = [180, 200, 220, 270, 300, 330, 30, 90];

export const aliasAvatarColors = (alias: string) => {
  // djb2-ish rolling hash. `>>> 0` coerces to an unsigned 32-bit int each
  // step so h stays a non-negative integer — otherwise overflow could make
  // h negative and `h % length` below would yield a negative index.
  let h = 0;
  for (let i = 0; i < alias.length; i++) h = (h * 31 + alias.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return {
    bg: `hsl(${hue}, 55%, 22%)`,
    ring: `hsl(${hue}, 60%, 45%)`,
    text: `hsl(${hue}, 80%, 78%)`,
  };
};

// First letter/digit for the avatar — \p{L}\p{N} + /u skips leading
// emoji/punctuation (so "🚀通信" → "通"). Wrapped in try/catch because
// Unicode property escapes throw on older JS engines (some Hermes/JSC
// builds); there we fall back to the raw first char rather than crash.
export const aliasInitial = (alias?: string): string => {
  if (!alias) return '·';
  try {
    const ch = alias.trim().match(/[\p{L}\p{N}]/u)?.[0] || alias.trim()[0] || '·';
    return ch.toUpperCase();
  } catch {
    return (alias.trim()[0] || '·').toUpperCase();
  }
};

export default function AliasAvatar({ alias, size = 32 }: { alias: string; size?: number }) {
  const c = aliasAvatarColors(alias);
  const source = getAvatarSource(alias);
  const [errored, setErrored] = useState(false);
  const showImage = source !== null && !errored;

  // Letter pill — always rendered as the base layer. When an illustration
  // is available it sits on top; if it errors we just drop it and the pill
  // shows through. This avoids a "blank circle then image" flash: even if
  // loading is slow, the pill is visible from the first frame.
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.bg,
        borderColor: c.ring,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Text style={{ color: c.text, fontSize: Math.max(10, Math.round(size * 0.42)), fontWeight: '600' }}>
        {aliasInitial(alias)}
      </Text>
      {showImage ? (
        <Image
          source={source!}
          onError={() => setErrored(true)}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
        />
      ) : null}
    </View>
  );
}
