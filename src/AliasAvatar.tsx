import { Text, View } from 'react-native';

// Port of the dashboard's AliasAvatar (same hash, same palette): the
// same alias renders the same color on web and mobile (#220 round 27,
// Vincent tg 734 参考 Web 端设计).

const AVATAR_HUES = [180, 200, 220, 270, 300, 330, 30, 90];

export const aliasAvatarColors = (alias: string) => {
  let h = 0;
  for (let i = 0; i < alias.length; i++) h = (h * 31 + alias.charCodeAt(i)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return {
    bg: `hsl(${hue}, 55%, 22%)`,
    ring: `hsl(${hue}, 60%, 45%)`,
    text: `hsl(${hue}, 80%, 78%)`,
  };
};

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
      }}
    >
      <Text style={{ color: c.text, fontSize: Math.max(10, Math.round(size * 0.42)), fontWeight: '600' }}>
        {aliasInitial(alias)}
      </Text>
    </View>
  );
}
