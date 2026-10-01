// 下次启动的「上次异常退出 · 发送诊断」小提示(owner 2026-10-01:不要大弹窗)。
// 角落一枚小胶囊,~8 秒自动隐藏(标记已出现,设置 › 关于 仍可复制);发送 / 关闭 = 删掉记录。
// 发送走正常的 sendTask,发给维护这个 app 的 agent。
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { elevated } from './elevation';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-fatal';
import { sendTask, type HubConfig } from './api';
import { fatalDiagnosticsText, fatalSummary, type FatalReport } from './fatal-report';
import { fatalStore } from './fatal-runtime';

/** 诊断发给谁:本项目的维护 agent(owner 2026-10-01 指定)。 */
// i18n-allow: hub alias (protocol identifier), not interface copy
export const DIAGNOSTICS_ALIAS = '通信龙';
export const CHIP_AUTO_HIDE_MS = 8000;

type Phase = 'idle' | 'sending' | 'sent' | 'failed';

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

  useEffect(() => {
    if (!report || phase !== 'idle') return;
    timer.current = setTimeout(() => { fatalStore.markShown(); setReport(null); }, CHIP_AUTO_HIDE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [report, phase]);

  if (!report) return null;

  const dismiss = () => { fatalStore.clear(); setReport(null); };
  const send = async () => {
    if (timer.current) clearTimeout(timer.current);
    setPhase('sending');
    try {
      await sendTask(cfg, DIAGNOSTICS_ALIAS, fatalDiagnosticsText(report));
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
        {phase === 'idle' ? (
          <>
            <Text style={styles.dot}>·</Text>
            <Pressable testID="last-crash-send" accessibilityRole="button" onPress={send} hitSlop={8}>
              <Text style={styles.action}>{t('fatal.send')}</Text>
            </Pressable>
            <Pressable testID="last-crash-dismiss" accessibilityRole="button" accessibilityLabel={t('fatal.dismiss')} onPress={dismiss} hitSlop={8} style={styles.close}>
              <Ionicons name="close" size={14} color={colors.textSecondary} />
            </Pressable>
          </>
        ) : null}
      </View>
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
