import { useEffect, useRef, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import { SelectField, type SelectOption } from './TaskSelectMenu';
import { PendingCardTitle, PendingPanelCard } from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-provider-management';
import { colors, spacing } from './theme';
import type { ProviderSnapshot } from './daemon-provider-management';
import type { HubConfig } from './api';
import { applyManagedProvider, providerWriteTransportAllowed } from './daemon-provider-management-api';
import type { ProviderApplicationResult } from './daemon-provider-application';
import { changeProviderSelection, EMPTY_PROVIDER_SELECTION, providerSelectionOptions, resolveProviderSelection, providerApplicationWrite, type ProviderSelection } from './daemon-provider-selection';

/** Single-node confirmed application; configuration counts remain unverified. */
export default function DaemonProviderSelection({ snapshot, identity, cfg }: { snapshot: ProviderSnapshot; identity: string; cfg: HubConfig }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const scope = JSON.stringify([identity, snapshot.revision, snapshot.codex_inventory?.observed_at]);
  const [state, setState] = useState<{ scope: string; selection: ProviderSelection } | null>(null);
  const selection = state?.scope === scope ? state.selection : EMPTY_PROVIDER_SELECTION;
  const options = providerSelectionOptions(snapshot, selection);
  const resolved = resolveProviderSelection(snapshot, selection);
  const [confirmation, setConfirmation] = useState('');
  const [application, setApplication] = useState<{ scope: string; result: ProviderApplicationResult | { kind: 'applying' } } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [scope]);
  const status = application?.scope === scope ? application.result : null;
  const busy = status?.kind === 'applying';
  const selectionKey = JSON.stringify([scope, selection]);
  const write = providerApplicationWrite(snapshot, selection, true);
  const canApply = !!write && providerWriteTransportAllowed(cfg.serverUrl) && !status;
  const submit = async () => {
    if (!canApply || !write || confirmation !== selectionKey || controller.current && !controller.current.signal.aborted) return;
    const ctrl = new AbortController(); controller.current = ctrl;
    setApplication({ scope, result: { kind: 'applying' } }); setConfirmation('');
    const result = await applyManagedProvider(cfg, snapshot.daemon_node_id, write, ctrl.signal);
    if (!ctrl.signal.aborted) setApplication({ scope, result });
    ctrl.abort();
  };
  const field = (name: keyof ProviderSelection, entries: SelectOption[], disabled = false) => <View style={{ gap: spacing.xs }}>
    <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.select.${name}`)}</Text>
    <SelectField value={selection[name] || null} options={entries} noneLabel={t('providerManagement.select.clear')}
      placeholder={t('providerManagement.select.choose')} title={t(`providerManagement.select.${name}`)}
      touch={width < 600} searchable disabled={busy || disabled || !entries.length} testID={`daemon-provider-select-${name}`}
      onPick={value => setState({ scope, selection: changeProviderSelection(selection, name, value ?? '') })} />
  </View>;
  return <PendingPanelCard testID="daemon-provider-selection">
    <PendingCardTitle title={t('providerManagement.select.title')} />
    <Text style={{ color: colors.textSecondary }}>{t('providerManagement.select.boundary')}</Text>
    {field('nodeId', options.nodes.map(n => ({ id: n.node_id, label: n.alias, sub: n.node_id })))}
    {!options.nodes.length ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.select.noNodes')}</Text> : null}
    {field('providerId', options.providers.map(p => ({ id: p.id, label: p.label, sub: p.id })), !selection.nodeId)}
    {field('authId', options.auth.map(a => ({ id: a.id, label: a.id, sub: t(`providerManagement.${a.kind}`) })), !selection.providerId)}
    {field('model', options.models.map(model => ({ id: model, label: model })), !selection.authId)}
    {resolved ? <Text testID="daemon-provider-selection-summary" style={{ color: colors.textSecondary }}>
      {resolved.nodeId} · {resolved.providerId} · {resolved.authId} · {resolved.model}
    </Text> : null}
    {resolved?.authKind === 'chatgpt' ? <Text style={{ color: colors.textSecondary }}>{t(write ? 'providerManagement.savedLoginApply' : 'providerManagement.loginUnverified')}</Text> : null}
    {!write ? <Text testID="daemon-provider-apply-unavailable" style={{ color: colors.textSecondary }}>{t('providerManagement.select.unavailable')}</Text> : null}
    {status ? <Text testID="daemon-provider-application-status" style={{ color: colors.textSecondary }}>{t(`providerManagement.apply.${status.kind}`)}{'requestId' in status ? ` · ${status.requestId ?? ''}` : ''}</Text> : null}
    {confirmation === selectionKey && canApply ? <View style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.textSecondary }}>{t('providerManagement.apply.confirmHint')}</Text>
      <Pressable testID="daemon-provider-apply-confirm" accessibilityRole="button" onPress={() => { void submit(); }} style={buttonStyle('secondary')}>
        <Text style={buttonTextStyle('secondary')}>{t('providerManagement.apply.confirm')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => setConfirmation('')}><Text style={{ color: colors.accent }}>{t('providerManagement.cancelToggle')}</Text></Pressable>
    </View> : null}
    <Pressable testID="daemon-provider-apply" accessibilityRole="button" accessibilityState={{ disabled: !canApply }} disabled={!canApply}
      onPress={() => setConfirmation(selectionKey)} style={[buttonStyle('secondary'), !canApply && { opacity: 0.45 }]}>
      <Text style={buttonTextStyle('secondary')}>{t('providerManagement.select.apply')}</Text>
    </Pressable>
  </PendingPanelCard>;
}
