// Daemon 设置的第一项：探测这台 host_supervisor 的资源、工具链和每个 runtime。
// 读已有接口；没有上报时展示 daemon-overview.ts 的演示探测。安装只走本机 daemon 安装器。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import * as Clipboard from 'expo-clipboard';
import { fetchNodeStatus, type HostSupervisorDaemon, type HubConfig, type Session } from './api';
import { PendingDemoBanner } from './backend-pending-ui';
import './i18n-backend-pending';
import './i18n-daemon';
import { isTauriDesktop } from './clipboard-attachment';
import {
  buildDaemonOverview,
  type DaemonOverview,
  type GapPrimary,
  type ListingKind,
  type OsFact,
  type OverviewGap,
  type ResourceCard,
  type ResourceKey,
  type RuntimeRow,
  type ToolRow,
} from './daemon-overview';
import { buttonStyle, buttonTextStyle, elevated } from './elevation';
import { useTranslation } from './i18n-react';
import { installLocalDaemon, scanLocalDaemon, type LocalDaemonScan } from './local-daemon';
import { openExternal } from './open-external';
import { colors, mixHex, onThemeChange, radius, spacing, type, weight } from './theme';
import type { LevelTone } from './host-levels';

const RESOURCE_LABEL: Record<ResourceKey, string> = {
  cpu: 'daemon.overview.cpu',
  ram: 'daemon.overview.ram',
  disk: 'daemon.overview.disk',
  network: 'daemon.overview.network',
};

const OS_LABEL: Record<OsFact['key'], string> = {
  hostname: 'daemon.overview.hostname',
  address: 'daemon.overview.address',
  user: 'daemon.overview.user',
  os: 'daemon.overview.osName',
};

const INSTALLED_KEY = { yes: 'daemon.overview.installedYes', no: 'daemon.overview.installedNo', unknown: 'daemon.overview.installedUnknown' } as const;

