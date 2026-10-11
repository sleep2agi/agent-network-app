import { useEffect, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import { SelectField, type SelectOption } from './TaskSelectMenu';
import { PendingCardTitle, PendingPanelCard } from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { colors, spacing } from './theme';
import { useTranslation } from './i18n-react';
import './i18n-provider-management';
import type { HubConfig } from './api';
import type { ProviderRead } from './daemon-provider-management';
import { readManagedProviders } from './daemon-provider-management-api';
import { changeCreateProviderSelection, createProviderOptions, EMPTY_CREATE_PROVIDER, managedCreateReference,
  type CreateProviderReference, type CreateProviderSelection } from './daemon-provider-create';

/** Read-only choices. Actual configuration is initialized by the Daemon on create. */
export default function DaemonCreateProvider({ cfg, daemonId, identity, enabled, onMode, onSelection }: {
  cfg: HubConfig; daemonId: string; identity: string; enabled: boolean;
  onMode: (enabled: boolean) => void; onSelection: (reference: CreateProviderReference | null) => void;
}) {
  const { t } = useTranslation(), { width } = useWindowDimensions();
  const [refresh, setRefresh] = useState(0);
  const [read, setRead] = useState<{ scope: string; value: ProviderRead } | null>(null);
  const [state, setState] = useState<{ scope: string; selection: CreateProviderSelection } | null>(null);
  const readScope = JSON.stringify([identity, refresh]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    readManagedProviders(cfg, daemonId, controller.signal).then(value => {
      if (!controller.signal.aborted) setRead({ scope: readScope, value });
    });
    return () => controller.abort();
  }, [cfg.serverUrl, cfg.token, cfg.networkId, daemonId, readScope, enabled]);
  const result = read?.scope === readScope ? read.value : null;
  const snapshot = result?.kind === 'ready' ? result.snapshot : null;
  const choiceScope = JSON.stringify([readScope, snapshot?.revision, result?.kind === 'ready' ? result.observedAt : null]);
  const selection = state?.scope === choiceScope ? state.selection : EMPTY_CREATE_PROVIDER;
  const options = snapshot ? createProviderOptions(snapshot, selection) : { providers: [], auth: [], models: [] };
  const pick = (field: keyof CreateProviderSelection, value: string) => {
    const next = changeCreateProviderSelection(selection, field, value);
    setState({ scope: choiceScope, selection: next });
    onSelection(snapshot ? managedCreateReference(snapshot, 'codex-app-server', next) : null);
  };
  const field = (name: keyof CreateProviderSelection, entries: SelectOption[]) => <View style={{ gap: spacing.xs }}>
    <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.select.${name}`)}</Text>
    <SelectField value={selection[name] || null} options={entries} noneLabel={t('providerManagement.select.clear')}
      placeholder={t('providerManagement.select.choose')} title={t(`providerManagement.select.${name}`)}
      touch={width < 600} searchable disabled={!entries.length} testID={`create-daemon-provider-${name}`}
      onPick={value => pick(name, value ?? '')} />
  </View>;
  return <PendingPanelCard testID="create-daemon-provider">
    <PendingCardTitle title={t('providerManagement.create.title')} />
    {([false, true] as const).map(mode => <Pressable key={String(mode)} testID={`create-daemon-provider-mode-${mode}`}
      accessibilityRole="radio" accessibilityState={{ checked: enabled === mode }} aria-checked={enabled === mode}
      onPress={() => { onSelection(null); setState(null); setRead(null); setRefresh(v => v + 1); onMode(mode); }} style={buttonStyle('secondary')}>
      <Text style={buttonTextStyle('secondary')}>{t(mode ? 'providerManagement.create.managed' : 'providerManagement.create.existing')}</Text>
    </Pressable>)}
    {enabled ? <>
      <Text style={{ color: colors.textSecondary }}>{t('providerManagement.create.boundary')}</Text>
      {!result ? <Text testID="create-daemon-provider-loading" style={{ color: colors.textSecondary }}>{t('providerManagement.loading')}</Text> : null}
      {result && result.kind !== 'ready' ? <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.${result.kind}`)}</Text> : null}
      {snapshot && !options.providers.length ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.create.empty')}</Text> : null}
      {field('providerId', options.providers.map(p => ({ id: p.id, label: p.label, sub: p.id })))}
      {field('authId', options.auth.map(a => ({ id: a.id, label: a.id, sub: 'API Key' })))}
      {field('model', options.models.map(model => ({ id: model, label: model })))}
      <Pressable testID="create-daemon-provider-refresh" accessibilityRole="button" onPress={() => {
        onSelection(null); setState(null); setRefresh(v => v + 1);
      }} style={buttonStyle('secondary')}><Text style={buttonTextStyle('secondary')}>{t('providerManagement.refresh')}</Text></Pressable>
    </> : null}
  </PendingPanelCard>;
}
