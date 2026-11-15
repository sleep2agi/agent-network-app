// 设置 → 通知 →「通知诊断」。正式包里照样显示(不是 dev-only):0.2.107 实机不弹时只能靠猜,
// 这里把运行时的真实状态摊开,并能一键复制给维护者。行的内容来自 notify-diagnostics.diagnosticsRows,
// 与「复制诊断信息」同一份。
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import * as Clipboard from 'expo-clipboard';
import { colors, onThemeChange, spacing, radius } from './theme';
import { APP_VERSION } from './version';
import { diagnosticsRows, formatDiagnostics, getNotifyDiagnostics, subscribeNotifyDiagnostics } from './notify-diagnostics';
import { recentSendTimings, subscribeSendTimings } from './send-timing';
import { refreshNotifyDiagnostics } from './notifier-runtime';

export default function NotifyDiagnosticsPanel() {
  const d = useSyncExternalStore(subscribeNotifyDiagnostics, getNotifyDiagnostics, getNotifyDiagnostics);
  // #518: the 「最近一次发送」 row (diagnosticsRows reads it) refreshes when a send settles.
  useSyncExternalStore(subscribeSendTimings, recentSendTimings, recentSendTimings);
  const [copied, setCopied] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    const tick = () => { void refreshNotifyDiagnostics().catch(() => {}); if (live) setNow(Date.now()); };
    tick();
    const id = setInterval(tick, 5000);
    return () => { live = false; clearInterval(id); };
  }, []);
  const rows = diagnosticsRows(d, now);
  // 2026-11-15 管理员「这些里面有丑的一逼吧」:默认收起,只给一行结论(正常 / 几项要注意);
  // 展开后是「标签左 · 值右」的细线分隔列表,复制按钮在最下面一整行。桌面不显示这块(SettingsScreen 判断)。
  const warn = rows.filter(r => r.warn).length;
  const [open, setOpen] = useState(false);
  return (
    <View style={s.wrap} testID="notify-diagnostics">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID="notify-diagnostics-toggle"
        onPress={() => setOpen(v => !v)}
        style={({ pressed }) => [s.summary, pressed && { opacity: 0.6 }]}
      >
        <View style={[s.dot, { backgroundColor: warn ? colors.failed : colors.running }]} />
        <Text style={s.summaryText}>{warn ? `${warn} 项需要注意` : '运行正常'}</Text>
        <Text style={s.summaryHint}>{open ? '收起' : `查看 ${rows.length} 项`}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {open ? (
        <View testID="notify-diagnostics-rows">
          {rows.map(r => (
            <View key={r.label} style={s.row}>
              <Text style={s.label} numberOfLines={2}>{r.label}</Text>
              <Text style={[s.value, r.warn && { color: colors.failed }]} selectable>{r.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="复制诊断信息"
        testID="notify-diagnostics-copy"
        onPress={() => {
          void (async () => {
            await refreshNotifyDiagnostics().catch(() => {});
            const text = formatDiagnostics(getNotifyDiagnostics(), `ANet v${APP_VERSION} 通知诊断(${Platform.OS})`);
            try { await Clipboard.setStringAsync(text); setCopied('已复制,可以直接粘贴发给维护者。'); }
            catch (e) { setCopied(`复制失败:${String((e as Error)?.message ?? e)}`); }
          })();
        }}
        style={({ pressed }) => [s.copy, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="copy-outline" size={16} color={colors.accent} />
        <Text style={s.copyText}>复制诊断信息</Text>
      </Pressable>
      {copied ? <Text style={s.hint}>{copied}</Text> : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap: {},
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52 },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  summaryText: { color: colors.text, fontSize: 15, flex: 1, minWidth: 0 },
  summaryHint: { color: colors.textMuted, fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  label: { color: colors.textSecondary, fontSize: 13, flex: 1, minWidth: 0 },
  value: { color: colors.text, fontSize: 13, flexShrink: 1, maxWidth: '60%', textAlign: 'right' },
  hint: { color: colors.textMuted, fontSize: 12, paddingBottom: spacing.sm },
  copy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  copyText: { color: colors.accent, fontSize: 15 },
});

let s = makeStyles();
onThemeChange(() => { s = makeStyles(); });
