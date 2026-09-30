// 任务详情头上的 ID。有短号的 Hub:显示 #N,点一下复制「#N」。
//   桌面(有指针):旁边一个小的「复制完整 ID」按钮(悬停有提示),不靠长按 —— 鼠标用户不会去长按。
//   手机(触屏):长按复制完整 ID(req_<uuid>),读屏的「操作」里也有这一项;不占头部的空间。
// 旧 Hub(没有短号):显示 uuid 前 8 位,点了复制完整 ID。复制后就地变成「已复制」1.5 秒。
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, type as typeScale } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import { idPrefix, shortIdLabel } from './task-short-id';
import type { Requirement } from './requirements-model';

export const COPIED_MS = 1500;

export default function TaskIdChip({ item, pointer }: { item: Pick<Requirement, 'id' | 'seq'>; pointer: boolean }) {
  useTranslation();
  const [copied, setCopied] = useState<'short' | 'full' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setCopied(null); }, [item.id]);
  const short = shortIdLabel(item);
  const copy = async (which: 'short' | 'full') => {
    try { await Clipboard.setStringAsync(which === 'short' && short ? short : item.id); } catch { return; }
    setCopied(which);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };
  const label = short ?? idPrefix(item.id);
  const shown = copied ? t(copied === 'full' ? 'taskId.copiedFull' : 'taskId.copied') : label;
  const chip = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, height: 28, paddingHorizontal: 8, borderRadius: radius.item, borderWidth: 1, borderColor: colors.border };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }} testID="req-detail-id">
      <Pressable
        testID="req-detail-id-copy"
        accessibilityRole="button"
        accessibilityLabel={short ? t('taskId.copyShort', { id: short }) : t('taskId.copyFull')}
        accessibilityActions={!pointer && short ? [{ name: 'longpress', label: t('taskId.copyFull') }] : undefined}
        onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'longpress') void copy('full'); }}
        {...({ title: short ? t('taskId.copyShort', { id: short }) : t('taskId.copyFull') } as object)}
        onPress={() => { void copy(short ? 'short' : 'full'); }}
        onLongPress={!pointer ? () => { if (short) void copy('full'); } : undefined}
        hitSlop={pointer ? 4 : 8}
        style={state => [chip, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
      >
        {copied ? <Ionicons name="checkmark" size={13} color={colors.accent} /> : null}
        <Text testID="req-detail-id-text" numberOfLines={1} style={{ color: copied ? colors.accent : colors.textSecondary, fontSize: typeScale.small, fontVariant: ['tabular-nums'] }}>{shown}</Text>
      </Pressable>
      {pointer && short ? (
        <Pressable
          testID="req-detail-id-copy-full"
          accessibilityRole="button"
          accessibilityLabel={t('taskId.copyFull')}
          {...({ title: t('taskId.copyFull') } as object)}
          onPress={() => { void copy('full'); }}
          style={state => [{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.item }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
        >
          <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
