import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, radius } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import { exactTaskTime, relativeTaskTime } from './task-time';
import { pointerUi } from './pointer-ui';
import { Ionicons } from './icons';

/** byInline(#506,「更新时间」列):更新者的名字跟在时间后面一起显示(Agent 前面一个芯片图标),不用悬停才看得到;名字太长只截名字。 */
export default function TaskTimeCell({ raw, now, by, id, byInline }: { raw?: string | null; now: number; by?: string; id: string; byInline?: { name: string; agent: boolean } }) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const label = useRef<View>(null);
  const safe = useModalSafePadding('overlay');
  const pointer = pointerUi();
  const exact = exactTaskTime(raw);
  const hint = `${exact}${by ? `\n${t('fields.time.by', { name: by })}` : ''}`;
  useEffect(() => { (label.current as unknown as HTMLElement | null)?.setAttribute?.('title', hint); }, [hint]);
  return <>
    <Pressable ref={label} testID={id} accessibilityRole="button" accessibilityLabel={hint} disabled={exact === '—'}
      {...({ title: hint } as object)}
      onPress={e => { e.stopPropagation(); setOpen(true); }}
      onLongPress={pointer ? undefined : e => { e.stopPropagation(); setOpen(true); }}
      style={{ minHeight: 32, justifyContent: 'center', minWidth: 0, flexShrink: 1 }}>
      {byInline && exact !== '—' ? <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, flexShrink: 0 }} numberOfLines={1}>{relativeTaskTime(raw, now)}{' ·\u00a0'}</Text>
        {byInline.agent ? <Ionicons name="hardware-chip-outline" size={11} color={colors.textMuted} style={{ marginRight: 2 }} /> : null}
        <Text style={{ color: colors.textMuted, fontSize: 12, flexShrink: 1, minWidth: 0 }} numberOfLines={1} testID={`${id}-by`}>{byInline.name}</Text>
      </View> : <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{relativeTaskTime(raw, now)}</Text>}
    </Pressable>
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <Pressable accessibilityLabel={t('fields.time.close')} onPress={e => { e.stopPropagation(); setOpen(false); }} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.15)', ...withBasePadding(safe, 24) }}>
        <View testID="task-time-exact" style={{ backgroundColor: colors.card, padding: 20, borderRadius: radius.control }}><Text style={{ color: colors.text }}>{hint}</Text></View>
      </Pressable>
    </Modal>
  </>;
}
