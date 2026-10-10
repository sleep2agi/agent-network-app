// Daemon / Hub「Runtime 支持」：功能 × runtime 是主内容，本机探测和 Provider 在下面。
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { useTranslation } from './i18n-react';
import './i18n-runtime-support';
import './i18n-backend-pending';
import './i18n-provider';
import DaemonRuntimeProviders from './DaemonRuntimeProviders';
import { readListProviders } from './daemon-provider-read';
import { catalogIsVisible, displayDaemonProviders, type TaggedProvider } from './daemon-runtime-providers';
import {
  PendingCardTitle,
  PendingDemoBanner,
  PendingLayerBadge,
  PendingPanelCard,
  type PendingLayer,
} from './backend-pending-ui';
import {
  SUPPORT_MATRIX_PATH,
  featureMatrixSource,
  hostProbe,
  runtimeSupportEntries,
  type AnetFeatureId,
  type HostBadge,
  type RuntimeHostContext,
  type RuntimeSupportEntry,
  type SupportLevel,
} from './runtime-support';
import type { HubConfig } from './api';
import { colors, onThemeChange, radius, spacing, type, weight } from './theme';

const LEVEL_KEY: Record<SupportLevel, string> = {
  supported: 'runtimeSupport.level.supported',
  partial: 'runtimeSupport.level.partial',
  unsupported: 'runtimeSupport.level.unsupported',
  unverified: 'runtimeSupport.level.unverified',
  na: 'runtimeSupport.level.na',
};

const FEATURE_KEY: Record<AnetFeatureId, string> = {
  hub_chat: 'runtimeSupport.feature.hub_chat',
  tui_copresence: 'runtimeSupport.feature.tui_copresence',
  daemon_lifecycle: 'runtimeSupport.feature.daemon_lifecycle',
  adopt: 'runtimeSupport.feature.adopt',
  provider_config: 'runtimeSupport.feature.provider_config',
  skills: 'runtimeSupport.feature.skills',
  tokens: 'runtimeSupport.feature.tokens',
  steer: 'runtimeSupport.feature.steer',
  long_task: 'runtimeSupport.feature.long_task',
};

const BADGE_KEY: Record<Exclude<HostBadge, null>, string> = {
  ready: 'runtimeSupport.badge.ready',
  blocked: 'runtimeSupport.badge.blocked',
  unknown: 'runtimeSupport.badge.unknown',
  undeclared: 'runtimeSupport.badge.undeclared',
};

const HOST_LINE_KEY: Record<Exclude<HostBadge, null>, string> = {
  ready: 'runtimeSupport.host.ready',
  blocked: 'runtimeSupport.host.blocked',
  unknown: 'runtimeSupport.host.unknown',
  undeclared: 'runtimeSupport.host.undeclared',
};

function levelColor(level: SupportLevel): string {
  if (level === 'supported') return colors.running;
  if (level === 'partial') return colors.blocked;
  if (level === 'unsupported') return colors.failed;
  return colors.textMuted;
}

function SupportBadge({ level, testID }: { level: SupportLevel; testID?: string }) {
  const { t } = useTranslation();
  return (
    <View testID={testID} style={styles.badge}>
      <Text style={[styles.badgeText, { color: levelColor(level) }]}>{t(LEVEL_KEY[level])}</Text>
    </View>
  );
}

function HostBadgeView({ badge }: { badge: Exclude<HostBadge, null> }) {
  const { t } = useTranslation();
  const color = badge === 'ready' ? colors.running : badge === 'blocked' ? colors.failed : colors.textMuted;
  return (
    <View style={styles.badge}>
      <Text style={[styles.badgeText, { color }]}>{t(BADGE_KEY[badge])}</Text>
    </View>
  );
}

