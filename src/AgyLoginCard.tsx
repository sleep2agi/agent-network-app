// Antigravity（agy）登录弹层 —— 设计稿 handoff/agy-login-channel-design.md。
//
// 只在节点上报 agy_login_capable 时出现（没有这个能力就继续用「复制命令」那张卡）。
// 流程：start_agy_login 拿授权 URL → 用户在浏览器登录 → 把授权码/落地页 URL 粘回来
// → submit_agy_login_code → get_rules_file_result 确认结果。
// 授权码只发给这台节点（经 Hub 转发一次），不经过对话模型、不落日志。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { fetchAgyLoginResult, startAgyLogin, submitAgyLoginCode, type HubConfig } from './api';
import { useTranslation } from './i18n-react';
import { colors, onThemeChange, radius, spacing } from './theme';
import { openExternal } from './open-external';
import { useModalSafePadding } from './safe-area-runtime';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';

const POLL_MS = 1500;
/** callHubTool 的返回是 {kind:'payload',payload} | {kind:'error'|'unsupported'}；这里统一取 payload。 */
const val = (r: any): any => (r && r.kind === 'payload' ? r.payload : r);
const errText = (r: any): string => (r && (r.error || r.payload?.error) ? String(r.error || r.payload?.error) : '');


export default function AgyLoginCard({ cfg, alias, onDone }: { cfg: HubConfig; alias: string; onDone?: () => void }) {
  useTranslation();
  const safe = useModalSafePadding('fullScreen');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [requestId, setRequestId] = useState('');
  const [loginId, setLoginId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setUrl(''); setRequestId(''); setLoginId(''); setCode(''); setError(''); setBusy(false);
  }, []);

  const waitResult = async (id: string): Promise<any> => {
    for (let i = 0; i < 40; i++) {
      const r = val(await fetchAgyLoginResult(cfg, id).catch(() => null));
      const status = r?.status;
      if (status && status !== 'pending' && status !== 'in_progress') return r;
      await new Promise(res => setTimeout(res, POLL_MS));
    }
    return null;
  };

  const begin = async () => {
    setBusy(true); setError('');
    try {
      const started = val(await startAgyLogin(cfg, undefined, alias));
      if (started?.error) throw new Error(String(started.error));
      const id = started?.request_id;
      if (!id) throw new Error('start failed');
      setRequestId(id);
      const res = await waitResult(id);
      const raw = res?.content ?? res?.result_content;
      const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!payload?.url || !payload?.login_id) throw new Error('no_url');
      setUrl(payload.url); setLoginId(payload.login_id);
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!requestId || !loginId || !code.trim()) return;
    setBusy(true); setError('');
    try {
      const sent = val(await submitAgyLoginCode(cfg, requestId, loginId, code.trim()));
      if (sent?.error) throw new Error(String(sent.error));
      const id = sent?.request_id;
      if (!id) throw new Error('submit failed');
      const res = await waitResult(id);
      const status = res?.status;
      if (status === 'done') { setOpen(false); reset(); onDone?.(); }
      else throw new Error(String(errText(res) || 'invalid_code').slice(0, 200));
    } catch (e: any) {
      setError(String(e?.message || e).slice(0, 200));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        testID="agy-login-open"
        accessibilityRole="button"
        onPress={() => { setOpen(true); if (!url) void begin(); }}
        style={({ pressed }) => [s.btn, pressed && { opacity: 0.75 }]}
      >
        <Text style={s.btnText}>登录 Antigravity…</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => { setOpen(false); reset(); }}>
        <ModalKeyboardAvoider scrim="rgba(0,0,0,0.45)" style={{ justifyContent: 'center', paddingTop: (safe.paddingTop ?? 0) + spacing.lg, paddingBottom: (safe.paddingBottom ?? 0) + spacing.lg, paddingLeft: (safe.paddingLeft ?? 0) + spacing.lg, paddingRight: (safe.paddingRight ?? 0) + spacing.lg }}>
          <View style={s.sheet} testID="agy-login-sheet">
            <Text style={s.title}>登录 Antigravity</Text>
            <Text style={s.hint}>授权码只发给这台节点，不经过对话模型、不落日志。</Text>
            {busy && !url ? <ActivityIndicator style={{ marginVertical: spacing.md }} /> : null}
            {url ? (
              <Pressable testID="agy-login-url" accessibilityRole="link" onPress={() => { void openExternal(url).catch(() => {}); }} style={s.linkRow}>
                <Text style={s.link}>在浏览器打开 Google 登录页</Text>
              </Pressable>
            ) : null}
            <TextInput
              testID="agy-login-code"
              value={code}
              onChangeText={setCode}
              placeholder="粘贴授权码或落地页完整 URL"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={s.input}
            />
            {error ? <Text testID="agy-login-error" style={s.error}>{error}</Text> : null}
            <View style={s.footer}>
              <Pressable testID="agy-login-cancel" onPress={() => { setOpen(false); reset(); }} style={s.secondary}><Text style={s.secondaryText}>取消</Text></Pressable>
              <Pressable testID="agy-login-submit" onPress={() => void submit()} disabled={busy || !code.trim()} style={[s.primary, (busy || !code.trim()) && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.primaryText}>完成登录</Text>}
              </Pressable>
            </View>
          </View>
        </ModalKeyboardAvoider>
      </Modal>
    </>
  );
}

const makeStyles = () => StyleSheet.create({
  btn: { marginTop: spacing.sm, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.control, backgroundColor: colors.subtleFill },
  btnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  linkRow: { paddingVertical: 6 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  input: { marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.sm, paddingVertical: 10, fontSize: 14, color: colors.text, backgroundColor: colors.inputBg },
  error: { color: colors.failed, fontSize: 12 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  secondary: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.control, backgroundColor: colors.subtleFill },
  secondaryText: { color: colors.textSecondary, fontSize: 14 },
  primary: { paddingHorizontal: spacing.lg, paddingVertical: 10, borderRadius: radius.control, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  primaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
});
let s = makeStyles();
onThemeChange(() => { s = makeStyles(); });
