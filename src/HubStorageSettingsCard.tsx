import './i18n-hub-storage';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
import { AppSwitch } from './AppSwitch';
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
  clearHubStorageConfig,
  getActiveHubStorageConfig,
  getHubStorageSnapshot,
  initialHubStorageForm,
  isSelectableHubStorageProvider,
  mergeHubStorageWrite,
  refreshHubStorageConfig,
  saveHubStorageConfig,
  SELECTABLE_HUB_STORAGE_PROVIDERS,
  subscribeHubStorage,
  testHubStorageConfig,
  type HubStorageAdminForm,
  type HubStorageConfigState,
  type HubStorageProvider,
} from './hub-storage';

function providerLabel(provider: HubStorageProvider): string {
  if (provider === 'oss') return tr('hubStorage.providerOss');
  if (provider === 's3') return tr('hubStorage.providerS3');
  return tr('hubStorage.providerModelScope');
}

function isLegacyModelscopeState(s: HubStorageConfigState): boolean {
  return s.configured && s.provider === 'modelscope';
}

function hubStorageStatusText(s: HubStorageConfigState): string {
  if (!s.configured) return tr('hubStorage.statusUnconfigured');
  if (isLegacyModelscopeState(s)) {
    return s.enabled
      ? tr('hubStorage.statusModelscopeUnsupported')
      : tr('hubStorage.statusModelscopeDisabled');
  }
  const p = providerLabel(s.provider);
  if (s.enabled && s.source === 'hub_managed') {
    return tr('hubStorage.statusHubManaged', { provider: p });
  }
  if (s.enabled) {
    return s.keyHint
      ? tr('hubStorage.statusEnabled', { provider: p, tail: s.keyHint })
      : tr('hubStorage.statusEnabledNoTail', { provider: p });
  }
  return tr('hubStorage.statusDisabled', { provider: p, tail: s.keyHint || '…' });
}

function hubManagedTargetLabel(s: HubStorageConfigState): string {
  if (s.provider === 'modelscope') return s.repoId || 'ModelScope';
  return [s.bucket, s.region].filter(Boolean).join(' · ') || providerLabel(s.provider);
}

