// 小 ⓘ 按钮 + 展开的说明卡。把「分区说明」这类一次读懂就不必常驻的文字收起来,给内容让位。
// 键盘可达:Tab 聚焦后 Enter/Space 展开;展开时 Esc 收起;再按一次也收起。
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { colors, spacing } from './theme';

export default function InfoTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const doc = (globalThis as any).document;
    const onKey = (event: any) => { if (event.key === 'Escape') setOpen(false); };
    doc?.addEventListener?.('keydown', onKey);
    return () => doc?.removeEventListener?.('keydown', onKey);
  }, [open]);
  return (
    <View style={{ position: 'relative', zIndex: open ? 20 : undefined }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(v => !v)}
        style={(state: any) => [
          { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
          state.focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any : null,
          state.hovered || open ? { backgroundColor: colors.rowHover } : null,
        ]}
      >
        <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600', lineHeight: 14 }}>i</Text>
      </Pressable>
      {open ? (
        <View
          accessibilityRole={'note' as any}
          style={{ position: 'absolute', top: 28, left: -8, width: 320, maxWidth: 360, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 18 }}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}
