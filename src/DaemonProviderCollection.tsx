import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { SelectField } from './TaskSelectMenu';
import { PendingCardTitle, PendingPanelCard } from './backend-pending-ui';
import { buttonStyle, buttonTextStyle } from './elevation';
import { useTranslation } from './i18n-react';
import { colors, spacing, radius } from './theme';
import type { ProviderSnapshot } from './daemon-provider-management';
import { collectionSourceOptions, collectionSourceForm, EMPTY_PROVIDER_COLLECTION, providerCollectionWrite,
  type ProviderCollectionForm, type ProviderCollectionWrite } from './daemon-provider-collection';

export default function DaemonProviderCollection({ snapshot, identity, secure, busy, collect }: {
  snapshot: ProviderSnapshot; identity: string; secure: boolean; busy: boolean;
  collect: (write: ProviderCollectionWrite) => Promise<void>;
}) {
  const { t } = useTranslation(); const { width } = useWindowDimensions();
  const scope = JSON.stringify([identity, snapshot.revision, snapshot.codex_inventory?.observed_at]);
  const [state, setState] = useState<{ scope: string; form: ProviderCollectionForm } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const form = state?.scope === scope ? state.form : EMPTY_PROVIDER_COLLECTION;
  const rows = collectionSourceOptions(snapshot);
  const write = providerCollectionWrite(snapshot, form, true);
  const confirmationKey = JSON.stringify([scope, form]);
  const available = !!write && secure && !busy;
  return <PendingPanelCard testID="daemon-provider-collection">
    <PendingCardTitle title={t('providerManagement.collect.title')} />
    <Text style={{ color: colors.textSecondary }}>{t('providerManagement.collect.boundary')}</Text>
    <SelectField value={form.nodeId || null} options={rows.map(row => ({ id: row.node_id, label: row.alias, sub: `${row.configured_provider} · ${row.configured_model}` }))}
      noneLabel={t('providerManagement.select.clear')} placeholder={t('providerManagement.select.choose')}
      title={t('providerManagement.collect.source')} touch={width < 600} searchable disabled={busy || !rows.length}
      testID="daemon-provider-collect-source" onPick={nodeId => {
        setConfirmation(''); setState({ scope, form: collectionSourceForm(snapshot, nodeId ?? '') });
      }} />
    {!rows.length ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.collect.noSource')}</Text> : null}
    {form.nodeId ? (['providerId', 'authId', 'label'] as const).map(field => <View key={field} style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.textSecondary }}>{t(`providerManagement.collect.${field}`)}</Text>
      <TextInput testID={`daemon-provider-collect-${field}`} value={form[field]} editable={!busy} autoCorrect={false} autoCapitalize="none"
        onChangeText={text => { setConfirmation(''); setState({ scope, form: { ...form, [field]: text } }); }}
        style={{ color: colors.text, backgroundColor: colors.bg, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control }} />
    </View>) : null}
    {!secure ? <Text style={{ color: colors.textSecondary }}>{t('providerManagement.insecure')}</Text> : null}
    {confirmation === confirmationKey && available ? <View style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.textSecondary }}>{t('providerManagement.collect.confirmHint')}</Text>
      <Pressable testID="daemon-provider-collect-confirm" accessibilityRole="button" onPress={() => {
        if (!write || !available) return; setConfirmation(''); void collect(write);
      }} style={buttonStyle('secondary')}><Text style={buttonTextStyle('secondary')}>{t('providerManagement.collect.confirm')}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setConfirmation('')}><Text style={{ color: colors.accent }}>{t('providerManagement.cancelToggle')}</Text></Pressable>
    </View> : null}
    <Pressable testID="daemon-provider-collect" accessibilityRole="button" disabled={!available}
      onPress={() => setConfirmation(confirmationKey)} style={[buttonStyle('secondary'), !available && { opacity: 0.45 }]}>
      <Text style={buttonTextStyle('secondary')}>{t('providerManagement.collect.button')}</Text>
    </Pressable>
  </PendingPanelCard>;
}
