import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, spacing, radius, type, weight } from './theme';
import { useTranslation } from './i18n-react';
import type { CodexInventory } from './daemon-provider-management';

export default function DaemonCodexInventoryRow({ row }: { row: CodexInventory['rows'][number] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const field = (label: string, value: string) => <View key={label} style={{ gap: spacing.xs, minWidth: 140, flexGrow: 1, flexBasis: 180 }}>
    <Text style={{ color: colors.textSecondary, fontSize: type.small }}>{label}</Text>
    <Text selectable style={{ color: colors.text, fontSize: type.body, fontWeight: weight.strong }}>{value}</Text>
  </View>;
  return <View testID={`daemon-codex-row-${row.node_id}`} style={{ backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: spacing.md, gap: spacing.md }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
      <Text style={{ color: colors.text, fontSize: type.body, fontWeight: weight.strong }}>{row.alias}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: type.small }}>{t(`providerManagement.inventory.${row.status}`)}</Text>
    </View>
    {row.status === 'observed' ? <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {field('Provider', row.configured_provider ?? '—')}
        {field(t('providerManagement.inventoryModel'), row.configured_model ?? '—')}
        {field(t('providerManagement.inventoryAuth'), t(`providerManagement.auth.${row.auth_kind}`))}
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: type.small }}>{t(`providerManagement.credential.${row.credential_status}`)}</Text>
    </> : null}
    <Pressable testID={`daemon-codex-details-toggle-${row.node_id}`} accessibilityRole="button"
      accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}>
      <Text style={{ color: colors.accent }}>{t(expanded ? 'providerManagement.inventoryHideDetails' : 'providerManagement.inventoryDetails')}</Text>
    </Pressable>
    {expanded ? <View testID={`daemon-codex-details-${row.node_id}`} style={{ gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm }}>
      <Text selectable style={{ color: colors.textSecondary, fontSize: type.small }}>ID · {row.node_id}</Text>
      {row.status === 'observed' ? <>
        <Text selectable style={{ color: colors.textSecondary, fontSize: type.small }}>{row.runtime} · CODEX_HOME #{row.home_ref} · {row.home_source}</Text>
        <Text selectable style={{ color: colors.textSecondary, fontSize: type.small }}>{t('providerManagement.inventorySelection', { provider: row.configured_provider ?? '—', model: row.configured_model ?? '—', nodeModel: row.node_configured_model ?? '—' })}</Text>
        <Text selectable style={{ color: colors.textSecondary, fontSize: type.small }}>{t('providerManagement.inventoryProviders', { providers: row.provider_ids?.join(' · ') || '—' })}</Text>
        {row.account_fingerprint ? <Text selectable style={{ color: colors.textSecondary, fontSize: type.small }}>Account #{row.account_fingerprint}</Text> : null}
      </> : null}
    </View> : null}
  </View>;
}