function useHubStorageEditor() {
  const hub = useSyncExternalStore(subscribeHubStorage, getHubStorageSnapshot, getHubStorageSnapshot);
  const [form, setForm] = useState<HubStorageAdminForm>(() => initialHubStorageForm(hub));
  const [customize, setCustomize] = useState(false);
  const [advanced, setAdvanced] = useState(() => !!hub.endpoint);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  useEffect(() => {
    void refreshHubStorageConfig(undefined, { force: false });
  }, []);

  useEffect(() => {
    setForm(prev => ({
      ...initialHubStorageForm(hub),
      apiToken: prev.apiToken,
      accessKeyId: prev.accessKeyId,
      accessKeySecret: prev.accessKeySecret,
    }));
  }, [
    hub.scopeKey,
    hub.configured,
    hub.source,
    hub.enabled,
    hub.provider,
    hub.repoId,
    hub.repoType,
    hub.revision,
    hub.bucket,
    hub.region,
    hub.endpoint,
    hub.prefix,
    hub.maxFileBytes,
    hub.updatedAt,
  ]);

  const setProvider = (provider: HubStorageProvider) => {
    if (!isSelectableHubStorageProvider(provider)) return;
    setForm(f => ({ ...f, provider }));
    setMsg(null);
  };

  const onSave = async () => {
    const cfg = getActiveHubStorageConfig();
    if (!cfg) { setMsg({ tone: 'err', text: tr('hubStorage.err.noHub') }); return; }
    const merged = mergeHubStorageWrite(hub, form);
    if (!merged.ok) { setMsg({ tone: 'err', text: tr(merged.reasonKey) }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveHubStorageConfig(cfg, merged.body);
      if (res.ok) {
        setForm(initialHubStorageForm(res.state));
        setCustomize(false);
        setMsg({
          tone: 'ok',
          text: tr('hubStorage.saved', { mb: Math.round(res.state.maxFileBytes / (1024 * 1024)) }),
        });
      } else {
        const text = res.error === 'network' ? tr('hubStorage.err.network') : tr('hubStorage.saveFailed', { msg: res.message });
        setMsg({ tone: 'err', text });
      }
    } finally {
      setBusy(false);
    }
  };

  const onTest = async (testManagedDirect = false) => {
    const cfg = getActiveHubStorageConfig();
    if (!cfg) { setMsg({ tone: 'err', text: tr('hubStorage.err.noHub') }); return; }
    let draftBody: ReturnType<typeof mergeHubStorageWrite> extends infer R ? (R extends { ok: true; body: infer B } ? B | undefined : never) : never = undefined;
    if (!testManagedDirect) {
      const merged = mergeHubStorageWrite(hub, form);
      if (!merged.ok) { setMsg({ tone: 'err', text: tr(merged.reasonKey) }); return; }
      draftBody = merged.body;
    }
    setTesting(true);
    setMsg(null);
    try {
      const res = await testHubStorageConfig(cfg, draftBody);
      if (res.ok) {
        const baseText = tr('hubStorage.testOk', { msg: res.message, ms: res.latencyMs });
        setMsg({
          tone: res.warning ? 'warn' : 'ok',
          text: res.warning ? `${baseText}\n${res.warning}` : baseText,
        });
      } else {
        const text = res.error === 'network' ? tr('hubStorage.err.network') : tr('hubStorage.testFailed', { msg: res.message });
        setMsg({ tone: 'err', text });
      }
    } finally {
      setTesting(false);
    }
  };

  const onToggleEnabled = async (next: boolean) => {
    setForm(f => ({ ...f, enabled: next }));
    const cfg = getActiveHubStorageConfig();
    if (!cfg || !hub.configured || hub.source === 'hub_managed') return;
    if (hub.provider === 'modelscope' && next) {
      setForm(f => ({ ...f, enabled: hub.enabled }));
      setMsg({ tone: 'err', text: tr('hubStorage.modelscopeDisabledHint') });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const merged = mergeHubStorageWrite(hub, { ...initialHubStorageForm(hub), provider: hub.provider, enabled: next });
      if (!merged.ok) {
        setForm(f => ({ ...f, enabled: hub.enabled }));
        setMsg({ tone: 'err', text: tr(merged.reasonKey) });
        return;
      }
      const res = await saveHubStorageConfig(cfg, merged.body);
      if (res.ok) {
        setMsg({
          tone: 'ok',
          text: tr('hubStorage.saved', { mb: Math.round(res.state.maxFileBytes / (1024 * 1024)) }),
        });
      } else {
        setForm(f => ({ ...f, enabled: hub.enabled }));
        const text = res.error === 'network' ? tr('hubStorage.err.network') : tr('hubStorage.saveFailed', { msg: res.message });
        setMsg({ tone: 'err', text });
      }
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    const cfg = getActiveHubStorageConfig();
    if (!cfg) { setMsg({ tone: 'err', text: tr('hubStorage.err.noHub') }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await clearHubStorageConfig(cfg);
      if (res.ok) {
        setForm(initialHubStorageForm(res.state));
        setCustomize(false);
        setMsg({
          tone: 'ok',
          text: res.state.source === 'hub_managed' ? tr('hubStorage.restoredManaged') : tr('hubStorage.cleared'),
        });
      } else {
        const text = res.error === 'network' ? tr('hubStorage.err.network') : tr('hubStorage.clearFailed', { msg: res.message });
        setMsg({ tone: 'err', text });
      }
    } finally {
      setBusy(false);
    }
  };

  return { hub, form, setForm, customize, setCustomize, advanced, setAdvanced, busy, testing, msg, setProvider, onSave, onTest, onToggleEnabled, onClear };
}

/** 宽屏 / 桌面设置页里的「文件存储中转」卡片。旧版 Hub 自动隐藏。 */
export function HubStorageSettingsCard() {
  useTranslation();
  const { hub, form, setForm, customize, setCustomize, advanced, setAdvanced, busy, testing, msg, setProvider, onSave, onTest, onToggleEnabled, onClear } = useHubStorageEditor();

  if (!hub.supported || (!hub.enabled && !hub.canManage)) return null;
  const ready = hub.enabled && hub.configured;
  const isLegacyModelscope = isLegacyModelscopeState(hub);
  const isHubManaged = hub.source === 'hub_managed';
  const showForm = !isHubManaged || customize;
  const mb = Math.round((hub.maxFileBytes || 100 * 1024 * 1024) / (1024 * 1024));
  const footer = hub.canManage
    ? (isHubManaged && !customize
      ? tr('hubStorage.hubManagedFooter')
      : (!hub.vaultReady ? tr('hubStorage.vaultMissing') : tr('hubStorage.adminFooter')))
    : (ready
      ? tr('hubStorage.memberFooterEnabled', { provider: providerLabel(hub.provider), mb })
      : tr('hubStorage.memberFooterDisabled'));

  return (
    <SettingsGroup
      title={tr('hubStorage.title')}
      footer={footer}
      footerTone={hub.canManage && showForm && !hub.vaultReady ? 'accent' : undefined}
      testID="hub-storage-group"
    >
      <SettingsControlRow label={tr('hubStorage.rowLabel')} testID="hub-storage-status-row">
        <Text style={[styles.status, isLegacyModelscope ? styles.statusWarn : (ready && styles.statusOk)]} testID="hub-storage-status">
          {hubStorageStatusText(hub)}
        </Text>
      </SettingsControlRow>

      {hub.canManage && isHubManaged ? (
        <SettingsCardContent testID="hub-storage-managed-summary">
          <View style={styles.formStack}>
            <Text style={styles.hint} testID="hub-storage-managed-text">
              {tr('hubStorage.hubManagedSummary', {
                provider: providerLabel(hub.provider),
                target: hubManagedTargetLabel(hub),
                mb,
              })}
            </Text>
            <View style={styles.actions}>
              {!customize ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('hubStorage.test')}
                  disabled={busy || testing}
                  onPress={() => void onTest(true)}
                  style={({ pressed }) => [styles.secondary, (busy || testing) && styles.disabled, pressed && { opacity: 0.7 }]}
                  testID="hub-storage-test-managed"
                >
                  <Text style={styles.secondaryText}>{testing ? tr('hubStorage.testing') : tr('hubStorage.test')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: customize }}
                onPress={() => setCustomize(v => !v)}
                hitSlop={6}
                testID="hub-storage-customize-toggle"
              >
                <Text style={styles.link}>{customize ? tr('hubStorage.customizeHide') : tr('hubStorage.customizeShow')}</Text>
              </Pressable>
            </View>
            {!customize && msg ? (
              <Text
                style={[
                  styles.hint,
                  msg.tone === 'ok' && styles.okText,
                  msg.tone === 'warn' && styles.warnText,
                  msg.tone === 'err' && styles.error,
                ]}
                testID="hub-storage-msg"
              >
                {msg.text}
              </Text>
            ) : null}
          </View>
        </SettingsCardContent>
      ) : null}

      {hub.canManage && showForm ? (
        <>
          <SettingsControlRow
            label={tr('hubStorage.enableSwitch')}
            subtitle={tr('hubStorage.enableSubtitle')}
            testID="hub-storage-enable-row"
          >
            <AppSwitch
              value={form.enabled}
              disabled={busy || testing}
              onValueChange={v => void onToggleEnabled(v)}
              testID="hub-storage-enable-switch"
            />
          </SettingsControlRow>

          <SettingsCardContent testID="hub-storage-admin-form">
            <View style={styles.formStack}>
              {isLegacyModelscope ? (
                <Text style={[styles.hint, styles.warnText]} testID="hub-storage-legacy-modelscope">
                  {tr('hubStorage.legacyModelscopeInfo', { repo: hub.repoId || tr('hubStorage.providerModelScope') })}
                </Text>
              ) : null}
              <Text style={styles.fieldLabel}>{tr('hubStorage.providerLabel')}</Text>
              <View style={styles.chips}>
                {SELECTABLE_HUB_STORAGE_PROVIDERS.map(p => (
                  <Pressable
                    key={p}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: form.provider === p }}
                    onPress={() => setProvider(p)}
                    style={[styles.chip, form.provider === p && styles.chipOn]}
                    testID={`hub-storage-provider-${p}`}
                  >
                    <Text style={[styles.chipText, form.provider === p && styles.chipTextOn]}>
                      {providerLabel(p)}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  key="modelscope"
                  disabled
                  accessibilityRole="radio"
                  accessibilityState={{ checked: false, disabled: true }}
                  style={[styles.chip, styles.chipDisabled]}
                  testID="hub-storage-provider-modelscope"
                >
                  <Text style={[styles.chipText, styles.chipTextDisabled]}>
                    {providerLabel('modelscope')}
                  </Text>
                </Pressable>
              </View>
              {!isLegacyModelscope ? (
                <Text style={styles.hint} testID="hub-storage-modelscope-hint">
                  {tr('hubStorage.modelscopeDisabledHint')}
                </Text>
              ) : null}

              <Text style={styles.fieldLabel}>{tr('hubStorage.bucketLabel')}</Text>
              <TextInput
                testID="hub-storage-bucket"
                accessibilityLabel={tr('hubStorage.bucketLabel')}
                value={form.bucket}
                onChangeText={bucket => setForm(f => ({ ...f, bucket }))}
                placeholder={tr('hubStorage.bucketPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>{tr('hubStorage.regionLabel')}</Text>
              <TextInput
                testID="hub-storage-region"
                accessibilityLabel={tr('hubStorage.regionLabel')}
                value={form.region}
                onChangeText={region => setForm(f => ({ ...f, region }))}
                placeholder={form.provider === 'oss' ? tr('hubStorage.regionPlaceholderOss') : tr('hubStorage.regionPlaceholderS3')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>{tr('hubStorage.akLabel')}</Text>
              <TextInput
                testID="hub-storage-ak"
                accessibilityLabel={tr('hubStorage.akLabel')}
                value={form.accessKeyId}
                onChangeText={accessKeyId => setForm(f => ({ ...f, accessKeyId }))}
                placeholder={hub.configured && hub.source !== 'hub_managed' && hub.provider === form.provider
                  ? tr('hubStorage.secretPlaceholderSaved', { tail: hub.keyHint || '…' })
                  : tr('hubStorage.akPlaceholder')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>{tr('hubStorage.skLabel')}</Text>
              <TextInput
                testID="hub-storage-sk"
                accessibilityLabel={tr('hubStorage.skLabel')}
                value={form.accessKeySecret}
                onChangeText={accessKeySecret => setForm(f => ({ ...f, accessKeySecret }))}
                placeholder={hub.configured && hub.source !== 'hub_managed' && hub.provider === form.provider
                  ? tr('hubStorage.secretPlaceholderSaved', { tail: hub.keyHint || '…' })
                  : tr('hubStorage.skPlaceholderNew')}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                style={styles.input}
              />

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: advanced }}
                onPress={() => setAdvanced(a => !a)}
                hitSlop={6}
                testID="hub-storage-advanced-toggle"
              >
                <Text style={styles.link}>{advanced ? tr('hubStorage.advancedHide') : tr('hubStorage.advancedShow')}</Text>
              </Pressable>

              {advanced ? (
                <View style={styles.advanced} testID="hub-storage-advanced">
                  <Text style={styles.fieldLabel}>{tr('hubStorage.prefixLabel')}</Text>
                  <TextInput
                    testID="hub-storage-prefix"
                    accessibilityLabel={tr('hubStorage.prefixLabel')}
                    value={form.prefix}
                    onChangeText={prefix => setForm(f => ({ ...f, prefix }))}
                    placeholder="anet-files"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />

                  <Text style={styles.fieldLabel}>{tr('hubStorage.maxSizeLabel')}</Text>
                  <TextInput
                    testID="hub-storage-max-mb"
                    accessibilityLabel={tr('hubStorage.maxSizeLabel')}
                    value={form.maxFileMb}
                    onChangeText={maxFileMb => setForm(f => ({ ...f, maxFileMb }))}
                    placeholder="100"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                    style={styles.input}
                  />

                  <Text style={styles.fieldLabel}>{tr('hubStorage.endpointLabel')}</Text>
                  <TextInput
                    testID="hub-storage-endpoint"
                    accessibilityLabel={tr('hubStorage.endpointLabel')}
                    value={form.endpoint}
                    onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))}
                    placeholder={form.provider === 'oss' ? tr('hubStorage.endpointPlaceholderOss') : tr('hubStorage.endpointPlaceholderS3')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={styles.input}
                  />
                  <Text style={styles.hint} testID="hub-storage-advanced-note">
                    {tr('hubStorage.advancedNote')}
                  </Text>
                </View>
              ) : null}

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('hubStorage.save')}
                  disabled={busy || testing}
                  onPress={() => void onSave()}
                  style={({ pressed }) => [styles.primary, (busy || testing) && styles.disabled, pressed && { opacity: 0.7 }]}
                  testID="hub-storage-save"
                >
                  <Text style={styles.primaryText}>{tr('hubStorage.save')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr('hubStorage.test')}
                  disabled={busy || testing}
                  onPress={() => void onTest()}
                  style={({ pressed }) => [styles.secondary, (busy || testing) && styles.disabled, pressed && { opacity: 0.7 }]}
                  testID="hub-storage-test"
                >
                  <Text style={styles.secondaryText}>{testing ? tr('hubStorage.testing') : tr('hubStorage.test')}</Text>
                </Pressable>
                {hub.configured && hub.source !== 'hub_managed' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={hub.hubManagedAvailable ? tr('hubStorage.resetToManaged') : tr('hubStorage.clear')}
                    disabled={busy || testing}
                    onPress={() => void onClear()}
                    style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
                    testID="hub-storage-clear"
                  >
                    <Text style={styles.secondaryText}>{hub.hubManagedAvailable ? tr('hubStorage.resetToManaged') : tr('hubStorage.clear')}</Text>
                  </Pressable>
                ) : null}
              </View>
              {msg ? (
                <Text
                  style={[
                    styles.hint,
                    msg.tone === 'ok' && styles.okText,
                    msg.tone === 'warn' && styles.warnText,
                    msg.tone === 'err' && styles.error,
                  ]}
                  testID="hub-storage-msg"
                >
                  {msg.text}
                </Text>
              ) : null}
            </View>
          </SettingsCardContent>
        </>
      ) : null}
    </SettingsGroup>
  );
}

/** 手机账号子页里的「文件存储中转」摘要组（仅使用 settings-kit 积木）。 */
export function HubStoragePhoneGroup({ onOpenEdit }: { onOpenEdit: () => void }) {
  useTranslation();
  const hub = useSyncExternalStore(subscribeHubStorage, getHubStorageSnapshot, getHubStorageSnapshot);
  useEffect(() => { void refreshHubStorageConfig(undefined, { force: false }); }, []);
  if (!hub.supported || (!hub.enabled && !hub.canManage)) return null;
  const ready = hub.enabled && hub.configured;
  const isLegacyModelscope = isLegacyModelscopeState(hub);
  const isHubManaged = hub.source === 'hub_managed';
  const mb = Math.round((hub.maxFileBytes || 100 * 1024 * 1024) / (1024 * 1024));
  const footer = hub.canManage
    ? (isHubManaged ? tr('hubStorage.hubManagedFooter') : tr('hubStorage.phoneHint'))
    : (ready
      ? tr('hubStorage.memberFooterEnabled', { provider: providerLabel(hub.provider), mb })
      : tr('hubStorage.memberFooterDisabled'));

  return (
    <SettingsGroup title={tr('hubStorage.title')} footer={footer} testID="hub-storage-group">
      <SettingsRow
        testID="hub-storage-row"
        icon="cloud-upload-outline"
        label={tr('hubStorage.rowLabel')}
        value={hubStorageStatusText(hub)}
        valueTone={isLegacyModelscope ? 'warn' : (ready ? 'accent' : undefined)}
        chevron={hub.canManage}
        onPress={hub.canManage ? onOpenEdit : undefined}
      />
    </SettingsGroup>
  );
}

/** 手机三级页：设置 → 账号 → 文件存储中转（严格仅使用 settings-kit）。 */
export function HubStorageEditPage() {
  useTranslation();
  const { hub, form, setForm, customize, setCustomize, busy, testing, msg, setProvider, onSave, onTest, onToggleEnabled, onClear } = useHubStorageEditor();
  const isLegacyModelscope = isLegacyModelscopeState(hub);
  const isHubManaged = hub.source === 'hub_managed';
  const showForm = !isHubManaged || customize;
  const mb = Math.round((hub.maxFileBytes || 100 * 1024 * 1024) / (1024 * 1024));

  return (
    <>
      {isHubManaged ? (
        <SettingsGroup
          title={tr('hubStorage.title')}
          footer={tr('hubStorage.hubManagedSummary', {
            provider: providerLabel(hub.provider),
            target: hubManagedTargetLabel(hub),
            mb,
          })}
          testID="hub-storage-managed-summary"
        >
          <SettingsRow
            testID="hub-storage-status-row"
            label={tr('hubStorage.rowLabel')}
            value={hubStorageStatusText(hub)}
            valueTone="accent"
          />
          <SettingsRow
            testID="hub-storage-customize-toggle"
            label={customize ? tr('hubStorage.customizeHide') : tr('hubStorage.customizeShowPhone')}
            chevron
            onPress={() => setCustomize(v => !v)}
          />
        </SettingsGroup>
      ) : null}

      {isHubManaged && !customize ? (
        <>
          <SettingsButton label={testing ? tr('hubStorage.testing') : tr('hubStorage.test')} busy={testing} disabled={busy} onPress={() => void onTest(true)} testID="hub-storage-test-managed" />
          {msg ? (
            <SettingsGroup
              testID="hub-storage-msg"
              footer={msg.text}
              footerTone={msg.tone === 'err' ? 'danger' : msg.tone === 'warn' ? 'warn' : 'accent'}
            />
          ) : null}
        </>
      ) : null}

      {showForm ? <>
      <SettingsGroup
        title={tr('hubStorage.title')}
        footer={!hub.vaultReady ? tr('hubStorage.vaultMissing') : tr('hubStorage.adminFooter')}
        footerTone={!hub.vaultReady ? 'accent' : undefined}
        testID="hub-storage-edit-page"
      >
        <SettingsSwitchRow
          testID="hub-storage-enable-switch"
          label={tr('hubStorage.enableSwitch')}
          subtitle={tr('hubStorage.enableSubtitle')}
          value={form.enabled}
          disabled={busy || testing}
          onValueChange={v => void onToggleEnabled(v)}
        />
      </SettingsGroup>

      {isLegacyModelscope ? (
        <SettingsGroup
          testID="hub-storage-legacy-modelscope"
          footer={tr('hubStorage.legacyModelscopeInfo', { repo: hub.repoId || tr('hubStorage.providerModelScope') })}
          footerTone="warn"
        />
      ) : null}

      <SettingsGroup title={tr('hubStorage.providerLabel')}>
        {SELECTABLE_HUB_STORAGE_PROVIDERS.map(p => (
          <SettingsChoiceRow
            key={p}
            testID={`hub-storage-provider-${p}`}
            label={providerLabel(p)}
            selected={form.provider === p}
            onPress={() => setProvider(p)}
          />
        ))}
        <SettingsChoiceRow
          key="modelscope"
          testID="hub-storage-provider-modelscope"
          label={providerLabel('modelscope')}
          subtitle={isLegacyModelscope ? undefined : tr('hubStorage.modelscopeDisabledHint')}
          selected={false}
          disabled
          onPress={() => {}}
        />
      </SettingsGroup>

      <SettingsGroup title={providerLabel(form.provider)}>
        <SettingsTextField
          label={tr('hubStorage.bucketLabel')}
          testID="hub-storage-bucket"
          value={form.bucket}
          onChangeText={bucket => setForm(f => ({ ...f, bucket }))}
          placeholder={tr('hubStorage.bucketPlaceholder')}
        />
        <SettingsTextField
          label={tr('hubStorage.regionLabel')}
          testID="hub-storage-region"
          value={form.region}
          onChangeText={region => setForm(f => ({ ...f, region }))}
          placeholder={form.provider === 'oss' ? tr('hubStorage.regionPlaceholderOss') : tr('hubStorage.regionPlaceholderS3')}
        />
        <SettingsTextField
          label={tr('hubStorage.akLabel')}
          testID="hub-storage-ak"
          value={form.accessKeyId}
          onChangeText={accessKeyId => setForm(f => ({ ...f, accessKeyId }))}
          placeholder={hub.configured && hub.source !== 'hub_managed' && hub.provider === form.provider
            ? tr('hubStorage.secretPlaceholderSaved', { tail: hub.keyHint || '…' })
            : tr('hubStorage.akPlaceholder')}
        />
        <SettingsTextField
          label={tr('hubStorage.skLabel')}
          testID="hub-storage-sk"
          value={form.accessKeySecret}
          onChangeText={accessKeySecret => setForm(f => ({ ...f, accessKeySecret }))}
          placeholder={hub.configured && hub.source !== 'hub_managed' && hub.provider === form.provider
            ? tr('hubStorage.secretPlaceholderSaved', { tail: hub.keyHint || '…' })
            : tr('hubStorage.skPlaceholderNew')}
          secureTextEntry
          textContentType="password"
        />
      </SettingsGroup>

      <SettingsGroup title={tr('hubStorage.maxSizeLabel')} footer={tr('hubStorage.advancedNote')}>
        <SettingsTextField
          label={tr('hubStorage.prefixLabel')}
          testID="hub-storage-prefix"
          value={form.prefix}
          onChangeText={prefix => setForm(f => ({ ...f, prefix }))}
          placeholder="anet-files"
        />
        <SettingsTextField
          label={tr('hubStorage.maxSizeLabel')}
          testID="hub-storage-max-mb"
          value={form.maxFileMb}
          onChangeText={maxFileMb => setForm(f => ({ ...f, maxFileMb }))}
          placeholder="100"
        />
        <SettingsTextField
          label={tr('hubStorage.endpointLabel')}
          testID="hub-storage-endpoint"
          value={form.endpoint}
          onChangeText={endpoint => setForm(f => ({ ...f, endpoint }))}
          placeholder={form.provider === 'oss' ? tr('hubStorage.endpointPlaceholderOss') : tr('hubStorage.endpointPlaceholderS3')}
        />
      </SettingsGroup>

      <SettingsButton label={tr('hubStorage.save')} busy={busy} disabled={testing} onPress={() => void onSave()} testID="hub-storage-save" />
      <SettingsButton label={testing ? tr('hubStorage.testing') : tr('hubStorage.test')} busy={testing} disabled={busy} onPress={() => void onTest()} testID="hub-storage-test" />
      {msg ? (
        <SettingsGroup
          testID="hub-storage-msg"
          footer={msg.text}
          footerTone={msg.tone === 'err' ? 'danger' : msg.tone === 'warn' ? 'warn' : 'accent'}
        />
      ) : null}
      {hub.configured && hub.source !== 'hub_managed' ? (
        <SettingsButton variant="destructive" label={hub.hubManagedAvailable ? tr('hubStorage.resetToManaged') : tr('hubStorage.clear')} disabled={busy || testing} onPress={() => void onClear()} testID="hub-storage-clear" />
      ) : null}
      </> : null}
    </>
  );
}

const makeStyles = () => StyleSheet.create({
  formStack: { gap: 6 },
  status: { color: colors.textMuted, fontSize: 14 },
  statusOk: { color: colors.accent, fontWeight: '600' },
  statusWarn: { color: colors.blocked, fontWeight: '600' },
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
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  okText: { color: colors.accent },
  warnText: { color: colors.blocked },
  error: { color: colors.failed },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipDisabled: { opacity: 0.45 },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextOn: { color: colors.bg, fontWeight: '600' },
  chipTextDisabled: { color: colors.textMuted },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
