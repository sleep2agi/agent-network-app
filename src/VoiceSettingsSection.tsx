// 设置 → 语音输入:识别模型(流式 / 极速版)+ 豆包语音(火山引擎)API Key + 「测试」。
//
// 默认只有**一个**「API Key」栏(新版控制台只有 API Key —— Vincent 09-26「用新版本的话会好一点」)。
// 旧版控制台的 App ID + Access Token 收在折叠的「高级 / 旧版控制台」里,和接口地址放在一起。
// Secret Key 两个接口都用不到,不再出现。
//
// 🔴 凭据只存本机(voice-credentials.ts),保存后**不回显**密钥全文:密钥输入框永远是空的,
// 状态行只显示「已配置 ✓ …a1b2」。密钥栏留空点保存 = 不改。

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { clearVoiceCredentials, loadVoiceCredentials, saveVoiceCredentials, voiceStorageKind } from './voice-credentials';
import { authMode, CONSOLE_LABELS, initialForm, mergeOnSave, statusLabel, voiceConfigStatus, VOLC_CONSOLE_URL, type VoiceConsole, type VoiceCredentials, type VoiceForm } from './voice-credentials-model';
import { AsrError, asrErrorMessage } from './doubao-asr';
import { finishUtteranceWith, newUtterance } from './useVoiceInput';
import { useVoiceRecorder } from './useVoiceRecorder';
import { STREAM_DEFAULT_RESOURCE_ID, STREAM_RESOURCE_IDS } from './doubao-stream-protocol';
import { MODE_LABELS, STREAM_UNAVAILABLE_HINT, streamingSupported, testFallbackNote, type VoiceMode, type VoicePlatform } from './voice-stream-policy';
import { clearStreamUnavailable, currentVoiceMode, loadVoiceMode, saveVoiceMode, streamUnavailable, subscribeVoicePrefs, voicePlatform } from './voice-prefs';

export const TEST_RECORD_MS = 3000;

export const CONSOLE_HELP = '在『开通管理』里开通：录音文件识别大模型-极速版 +（可选）流式语音识别大模型';

type TestState =
  | { kind: 'idle' }
  | { kind: 'recording'; until: number }
  | { kind: 'transcribing' }
  | { kind: 'done'; text: string; via: VoiceMode; note?: string }
  | { kind: 'error'; message: string };

/** 「识别模型」这一栏:本平台能不能选流式。桌面 webview 的 WebSocket 设不了鉴权头 → 只有极速版。 */
export function modeChoices(platform: VoicePlatform): VoiceMode[] {
  return streamingSupported(platform) ? ['stream', 'flash'] : ['flash'];
}

/** 「高级」默认展开与否:用了旧版控制台或改过任何接口参数,就展开(让人看得见自己改过什么)。 */
export function advancedInitiallyOpen(c: VoiceCredentials | null): boolean {
  return !!c && (!!c.appId || !!c.endpoint || !!c.streamEndpoint || !!c.streamResourceId);
}