export default function RuntimeSupportPane({
  layer,
  host,
  cfg,
  initialRuntimeId = null,
}: {
  layer: Extract<PendingLayer, 'hub' | 'daemon'>;
  host: RuntimeHostContext;
  cfg?: HubConfig;
  initialRuntimeId?: string | null;
}) {
  const { t, language } = useTranslation();
  const entries = runtimeSupportEntries(host);
  const [selectedId, setSelectedId] = useState<string | null>(initialRuntimeId);
  const [paneWidth, setPaneWidth] = useState(0);
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0] ?? null;
  const split = paneWidth >= 720;
  const daemonKey = host.kind === 'daemon' ? `${host.daemon.daemon_node_id ?? ''}:${host.daemon.alias ?? ''}` : '';
  const [providerRead, setProviderRead] = useState<'pending' | 'ok' | 'unsupported' | 'error'>(daemonKey && cfg ? 'pending' : 'unsupported');
  const [providerRows, setProviderRows] = useState<TaggedProvider[]>([]);

  const serverUrl = cfg?.serverUrl ?? '';
  const token = cfg?.token ?? '';
  const networkId = cfg?.networkId;
  useEffect(() => {
    if (!daemonKey || !serverUrl || !token) return;
    let cancel = false;
    setProviderRead('pending');
    void readListProviders({ serverUrl, token, networkId }).then(result => {
      if (cancel) return;
      if (result.kind === 'ok') {
        setProviderRows(result.rows);
        setProviderRead('ok');
      } else {
        setProviderRows([]);
        setProviderRead(result.kind);
      }
    });
    return () => { cancel = true; };
  }, [daemonKey, serverUrl, token, networkId]);

  return (
    <View testID="runtime-support" style={styles.root} onLayout={event => setPaneWidth(event.nativeEvent.layout.width)}>
      <View style={styles.meta}>
        <PendingLayerBadge layer={layer} t={t} />
        {featureMatrixSource() === 'demo' ? <PendingDemoBanner t={t} /> : null}
      </View>
      <Text style={styles.hint}>{t('runtimeSupport.hint')}</Text>
      <View style={[styles.columns, !split && styles.columnsStack]}>
        <PendingPanelCard testID="runtime-support-list" style={[styles.listCard, split && styles.listCardSplit]}>
          {entries.map(entry => (
            <RuntimeRow
              key={entry.id}
              entry={entry}
              selected={selected?.id === entry.id}
              onPress={() => setSelectedId(entry.id)}
            />
          ))}
        </PendingPanelCard>
        <PendingPanelCard testID="runtime-support-detail" style={styles.detailCard}>
          {selected ? (
            <RuntimeDetail entry={selected} host={host} providerRead={providerRead} providerRows={providerRows} language={language} />
          ) : (
            <Text style={styles.hint}>{t('runtimeSupport.select')}</Text>
          )}
        </PendingPanelCard>
      </View>
    </View>
  );
}

