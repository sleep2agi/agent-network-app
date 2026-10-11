import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import type { HubConfig } from './api';
import { readManagedProviders, providerWriteTransportAllowed } from './daemon-provider-management-api';
import { providerConfiguredCounts, providerKeyWrite, providerEnabledWrite, scopedProviderSave, EMPTY_PROVIDER_KEY_FORM, type ProviderKeyForm, type ProviderRead, type ProviderSaveState } from './daemon-provider-management';
import { PendingCardTitle, PendingPanelCard } from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-provider-management';
import { colors, spacing, type, radius } from './theme';
import DaemonProviderSelection from './DaemonProviderSelection';

export default function DaemonProvidersPane({ cfg, daemonId, alias, offline = false }: {
  cfg: HubConfig; daemonId?: string; alias: string; offline?: boolean;
}) {
  const { t } = useTranslation();
  const [tick, refresh] = useState(0);
  // Identity includes the credential, but stays in memory and never enters logs/DOM/storage.
  const identity = JSON.stringify([cfg.serverUrl, cfg.networkId, cfg.token, daemonId, offline, tick]);
  const [result, setResult] = useState<{ identity: string; value: ProviderRead } | null>(null);
  const [editing, setEditing] = useState<{ identity: string; form: ProviderKeyForm } | null>(null);
  const [saveState, setSaveState] = useState<ProviderSaveState | null>(null);
  const [toggleRequest, setToggleRequest] = useState<{ scope: string; providerId: string } | null>(null);
  const saveNote = scopedProviderSave(saveState, identity);
  const saving = saveNote === 'saving';
  const writeController = useRef<AbortController | null>(null);
  const form = editing?.identity === identity ? editing.form : EMPTY_PROVIDER_KEY_FORM;
  const setField = (field: keyof ProviderKeyForm, text: string) => setEditing({ identity, form: { ...form, [field]: text } });
  useEffect(() => {
    setSaveState(null); setEditing(null);
    if (!daemonId || !cfg.networkId || offline) return;
    const ctrl = new AbortController();
    void readManagedProviders(cfg, daemonId, ctrl.signal).then(value => {
      if (!ctrl.signal.aborted) setResult({ identity, value });
    });
    return () => { ctrl.abort(); writeController.current?.abort(); };
  }, [identity]);
  // Render-time scope barrier: even the first frame after changing daemon cannot show old data.
  const value = result?.identity === identity ? result.value : null;
  const snapshot = value?.kind === 'ready' && !offline ? value.snapshot : null;
  const counts = snapshot ? providerConfiguredCounts(snapshot) : null;
  const reason = !daemonId || !cfg.networkId ? 'noTarget' : offline ? 'offline' : value?.kind ?? 'loading';
  const write = snapshot ? providerKeyWrite(snapshot, form) : null;
  const secure = providerWriteTransportAllowed(cfg.serverUrl);
  const toggleScope = JSON.stringify([identity, snapshot?.revision]);
  const save = async (requested = write) => {
    if (!requested || !daemonId || !secure || saving) return;
    setSaveState({ identity, phase: 'saving' });
    setToggleRequest(null);
    const ctrl = new AbortController(); writeController.current = ctrl;
    setEditing({ identity, form: { ...form, key: '' } });
    const saved = await readManagedProviders(cfg, daemonId, ctrl.signal, requested);
    if (ctrl.signal.aborted) return;
    setResult({ identity, value: saved });
    setSaveState({ identity, phase: saved.kind === 'ready' ? 'saved' : 'unconfirmed' });
  };
  return <View testID="daemon-providers-real" style={{ gap: spacing.md }}>
    <PendingPanelCard>
      <PendingCardTitle title={t('providerManagement.title')} />
      <Text style={{ color: colors.textSecondary }}>{alias} · {daemonId ?? '—'}</Text>
      <Text style={{ color: colors.textSecondary }}>{t('providerManagement.boundary')}</Text>
      {reason === 'loading' ? <ActivityIndicator color={colors.accent} /> : null}
      {reason !== 'ready' ? <Text testID="daemon-providers-state" style={{ color: colors.textSecondary }}>{t(`providerManagement.${reason}`)}</Text> : null}
      {counts ? <>
        <Text testID="daemon-providers-counts" style={{ color: colors.text }}>{t('providerManagement.counts', counts)}</Text>
        <Text style={{ color: colors.textSecondary }}>{t('providerManagement.observed', { revision: snapshot!.revision, time: new Date(value!.kind === 'ready' ? value!.observedAt : 0).toLocaleString() })}</Text>
      </> : null}
      <Pressable testID="daemon-providers-refresh" accessibilityRole="button"
        disabled={!daemonId || !cfg.networkId || offline || reason === 'loading' || saving} onPress={() => refresh(n => n + 1)}
        style={buttonStyle('secondary')}><Text style={buttonTextStyle('secondary')}>{t('providerManagement.refresh')}</Text></Pressable>
    </PendingPanelCard>
    {saveNote ? <Text testID="daemon-provider-save-status" style={{ color: colors.textSecondary }}>{t(`providerManagement.${saveNote}`)}</Text> : null}
    {snapshot ? <PendingPanelCard testID="daemon-codex-inventory">
      <PendingCardTitle title={t('providerManagement.inventoryTitle')} />
      <Text style={{ color: colors.textSecondary }}>{t('providerManagement.inventoryBoundary')}</Text>
      {!snapshot.codex_inventory ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.inventoryUnavailable')}</Text> : <>
        <Text style={{ color: colors.textSecondary }}>{new Date(snapshot.codex_inventory.observed_at).toLocaleString()}</Text>
        <Text style={{ color: colors.textSecondary }}>Codex · {t(`providerManagement.installation.${snapshot.codex_inventory.installation?.status ?? 'unknown'}`)} · {snapshot.codex_inventory.installation?.version ?? '—'}</Text>
        {!snapshot.codex_inventory.rows.length ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.inventoryEmpty')}</Text> : null}
        {snapshot.codex_inventory.rows.map(row => <View key={row.node_id} style={{ gap: spacing.xs, paddingVertical: spacing.sm }}>
          <Text style={{ color: colors.text }}>{row.alias} · {row.node_id}</Text>
          <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.inventory.${row.status}`)}</Text>
          {row.status === 'observed' ? <>
            <Text style={{ color: colors.textSecondary }}>{row.runtime} · CODEX_HOME #{row.home_ref} · {row.home_source}</Text>
            <Text style={{ color: colors.textSecondary }}>{t('providerManagement.inventorySelection', { provider: row.configured_provider ?? '—', model: row.configured_model ?? '—', nodeModel: row.node_configured_model ?? '—' })}</Text>
            <Text style={{ color: colors.textSecondary }}>{t('providerManagement.inventoryProviders', { providers: row.provider_ids?.join(' · ') || '—' })}</Text>
            <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.auth.${row.auth_kind}`)} · {t(`providerManagement.credential.${row.credential_status}`)}</Text>
            {row.account_fingerprint ? <Text style={{ color: colors.textSecondary }}>Account #{row.account_fingerprint}</Text> : null}
          </> : null}
        </View>)}
      </>}
    </PendingPanelCard> : null}
    {snapshot ? <DaemonProviderSelection snapshot={snapshot} identity={identity} cfg={cfg} /> : null}
    {snapshot ? <PendingPanelCard testID="daemon-provider-key-form">
      <PendingCardTitle title={t('providerManagement.keyForm')} />
      <Text style={{ color: colors.textSecondary }}>{t('providerManagement.writeHint')}</Text>
      {(['id', 'label', 'authId', 'baseUrl', 'models', 'key'] as const).map(field => <View key={field} style={{ gap: spacing.xs }}>
        <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.field.${field}`)}</Text>
        <TextInput testID={`daemon-provider-input-${field}`} accessibilityLabel={t(`providerManagement.field.${field}`)}
          value={form[field]} onChangeText={text => setField(field, text)} editable={!saving}
          secureTextEntry={field === 'key'} autoCorrect={false} autoCapitalize="none"
          style={{ color: colors.text, backgroundColor: colors.bg, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control }} />
      </View>)}
      {!secure ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.insecure')}</Text> : null}
      <Pressable testID="daemon-provider-save" accessibilityRole="button" disabled={!write || !secure || saving} onPress={() => { void save(); }}
        style={[buttonStyle('secondary'), (!write || !secure || saving) && { opacity: 0.45 }]}>
        <Text style={buttonTextStyle('secondary')}>{t('providerManagement.save')}</Text>
      </Pressable>
    </PendingPanelCard> : null}
    {snapshot?.providers.length === 0 ? <Text testID="daemon-providers-empty" style={{ color: colors.textSecondary }}>{t('providerManagement.empty')}</Text> : null}
    {snapshot?.providers.map(provider => <PendingPanelCard key={provider.id} testID={`daemon-provider-${provider.id}`}>
      <PendingCardTitle title={provider.label} />
      <Text style={{ color: colors.textSecondary }}>{provider.id} · {t(provider.enabled ? 'providerManagement.enabled' : 'providerManagement.disabled')}</Text>
      {toggleRequest?.scope === toggleScope && toggleRequest.providerId === provider.id ? <View testID={`daemon-provider-toggle-confirm-${provider.id}`} style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.textSecondary }}>{t('providerManagement.toggleHint')}</Text>
        <Pressable testID={`daemon-provider-toggle-submit-${provider.id}`} accessibilityRole="button" disabled={saving || !secure}
          onPress={() => { void save(providerEnabledWrite(snapshot, provider.id, !provider.enabled)); }} style={buttonStyle('secondary')}>
          <Text style={buttonTextStyle('secondary')}>{t(provider.enabled ? 'providerManagement.confirmDisable' : 'providerManagement.confirmEnable')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => setToggleRequest(null)}>
          <Text style={{ color: colors.accent }}>{t('providerManagement.cancelToggle')}</Text>
        </Pressable>
      </View> : <Pressable testID={`daemon-provider-toggle-${provider.id}`} accessibilityRole="button" disabled={saving || !secure}
        onPress={() => setToggleRequest({ scope: toggleScope, providerId: provider.id })}>
        <Text style={{ color: colors.accent }}>{t(provider.enabled ? 'providerManagement.disable' : 'providerManagement.enable')}</Text>
      </Pressable>}
      {provider.runtimes.map(runtime => <View key={runtime.runtime} style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{runtime.runtime}</Text>
        {runtime.auth.map(auth => <View key={auth.id} style={{ gap: spacing.xs, paddingLeft: spacing.sm }}>
          <Text style={{ color: colors.text }}>{t(`providerManagement.${auth.kind}`)} · {auth.id}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: type.small }}>{t(auth.credential_present ? 'providerManagement.keyStored' : 'providerManagement.loginUnverified')}</Text>
          {auth.baseUrl ? <Text style={{ color: colors.textSecondary }}>{auth.baseUrl}</Text> : null}
          <Text style={{ color: colors.textSecondary }}>{auth.models.join(' · ')}</Text>
          <Text style={{ color: colors.textSecondary }}>{t('providerManagement.notApplied')}</Text>
          {auth.kind === 'api_key' ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => {
            setEditing({ identity, form: { id: provider.id, label: provider.label, authId: auth.id, baseUrl: auth.baseUrl ?? '', models: auth.models.join(', '), key: '' } });
          }}><Text style={{ color: colors.accent }}>{t('providerManagement.edit')}</Text></Pressable> : null}
        </View>)}
      </View>)}
    </PendingPanelCard>)}
  </View>;
}
