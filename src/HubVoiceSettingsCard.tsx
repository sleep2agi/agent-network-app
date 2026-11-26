import './i18n-hub-voice';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
import { AppSwitch } from './AppSwitch';
import { STREAM_DEFAULT_RESOURCE_ID, STREAM_RESOURCE_IDS } from './doubao-stream-protocol';
import { clearStreamUnavailable } from './voice-prefs';
import {
  SettingsButton,
  SettingsCardContent,
  SettingsChoiceRow,
  SettingsControlRow,
  SettingsGroup,
  SettingsRow,
  SettingsSwitchRow,
  SettingsTextField,
} from './settings-kit';
import {
  clearHubVoiceConfig,
  getActiveHubVoiceConfig,
  getHubVoiceSnapshot,
  initialHubVoiceForm,
  mergeHubVoiceWrite,
  refreshHubVoiceConfig,
  saveHubVoiceConfig,
  subscribeHubVoice,
  type HubVoiceAdminForm,
  type HubVoiceAuthMode,
  type HubVoiceConfigState,
} from './hub-voice';

function hubVoiceStatusText(s: HubVoiceConfigState): string {
  if (!s.configured) return tr('hubVoice.statusUnconfigured');
  if (s.enabled) return s.keyHint ? tr('hubVoice.statusEnabledHint', { tail: s.keyHint }) : tr('hubVoice.statusEnabled');
  return tr('hubVoice.statusDisabled', { tail: s.keyHint || '…' });
}