export default function VoiceSettingsSection({ showCredentials = true, showTest = true, showMode = true }: { showCredentials?: boolean; showTest?: boolean; showMode?: boolean }) {
  const storage = voiceStorageKind();
  const platform = voicePlatform();
  const [mode, setMode] = useState<VoiceMode>(currentVoiceMode());
  const [unavailable, setUnavailable] = useState(streamUnavailable());
  const [interim, setInterim] = useState('');
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
  const utteranceRef = useRef<ReturnType<typeof newUtterance> | null>(null);

  const reload = () => loadVoiceCredentials().then(c => { setCreds(c); setForm(initialForm(c)); setAdvanced(advancedInitiallyOpen(c)); setLoaded(true); });
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    void loadVoiceMode().then(setMode);
    return subscribeVoicePrefs(() => { setMode(currentVoiceMode()); setUnavailable(streamUnavailable()); });
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); recorder.setChunkListener(null); recorder.discard(); utteranceRef.current?.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
  const credMode = creds ? authMode(creds) : undefined;

  const onSave = async () => {
    const r = mergeOnSave(creds, form);
    if (!r.ok) { setSaveMsg({ ok: false, text: r.reason }); return; }
    setBusy(true);
    try {
      await saveVoiceCredentials(r.creds);
      clearStreamUnavailable(); // 新凭据 / 新资源 ID:流式重新试
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
    // 测试按**所选识别模型**走,且流式不看「本次已记住不可用」:用户点测试就是想确认现在通不通。
    const route: VoiceMode = mode === 'stream' && streamingSupported(platform) ? 'stream' : 'flash';
    setInterim('');
    const u = newUtterance(route, setInterim);
    utteranceRef.current = u;
    u.start();
    recorder.setChunkListener(route === 'stream' ? u.onChunk : null);
    let started = await recorder.start();
    // 第一次用:系统授权框刚弹过。这里不是按住手势,授权成功就直接接着录。
    if (!started.ok && started.permissionJustGranted) started = await recorder.start();
    if (!started.ok) { u.cancel(); recorder.setChunkListener(null); setTest({ kind: 'error', message: started.reason }); return; }
    setTest({ kind: 'recording', until: Date.now() + TEST_RECORD_MS });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      recorder.setChunkListener(null);
      const captured = recorder.stop();
      setTest({ kind: 'transcribing' });
      void (async () => {
        try {
          const r = await finishUtteranceWith(u, captured);
          if (route === 'stream' && r.via === 'stream') clearStreamUnavailable();
          setTest({ kind: 'done', text: r.text, via: r.via, note: testFallbackNote(route, r, status.configured ? status.streamResourceId : STREAM_DEFAULT_RESOURCE_ID, credMode) });
        } catch (e) {
          const err = e instanceof AsrError ? e : new AsrError('upstream_error');
          setTest({ kind: 'error', message: asrErrorMessage(err.code, err.upstream, credMode) });
        }
      })();
    }, TEST_RECORD_MS);
  };

  const onPickMode = (m: VoiceMode) => { setMode(m); void saveVoiceMode(m); };
  const choices = modeChoices(platform);
  const setConsole = (c: VoiceConsole) => setForm(f => ({ ...f, console: c }));
  const savedIs = (c: VoiceConsole) => status.configured && status.console === c;

  const testBusy = test.kind === 'recording' || test.kind === 'transcribing';
  const secondsLeft = test.kind === 'recording' ? Math.max(0, Math.ceil((test.until - Date.now()) / 1000)) : 0;

  return (
    <View testID="voice-settings">
      {showMode ? (
        <View style={styles.block} testID="voice-mode">
          <Text style={styles.label}>识别模型</Text>
          <View style={styles.options}>
            {choices.map(m => {
              const on = mode === m || choices.length === 1;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => onPickMode(m)}
                  style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.7 }]}
                  testID={`voice-mode-${m}`}
                >
                  <View style={[styles.radio, on && styles.radioOn]} />
                  <Text style={[styles.optionText, on && styles.optionTextOn]}>{MODE_LABELS[m]}</Text>
                </Pressable>
              );
            })}
          </View>
          {!streamingSupported(platform) ? (
            <Text style={styles.hint}>桌面版暂时只支持录音文件识别·极速版(说完再出字);边说边出字目前只在手机 App 上。</Text>
          ) : mode === 'stream' && unavailable ? (
            <Text style={[styles.hint, styles.warn]} testID="voice-stream-unavailable">{STREAM_UNAVAILABLE_HINT}</Text>
          ) : mode === 'stream' ? (
            <Text style={styles.hint}>按住说话时文字实时出现在录音浮层里,松手后写进输入框。没开通流式会自动改用极速版。</Text>
          ) : (
            <Text style={styles.hint}>松手后整句识别一次。</Text>
          )}
        </View>
      ) : null}

      {showCredentials ? (
        <View style={styles.block}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>状态</Text>
            {loaded ? (
              <Text style={[styles.status, status.configured && styles.statusOk]} testID="voice-status">{statusLabel(status)}</Text>
            ) : <ActivityIndicator size="small" color={colors.textMuted} />}
          </View>
          {status.configured && (status.console === 'old' || status.customEndpoint || status.customStreamEndpoint) ? (
            <Text style={styles.hint} testID="voice-status-mode">
              {status.console === 'old' ? `旧版控制台 · App ID ${status.appId}` : '新版控制台 · API Key'}
              {status.customEndpoint || status.customStreamEndpoint ? ' · 自定义接口地址' : ''}
            </Text>
          ) : null}

          {form.console === 'new' ? (
            <>
              <Text style={styles.fieldLabel}>API Key</Text>
              <TextInput
                testID="voice-api-key"
                accessibilityLabel="API Key"
                value={form.apiKey}
                onChangeText={apiKey => setForm(f => ({ ...f, apiKey }))}
                placeholder={savedIs('new') && status.configured ? `已保存 ${status.tokenTail},留空不改` : '火山引擎控制台 → API Key 管理 里复制'}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                style={styles.input}
              />
            </>
          ) : null}
          <Text style={styles.hint} testID="voice-console-help">
            <Text style={styles.link} onPress={() => void Linking.openURL(VOLC_CONSOLE_URL)} accessibilityRole="link">火山引擎控制台</Text>
            {` ${CONSOLE_HELP}`}
          </Text>

          <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(a => !a)} hitSlop={6} testID="voice-advanced-toggle">
            <Text style={styles.link}>{advanced ? '收起 高级 / 旧版控制台' : '高级 / 旧版控制台 ›'}</Text>
          </Pressable>
          {advanced ? (
            <View style={styles.advanced} testID="voice-advanced">
              <Text style={styles.fieldLabel}>控制台版本</Text>
              <View style={styles.chips}>
                {(['new', 'old'] as const).map(c => (
                  <Pressable key={c} accessibilityRole="radio" accessibilityState={{ checked: form.console === c }} onPress={() => setConsole(c)} style={[styles.chip, form.console === c && styles.chipOn]} testID={`voice-console-${c}`}>
                    <Text style={[styles.chipText, form.console === c && styles.chipTextOn]}>{CONSOLE_LABELS[c]}</Text>
                  </Pressable>
                ))}
              </View>
              {form.console === 'old' ? (
                <>
                  <Text style={styles.fieldLabel}>App ID</Text>
                  <TextInput
                    testID="voice-app-id"
                    accessibilityLabel="App ID"
                    value={form.appId}
                    onChangeText={appId => setForm(f => ({ ...f, appId }))}
                    placeholder="旧版控制台应用的 APP ID"
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
                    placeholder={savedIs('old') && status.configured ? `已保存 ${status.tokenTail},留空不改` : '旧版控制台应用的 Access Token'}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    style={styles.input}
                  />
                </>
              ) : null}
              <Text style={styles.fieldLabel}>极速版接口地址</Text>
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
              {streamingSupported(platform) ? (
                <>
                  <Text style={styles.fieldLabel}>流式接口地址</Text>
                  <TextInput
                    testID="voice-stream-endpoint"
                    accessibilityLabel="流式接口地址"
                    value={form.streamEndpoint}
                    onChangeText={streamEndpoint => setForm(f => ({ ...f, streamEndpoint }))}
                    placeholder="留空 = 官方 wss://…/sauc/bigmodel_async(必须 wss)"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <Text style={styles.fieldLabel}>流式资源 ID(控制台开通的是哪一种)</Text>
                  <View style={styles.chips}>
                    {STREAM_RESOURCE_IDS.map(id => {
                      const on = (form.streamResourceId || STREAM_DEFAULT_RESOURCE_ID) === id;
                      return (
                        <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setForm(f => ({ ...f, streamResourceId: id }))} style={[styles.chip, on && styles.chipOn]} testID={`voice-stream-resource-${id}`}>
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{id}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={styles.hint}>1.0 小时版 volc.bigasr.sauc.duration(默认)· 并发版 …concurrent · 2.0 为 volc.seedasr.*</Text>
                </>
              ) : null}
            </View>
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
          <Text style={styles.hint}>点「测试」后说 3 秒话,按上面选的识别模型显示识别出的文字{mode === 'stream' && streamingSupported(platform) ? '(流式:边说边出字)' : ''}。</Text>
          {(test.kind === 'recording' || test.kind === 'transcribing') && interim ? <Text style={[styles.result, styles.interim]} testID="voice-test-interim">{interim}</Text> : null}
          {test.kind === 'done' ? <Text style={styles.result} testID="voice-test-result">{test.text ? `识别结果(${test.via === 'stream' ? '流式' : '极速版'}):${test.text}` : '没有识别到文字(静音?)'}</Text> : null}
          {test.kind === 'done' && test.note ? <Text style={[styles.hint, styles.warn]} testID="voice-test-note">{test.note}</Text> : null}
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
  advanced: { gap: 6, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  primary: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.lg, height: 32, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: colors.bg, fontWeight: '600', fontSize: 13 },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.lg, height: 32, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.text, fontSize: 13 },
  disabled: { opacity: 0.45 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.failed },
  result: { color: colors.text, fontSize: 14, marginTop: 4 },
  interim: { color: colors.textSecondary },
  warn: { color: colors.accent },
  options: { gap: 6, marginTop: 4 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 10 },
  optionOn: { borderColor: colors.accent },
  radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.textMuted },
  radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  optionText: { color: colors.text, fontSize: 14, flexShrink: 1 },
  optionTextOn: { fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.bg, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
