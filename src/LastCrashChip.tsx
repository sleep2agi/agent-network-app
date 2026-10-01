// 下次启动的「上次异常退出 · 发送诊断」小提示(owner 2026-10-01:不要大弹窗)。
// 角落一枚小胶囊,~8 秒自动隐藏(标记已出现,设置 › 关于 仍可复制);发送 / 关闭 = 删掉记录。
// 发给谁由用户在节点选择器(NodePicker,定时任务用的同一个)里挑 —— 公开产品,没有固定的维护 agent,
// 写死别名会发不出去或发给陌生人的同名节点。上次选的按账号记在本机,下次预选。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { elevated } from './elevation';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-fatal';
import { fetchHubNodes, fetchStatus, sendTask, type HubConfig, type HubNode, type Session } from './api';
import { loadChatPins } from './chat-pins';
import NodePickerSheet from './NodePicker';
import { pickerChoices, type PickerNode } from './node-picker-model';
import { preselectRecipient } from './diagnostics-recipient';
import { fatalDiagnosticsText, fatalSummary, type FatalReport } from './fatal-report';
import { fatalStore, loadDiagnosticsRecipient, saveDiagnosticsRecipient } from './fatal-runtime';

export const CHIP_AUTO_HIDE_MS = 8000;

type Phase = 'idle' | 'picking' | 'sending' | 'sent' | 'failed';

export default function LastCrashChip({ cfg }: { cfg: HubConfig }) {
  useTranslation();
  const insets = useSafeAreaInsets();
  // 只看启动那一刻的记录:本次运行里新记的(渲染兜底)留到下次启动再提示。
  const [report, setReport] = useState<FatalReport | null>(() => {
    const r = fatalStore.read();
    return r && !r.shown ? r : null;
  });
  const [phase, setPhase] = useState<Phase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nodes, setNodes] = useState<HubNode[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const choices = useMemo(() => pickerChoices(nodes, sessions), [nodes, sessions]);
  const preselect = useMemo(() => preselectRecipient(choices.nodes, phase === 'picking' ? loadDiagnosticsRecipient(cfg) : null), [choices.nodes, phase, cfg]);

  // 选择器打开时才拉节点(没点「发送诊断」的人不多发一个请求)。拿不到状态就全画成离线,仍可选。
  useEffect(() => {
    if (phase !== 'picking') return;
    let live = true;
    fetchHubNodes(cfg).then(d => { if (live) setNodes(d.nodes ?? []); }).catch(() => {});
    fetchStatus(cfg).then(d => { if (live) setSessions(d.sessions ?? []); }).catch(() => {});
    loadChatPins(cfg).then(p => { if (live) setPins(p); }).catch(() => {});
    return () => { live = false; };
  }, [phase, cfg]);

  useEffect(() => {
    if (!report || phase !== 'idle') return;
    timer.current = setTimeout(() => { fatalStore.markShown(); setReport(null); }, CHIP_AUTO_HIDE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [report, phase]);

  if (!report) return null;

  const dismiss = () => { fatalStore.clear(); setReport(null); };
  // 点「发送诊断」= 打开选择器;关掉选择器 = 回到小提示并重新计 8 秒。
  const openPicker = () => { if (timer.current) clearTimeout(timer.current); setPhase('picking'); };
  const send = async (target: PickerNode) => {
    saveDiagnosticsRecipient(cfg, target.alias);
    setPhase('sending');
    try {
      await sendTask(cfg, target.alias, fatalDiagnosticsText(report));
      fatalStore.clear();
      setPhase('sent');
      setTimeout(() => setReport(null), 2000);
    } catch {
      // 记录留着:设置 › 关于 里还能复制。
      fatalStore.markShown();
      setPhase('failed');
      setTimeout(() => setReport(null), 4000);
    }
  };

  const label = phase === 'sending' ? t('fatal.sending') : phase === 'sent' ? t('fatal.sent') : phase === 'failed' ? t('fatal.sendFailed') : t('fatal.chip');
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 72 }]}>
      <View style={styles.chip} testID="last-crash-chip" accessibilityLiveRegion="polite">
        <Text style={styles.text} numberOfLines={1} accessibilityHint={fatalSummary(report)}>{label}</Text>
        {phase === 'idle' || phase === 'picking' ? (
          <>
            <Text style={styles.dot}>·</Text>
            <Pressable testID="last-crash-send" accessibilityRole="button" onPress={openPicker} hitSlop={8}>
              <Text style={styles.action}>{t('fatal.send')}</Text>
            </Pressable>
            <Pressable testID="last-crash-dismiss" accessibilityRole="button" accessibilityLabel={t('fatal.dismiss')} onPress={dismiss} hitSlop={8} style={styles.close}>
              <Ionicons name="close" size={14} color={colors.textSecondary} />
            </Pressable>
          </>
        ) : null}
      </View>
      <NodePickerSheet
        title={t('fatal.pickRecipient')}
        visible={phase === 'picking'}
        nodes={choices.nodes}
        hiddenOffline={choices.hiddenOffline}
        selectedId={preselect.selectedId}
        recents={preselect.recents}
        pinned={pins}
        onClose={() => setPhase('idle')}
        onSelect={n => { if (n.assignable) void send(n); }}
      />
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap: { position: 'absolute', right: spacing.md, alignItems: 'flex-end' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingLeft: spacing.md, paddingRight: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.card, ...elevated('floating') },
  text: { color: colors.text, fontSize: 12 },
  dot: { color: colors.textSecondary, fontSize: 12, marginHorizontal: 6 },
  action: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  close: { marginLeft: spacing.sm },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