export default function DaemonOverviewSection({
  cfg,
  alias,
  nodeId,
  nodeHostname,
  supervisor,
  listing,
  daemonVersion,
  offline = false,
  refreshTick = 0,
  onRefresh,
  preview,
}: {
  cfg: HubConfig;
  alias: string;
  nodeId: string | null;
  nodeHostname: string | null;
  supervisor: HostSupervisorDaemon | null;
  listing: ListingKind;
  daemonVersion: string | null;
  /** Daemon 离线(header 同一个判断)。整页按上次快照说明。 */
  offline?: boolean;
  refreshTick?: number;
  onRefresh?: () => Promise<void>;
  /** 验收夹具：不访问 Hub。 */
  preview?: DaemonOverview;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [hostsLoaded, setHostsLoaded] = useState(!!preview);
  const [scan, setScan] = useState<LocalDaemonScan | null>(null);
  const [scanned, setScanned] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState(false);
  const [probedAt, setProbedAt] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installNote, setInstallNote] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const loadHosts = useCallback(async () => {
    if (preview) return;
    try {
      const data = await fetchNodeStatus(cfg);
      setSessions(data.sessions ?? []);
      setProbeError(false);
    } catch {
      setProbeError(true);
    } finally {
      setHostsLoaded(true);
    }
  }, [cfg, preview]);

  useEffect(() => { void loadHosts(); }, [loadHosts, refreshTick]);

  const model = preview ?? buildDaemonOverview({
    nowMs: Date.now(),
    hostsLoaded,
    sessions,
    alias,
    nodeId,
    nodeHostname,
    supervisor,
    listing,
    // light status (the screen's) has no `version`; the full projection read above does.
    daemonVersion: daemonVersion || sessions?.find(row => row.alias === alias)?.version?.trim() || null,
    offline,
    localScan: scan,
    scanned,
  });

  const runProbe = async () => {
    setInstallNote('');
    try {
      if (!preview) {
        await onRefresh?.();
        await loadHosts();
        if (isTauriDesktop()) {
          try {
            setScan(await scanLocalDaemon());
            setScanned(true);
          } catch {
            setProbeError(true);
          }
        }
      }
      setProbedAt(Date.now());
    } catch {
      setProbeError(true);
    }
  };

  const probe = async () => {
    if (probing || installing) return;
    setProbing(true);
    try { await runProbe(); } finally { setProbing(false); }
  };

  const install = async () => {
    if (installing || probing || !model.localInstall) return;
    setInstalling(true);
    setInstallNote('');
    try {
      const report = await installLocalDaemon();
      setInstallNote(report.ok ? t('daemon.overview.installDone') : `${t('daemon.overview.installFailed')}${report.error ? ` ${report.error}` : ''}`);
      if (report.ok) await runProbe();
    } catch {
      setInstallNote(t('daemon.overview.installFailed'));
    } finally {
      setInstalling(false);
    }
  };

  const copy = async (id: string, command: string) => {
    try {
      await Clipboard.setStringAsync(command);
      setCopied(id);
      setTimeout(() => setCopied(current => (current === id ? null : current)), 1500);
    } catch { /* The command stays selectable. */ }
  };

  // 只有桌面 Tauri 会扫描本机;手机 / 网页只能重读 Hub 里 Daemon 的上报,所以叫「刷新」。
  const canScan = isTauriDesktop();
  const wide = width >= 860;
  const resourceBasis = width >= 980 ? '23%' : width >= 520 ? '47%' : '100%';
  const statusLine = model.pending
    ? t('daemon.overview.waiting')
    : probedAt
      ? t(canScan ? 'daemon.overview.probed' : 'daemon.overview.refreshed', { time: new Date(probedAt).toLocaleTimeString() })
      : model.demo
        ? t(canScan ? 'daemon.overview.demoNote' : 'daemon.overview.demoNoteReadonly')
        : t(canScan ? 'daemon.overview.reported' : 'daemon.overview.reportedReadonly');

  return (
    <ScrollView
      testID="daemon-overview"
      style={styles.scroll}
      contentContainerStyle={styles.content}
      onLayout={event => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('daemon.overview.title')}</Text>
          <Text style={styles.lead}>{t('daemon.overview.lead')}</Text>
          {canScan ? <Text style={styles.lead}>{t('daemon.overview.leadDesktop')}</Text> : <Text testID="daemon-overview-lead-readonly" style={styles.lead}>{t('daemon.overview.leadReadonly')}</Text>}
        </View>
        <Pressable
          testID="daemon-overview-probe"
          accessibilityRole="button"
          accessibilityLabel={t(canScan ? 'daemon.overview.probe' : 'daemon.overview.refresh')}
          disabled={probing || installing}
          onPress={() => { void probe(); }}
          style={({ pressed }) => [styles.primaryBtn, (probing || installing) && styles.disabled, pressed && styles.pressed]}
        >
          {probing ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryBtnText}>{t(canScan ? 'daemon.overview.probe' : 'daemon.overview.refresh')}</Text>}
        </Pressable>
      </View>

      {model.demo ? <PendingDemoBanner t={t} /> : null}
      {model.offline && !model.pending ? (
        <Text testID="daemon-overview-offline" style={styles.warn}>{t(model.demo ? 'daemon.overview.offlineNever' : 'daemon.overview.offline')}</Text>
      ) : null}
      <Text style={styles.statusLine}>{statusLine}</Text>
      {probeError ? <Text testID="daemon-overview-probe-error" style={styles.warn}>{t('daemon.overview.probeFailed')}</Text> : null}
      {model.notListed ? <Text testID="daemon-overview-not-listed" style={styles.warn}>{t('daemon.overview.notListed')}</Text> : null}
      {model.ambiguous ? <Text style={styles.warn}>{t('daemon.overview.ambiguous')}</Text> : null}
      {model.hubUnsupported ? <Text style={styles.warn}>{t('daemon.overview.hubUnsupported')}</Text> : null}
      {model.scanMismatch ? <Text testID="daemon-overview-scan-mismatch" style={styles.note}>{t('daemon.overview.scanMismatch')}</Text> : null}
      {model.capability === 'ready' ? <Text style={styles.note}>{t('daemon.overview.capabilityReady')}</Text> : null}
      {model.capability === 'unknown' && !model.demo ? <Text style={styles.note}>{t('daemon.overview.capabilityUnknown')}</Text> : null}

      {model.pending ? (
        <View style={styles.waiting}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('daemon.overview.gaps', { count: model.gaps.length })}</Text>
            {model.gaps.length === 0 ? <Text testID={model.checkable ? 'daemon-overview-no-gaps' : 'daemon-overview-gaps-unchecked'} style={styles.note}>{t(model.checkable ? 'daemon.overview.noGaps' : 'daemon.overview.gapsUnchecked')}</Text> : (
              <View style={styles.gapGrid} testID="daemon-overview-gaps">
                {model.gaps.map(gap => (
                  <GapCard
                    key={gap.id}
                    gap={gap}
                    wide={wide}
                    copied={copied === gap.id}
                    busy={installing || probing}
                    onCopy={() => { if (gap.command) void copy(gap.id, gap.command); }}
                    onDocs={() => { void openExternal(gap.docsUrl); }}
                    onInstall={() => { void install(); }}
                    t={t}
                  />
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('daemon.overview.resources')}</Text>
            <View style={styles.cardGrid}>
              {model.resources.map(card => (
                <ResourceTile key={card.key} card={card} basis={resourceBasis} t={t} />
              ))}
            </View>
          </View>

          <View style={[styles.columns, !wide && styles.columnsStack]}>
            <View style={styles.column}>
              <Text style={styles.sectionTitle}>{t('daemon.overview.os')}</Text>
              <View style={styles.panel}>
                {model.os.map((fact, index) => (
                  <View key={fact.key} style={[styles.fact, index > 0 && styles.rowBorder]}>
                    <Text style={styles.factLabel}>{t(OS_LABEL[fact.key])}</Text>
                    <Text style={styles.factValue} numberOfLines={1}>{fact.value || t('daemon.overview.unreported')}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={styles.column}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{t('daemon.overview.toolchain')}</Text>
                {model.localInstall ? (
                  <Pressable
                    testID="daemon-overview-install"
                    accessibilityRole="button"
                    accessibilityLabel={t('daemon.overview.installLocal')}
                    disabled={installing || probing}
                    onPress={() => { void install(); }}
                    style={({ pressed }) => [styles.secondaryBtn, (installing || probing) && styles.disabled, pressed && styles.pressed]}
                  >
                    <Text style={styles.secondaryBtnText}>{installing ? t('daemon.overview.installing') : t('daemon.overview.installLocal')}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.panel} testID="daemon-overview-tools">
                {model.tools.map((row, index) => (
                  <ToolLine key={row.key} row={row} first={index === 0} t={t} />
                ))}
              </View>
              {model.installBlocked ? <Text style={styles.warn}>{model.installBlocked}</Text> : null}
              {installNote ? <Text testID="daemon-overview-install-note" style={styles.note}>{installNote}</Text> : null}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('daemon.overview.runtimes')}</Text>
            {!model.demo && !model.readinessReported ? <Text style={styles.note}>{t('daemon.overview.readinessMissing')}</Text> : null}
            <View style={styles.panel} testID="daemon-overview-runtimes">
              {model.runtimes.map((row, index) => (
                <RuntimeLine key={row.id} row={row} first={index === 0} t={t} />
              ))}
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

function ResourceTile({ card, basis, t }: { card: ResourceCard; basis: '23%' | '47%' | '100%'; t: (key: string, values?: Record<string, string | number>) => string }) {
  const detail = resourceDetail(card, t);
  const network = card.key === 'network';
  return (
    <View testID={`daemon-overview-resource-${card.key}`} style={[styles.statCard, { flexBasis: basis }]}>
      <View style={styles.statTop}>
        <Text style={styles.statLabel}>{t(RESOURCE_LABEL[card.key])}</Text>
        {card.stale ? <Text style={styles.stale}>{t('daemon.overview.stale')}</Text> : null}
      </View>
      <Text style={[styles.statValue, network && styles.statAddress]} numberOfLines={1}>{network ? (card.address || t('daemon.overview.unreported')) : card.value}</Text>
      {network ? null : <Meter pct={card.pct} tone={card.tone} stale={card.stale} />}
      <Text style={styles.statDetail} numberOfLines={2}>{detail}</Text>
    </View>
  );
}

function resourceDetail(card: ResourceCard, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (card.key === 'network') return card.address ? t('daemon.overview.networkHint') : t('daemon.overview.unreported');
  if (card.key === 'cpu') {
    if (card.load != null && card.cores != null) return t('daemon.overview.cpuLoad', { load: card.load, cores: card.cores });
    if (card.cores != null) return t('daemon.overview.coresOnly', { cores: card.cores });
    return t('daemon.overview.unreported');
  }
  if (card.usedGb != null && card.totalGb != null) return t('daemon.overview.gb', { used: card.usedGb, total: card.totalGb });
  if (card.totalGb != null) return t('daemon.overview.gbTotal', { total: card.totalGb });
  return t('daemon.overview.unreported');
}

function Meter({ pct, tone, stale }: { pct: number | null; tone: LevelTone; stale: boolean }) {
  const fill = meterColor(tone, stale);
  return (
    <View style={[styles.meterTrack, stale && styles.meterStale]}>
      {pct != null && fill ? <View style={[styles.meterFill, { width: `${Math.max(2, Math.round(pct))}%`, backgroundColor: fill }]} /> : null}
    </View>
  );
}

function meterColor(tone: LevelTone, stale: boolean): string | undefined {
  if (stale || tone === 'none') return stale ? colors.textMuted : undefined;
  if (tone === 'ok') return colors.accent;
  if (tone === 'warn') return mixHex(colors.blocked, colors.card, 0.22);
  if (tone === 'danger') return mixHex(colors.failed, colors.card, 0.22);
  return undefined;
}

function ToolLine({ row, first, t }: { row: ToolRow; first: boolean; t: (key: string, values?: Record<string, string | number>) => string }) {
  const stateKey = row.state === 'ok' ? 'daemon.overview.state.ok' : row.state === 'missing' ? 'daemon.overview.state.missing_cli' : row.state === 'bad' ? 'daemon.overview.state.bad' : 'daemon.overview.state.unreported';
  return (
    <View testID={`daemon-overview-tool-${row.key}`} style={[styles.runtime, !first && styles.rowBorder]}>
      <View style={[styles.dot, { backgroundColor: stateColor(row.state) }]} />
      <View style={styles.runtimeBody}>
        <Text style={styles.runtimeName} numberOfLines={1}>{t(row.labelKey)}</Text>
        <Text style={styles.runtimeMeta} numberOfLines={1}>
          {t(stateKey)}
          {row.version ? ` · ${t('daemon.overview.version', { version: row.version })}` : ''}
          {row.path ? ` · ${row.path}` : ''}
        </Text>
      </View>
    </View>
  );
}

function RuntimeLine({ row, first, t }: { row: RuntimeRow; first: boolean; t: (key: string, values?: Record<string, string | number>) => string }) {
  const name = row.labelKey ? t(row.labelKey) : row.id;
  return (
    <View testID={`daemon-overview-runtime-${row.id}`} style={[styles.runtime, !first && styles.rowBorder]}>
      <View style={[styles.dot, { backgroundColor: stateColor(row.state) }]} />
      <View style={styles.runtimeBody}>
        <View style={styles.runtimeTop}>
          <Text style={styles.runtimeName} numberOfLines={1}>{name}</Text>
          <Text style={styles.runtimeState}>{t(`daemon.overview.state.${row.state}`)}</Text>
        </View>
        <Text style={styles.runtimeMeta} numberOfLines={2}>
          {t(INSTALLED_KEY[row.installed])}
          {' · '}
          {row.version ? t('daemon.overview.version', { version: row.version }) : t('daemon.overview.noVersion')}
        </Text>
        {row.reason ? <Text style={styles.runtimeReason}>{row.reason}</Text> : null}
        {row.noteKey && !row.reason ? <Text style={styles.runtimeMeta}>{t(row.noteKey)}</Text> : null}
      </View>
    </View>
  );
}

function GapCard({
  gap, wide, copied, busy, onCopy, onDocs, onInstall, t,
}: {
  gap: OverviewGap;
  wide: boolean;
  copied: boolean;
  busy: boolean;
  onCopy: () => void;
  onDocs: () => void;
  onInstall: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const name = gap.labelKey.startsWith('daemon.') ? t(gap.labelKey) : gap.labelKey;
  return (
    <View testID={`daemon-overview-gap-${gap.id}`} style={[styles.gapCard, wide ? styles.gapWide : styles.gapNarrow]}>
      <Text style={styles.gapName} numberOfLines={1}>{name}</Text>
      <Text style={styles.gapState}>{t(gap.stateKey)}</Text>
      {gap.reason ? <Text style={styles.runtimeReason}>{gap.reason}</Text> : null}
      {gap.noteKey ? <Text style={styles.runtimeMeta}>{t(gap.noteKey)}</Text> : null}
      {gap.command ? <Text selectable style={styles.command}>{gap.command}</Text> : null}
      <View style={styles.gapActions}>
        <GapButton primary={gap.primary} copied={copied} busy={busy} onCopy={onCopy} onDocs={onDocs} onInstall={onInstall} t={t} testID={gap.id} />
      </View>
    </View>
  );
}

function GapButton({
  primary, copied, busy, onCopy, onDocs, onInstall, t, testID,
}: {
  primary: GapPrimary;
  copied: boolean;
  busy: boolean;
  onCopy: () => void;
  onDocs: () => void;
  onInstall: () => void;
  t: (key: string) => string;
  testID: string;
}) {
  if (primary === 'install-local') {
    return (
      <>
        <Pressable testID={`daemon-overview-gap-install-${testID}`} accessibilityRole="button" disabled={busy} onPress={onInstall} style={({ pressed }) => [styles.secondaryBtn, busy && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.secondaryBtnText}>{t('daemon.overview.installLocal')}</Text>
        </Pressable>
        <Pressable testID={`daemon-overview-docs-${testID}`} accessibilityRole="link" accessibilityLabel={t('daemon.overview.docs')} onPress={onDocs} style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}>
          <Ionicons name="open-outline" size={14} color={colors.accent} />
          <Text style={styles.linkText}>{t('daemon.overview.docs')}</Text>
        </Pressable>
      </>
    );
  }
  return (
    <>
      {primary === 'copy-install' || primary === 'copy-fix' ? (
        <Pressable testID={`daemon-overview-copy-${testID}`} accessibilityRole="button" accessibilityLabel={t('daemon.overview.copy')} onPress={onCopy} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
          <Text style={styles.secondaryBtnText}>{copied ? t('daemon.overview.copied') : t('daemon.overview.copy')}</Text>
        </Pressable>
      ) : null}
      <Pressable testID={`daemon-overview-docs-${testID}`} accessibilityRole="link" accessibilityLabel={t('daemon.overview.docs')} onPress={onDocs} style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}>
        <Ionicons name="open-outline" size={14} color={colors.accent} />
        <Text style={styles.linkText}>{t('daemon.overview.docs')}</Text>
      </Pressable>
    </>
  );
}

function stateColor(state: string): string {
  if (state === 'ready' || state === 'ok') return colors.running;
  if (state === 'missing_cli' || state === 'missing' || state === 'bad' || state === 'no_network') return colors.failed;
  if (state === 'not_logged_in') return colors.blocked;
  return colors.rest;
}

const makeStyles = () => StyleSheet.create({
  scroll: { flex: 1, minWidth: 0 },
  content: { padding: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.lg, width: '100%', maxWidth: 1180, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, flexWrap: 'wrap' },
  headerText: { flex: 1, minWidth: 220, gap: spacing.xs },
  title: { color: colors.text, fontSize: type.heading, fontWeight: weight.strong },
  lead: { color: colors.textSecondary, fontSize: type.body, lineHeight: 22 },
  statusLine: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
  note: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
  warn: { color: colors.blocked, fontSize: type.small, lineHeight: 18 },
  waiting: { paddingVertical: spacing.xl, alignItems: 'flex-start' },
  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { color: colors.textSecondary, fontSize: type.small, fontWeight: weight.medium },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: { flexGrow: 1, minWidth: 140, backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.md, gap: spacing.sm, ...elevated('raised') },
  statTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  statLabel: { color: colors.textSecondary, fontSize: type.small },
  statValue: { color: colors.text, fontSize: type.heading, fontWeight: weight.strong, fontVariant: ['tabular-nums'] },
  statAddress: { fontSize: type.title },
  statDetail: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
  stale: { color: colors.textMuted, fontSize: type.caption },
  meterTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.tonalBg, overflow: 'hidden' },
  meterStale: { backgroundColor: colors.subtleFill },
  meterFill: { height: 6, borderRadius: radius.pill },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
  columnsStack: { flexDirection: 'column' },
  column: { flex: 1, minWidth: 240, gap: spacing.sm },
  panel: { backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden', ...elevated('raised') },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, minHeight: 44 },
  factLabel: { width: 88, color: colors.textMuted, fontSize: type.small },
  factValue: { flex: 1, color: colors.text, fontSize: type.body },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  runtime: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  dot: { width: 8, height: 8, borderRadius: radius.pill, marginTop: 6 },
  runtimeBody: { flex: 1, minWidth: 0, gap: 2 },
  runtimeTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  runtimeName: { flex: 1, color: colors.text, fontSize: type.body, fontWeight: weight.strong },
  runtimeState: { color: colors.textSecondary, fontSize: type.small },
  runtimeMeta: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
  runtimeReason: { color: colors.textSecondary, fontSize: type.small, lineHeight: 18 },
  gapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gapCard: { backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.md, gap: spacing.xs, ...elevated('raised') },
  gapWide: { flexBasis: 280, flexGrow: 1 },
  gapNarrow: { flexBasis: '100%' },
  gapName: { color: colors.text, fontSize: type.body, fontWeight: weight.strong },
  gapState: { color: colors.failed, fontSize: type.small, fontWeight: weight.medium },
  gapActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  command: { color: colors.text, fontSize: type.small, lineHeight: 18 },
  primaryBtn: { ...buttonStyle('primary'), paddingHorizontal: spacing.lg },
  primaryBtnText: { ...buttonTextStyle('primary') },
  secondaryBtn: { ...buttonStyle('secondary'), paddingHorizontal: spacing.md },
  secondaryBtnText: { ...buttonTextStyle('secondary') },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, height: 36 },
  linkText: { color: colors.accent, fontSize: type.body, fontWeight: weight.strong },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
