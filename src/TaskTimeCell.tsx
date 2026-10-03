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

/**
 * byInline(#506,「更新时间」列):更新者的名字跟在时间后面一起显示(Agent 前面一个芯片图标),不用悬停才看得到;名字太长只截名字。
 * Hub 给 last_event 时再带 verb(「把状态改成「进行中」」/ commented …)和 preview(「：评论正文」,已带冒号);名字 + 动词 + 预览是同一段文字,列窄就在末尾截;
 * 没有操作者时 name = null,只写「时间 · 动词」。
 */
export type TimeCellInline = { name: string | null; agent: boolean; verb?: string; preview?: string | null };
export default function TaskTimeCell({ raw, now, by, id, byInline }: { raw?: string | null; now: number; by?: string; id: string; byInline?: TimeCellInline }) {
  const { language } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = useRef<View>(null);
  const safe = useModalSafePadding('overlay');
  const pointer = pointerUi();
  const exact = exactTaskTime(raw);
  const detail = byInline?.verb ? `${byInline.verb}${byInline.preview ?? ''}` : '';
  const hint = `${exact}${by ? `\n${t('fields.time.by', { name: by })}` : ''}${detail ? `\n${detail}` : ''}`;
  useEffect(() => { (label.current as unknown as HTMLElement | null)?.setAttribute?.('title', hint); }, [hint]);
  return <>
    <Pressable ref={label} testID={id} accessibilityRole="button" accessibilityLabel={hint} disabled={exact === '—'}
      {...({ title: hint } as object)}
      onPress={e => { e.stopPropagation(); setOpen(true); }}
      onLongPress={pointer ? undefined : e => { e.stopPropagation(); setOpen(true); }}
      style={{ minHeight: 32, justifyContent: 'center', minWidth: 0, flexShrink: 1 }}>
      {byInline && exact !== '—' ? <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12, flexShrink: 0 }} numberOfLines={1}>{relativeTaskTime(raw, now)}{' ·\u00a0'}</Text>
        {byInline.name !== null && byInline.agent ? <Ionicons name="hardware-chip-outline" size={11} color={colors.textMuted} style={{ marginRight: 2 }} /> : null}
        {byInline.verb
          // 有动词(last_event):列窄(约 140px),名字 + 动词 + 预览放进同一段文字,放不下在末尾截(完整的一句在悬停 / 点开里)。
          ? <Text style={{ color: colors.textMuted, fontSize: 12, flexShrink: 1, minWidth: 0 }} numberOfLines={1} testID={`${id}-line`}>
            {byInline.name !== null ? <Text testID={`${id}-by`}>{byInline.name}</Text> : null}
            <Text testID={`${id}-verb`}>{byInline.name !== null && language !== 'zh' ? '\u00a0' : ''}{byInline.verb}</Text>
            {byInline.preview ? <Text testID={`${id}-preview`}>{byInline.preview}</Text> : null}
          </Text>
          : <Text style={{ color: colors.textMuted, fontSize: 12, flexShrink: 1, minWidth: 0 }} numberOfLines={1} testID={`${id}-by`}>{byInline.name}</Text>}
      </View> : <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{relativeTaskTime(raw, now)}</Text>}
    </Pressable>
    <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
      <Pressable accessibilityLabel={t('fields.time.close')} onPress={e => { e.stopPropagation(); setOpen(false); }} style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.15)', ...withBasePadding(safe, 24) }}>
        <View testID="task-time-exact" style={{ backgroundColor: colors.card, padding: 20, borderRadius: radius.control }}><Text style={{ color: colors.text }}>{hint}</Text></View>
      </Pressable>
    </Modal>
  </>;
}