function useHubVoiceEditor() {
  const hub = useSyncExternalStore(subscribeHubVoice, getHubVoiceSnapshot, getHubVoiceSnapshot);
  const [form, setForm] = useState<HubVoiceAdminForm>(() => initialHubVoiceForm(hub));
  const [advanced, setAdvanced] = useState(() => hub.authMode === 'app-token' || !!hub.endpoint || !!hub.streamEndpoint || !!hub.streamResourceId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void refreshHubVoiceConfig(undefined, { force: false });
  }, []);

  useEffect(() => {
    setForm(prev => ({
      ...initialHubVoiceForm(hub),
      apiKey: prev.apiKey,
      accessToken: prev.accessToken,
    }));
    if (hub.authMode === 'app-token' || !!hub.endpoint || !!hub.streamEndpoint || !!hub.streamResourceId) setAdvanced(true);
  }, [hub.scopeKey, hub.configured, hub.enabled, hub.authMode, hub.appId, hub.endpoint, hub.streamEndpoint, hub.streamResourceId, hub.updatedAt]);

  const setAuthMode = (authMode: HubVoiceAuthMode) => setForm(f => ({ ...f, authMode }));

  const onSave = async () => {
    const cfg = getActiveHubVoiceConfig();
    if (!cfg) { setMsg({ ok: false, text: tr('hubVoice.err.noHub') }); return; }
    const merged = mergeHubVoiceWrite(hub, form);
    if (!merged.ok) { setMsg({ ok: false, text: tr(merged.reasonKey) }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveHubVoiceConfig(cfg, merged.body);
      if (res.ok) {
        clearStreamUnavailable();
        setForm(initialHubVoiceForm(res.state));
        setMsg({ ok: true, text: tr('hubVoice.saved') });
      } else {
        const text = res.error === 'network' ? tr('hubVoice.err.network') : tr('hubVoice.saveFailed', { msg: res.message });
        setMsg({ ok: false, text });
      }
    } finally {
      setBusy(false);
    }
  };

  const onToggleEnabled = async (next: boolean) => {
    setForm(f => ({ ...f, enabled: next }));
    const cfg = getActiveHubVoiceConfig();
    if (!cfg || !hub.configured) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveHubVoiceConfig(cfg, {
        enabled: next,
        provider: 'doubao',
        auth_mode: hub.authMode,
        app_id: hub.appId,
        endpoint: hub.endpoint,
        stream_endpoint: hub.streamEndpoint,
        stream_resource_id: hub.streamResourceId,
      });
      if (res.ok) {
        setMsg({ ok: true, text: tr('hubVoice.saved') });
      } else {
        setForm(f => ({ ...f, enabled: hub.enabled }));
        const text = res.error === 'network' ? tr('hubVoice.err.network') : tr('hubVoice.saveFailed', { msg: res.message });
        setMsg({ ok: false, text });
      }
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    const cfg = getActiveHubVoiceConfig();
    if (!cfg) { setMsg({ ok: false, text: tr('hubVoice.err.noHub') }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await clearHubVoiceConfig(cfg);
      if (res.ok) {
        setForm(initialHubVoiceForm(res.state));
        setMsg({ ok: true, text: tr('hubVoice.cleared') });
      } else {
        const text = res.error === 'network' ? tr('hubVoice.err.network') : tr('hubVoice.clearFailed', { msg: res.message });
        setMsg({ ok: false, text });
      }
    } finally {
      setBusy(false);
    }
  };

  return { hub, form, setForm, advanced, setAdvanced, busy, msg, setAuthMode, onSave, onToggleEnabled, onClear };
}

/** 宽屏 / 桌面设置页里的「服务器统一语音服务」卡片。旧版 Hub 自动隐藏。 */
export function HubVoiceSettingsCard() {
  useTranslation();
  const { hub, form, setForm, advanced, setAdvanced, busy, msg, setAuthMode, onSave, onToggleEnabled, onClear } = useHubVoiceEditor();

  if (!hub.supported || (!hub.canUse && !hub.canManage)) return null;
  const ready = hub.enabled && hub.configured && hub.canUse;
  const footer = hub.canManage
    ? (!hub.vaultReady ? tr('hubVoice.vaultMissing') : tr('hubVoice.adminFooter'))
    : (ready ? tr('hubVoice.memberFooterEnabled') : tr('hubVoice.memberFooterDisabled'));

  return (
    <SettingsGroup
      title={tr('hubVoice.title')}
      footer={footer}
      footerTone={hub.canManage && !hub.vaultReady ? 'accent' : undefined}
      testID="hub-voice-group"
    >
      <SettingsControlRow label={tr('hubVoice.rowLabel')} testID="hub-voice-status-row">
        <Text style={[styles.status, ready && styles.statusOk]} testID="hub-voice-status">
          {hubVoiceStatusText(hub)}
        </Text>
      </SettingsControlRow>

      {hub.canManage ? (
        <>
          <SettingsControlRow
            label={tr('hubVoice.enableSwitch')}
            subtitle={tr('hubVoice.enableSubtitle')}
            testID="hub-voice-enable-row"
          >
            <AppSwitch
              value={form.enabled}
              disabled={busy}
              onValueChange={v => void onToggleEnabled(v)}
              testID="hub-voice-enable-switch"
            />
          </SettingsControlRow>

          <SettingsCardContent testID="hub-voice-admin-form">
            <View style={styles.formStack}>
              {form.authMode === 'api-key' ? (
                <>
                  <Text style={styles.fieldLabel}>API Key</Text>
                  <TextInput
                    testID="hub-voice-api-key"
                    accessibilityLabel="Hub Voice API Key"
                    value={form.apiKey}
                    onChangeText={apiKey => setForm(f => ({ ...f, apiKey }))}
                    placeholder={hub.configured && hub.authMode === 'api-key'
                      ? tr('hubVoice.apiKeyPlaceholderSaved', { tail: hub.keyHint || '…' })
                      : tr('hubVoice.apiKeyPlaceholderNew')}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    style={styles.input}
                  />
                </>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: advanced }}
                onPress={() => setAdvanced(a => !a)}
                hitSlop={6}
                testID="hub-voice-advanced-toggle"
              >
                <Text style={styles.link}>{advanced ? tr('hubVoice.advancedHide') : tr('hubVoice.advancedShow')}</Text>
              </Pressable>

              {advanced ? (
                <View style={styles.advanced} testID="hub-voice-advanced">
                  <Text style={styles.fieldLabel}>{tr('hubVoice.consoleMode')}</Text>
                  <View style={styles.chips}>
                    {(['api-key', 'app-token'] as const).map(m => (
                      <Pressable
                        key={m}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: form.authMode === m }}
                        onPress={() => setAuthMode(m)}
                        style={[styles.chip, form.authMode === m && styles.chipOn]}
                        testID={`hub-voice-mode-${m}`}
                      >
                        <Text style={[styles.chipText, form.authMode === m && styles.chipTextOn]}>
                          {m === 'api-key' ? tr('hubVoice.consoleNew') : tr('hubVoice.consoleOld')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {form.authMode === 'app-token' ? (
                    <>
                      <Text style={styles.fieldLabel}>App ID</Text>
                      <TextInput
                        testID="hub-voice-app-id"
                        accessibilityLabel="Hub Voice App ID"
                        value={form.appId}
                        onChangeText={appId => setForm(f => ({ ...f, appId }))}
                        placeholder={tr('hubVoice.appIdPlaceholder')}
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={styles.input}
                      />
                      <Text style={styles.fieldLabel}>Access Token</Text>
                      <TextInput
                        testID="hub-voice-access-token"
                        accessibilityLabel="Hub Voice Access Token"
                        value={form.accessToken}
                        onChangeText={accessToken => setForm(f => ({ ...f, accessToken }))}
                        placeholder={hub.configured && hub.authMode === 'app-token'
                          ? tr('hubVoice.apiKeyPlaceholderSaved', { tail: hub.keyHint || '…' })
                          : tr('hubVoice.accessTokenPlaceholderNew')}
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="password"
                        style={styles.input}
                      />
                    </>
                  ) : null}

                  <Text style={styles.fieldLabel}>{tr('hubVoice.endpointLabel')}</Text>
                  <TextInput
                    testID="hub-voice-endpoint"
                    accessibilityLabel={tr('hubVoice.endpointLabel')}
                    value={form.endpoint}
                    onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))}
                    placeholder={tr('hubVoice.endpointPlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />

                  <Text style={styles.fieldLabel}>{tr('hubVoice.streamEndpointLabel')}</Text>
                  <TextInput
                    testID="hub-voice-stream-endpoint"
                    accessibilityLabel={tr('hubVoice.streamEndpointLabel')}
                    value={form.streamEndpoint}
                    onChangeText={streamEndpoint => setForm(f => ({ ...f, streamEndpoint }))}
                    placeholder={tr('hubVoice.streamEndpointPlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />

                  <Text style={styles.fieldLabel}>{tr('hubVoice.streamResourceLabel')}</Text>
                  <View style={styles.chips}>
                    {STREAM_RESOURCE_IDS.map(id => {
                      const on = (form.streamResourceId || STREAM_DEFAULT_RESOURCE_ID) === id;
                      return (
                        <Pressable
                          key={id}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: on }}
                          onPress={() => setForm(f => ({ ...f, streamResourceId: id }))}
                          style={[styles.chip, on && styles.chipOn]}
                          testID={`hub-voice-stream-resource-${id}`}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{id}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('hubVoice.save')}
                  disabled={busy}
                  onPress={() => void onSave()}
                  style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && { opacity: 0.7 }]}
                  testID="hub-voice-save"
                >
                  <Text style={styles.primaryText}>{tr('hubVoice.save')}</Text>
                </Pressable>
                {hub.configured ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr('hubVoice.clear')}
                    disabled={busy}
                    onPress={() => void onClear()}
                    style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
                    testID="hub-voice-clear"
                  >
                    <Text style={styles.secondaryText}>{tr('hubVoice.clear')}</Text>
                  </Pressable>
                ) : null}
                {msg ? <Text style={[styles.hint, !msg.ok && styles.error]} testID="hub-voice-msg">{msg.text}</Text> : null}
              </View>
            </View>
          </SettingsCardContent>
        </>
      ) : null}
    </SettingsGroup>
  );
}

/** 手机语音子页顶部的「服务器统一语音服务」摘要组（仅使用 settings-kit 积木）。 */
export function HubVoicePhoneGroup({ onOpenEdit }: { onOpenEdit: () => void }) {
  useTranslation();
  const hub = useSyncExternalStore(subscribeHubVoice, getHubVoiceSnapshot, getHubVoiceSnapshot);
  useEffect(() => { void refreshHubVoiceConfig(undefined, { force: false }); }, []);
  if (!hub.supported || (!hub.canUse && !hub.canManage)) return null;
  const ready = hub.enabled && hub.configured && hub.canUse;
  const footer = hub.canManage
    ? tr('hubVoice.phoneHint')
    : (ready ? tr('hubVoice.memberFooterEnabled') : tr('hubVoice.memberFooterDisabled'));

  return (
    <SettingsGroup title={tr('hubVoice.title')} footer={footer} testID="hub-voice-group">
      <SettingsRow
        testID="hub-voice-row"
        label={tr('hubVoice.rowLabel')}
        value={hubVoiceStatusText(hub)}
        valueTone={ready ? 'accent' : undefined}
        chevron={hub.canManage}
        onPress={hub.canManage ? onOpenEdit : undefined}
      />
    </SettingsGroup>
  );
}

/** 手机三级页：设置 → 语音输入 → 服务器统一语音（严格仅使用 settings-kit）。 */
export function HubVoiceEditPage() {
  useTranslation();
  const { hub, form, setForm, busy, msg, setAuthMode, onSave, onToggleEnabled, onClear } = useHubVoiceEditor();

  return (
    <>
      <SettingsGroup
        title={tr('hubVoice.title')}
        footer={!hub.vaultReady ? tr('hubVoice.vaultMissing') : tr('hubVoice.adminFooter')}
        footerTone={!hub.vaultReady ? 'accent' : undefined}
        testID="hub-voice-edit-page"
      >
        <SettingsSwitchRow
          testID="hub-voice-enable-switch"
          label={tr('hubVoice.enableSwitch')}
          subtitle={tr('hubVoice.enableSubtitle')}
          value={form.enabled}
          disabled={busy}
          onValueChange={v => void onToggleEnabled(v)}
        />
      </SettingsGroup>

      <SettingsGroup title={tr('hubVoice.consoleMode')}>
        {(['api-key', 'app-token'] as const).map(m => (
          <SettingsChoiceRow
            key={m}
            testID={`hub-voice-mode-${m}`}
            label={m === 'api-key' ? tr('hubVoice.consoleNew') : tr('hubVoice.consoleOld')}
            selected={form.authMode === m}
            onPress={() => setAuthMode(m)}
          />
        ))}
      </SettingsGroup>

      {form.authMode === 'api-key' ? (
        <SettingsGroup title="API Key">
          <SettingsTextField
            testID="hub-voice-api-key"
            accessibilityLabel="Hub Voice API Key"
            value={form.apiKey}
            onChangeText={apiKey => setForm(f => ({ ...f, apiKey }))}
            placeholder={hub.configured && hub.authMode === 'api-key'
              ? tr('hubVoice.apiKeyPlaceholderSaved', { tail: hub.keyHint || '…' })
              : tr('hubVoice.apiKeyPlaceholderNew')}
            secureTextEntry
            textContentType="password"
          />
        </SettingsGroup>
      ) : (
        <SettingsGroup title="App ID / Access Token">
          <SettingsTextField
            label="App ID"
            testID="hub-voice-app-id"
            value={form.appId}
            onChangeText={appId => setForm(f => ({ ...f, appId }))}
            placeholder={tr('hubVoice.appIdPlaceholder')}
          />
          <SettingsTextField
            label="Access Token"
            testID="hub-voice-access-token"
            value={form.accessToken}
            onChangeText={accessToken => setForm(f => ({ ...f, accessToken }))}
            placeholder={hub.configured && hub.authMode === 'app-token'
              ? tr('hubVoice.apiKeyPlaceholderSaved', { tail: hub.keyHint || '…' })
              : tr('hubVoice.accessTokenPlaceholderNew')}
            secureTextEntry
            textContentType="password"
          />
        </SettingsGroup>
      )}

      <SettingsGroup title={tr('hubVoice.endpointLabel')}>
        <SettingsTextField
          testID="hub-voice-endpoint"
          accessibilityLabel={tr('hubVoice.endpointLabel')}
          value={form.endpoint}
          onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))}
          placeholder="https://…"
        />
        <SettingsTextField
          testID="hub-voice-stream-endpoint"
          accessibilityLabel={tr('hubVoice.streamEndpointLabel')}
          value={form.streamEndpoint}
          onChangeText={streamEndpoint => setForm(f => ({ ...f, streamEndpoint }))}
          placeholder="wss://…"
        />
      </SettingsGroup>

      <SettingsGroup title={tr('hubVoice.streamResourceLabel')}>
        {STREAM_RESOURCE_IDS.map(id => (
          <SettingsChoiceRow
            key={id}
            testID={`hub-voice-stream-resource-${id}`}
            label={id}
            selected={(form.streamResourceId || STREAM_DEFAULT_RESOURCE_ID) === id}
            onPress={() => setForm(f => ({ ...f, streamResourceId: id }))}
          />
        ))}
      </SettingsGroup>

      <SettingsButton label={tr('hubVoice.save')} busy={busy} onPress={() => void onSave()} testID="hub-voice-save" />
      {msg ? <SettingsGroup testID="hub-voice-msg" footer={msg.text} footerTone={msg.ok ? 'accent' : 'danger'} /> : null}
      {hub.configured ? (
        <SettingsButton variant="destructive" label={tr('hubVoice.clear')} disabled={busy} onPress={() => void onClear()} testID="hub-voice-clear" />
      ) : null}
    </>
  );
}

const makeStyles = () => StyleSheet.create({
  formStack: { gap: 6 },
  status: { color: colors.textMuted, fontSize: 14 },
  statusOk: { color: colors.accent, fontWeight: '600' },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.inputBg,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 14,
  },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.bg, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
