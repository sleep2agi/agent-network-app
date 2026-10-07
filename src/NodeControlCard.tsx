// 节点页「概览」→「节点操作」卡片(agent-network board #694 第 4 步)。判据在 node-control-access.ts。
// 置灰而不是隐藏(app#196,Vincent 定):隐藏会让人以为功能不存在;置灰 + 一句原因 + 一个下一步。
//
// 桌面和手机是两套交互(Vincent 定):
//   - 桌面(指针):按钮按内容宽、高 34,左对齐排一行;「交给守护进程管理」是一个晴蓝文字按钮,悬停变底色。
//   - 手机(compact,触屏):两个按钮各占一半宽、高 44(手指尺寸);下一步是整行的浅蓝(tonal)按钮。
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { useTranslation } from './i18n-react';
import { colors, radius, spacing, type as typeScale, weight } from './theme';
import { nodeActionVisual, type NodeActionTone } from './node-action-visual';
import type { NodeControlView } from './node-control-access';
import { ds } from './ui-scale';

function ControlButton({ testID, label, tone, enabled, hint, onPress, compact }: { testID: string; label: string; tone: NodeActionTone; enabled: boolean; hint: string; onPress: () => void; compact: boolean }) {
  const [hovered, setHovered] = useState(false);
  const visual = nodeActionVisual(colors, tone);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      accessibilityHint={enabled ? undefined : hint}
      disabled={!enabled}
      onPress={enabled ? onPress : undefined}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        {
          borderWidth: 1, borderRadius: radius.control, borderColor: visual.borderColor, backgroundColor: visual.backgroundColor,
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
        },
        compact ? { flex: 1, minHeight: 44 } : { minWidth: ds(92), height: ds(34) },
        enabled && hovered && { backgroundColor: colors.inputBg },
        enabled && pressed && { opacity: 0.68 },
        !enabled && { opacity: 0.35 },
      ]}
    >
      <Text style={{ color: visual.textColor, fontSize: 13, lineHeight: 18, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export default function NodeControlCard({ view, compact, onRestart, onStop, onAdopt, adoptOpen, adoptSlot, message }: {
  view: NodeControlView;
  /** 手机 / 窄窗:触屏尺寸。 */
  compact: boolean;
  onRestart: () => void;
  onStop: () => void;
  onAdopt: () => void;
  /** 收编对话框已在卡片里展开。 */
  adoptOpen: boolean;
  /** 展开后放 NodeAdoptionControls(复用 0.2.218 的收编流程)。 */
  adoptSlot?: ReactNode;
  /** 提交结果那一行(父组件已上色)。 */
  message?: ReactNode;
}) {
  const { t } = useTranslation();
  const [linkHover, setLinkHover] = useState(false);
  return (
    <View testID="node-control-card" style={{ backgroundColor: colors.card, borderRadius: radius.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <ControlButton testID="node-control-restart" label={t('nodeControl.restart')} tone="neutral" enabled={view.restart.enabled} hint={view.restart.reason} onPress={onRestart} compact={compact} />
        <ControlButton testID="node-control-stop" label={t('nodeControl.stop')} tone="caution" enabled={view.stop.enabled} hint={view.stop.reason} onPress={onStop} compact={compact} />
      </View>
      {view.notice ? (
        <Text testID="node-control-notice" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{view.notice}</Text>
      ) : view.mode === 'adopted' && view.restart.reason ? (
        <Text testID="node-control-notice" style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }}>{view.restart.reason}</Text>
      ) : null}
      {view.next === 'adopt' && !adoptOpen ? (
        <Pressable
          testID="node-control-adopt"
          accessibilityRole="button"
          accessibilityLabel={t('nodeControl.adopt')}
          onPress={onAdopt}
          onHoverIn={() => setLinkHover(true)}
          onHoverOut={() => setLinkHover(false)}
          style={({ pressed }) => compact
            ? [{ minHeight: 44, borderRadius: radius.control, backgroundColor: colors.tonalBg, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.68 }]
            : [{ alignSelf: 'flex-start', borderRadius: radius.item, paddingHorizontal: spacing.xs, paddingVertical: 2, marginLeft: -spacing.xs }, linkHover && { backgroundColor: colors.tonalBg }, pressed && { opacity: 0.68 }]}
        >
          <Text style={{ color: colors.accent, fontSize: compact ? typeScale.body : typeScale.small, fontWeight: weight.strong }}>{t('nodeControl.adopt')} ›</Text>
        </Pressable>
      ) : null}
      {view.next === 'no_daemon' ? (
        <Text testID="node-control-no-daemon" style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }}>{t('nodeControl.noDaemon')}</Text>
      ) : null}
      {view.next === 'daemon_cannot_adopt' ? (
        <Text testID="node-control-daemon-old" style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18 }}>{t('nodeControl.daemonTooOld')}</Text>
      ) : null}
      {adoptOpen ? adoptSlot : null}
      {message}
    </View>
  );
}
