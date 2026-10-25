// 设置 → 关于 →「上报日志与 SKILLS」。匿名或 PAT 两种方式把诊断发到门户。
//
// 契约未定时只发**最小、白名单**内容:日志 = 一条 app 摘要(+ 上次异常摘要);SKILLS = 本机无技能目录时为空数组。
// schema 定稿后只改 payload 组装,不动这里的状态机。
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { t as tr } from './i18n';
import './i18n-portal-report';
import { colors, radius, spacing, type as typeScale } from './theme';
import { useModalSafePadding } from './safe-area-runtime';
import { APP_VERSION } from './version';
import {
  buildBody, clientInfo, describeFailure, headersFor, normalizeBase, PORTAL_BASE, reportPath, redactLog,
  type LogItem, type ReportAuth, type ReportKind,
} from './portal-report';

type Status = { kind: 'idle' } | { kind: 'sending'; which: ReportKind } | { kind: 'ok'; text: string } | { kind: 'err'; text: string };

export default function PortalReportPanel({ open, onClose, lastFatal }: { open: boolean; onClose: () => void; lastFatal?: string | null }) {
  const safe = useModalSafePadding('fullScreen');
  // 主题在 import 之后才定,所以样式表按组件挂载时构建(与 MobileNavRail 同一约定)。
  const s = useMemo(makeStyles, []);
  const [pat, setPat] = useState('');
  // 门户域名在 TM 内网解析(公网 NXDOMAIN,2026-10-25 实测),所以地址要能改:内网/测试环境用一个 host,
  // 正式分发时保持默认即可。
  const [base, setBase] = useState(PORTAL_BASE);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const send = async (which: ReportKind) => {
    if (status.kind === 'sending') return;
    setStatus({ kind: 'sending', which });
    const auth: ReportAuth = pat.trim() ? { mode: 'pat', token: pat.trim() } : { mode: 'anonymous' };
    const logs: LogItem[] = [
      redactLog({ level: 'info', module: 'app', message: `client ${APP_VERSION} on ${Platform.OS}` }),
      ...(lastFatal ? [redactLog({ level: 'error', module: 'fatal', message: lastFatal })] : []),
    ];
    const items = which === 'logs' ? logs : [];
    const { body, tooBig, dropped } = buildBody(which, clientInfo(Platform.OS, 'zh'), items);
    if (tooBig) { setStatus({ kind: 'err', text: tr('portalReport.tooBig') }); return; }
    try {
      const root = normalizeBase(base);
      const res = await fetch(`${root}${reportPath(which)}`, {
        method: 'POST',
        headers: headersFor(auth),
        body: JSON.stringify(body),
      });
      if (!res.ok) { setStatus({ kind: 'err', text: tr(describeFailure(res.status)) }); return; }
      setStatus({ kind: 'ok', text: tr('portalReport.ok', { n: items.length, d: dropped }) });
    } catch {
      setStatus({ kind: 'err', text: tr('portalReport.offline') });
    }
  };

  if (!open) return null;
  const busy = status.kind === 'sending';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.scrim, { paddingTop: safe.paddingTop + spacing.lg, paddingBottom: safe.paddingBottom + spacing.lg }]}>
        <View style={s.card} testID="portal-report-panel">
          <Text style={s.title}>{tr('portalReport.title')}</Text>
          <Text style={s.hint}>{tr('portalReport.patHint')}</Text>
          <TextInput
            value={base}
            onChangeText={setBase}
            placeholder={PORTAL_BASE}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={s.input}
            testID="portal-report-base"
          />
          <TextInput
            value={pat}
            onChangeText={setPat}
            placeholder={tr('portalReport.pat')}
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={s.input}
            testID="portal-report-pat"
          />
          <View style={s.row}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send('logs')} style={[s.btn, busy && s.btnOff]} testID="portal-report-send-logs">
              {busy && status.which === 'logs' ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
              <Text style={s.btnText}>{tr('portalReport.sendLogs')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send('skills')} style={[s.btn, s.btnGhost, busy && s.btnOff]} testID="portal-report-send-skills">
              {busy && status.which === 'skills' ? <ActivityIndicator size="small" color={colors.accent} /> : null}
              <Text style={[s.btnText, s.btnGhostText]}>{tr('portalReport.sendSkills')}</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 120 }}>
            <Text testID="portal-report-status" style={[s.status, status.kind === 'err' && { color: colors.failed }, status.kind === 'ok' && { color: colors.running }]}>
              {status.kind === 'sending' ? tr('portalReport.sending') : status.kind === 'idle' ? '' : status.text}
            </Text>
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={onClose} style={s.close} testID="portal-report-close"><Text style={s.closeText}>OK</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 460, backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: typeScale.heading, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: typeScale.caption },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.sm, paddingVertical: 8, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.control },
  btnOff: { opacity: 0.5 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.onAccent, fontWeight: '600' },
  btnGhostText: { color: colors.accent },
  status: { color: colors.textMuted, fontSize: typeScale.caption, minHeight: 18 },
  close: { alignSelf: 'flex-end', paddingHorizontal: spacing.md, minHeight: 36, justifyContent: 'center' },
  closeText: { color: colors.accent, fontWeight: '600' },
});
