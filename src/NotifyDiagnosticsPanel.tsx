// 设置 → 通知 →「通知诊断」。正式包里照样显示(不是 dev-only):0.2.107 实机不弹时只能靠猜,
// 这里把运行时的真实状态摊开,并能一键复制给维护者。行的内容来自 notify-diagnostics.diagnosticsRows,
// 与「复制诊断信息」同一份。
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import * as Clipboard from 'expo-clipboard';
import { colors, onThemeChange, spacing } from './theme';
import { APP_VERSION } from './version';
import { diagnosticsRows, formatDiagnostics, getNotifyDiagnostics, subscribeNotifyDiagnostics } from './notify-diagnostics';
import { refreshNotifyDiagnostics } from './notifier-runtime';

export default function NotifyDiagnosticsPanel() {
  const d = useSyncExternalStore(subscribeNotifyDiagnostics, getNotifyDiagnostics, getNotifyDiagnostics);
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
  const desktop = Platform.OS === 'web';
  return (
    <View style={s.wrap} testID="notify-diagnostics">
      {desktop ? <Text style={s.hint}>桌面端的系统通知走系统栏(另一条链路);下面是手机端通知运行时的状态。</Text> : null}
      {rows.map(r => (
        <View key={r.label} style={s.row}>
          <Text style={s.label}>{r.label}</Text>
          <Text style={[s.value, r.warn && { color: colors.failed }]} selectable>{r.value}</Text>
        </View>
      ))}
      <View style={s.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="复制诊断信息"
          testID="notify-diagnostics-copy"
          onPress={() => {
            void (async () => {
              await refreshNotifyDiagnostics().catch(() => {});
              const text = formatDiagnostics(getNotifyDiagnostics(), `Agent Network v${APP_VERSION} 通知诊断(${Platform.OS})`);
              try { await Clipboard.setStringAsync(text); setCopied('已复制,可以直接粘贴发给维护者。'); }
              catch (e) { setCopied(`复制失败:${String((e as Error)?.message ?? e)}`); }
            })();
          }}
          style={({ pressed }) => [s.button, pressed && { opacity: 0.6 }]}
        >
          <Text style={s.buttonText}>复制诊断信息</Text>
        </Pressable>
        {copied ? <Text style={s.hint}>{copied}</Text> : null}
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 6 },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  label: { color: colors.textMuted, fontSize: 12, width: 132 },
  value: { color: colors.text, fontSize: 12, flex: 1, minWidth: 0 },
  hint: { color: colors.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  button: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card },
  buttonText: { color: colors.text, fontSize: 13 },
});

let s = makeStyles();
onThemeChange(() => { s = makeStyles(); });
