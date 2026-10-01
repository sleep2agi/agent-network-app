import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { localizedVoiceStatus } from './i18n-settings-presentation';
import { settingsText } from './i18n-settings';
// 设置 → 语音输入:识别模型(流式 / 极速版)+ 豆包语音(火山引擎)API Key + 麦克风(桌面,MicDeviceSetting)
// + 「测试」。
//
// 默认只有**一个**「API Key」栏(新版控制台只有 API Key —— Vincent 09-26「用新版本的话会好一点」)。
// 旧版控制台的 App ID + Access Token 收在折叠的「高级 / 旧版控制台」里,和接口地址放在一起。
// Secret Key 两个接口都用不到,不再出现。
//
// 🔴 凭据只存本机(voice-credentials.ts),保存后**不回显**密钥全文:密钥输入框永远是空的,
// 状态行只显示「已配置 ✓ …a1b2」。密钥栏留空点保存 = 不改。

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { clearVoiceCredentials, loadVoiceCredentials, saveVoiceCredentials, voiceStorageKind } from './voice-credentials';
import { authMode, CONSOLE_LABELS, initialForm, mergeOnSave, voiceConfigStatus, VOLC_CONSOLE_URL, type VoiceConsole, type VoiceCredentials, type VoiceForm } from './voice-credentials-model';
import { AsrError, asrErrorMessage } from './doubao-asr';
import { openExternal } from './open-external';
import { finishUtteranceWith, newUtterance } from './useVoiceInput';
import { useVoiceRecorder } from './useVoiceRecorder';
import MicDeviceSetting from './MicDeviceSetting';
import { SettingsActionRow, SettingsCardContent, SettingsChoiceRow, SettingsControlRow, SettingsGroup } from './settings-kit';
import { STREAM_DEFAULT_RESOURCE_ID, STREAM_RESOURCE_IDS } from './doubao-stream-protocol';
import { MODE_LABELS, STREAM_UNAVAILABLE_HINT, streamingSupported, testFallbackNote, type VoiceMode, type VoicePlatform } from './voice-stream-policy';
import { clearStreamUnavailable, currentVoiceMode, loadVoiceMode, saveVoiceMode, streamUnavailable, subscribeVoicePrefs, voicePlatform } from './voice-prefs';
import { buttonStyle, buttonTextStyle } from './elevation';

export const TEST_RECORD_MS = 3000;

export const CONSOLE_HELP = 'settings.copy.223';

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

/**
 * 语音设置的全部状态与动作(凭据表单、保存/清除、识别模型、测试录音)。宽屏的 VoiceSettingsSection 和
 * 手机子页(SettingsPhonePages.tsx 的 VoicePhonePage)共用这一份 —— 两边只是画法不同,行为一处。
 */
export function useVoiceSettings() {
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
      setSaveMsg({ ok: true, text: tr('settings.copy.224') });
    } catch {
      setSaveMsg({ ok: false, text: tr('settings.copy.225') });
    } finally { setBusy(false); }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      await clearVoiceCredentials();
      setCreds(null);
      setForm(initialForm(null));
      setSaveMsg({ ok: true, text: tr('settings.copy.226') });
    } catch {
      setSaveMsg({ ok: false, text: tr('settings.copy.227') });
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

  return { storage, platform, mode, unavailable, interim, creds, loaded, form, setForm, advanced, setAdvanced, saveMsg, busy, test, status, onSave, onClear, onTest, onPickMode, choices, setConsole, savedIs, testBusy, secondsLeft };
}

export const VOICE_UNSUPPORTED_TEXT = 'settings.copy.228';
export const voiceStorageLabel = (storage: string) => storage === 'keychain' ? tr('settings.copy.229') : tr('settings.copy.230');

