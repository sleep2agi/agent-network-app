import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, onThemeChange, spacing } from './theme';
import {
  daemonChecklist,
  installBlocker,
  installLocalDaemon,
  scanLocalDaemon,
  type LocalDaemonInstallReport,
  type LocalDaemonScan,
} from './local-daemon';

// app#253 —— 「选服务器」空状态里的本机 daemon 一键扫描/安装卡片(只在桌面端 Local workspace 出现)。
// 不自己偷偷起(Vincent 定):扫描、安装都要点按钮;安装完成后由父组件刷新 host_supervisor 列表。
export default function LocalDaemonSetupCard({ onInstalled }: { onInstalled: () => void }) {
  const [scan, setScan] = useState<LocalDaemonScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [report, setReport] = useState<LocalDaemonInstallReport | null>(null);
  const [error, setError] = useState('');

  const runScan = async () => {
    setScanning(true); setError(''); setReport(null);
    try { setScan(await scanLocalDaemon()); } catch (e) { setError(String(e)); } finally { setScanning(false); }
  };
  const runInstall = async () => {
    setInstalling(true); setError(''); setReport(null);
    try {
      const result = await installLocalDaemon();
      setReport(result);
      if (result.ok) { onInstalled(); void scanLocalDaemon().then(setScan).catch(() => undefined); }
    } catch (e) { setError(String(e)); } finally { setInstalling(false); }
  };
  const blocker = scan ? installBlocker(scan) : null;

  return (
    <View style={styles.card} testID="local-daemon-setup-card">
      <Text style={styles.title}>本机就是这台服务器?一键装上本机 daemon</Text>
      <Text style={styles.body}>扫描本机的 Node.js / npm / anet CLI,缺什么装什么(缺 Node 或版本太低会自动下载一份私有 Node 22,装在 app 自己的目录里,不动系统、不要 sudo),然后用本地 Hub 的凭据注册并启动 host_supervisor。每一步都由你点按钮触发,不会后台偷偷装。</Text>
      <View style={styles.actions}>
        <Pressable disabled={scanning || installing} testID="local-daemon-scan" style={({ pressed }) => [styles.button, styles.buttonGhost, pressed && { opacity: 0.7 }]} onPress={() => { void runScan(); }}>
          <Text style={styles.buttonGhostText}>{scanning ? '扫描中…' : scan ? '重新扫描' : '扫描本机'}</Text>
        </Pressable>
        {scan ? (
          <Pressable disabled={installing || !!blocker} testID="local-daemon-install" style={({ pressed }) => [styles.button, (installing || blocker) && { opacity: 0.5 }, pressed && { opacity: 0.7 }]} onPress={() => { void runInstall(); }}>
            <Text style={styles.buttonText}>{installing ? '安装中…' : scan.profileExists ? '重新注册并启动本机 daemon' : '一键安装并启动本机 daemon'}</Text>
          </Pressable>
        ) : null}
      </View>
      {scan ? (
        <View style={styles.checklist}>
          {daemonChecklist(scan).map(row => (
            <View key={row.key} style={styles.row}>
              <Text style={[styles.mark, row.state === 'ok' ? styles.markOk : styles.markBad]}>{row.state === 'ok' ? '✓' : '✗'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowDetail} selectable>{row.detail}</Text>
              </View>
            </View>
          ))}
          {blocker ? <Text style={styles.blocker}>{blocker}</Text> : null}
        </View>
      ) : null}
      {installing ? (
        <View style={styles.progress}><ActivityIndicator color={colors.accent} /><Text style={styles.rowDetail}>正在安装并启动……第一次可能要下载私有 Node(约 50 MB)和 anet 的 npm 包,1–3 分钟。</Text></View>
      ) : null}
      {report ? (
        <View style={styles.report}>
          <Text style={[styles.rowLabel, report.ok ? styles.markOk : styles.markBad]}>{report.ok ? `已注册并启动:${report.nodeId ?? ''}。列表会在 10 秒内出现。` : `没有完成:${report.error ?? ''}`}</Text>
          <ScrollView style={styles.log} contentContainerStyle={{ padding: spacing.sm }} testID="local-daemon-steps">
            {report.steps.map((step, index) => (
              <View key={`${index}-${step.name}`} style={{ marginBottom: spacing.sm }}>
                <Text style={[styles.stepName, step.ok ? styles.markOk : styles.markBad]}>{step.ok ? '✓' : '✗'} {step.name}</Text>
                {step.output ? <Text style={styles.stepOutput} selectable>{step.output}</Text> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {error ? <Text style={styles.blocker}>{error}</Text> : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, padding: spacing.lg, marginBottom: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  buttonText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  buttonGhostText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  checklist: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  mark: { width: 18, fontSize: 14, fontWeight: '700' },
  markOk: { color: colors.running },
  markBad: { color: colors.failed },
  rowLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  rowDetail: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  blocker: { color: colors.failed, fontSize: 12, lineHeight: 17 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  report: { gap: spacing.sm },
  log: { maxHeight: 220, backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  stepName: { fontSize: 12, fontWeight: '600' },
  stepOutput: { color: colors.textMuted, fontSize: 11, lineHeight: 15, fontFamily: 'Menlo' },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