function RuntimeRow({ entry, selected, onPress }: { entry: RuntimeSupportEntry; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const title = entry.labelKey ? t(entry.labelKey) : entry.id;
  return (
    <Pressable
      testID={`runtime-support-row-${entry.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${t(LEVEL_KEY[entry.overall])}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowOn, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.rowTitle}>
        <Text style={styles.rowName} numberOfLines={1}>{title}</Text>
        <SupportBadge level={entry.overall} testID={`runtime-support-overall-${entry.id}`} />
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowId} numberOfLines={1}>{entry.id}</Text>
        {entry.maturity ? <Text style={styles.rowId}>{t(`runtimeSupport.maturity.${entry.maturity}`)}</Text> : null}
        {entry.hostBadge ? <HostBadgeView badge={entry.hostBadge} /> : null}
      </View>
    </Pressable>
  );
}

function RuntimeDetail({
  entry,
  host,
  providerRead,
  providerRows,
  language,
}: {
  entry: RuntimeSupportEntry;
  host: RuntimeHostContext;
  providerRead: 'pending' | 'ok' | 'unsupported' | 'error';
  providerRows: TaggedProvider[];
  language: 'zh' | 'en';
}) {
  const { t } = useTranslation();
  const title = entry.labelKey ? t(entry.labelKey) : entry.id;
  const probe = hostProbe(host, entry.id, Date.now());
  const generation = entry.id === 'opencode-cli' ? 'v2' as const : undefined;
  const providerDisplay = host.kind === 'daemon'
    ? displayDaemonProviders({
      daemon: host.daemon,
      rows: providerRows,
      read: providerRead,
      runtimeId: entry.id,
      opencodeGeneration: generation,
    })
    : null;
  const showProviders = !!providerDisplay && catalogIsVisible(providerDisplay, entry.id, generation);
  const docs = `https://www.anet.sh${language === 'en' ? '/en' : ''}${SUPPORT_MATRIX_PATH}`;
  return (
    <View style={styles.detail}>
      <View style={styles.detailHead}>
        <View style={{ flex: 1, minWidth: 0, gap: spacing.xs }}>
          <Text style={styles.detailTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.rowId}>{entry.id}{entry.maturity ? ` · ${t(`runtimeSupport.maturity.${entry.maturity}`)}` : ''}</Text>
        </View>
        <SupportBadge level={entry.overall} testID="runtime-support-detail-overall" />
      </View>

      <View testID="runtime-support-matrix" style={styles.section}>
        <PendingCardTitle title={t('runtimeSupport.section.features')} subtitle={t('runtimeSupport.matrixCaption')} />
        {entry.features.map(cell => (
          <View key={cell.feature} testID={`runtime-support-feature-${cell.feature}`} style={styles.feature}>
            <View style={styles.featureHead}>
              <Text style={styles.featureName}>{t(FEATURE_KEY[cell.feature])}</Text>
              <SupportBadge level={cell.level} />
            </View>
            <Text style={styles.featureNote}>{t(cell.noteKey)}</Text>
          </View>
        ))}
        <Pressable
          testID="runtime-support-docs"
          accessibilityRole="link"
          onPress={() => { void Linking.openURL(docs); }}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.link}>{t('runtimeSupport.docs')}</Text>
        </Pressable>
      </View>

      <View testID="runtime-support-host" style={styles.section}>
        <PendingCardTitle title={t('runtimeSupport.section.host')} subtitle={probe.status === 'daemon' ? t('runtimeSupport.host.liveCaption') : undefined} />
        <HostLines probe={probe} />
      </View>

      {showProviders && host.kind === 'daemon' ? (
        <View testID="runtime-support-providers" style={styles.section}>
          <PendingCardTitle title={t('runtimeSupport.section.providers')} />
          <DaemonRuntimeProviders
            daemon={host.daemon}
            rows={providerRows}
            read={providerRead}
            runtimeId={entry.id}
            opencodeGeneration={generation}
          />
        </View>
      ) : null}
    </View>
  );
}

function HostLines({ probe }: { probe: ReturnType<typeof hostProbe> }) {
  const { t } = useTranslation();
  if (probe.status === 'pending') return <Text style={styles.featureNote}>{t('runtimeSupport.host.pending')}</Text>;
  if (probe.status === 'missing') return <Text style={styles.featureNote}>{t('runtimeSupport.host.missing')}</Text>;
  if (probe.status === 'unlisted') return <Text style={styles.featureNote}>{t('runtimeSupport.host.unlisted')}</Text>;
  if (probe.status === 'several') return <Text testID="runtime-support-several" style={styles.featureNote}>{t('runtimeSupport.host.several')}</Text>;
  if (probe.status === 'error') return <Text style={styles.featureNote}>{t('runtimeSupport.host.error')}</Text>;
  if (probe.status === 'unsupported') {
    return <Text testID="runtime-support-upgrade" style={styles.featureNote}>{t('runtimeSupport.upgrade.hub')}</Text>;
  }
  if (probe.status !== 'daemon') return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {probe.badge ? <Text style={styles.featureNote}>{t(HOST_LINE_KEY[probe.badge])}</Text> : null}
      {probe.version ? <Text style={styles.featureNote}>{t('runtimeSupport.host.version', { version: probe.version })}</Text> : null}
      {probe.readinessNote ? <Text testID="runtime-support-readiness-note" style={styles.featureNote}>{probe.readinessNote}</Text> : null}
      {probe.createKind === 'ready' ? <Text style={styles.featureNote}>{t('runtimeSupport.host.createReady')}</Text> : null}
      {probe.createKind === 'blocked' ? <Text style={styles.featureNote}>{t('runtimeSupport.host.createBlocked', { reason: probe.createReasonCode ?? '' })}</Text> : null}
      {probe.createKind === 'unknown' ? <Text style={styles.featureNote}>{t('runtimeSupport.host.createUnknown')}</Text> : null}
      {probe.createKind === 'blocked' ? <Text style={styles.featureNote}>{t('runtimeSupport.host.doctor')}</Text> : null}
      {probe.adoptCapable === true ? <Text style={styles.featureNote}>{t('runtimeSupport.host.adoptYes')}</Text> : null}
      {probe.adoptCapable === false ? <Text style={styles.featureNote}>{t('runtimeSupport.host.adoptNo')}</Text> : null}
      {probe.adoptCapable === null ? <Text style={styles.featureNote}>{t('runtimeSupport.host.adoptUnknown')}</Text> : null}
      {probe.upgrade === 'npm' ? <Text testID="runtime-support-upgrade" style={styles.featureNote}>{t('runtimeSupport.upgrade.npm')}</Text> : null}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { gap: spacing.lg },
    meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    hint: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
    columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    columnsStack: { flexDirection: 'column' },
    listCard: { paddingHorizontal: 0, paddingVertical: spacing.sm, gap: 0 },
    listCardSplit: { flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0 },
    detailCard: { flexGrow: 2, flexShrink: 1, flexBasis: 420, minWidth: 0 },
    row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs },
    rowOn: { backgroundColor: colors.rowActive },
    rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    rowName: { color: colors.text, fontSize: type.body, fontWeight: weight.strong, flex: 1 },
    rowMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    rowId: { color: colors.textMuted, fontSize: type.small },
    badge: {
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      backgroundColor: colors.subtleFill,
    },
    badgeText: { fontSize: type.small, fontWeight: weight.strong },
    detail: { gap: spacing.lg },
    detailHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    detailTitle: { color: colors.text, fontSize: type.title, fontWeight: weight.strong },
    section: { gap: spacing.sm },
    feature: {
      gap: spacing.xs,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    featureHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    featureName: { color: colors.text, fontSize: type.body, flex: 1 },
    featureNote: { color: colors.textSecondary, fontSize: type.small, lineHeight: 18 },
    link: { color: colors.accent, fontSize: type.small },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
