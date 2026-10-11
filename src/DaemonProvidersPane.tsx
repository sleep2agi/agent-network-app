import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import type { HubConfig } from './api';
import { readManagedProviders, providerWriteTransportAllowed } from './daemon-provider-management-api';
import { providerConfiguredCounts, providerKeyWrite, EMPTY_PROVIDER_KEY_FORM, type ProviderKeyForm, type ProviderRead } from './daemon-provider-management';
import { PendingCardTitle, PendingPanelCard } from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-provider-management';
import { colors, spacing, type } from './theme';

export default function DaemonProvidersPane({ cfg, daemonId, alias, offline = false }: {
  cfg: HubConfig; daemonId?: string; alias: string; offline?: boolean;
}) {
  const { t } = useTranslation();
  const [tick, refresh] = useState(0);
  // Identity includes the credential, but stays in memory and never enters logs/DOM/storage.
  const identity = JSON.stringify([cfg.serverUrl, cfg.networkId, cfg.token, daemonId, offline, tick]);
  const [result, setResult] = useState<{ identity: string; value: ProviderRead } | null>(null);
  const [editing, setEditing] = useState<{ identity: string; form: ProviderKeyForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const writeController = useRef<AbortController | null>(null);
  const form = editing?.identity === identity ? editing.form : EMPTY_PROVIDER_KEY_FORM;
  const setField = (field: keyof ProviderKeyForm, text: string) => setEditing({ identity, form: { ...form, [field]: text } });
  useEffect(() => {
    setSaving(false); setSaveNote(''); setEditing(null);
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
  const save = async () => {
    if (!write || !daemonId || !secure || saving) return;
    setSaving(true); setSaveNote('saving');
    const ctrl = new AbortController(); writeController.current = ctrl;
    setEditing({ identity, form: { ...form, key: '' } });
    const saved = await readManagedProviders(cfg, daemonId, ctrl.signal, write);
    if (ctrl.signal.aborted) return;
    setSaving(false);
    setResult({ identity, value: saved });
    setSaveNote(saved.kind === 'ready' ? 'saved' : 'unconfirmed');
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
    {snapshot ? <PendingPanelCard testID="daemon-provider-key-form">
      <PendingCardTitle title={t('providerManagement.keyForm')} />
      <Text style={{ color: colors.textSecondary }}>{t('providerManagement.writeHint')}</Text>
      {(['id', 'label', 'authId', 'baseUrl', 'models', 'key'] as const).map(field => <View key={field} style={{ gap: spacing.xs }}>
        <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.field.${field}`)}</Text>
        <TextInput testID={`daemon-provider-input-${field}`} accessibilityLabel={t(`providerManagement.field.${field}`)}
          value={form[field]} onChangeText={text => setField(field, text)} editable={!saving}
          secureTextEntry={field === 'key'} autoCorrect={false} autoCapitalize="none"
          style={{ color: colors.text, backgroundColor: colors.bg, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 6 }} />
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