export default function VoiceSettingsSection({ showCredentials = true, showTest = true, showMode = true, showMic = true }: { showCredentials?: boolean; showTest?: boolean; showMode?: boolean; showMic?: boolean }) {
  useTranslation();
  const { storage, platform, mode, unavailable, interim, loaded, form, setForm, advanced, setAdvanced, saveMsg, busy, test, status, onSave, onClear, onTest, onPickMode, choices, setConsole, savedIs, testBusy, secondsLeft } = useVoiceSettings();

  if (storage === 'unsupported') {
    return (
      <SettingsGroup testID="voice-settings-unsupported">
        <SettingsCardContent><Text style={styles.hint}>{tr(VOICE_UNSUPPORTED_TEXT)}</Text></SettingsCardContent>
      </SettingsGroup>
    );
  }

  return (
    <View testID="voice-settings">
      {showMode ? (
        // v2(#427):识别方式 = 设置积木的单选行(✓ 在右侧同一列),说明放在卡片下面。
        <SettingsGroup
          title={tr('settings.copy.127')}
          testID="voice-mode"
          footer={!streamingSupported(platform) ? tr('settings.copy.231')
            : mode === 'stream' && unavailable ? <Text testID="voice-stream-unavailable">{settingsText(STREAM_UNAVAILABLE_HINT)}</Text>
              : mode === 'stream' ? tr('settings.copy.232') : tr('settings.copy.117')}
          footerTone={mode === 'stream' && unavailable && streamingSupported(platform) ? 'accent' : undefined}
        >
          {choices.map(m => (
            <SettingsChoiceRow key={m} label={settingsText(MODE_LABELS[m])} selected={mode === m || choices.length === 1} onPress={() => onPickMode(m)} testID={`voice-mode-${m}`} />
          ))}
        </SettingsGroup>
      ) : null}

      {showCredentials ? (
        <SettingsGroup footer={`${tr('settings.copy.242')}${voiceStorageLabel(storage)}${tr('settings.copy.243')}`} testID="voice-credentials">
          <SettingsControlRow
            label={tr('settings.copy.24')}
            subtitle={status.configured && (status.console === 'old' || status.customEndpoint || status.customStreamEndpoint)
              ? <Text testID="voice-status-mode">{status.console === 'old' ? tr('settings.copy.194', { v0: status.appId }) : tr('settings.copy.118')}{status.customEndpoint || status.customStreamEndpoint ? tr('settings.copy.119') : ''}</Text>
              : undefined}
            testID="voice-status-row"
          >
            {loaded ? (
              <Text style={[styles.status, status.configured && styles.statusOk]} testID="voice-status">{localizedVoiceStatus(status)}</Text>
            ) : <ActivityIndicator size="small" color={colors.textMuted} />}
          </SettingsControlRow>
          <SettingsCardContent testID="voice-credentials-form">
          <View style={styles.formStack}>

          {form.console === 'new' ? (
            <>
              <Text style={styles.fieldLabel}>API Key</Text>
              <TextInput
                testID="voice-api-key"
                accessibilityLabel="API Key"
                value={form.apiKey}
                onChangeText={apiKey => setForm(f => ({ ...f, apiKey }))}
                placeholder={savedIs('new') && status.configured ? tr('settings.copy.267', { v0: status.tokenTail }) : tr('settings.copy.233')}
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
            <Text style={styles.link} onPress={() => { void openExternal(VOLC_CONSOLE_URL).catch(() => {}); }} accessibilityRole="link" testID="voice-console-link">{tr('settings.copy.234')}</Text>
            {` ${tr(CONSOLE_HELP)}`}
          </Text>

          <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(a => !a)} hitSlop={6} testID="voice-advanced-toggle">
            <Text style={styles.link}>{advanced ? tr('settings.copy.235') : tr('settings.copy.236')}</Text>
          </Pressable>
          {advanced ? (
            <View style={styles.advanced} testID="voice-advanced">
              <Text style={styles.fieldLabel}>{tr('settings.copy.144')}</Text>
              <View style={styles.chips}>
                {(['new', 'old'] as const).map(c => (
                  <Pressable key={c} accessibilityRole="radio" accessibilityState={{ checked: form.console === c }} onPress={() => setConsole(c)} style={[styles.chip, form.console === c && styles.chipOn]} testID={`voice-console-${c}`}>
                    <Text style={[styles.chipText, form.console === c && styles.chipTextOn]}>{settingsText(CONSOLE_LABELS[c])}</Text>
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
                    placeholder={tr('settings.copy.237')}
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
                    placeholder={savedIs('old') && status.configured ? tr('settings.copy.267', { v0: status.tokenTail }) : tr('settings.copy.238')}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    style={styles.input}
                  />
                </>
              ) : null}
              <Text style={styles.fieldLabel}>{tr('settings.copy.239')}</Text>
              <TextInput
                testID="voice-endpoint"
                accessibilityLabel={tr('settings.copy.147')}
                value={form.endpoint}
                onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))}
                placeholder={tr('settings.copy.240')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              {streamingSupported(platform) ? (
                <>
                  <Text style={styles.fieldLabel}>{tr('settings.copy.150')}</Text>
                  <TextInput
                    testID="voice-stream-endpoint"
                    accessibilityLabel={tr('settings.copy.150')}
                    value={form.streamEndpoint}
                    onChangeText={streamEndpoint => setForm(f => ({ ...f, streamEndpoint }))}
                    placeholder={tr('settings.copy.241')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <Text style={styles.fieldLabel}>{tr('settings.copy.151')}</Text>
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
                  <Text style={styles.hint}>{tr('settings.copy.152')}</Text>
                </>
              ) : null}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel={tr('settings.copy.141')} disabled={busy} onPress={() => void onSave()} style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && { opacity: 0.7 }]} testID="voice-save">
              <Text style={styles.primaryText}>{tr('settings.copy.140')}</Text>
            </Pressable>
            {status.configured ? (
              <Pressable accessibilityRole="button" accessibilityLabel={tr('settings.copy.143')} disabled={busy} onPress={() => void onClear()} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]} testID="voice-clear">
                <Text style={styles.secondaryText}>{tr('settings.copy.142')}</Text>
              </Pressable>
            ) : null}
            {saveMsg ? <Text style={[styles.hint, !saveMsg.ok && styles.error]} testID="voice-save-msg">{saveMsg.text}</Text> : null}
          </View>
          </View>
          </SettingsCardContent>
        </SettingsGroup>
      ) : null}

      {/* 麦克风选择只在 webview 里有(getUserMedia);手机走原生录音,没有这一栏。 */}
      {showMic && Platform.OS === 'web' ? <SettingsGroup><SettingsCardContent><MicDeviceSetting /></SettingsCardContent></SettingsGroup> : null}

      {showTest ? (
        <SettingsGroup testID="voice-test-group">
          <SettingsActionRow
            label={tr('settings.copy.133')}
            subtitle={`${tr('settings.copy.245')}${mode === 'stream' && streamingSupported(platform) ? tr('settings.copy.246') : ''}。`}
            action={test.kind === 'recording' ? tr('settings.copy.195', { v0: secondsLeft }) : test.kind === 'transcribing' ? tr('settings.copy.121') : tr('settings.copy.244')}
            disabled={testBusy || !status.configured}
            onPress={() => void onTest()}
            testID="voice-test-row"
            buttonTestID="voice-test"
          />
          {(test.kind === 'recording' || test.kind === 'transcribing') && interim ? <SettingsCardContent><Text style={[styles.result, styles.interim]} testID="voice-test-interim">{interim}</Text></SettingsCardContent> : null}
          {test.kind === 'done' ? (
            <SettingsCardContent>
              <Text style={styles.result} testID="voice-test-result">{test.text ? tr('settings.copy.196', { v0: test.via === 'stream' ? tr('settings.copy.122') : tr('settings.copy.123'), v1: test.text }) : tr('settings.copy.124')}</Text>
              {test.note ? <Text style={[styles.hint, styles.warn]} testID="voice-test-note">{test.note}</Text> : null}
            </SettingsCardContent>
          ) : null}
          {test.kind === 'error' ? <SettingsCardContent><Text style={[styles.result, styles.error]} testID="voice-test-error">{test.message}</Text></SettingsCardContent> : null}
        </SettingsGroup>
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  formStack: { gap: 6 },
  status: { color: colors.textMuted, fontSize: 14 },
  statusOk: { color: colors.accent, fontWeight: '600' },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, backgroundColor: colors.inputBg, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: 8, fontSize: 14 },
  link: { color: colors.accent, fontSize: 12, marginTop: 6 },
  advanced: { gap: 6, paddingLeft: spacing.sm, borderLeftWidth: 2, borderLeftColor: colors.border },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  primary: { ...buttonStyle('primary') },
  primaryText: { ...buttonTextStyle('primary') },
  secondary: { ...buttonStyle('secondary') },
  secondaryText: { ...buttonTextStyle('secondary') },
  disabled: { opacity: 0.45 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.failed },
  result: { color: colors.text, fontSize: 14, marginTop: 4 },
  interim: { color: colors.textSecondary },
  warn: { color: colors.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.bg, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
