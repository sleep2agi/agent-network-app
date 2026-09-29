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

export default function TaskTimeCell({ raw, now, by, id }: { raw?: string | null; now: number; by?: string; id: string }) {
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
      style={{ minHeight: 32, justifyContent: 'center' }}>
      <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{relativeTaskTime(raw, now)}</Text>
    </Pressable>
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <Pressable accessibilityLabel={t('fields.time.close')} onPress={e => { e.stopPropagation(); setOpen(false); }} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.15)', ...withBasePadding(safe, 24) }}>
        <View testID="task-time-exact" style={{ backgroundColor: colors.card, padding: 20, borderRadius: radius.control }}><Text style={{ color: colors.text }}>{hint}</Text></View>
      </Pressable>
    </Modal>
  </>;
}
