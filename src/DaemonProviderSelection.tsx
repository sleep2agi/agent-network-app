import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import { SelectField, type SelectOption } from './TaskSelectMenu';
import { PendingCardTitle, PendingPanelCard } from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import './i18n-provider-management';
import { colors, spacing } from './theme';
import type { ProviderSnapshot } from './daemon-provider-management';
import { changeProviderSelection, EMPTY_PROVIDER_SELECTION, providerSelectionOptions, resolveProviderSelection, type ProviderSelection } from './daemon-provider-selection';

/** Real configuration selector. Application remains unavailable until the backend contract is wired. */
export default function DaemonProviderSelection({ snapshot, identity }: { snapshot: ProviderSnapshot; identity: string }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const scope = JSON.stringify([identity, snapshot.revision, snapshot.codex_inventory?.observed_at]);
  const [state, setState] = useState<{ scope: string; selection: ProviderSelection } | null>(null);
  const selection = state?.scope === scope ? state.selection : EMPTY_PROVIDER_SELECTION;
  const options = providerSelectionOptions(snapshot, selection);
  const resolved = resolveProviderSelection(snapshot, selection);
  const field = (name: keyof ProviderSelection, entries: SelectOption[], disabled = false) => <View style={{ gap: spacing.xs }}>
    <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.select.${name}`)}</Text>
    <SelectField value={selection[name] || null} options={entries} noneLabel={t('providerManagement.select.clear')}
      placeholder={t('providerManagement.select.choose')} title={t(`providerManagement.select.${name}`)}
      touch={width < 600} searchable disabled={disabled || !entries.length} testID={`daemon-provider-select-${name}`}
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
    {resolved?.authKind === 'chatgpt' ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.loginUnverified')}</Text> : null}
    <Text testID="daemon-provider-apply-unavailable" style={{ color: colors.textSecondary }}>{t('providerManagement.select.unavailable')}</Text>
    <Pressable testID="daemon-provider-apply" accessibilityRole="button" accessibilityState={{ disabled: true }} disabled
      style={[buttonStyle('secondary'), { opacity: 0.45 }]}>
      <Text style={buttonTextStyle('secondary')}>{t('providerManagement.select.apply')}</Text>
    </Pressable>
  </PendingPanelCard>;
}
