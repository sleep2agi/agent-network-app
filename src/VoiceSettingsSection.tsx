// 设置 → 语音输入:豆包语音(火山引擎)凭据 + 「测试」。
//
// 🔴 凭据只存本机(voice-credentials.ts),保存后**不回显**密钥全文:Access Token / Secret Key
// 输入框永远是空的,状态行只显示「已配置 ✓ …a1b2」。密钥栏留空点保存 = 不改。

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { clearVoiceCredentials, loadVoiceCredentials, saveVoiceCredentials, voiceStorageKind } from './voice-credentials';
import { initialForm, mergeOnSave, statusLabel, voiceConfigStatus, type VoiceCredentials, type VoiceForm } from './voice-credentials-model';
import { AsrError, asrErrorMessage } from './doubao-asr';
import { transcribeCaptured } from './useVoiceInput';
import { useVoiceRecorder } from './useVoiceRecorder';

export const TEST_RECORD_MS = 3000;

type TestState =
  | { kind: 'idle' }
  | { kind: 'recording'; until: number }
  | { kind: 'transcribing' }
  | { kind: 'done'; text: string }
  | { kind: 'error'; message: string };

export default function VoiceSettingsSection({ showCredentials = true, showTest = true }: { showCredentials?: boolean; showTest?: boolean }) {
  const storage = voiceStorageKind();
  const [creds, setCreds] = useState<VoiceCredentials | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<VoiceForm>(initialForm(null));
  const [advanced, setAdvanced] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [, forceTick] = useState(0);
  const recorder = useVoiceRecorder();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = () => loadVoiceCredentials().then(c => { setCreds(c); setForm(initialForm(c)); setAdvanced(!!c?.endpoint); setLoaded(true); });
  useEffect(() => { void reload(); }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); recorder.discard(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (test.kind !== 'recording') return;
    const id = setInterval(() => forceTick(n => n + 1), 200);
    return () => clearInterval(id);
  }, [test.kind]);

  if (storage === 'unsupported') {
    return (
      <View style={styles.block} testID="voice-settings-unsupported">
        <Text style={styles.hint}>网页版不支持语音输入:浏览器里没有安全存储,不能保存语音识别的密钥。请使用桌面版或手机 App。</Text>
      </View>
    );
  }

  const status = voiceConfigStatus(creds);

  const onSave = async () => {
    const r = mergeOnSave(creds, form);
    if (!r.ok) { setSaveMsg({ ok: false, text: r.reason }); return; }
    setBusy(true);
    try {
      await saveVoiceCredentials(r.creds);
      setCreds(r.creds);
      setForm(initialForm(r.creds)); // 🔴 保存后清空密钥栏,不回显
      setSaveMsg({ ok: true, text: '已保存到本机' });
    } catch {
      setSaveMsg({ ok: false, text: '保存失败:本机安全存储不可用' });
    } finally { setBusy(false); }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      await clearVoiceCredentials();
      setCreds(null);
      setForm(initialForm(null));
      setSaveMsg({ ok: true, text: '已清除' });
    } catch {
      setSaveMsg({ ok: false, text: '清除失败' });
    } finally { setBusy(false); }
  };

  const onTest = async () => {
    if (!creds) { setTest({ kind: 'error', message: asrErrorMessage('not_configured') }); return; }
    let started = await recorder.start();
    // 第一次用:系统授权框刚弹过。这里不是按住手势,授权成功就直接接着录。
    if (!started.ok && started.permissionJustGranted) started = await recorder.start();
    if (!started.ok) { setTest({ kind: 'error', message: started.reason }); return; }
    setTest({ kind: 'recording', until: Date.now() + TEST_RECORD_MS });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const captured = recorder.stop();
      setTest({ kind: 'transcribing' });
      void (async () => {
        try {
          if (!captured) throw new AsrError('too_short');
          const text = await transcribeCaptured(await loadVoiceCredentials(), captured);
          setTest({ kind: 'done', text });
        } catch (e) {
          const err = e instanceof AsrError ? e : new AsrError('upstream_error');
          setTest({ kind: 'error', message: asrErrorMessage(err.code, err.upstream) });
        }
      })();
    }, TEST_RECORD_MS);
  };

  const testBusy = test.kind === 'recording' || test.kind === 'transcribing';
  const secondsLeft = test.kind === 'recording' ? Math.max(0, Math.ceil((test.until - Date.now()) / 1000)) : 0;

  return (
    <View testID="voice-settings">
      {showCredentials ? (
        <View style={styles.block}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>状态</Text>
            {loaded ? (
              <Text style={[styles.status, status.configured && styles.statusOk]} testID="voice-status">{statusLabel(status)}</Text>
            ) : <ActivityIndicator size="small" color={colors.textMuted} />}
          </View>
          {status.configured ? (
            <Text style={styles.hint} testID="voice-status-mode">
              {status.mode === 'app-token' ? `旧版控制台 · App ID ${status.appId}` : '新版控制台 · API Key'}
              {status.hasSecretKey ? ' · Secret Key 已保存' : ''}
              {status.customEndpoint ? ' · 自定义接口地址' : ''}
            </Text>
          ) : null}

          <Text style={styles.fieldLabel}>App ID</Text>
          <TextInput
            testID="voice-app-id"
            accessibilityLabel="App ID"
            value={form.appId}
            onChangeText={appId => setForm(f => ({ ...f, appId }))}
            placeholder="旧版控制台的 APP ID;新版控制台留空"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Access Token</Text>
          <TextInput
            testID="voice-access-token"
            accessibilityLabel="Access Token"
            value={form.accessToken}
            onChangeText={accessToken => setForm(f => ({ ...f, accessToken }))}
            placeholder={status.configured ? `已保存 ${status.tokenTail},留空不改` : 'Access Token;新版控制台填 API Key'}
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Secret Key(可选)</Text>
          <TextInput
            testID="voice-secret-key"
            accessibilityLabel="Secret Key"
            value={form.secretKey}
            onChangeText={secretKey => setForm(f => ({ ...f, secretKey }))}
            placeholder={status.configured && status.hasSecretKey ? '已保存,留空不改' : '极速版接口用不到,可留空'}
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            style={styles.input}
          />
          <Pressable accessibilityRole="button" onPress={() => setAdvanced(a => !a)} hitSlop={6} testID="voice-advanced-toggle">
            <Text style={styles.link}>{advanced ? '收起高级' : '高级:接口地址'}</Text>
          </Pressable>
          {advanced ? (
            <>
              <TextInput
                testID="voice-endpoint"
                accessibilityLabel="接口地址"
                value={form.endpoint}
                onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))}
                placeholder="留空 = 官方 openspeech.bytedance.com(必须 https)"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
            </>
          ) : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="保存语音识别凭据" disabled={busy} onPress={() => void onSave()} style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && { opacity: 0.7 }]} testID="voice-save">
              <Text style={styles.primaryText}>保存</Text>
            </Pressable>
            {status.configured ? (
              <Pressable accessibilityRole="button" accessibilityLabel="清除语音识别凭据" disabled={busy} onPress={() => void onClear()} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]} testID="voice-clear">
                <Text style={styles.secondaryText}>清除</Text>
              </Pressable>
            ) : null}
            {saveMsg ? <Text style={[styles.hint, !saveMsg.ok && styles.error]} testID="voice-save-msg">{saveMsg.text}</Text> : null}
          </View>
          <Text style={styles.hint}>
            在火山引擎控制台「豆包语音」里开通「录音文件识别大模型-极速版」(资源 volc.bigasr.auc_turbo)。
            旧版控制台:填应用的 APP ID 和 Access Token;新版控制台:App ID 留空,把 API Key 填进 Access Token。
            凭据只保存在本机({storage === 'keychain' ? '系统钥匙串' : '系统安全存储'}),不会上传到 Hub;语音直接发给豆包识别,不经过 Hub。
          </Text>
        </View>
      ) : null}

      {showTest ? (
        <View style={styles.block}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>测试语音识别</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="测试语音识别" disabled={testBusy || !status.configured} onPress={() => void onTest()} style={({ pressed }) => [styles.secondary, (testBusy || !status.configured) && styles.disabled, pressed && { opacity: 0.7 }]} testID="voice-test">
              <Text style={styles.secondaryText}>{test.kind === 'recording' ? `录音中 ${secondsLeft}s` : test.kind === 'transcribing' ? '识别中…' : '测试'}</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>点「测试」后说 3 秒话,显示识别出的文字。</Text>
          {test.kind === 'done' ? <Text style={styles.result} testID="voice-test-result">{test.text ? `识别结果:${test.text}` : '没有识别到文字(静音?)'}</Text> : null}
          {test.kind === 'error' ? <Text style={[styles.result, styles.error]} testID="voice-test-error">{test.message}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  block: { paddingVertical: spacing.sm, gap: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  label: { color: colors.text, fontSize: 14 },
  status: { color: colors.textMuted, fontSize: 14 },
  statusOk: { color: colors.accent, fontWeight: '600' },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.inputBg, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: 8, fontSize: 14 },
  link: { color: colors.accent, fontSize: 12, marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  primary: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.lg, height: 32, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.bg, fontWeight: '600', fontSize: 13 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.lg, height: 32, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontSize: 13 },
  disabled: { opacity: 0.45 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.failed },
  result: { color: colors.text, fontSize: 14, marginTop: 4 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
