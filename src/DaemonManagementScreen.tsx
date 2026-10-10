// Board #908 — management page for one host_supervisor daemon.
// Replaces the chat empty-state. Lists nodes the Hub already scopes to this daemon
// and calls the existing create / start / stop / restart / delete paths.
// Runtime logs stay on the node page (same handoff the old notice used).
// Unconnected provider, skills, key, and env entries stay a local demo on this page.
// That panel does not replace create, start, stop, restart, delete, or the disabled Probe button.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-chat';
import './i18n-daemon';
import './i18n-backend-pending';
import { BackendPendingIntegration } from './BackendPendingDemo';
import { PendingPanelCard, PendingSegmentedTabs, type PendingTab } from './backend-pending-ui';
import {
  fetchHostSupervisors,
  fetchHubNodes,
  fetchStatus,
  runNodeLifecycleAction,
  type HostSupervisorDaemon,
  type HostSupervisorListResult,
  type HubConfig,
  type HubNode,
  type Session,
} from './api';
import {
  actionReason,
  createAction,
  daemonMgmtLayout,
  daemonNodeOf,
  lifecycleErrorMessage,
  lifecycleTool,
  lookupSupervisor,
  managedRows,
  nodeActions,
  nodeTypeLabel,
  probeAction,
  runtimeLabel,
  statusLabel,
  statusView,
  type MgmtAction,
  type NodeActionId,
} from './daemon-management';
import { colors, onThemeChange, radius, spacing, statusColor, type, weight } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';
import { nodeActionVisual, type NodeActionTone } from './node-action-visual';
import { usePoll } from './usePoll';
import { PANE_BACK_TEST_ID } from './pane-header';
import { pointerUi } from './pointer-ui';
import DialogFrame from './DialogFrame';

const CONFIRM_TITLE: Record<NodeActionId, string> = {
  start: 'daemon.mgmt.confirmStart',
  restart: 'daemon.mgmt.confirmRestart',
  stop: 'daemon.mgmt.confirmStop',
  delete: 'daemon.mgmt.confirmDelete',
};

const ACTION_LABEL: Record<MgmtAction['id'], string> = {
  create: 'daemon.mgmt.create',
  probe: 'daemon.mgmt.probe',
  start: 'daemon.mgmt.start',
  restart: 'daemon.mgmt.restart',
  stop: 'daemon.mgmt.stop',
  delete: 'daemon.mgmt.delete',
};

const NODE_TONE: Record<NodeActionId, NodeActionTone> = {
  start: 'primary',
  restart: 'neutral',
  stop: 'caution',
  delete: 'danger',
};

type DaemonSection = 'nodes' | PendingTab;

const INTEGRATION_TITLE: Record<PendingTab, string> = {
  skills: 'server.pendingTitle.skills',
  tokens: 'server.pendingTitle.tokens',
  provider: 'server.pendingTitle.provider',
};

export default function DaemonManagementScreen({
  cfg,
  alias,
  desktop = false,
  hideBack = false,
  initialSection = 'nodes',
  onBack,
  onOpenLogs,
  onOpenNodeSettings,
  onOpenManagedChat,
  onCreate,
}: {
  cfg: HubConfig;
  alias: string;
  desktop?: boolean;
  hideBack?: boolean;
  initialSection?: DaemonSection;
  onBack: () => void;
  onOpenLogs?: () => void;
  /** 打开本守护进程节点自身的节点设置页。 */
  onOpenNodeSettings?: () => void;
  /** 打开某个托管节点的会话。 */
  onOpenManagedChat?: (alias: string) => void;
  onCreate?: (daemon: HostSupervisorDaemon) => void;
}) {
  useTranslation();
  const pointer = pointerUi(desktop);
  const [width, setWidth] = useState(0);
  const layout = daemonMgmtLayout(width || (desktop ? DAEMON_WIDE : DAEMON_NARROW));
  const [nodes, setNodes] = useState<HubNode[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [statusUnread, setStatusUnread] = useState(false);
  const [supervisors, setSupervisors] = useState<HostSupervisorListResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<NodeActionId | null>(null);
  const [confirmAlias, setConfirmAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [section, setSection] = useState<DaemonSection>(initialSection);

  const load = useCallback(async () => {
    try {
      const nodesRes = await fetchHubNodes(cfg);
      const [statusRes, supervisorsRes] = await Promise.all([
        fetchStatus(cfg).then(data => ({ ok: true as const, sessions: data.sessions ?? [] })).catch(() => ({ ok: false as const, sessions: [] as Session[] })),
        fetchHostSupervisors(cfg),
      ]);
      setNodes(nodesRes.nodes ?? []);
      setSessions(statusRes.ok ? statusRes.sessions : null);
      setStatusUnread(!statusRes.ok);
      setSupervisors(supervisorsRes);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [cfg]);

  usePoll(() => { void load(); }, 10000, [load]);

  const refresh = () => { setRefreshing(true); void load(); };
  const showBack = !desktop && !hideBack;
  const daemon = daemonNodeOf(nodes, alias);
  const rows = managedRows(nodes, statusUnread ? null : sessions, alias);
  const selected = rows.find(row => row.nodeId === selectedId) ?? null;
  const lookup = lookupSupervisor(supervisors, daemon ? { node_id: daemon.node_id, alias: daemon.alias } : { alias });
  const create = createAction(lookup, !!onCreate);
  const probe = probeAction();
  const daemons = supervisors?.ok ? supervisors.daemons : undefined;
  const actions = nodeActions({
    node: selected?.node ?? null,
    status: selected?.status ?? statusView(undefined, null),
    daemons,
    networkId: cfg.networkId,
  });
  const daemonSession = (statusUnread ? null : sessions)?.find(session => session.alias === alias);
  const daemonStatus = statusView(daemonSession, daemon?.lifecycle_state);
  const subtitle = [
    t('daemon.mgmt.kicker'),
    daemonStatus.kind === 'reported' ? daemonStatus.text : '',
    daemon?.hostname?.trim() || (lookup.kind === 'ready' ? lookup.daemon?.hostname?.trim() : '') || '',
  ].filter(Boolean).join(' · ');

  const run = async (id: NodeActionId) => {
    if (!selected || busy) return;
    setBusy(true);
    setMessage('');
    const result = await runNodeLifecycleAction(cfg, lifecycleTool(id), selected.node);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.unsupported ? t('daemon.mgmt.lifecycleUnsupported') : lifecycleErrorMessage(id, result.error, result.in_flight_count));
      return;
    }
    setMessage(t(`daemon.mgmt.submitted.${id}`));
    setPending(null);
    setConfirmAlias('');
    void load();
  };

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {showBack ? (
        <Pressable testID={PANE_BACK_TEST_ID} onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('chat.back')}>
          <Text style={{ color: colors.accent, fontSize: type.heading }}>‹</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontSize: type.title, fontWeight: weight.strong }} numberOfLines={1}>{alias}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: type.small }} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Pressable
        testID="daemon-mgmt-node-settings"
        accessibilityRole="link"
        disabled={!onOpenNodeSettings}
        onPress={onOpenNodeSettings}
        hitSlop={6}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, pressed && onOpenNodeSettings && { opacity: 0.6 }, !onOpenNodeSettings && { opacity: 0.45 }]}
      >
        <Ionicons name="settings-outline" size={16} color={colors.accent} />
        <Text style={{ color: colors.accent, fontSize: type.body }}>{t('daemon.mgmt.nodeSettings')}</Text>
      </Pressable>
      <Pressable
        testID="daemon-mgmt-domain-settings"
        accessibilityRole="link"
        onPress={() => setSection('skills')}
        hitSlop={6}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="layers-outline" size={16} color={colors.accent} />
        <Text style={{ color: colors.accent, fontSize: type.body }}>{t('daemon.mgmt.domainSettings')}</Text>
      </Pressable>
      <Pressable
        testID="daemon-mgmt-logs"
        accessibilityRole="link"
        disabled={!onOpenLogs}
        onPress={onOpenLogs}
        hitSlop={6}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, pressed && onOpenLogs && { opacity: 0.6 }, !onOpenLogs && { opacity: 0.45 }]}
      >
        <Ionicons name="document-text-outline" size={16} color={colors.accent} />
        <Text style={{ color: colors.accent, fontSize: type.body }}>{t('daemon.mgmt.logs')}</Text>
      </Pressable>
      {pointer ? (
        <Pressable testID="daemon-mgmt-refresh" accessibilityRole="button" accessibilityLabel={t('daemon.mgmt.refresh')} disabled={refreshing} onPress={refresh} hitSlop={6}>
          {refreshing ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />}
        </Pressable>
      ) : null}
    </View>
  );

  if (nodes === null && !failed) {
    return (
      <View testID="daemon-management" style={{ flex: 1, backgroundColor: colors.bg }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.textSecondary, fontSize: type.body }}>{t('daemon.mgmt.loading')}</Text>
        </View>
      </View>
    );
  }

  if (nodes === null && failed) {
    return (
      <View testID="daemon-management" style={{ flex: 1, backgroundColor: colors.bg }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl }}>
          <Text style={{ color: colors.text, fontSize: type.title, fontWeight: weight.strong }}>{t('daemon.mgmt.loadFailed')}</Text>
          <Pressable testID="daemon-mgmt-retry" accessibilityRole="button" onPress={refresh} style={({ pressed }) => [buttonStyle('primary'), pressed && { opacity: 0.85 }]}>
            <Text style={buttonTextStyle('primary')}>{t('daemon.mgmt.retry')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const daemonActions = (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: colors.textSecondary, fontSize: type.body, lineHeight: 20 }}>{t('daemon.mgmt.intro')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}>
        <MgmtButton testID="daemon-mgmt-create" action={create} busy={busy} onPress={() => { if (lookup.kind === 'ready' && lookup.daemon && onCreate) onCreate(lookup.daemon); }} />
        <MgmtButton testID="daemon-mgmt-probe" action={probe} busy={busy} onPress={() => {}} />
      </View>
      <ActionNotes actions={[create, probe]} />
      {!onOpenLogs ? <Text testID="daemon-mgmt-reason-logs" style={{ color: colors.textMuted, fontSize: type.small, lineHeight: 18 }}>{t('daemon.mgmt.logsUnavailable')}</Text> : null}
      {failed ? <Text style={{ color: colors.blocked, fontSize: type.small }}>{t('daemon.mgmt.loadFailed')}</Text> : null}
      {statusUnread ? <Text testID="daemon-mgmt-status-unread" style={{ color: colors.textMuted, fontSize: type.small, lineHeight: 18 }}>{t('daemon.mgmt.statusUnread')}</Text> : null}
    </View>
  );

  const detail = (
    <View style={{ gap: spacing.md }}>
      {selected ? (
        <View style={{ gap: spacing.xs }} testID="daemon-mgmt-detail">
          <Text style={{ color: colors.text, fontSize: type.title, fontWeight: weight.strong }}>{selected.name}</Text>
          {selected.name !== selected.alias ? <Text style={{ color: colors.textMuted, fontSize: type.small }}>{selected.alias}</Text> : null}
          <Fact label={t('daemon.mgmt.field.status')} value={statusLabel(selected.status)} dot={selected.status.online === null ? colors.rest : statusColor(selected.status.text, selected.status.online)} />
          <Fact label={t('daemon.mgmt.field.runtime')} value={runtimeLabel(selected.runtime)} />
          <Fact label={t('daemon.mgmt.field.type')} value={nodeTypeLabel(selected.type)} testID="daemon-mgmt-detail-type" />
        </View>
      ) : (
        <Text style={{ color: colors.textMuted, fontSize: type.body }}>{rows.length ? t('daemon.mgmt.selectNode') : t('daemon.mgmt.empty')}</Text>
      )}
      {selected ? (
        <>
          {onOpenManagedChat ? (
            <Pressable
              testID="daemon-mgmt-open-chat"
              accessibilityRole="button"
              accessibilityLabel={t('daemon.mgmt.openChat')}
              onPress={() => onOpenManagedChat(selected.alias)}
              style={({ pressed }) => [buttonStyle('primary'), { alignSelf: 'flex-start' }, pressed && { opacity: 0.85 }]}
            >
              <Text style={buttonTextStyle('primary')}>{t('daemon.mgmt.openChat')}</Text>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {actions.filter(action => action.visible).map(action => (
              <MgmtButton
                key={action.id}
                testID={`daemon-mgmt-${action.id}`}
                action={action}
                busy={busy}
                tone={NODE_TONE[action.id as NodeActionId]}
                onPress={() => { setMessage(''); setConfirmAlias(''); setPending(action.id as NodeActionId); }}
              />
            ))}
          </View>
          <ActionNotes actions={actions.filter(action => action.visible)} />
        </>
      ) : null}
      {message ? <Text testID="daemon-mgmt-message" style={{ color: messageTone(message), fontSize: type.small, lineHeight: 18 }}>{message}</Text> : null}
    </View>
  );

  const list = rows.length === 0 ? (
    <Text testID="daemon-mgmt-empty" style={{ color: colors.textMuted, fontSize: type.body, padding: spacing.lg }}>{t('daemon.mgmt.empty')}</Text>
  ) : (
    rows.map(row => (
      <Row key={row.nodeId} row={row} selected={row.nodeId === selected?.nodeId} compact={layout === 'split'} onPress={() => setSelectedId(row.nodeId)} />
    ))
  );

  const pendingSection = section === 'nodes' ? null : section;
  const sectionNav = (
    <View style={[screenStyles.sectionNav, layout === 'stack' && screenStyles.sectionNavStack]}>
      <Text style={screenStyles.sectionLabel}>{t('daemon.mgmt.kicker')}</Text>
      <Pressable
        testID="daemon-section-nodes"
        accessibilityRole="tab"
        accessibilityState={{ selected: section === 'nodes' }}
        onPress={() => setSection('nodes')}
        style={({ pressed }) => [screenStyles.sectionItem, section === 'nodes' && screenStyles.sectionItemActive, pressed && { opacity: 0.65 }]}
      >
        <Ionicons name="git-network-outline" size={18} color={section === 'nodes' ? colors.accent : colors.textSecondary} />
        <Text style={[screenStyles.sectionItemText, section === 'nodes' && screenStyles.sectionItemTextActive]} numberOfLines={1}>{t('daemon.mgmt.nodesCount', { count: rows.length })}</Text>
      </Pressable>
      <Text style={screenStyles.sectionLabel} testID="daemon-integrations-label">{t('daemon.integrations')}</Text>
      <PendingSegmentedTabs
        stacked
        value={pendingSection}
        onChange={setSection}
        testID="daemon-section-tabs"
        t={t}
      />
    </View>
  );

  const nodesPage = (
    <ScrollView style={screenStyles.content} contentContainerStyle={screenStyles.contentInner} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <View style={screenStyles.pageHeading}>
        <Text style={screenStyles.pageTitle}>{t('daemon.mgmt.nodesCount', { count: rows.length })}</Text>
        {daemonActions}
      </View>
      <View style={[screenStyles.nodeGrid, layout === 'stack' && screenStyles.nodeGridStack]}>
        <PendingPanelCard testID="daemon-managed-list" style={screenStyles.nodeList}>
          {list}
        </PendingPanelCard>
        <PendingPanelCard testID="daemon-managed-detail" style={screenStyles.nodeDetail}>
          {detail}
        </PendingPanelCard>
      </View>
    </ScrollView>
  );

  const integrationPage = pendingSection ? (
    <ScrollView style={screenStyles.content} contentContainerStyle={screenStyles.contentInner} keyboardShouldPersistTaps="handled">
      <Text style={screenStyles.pageTitle}>{t(INTEGRATION_TITLE[pendingSection])}</Text>
      <BackendPendingIntegration layer="daemon" tab={pendingSection} showTabs={false} testIDPrefix="daemon-pending" />
    </ScrollView>
  ) : null;

  return (
    <View testID="daemon-management" style={{ flex: 1, backgroundColor: colors.bg }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {header}
      <View style={[screenStyles.body, layout === 'stack' && screenStyles.bodyStack]}>
        {sectionNav}
        {section === 'nodes' ? nodesPage : integrationPage}
      </View>
      {pending ? (
        <DialogFrame
          testID="daemon-mgmt-confirm-dialog"
          title={t(CONFIRM_TITLE[pending])}
          closeLabel={t('daemon.mgmt.cancel')}
          onClose={() => { if (!busy) { setPending(null); setConfirmAlias(''); } }}
          footer={(
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => { if (!busy) { setPending(null); setConfirmAlias(''); } }} style={({ pressed }) => [buttonStyle('secondary'), pressed && { opacity: 0.8 }]}>
                <Text style={buttonTextStyle('secondary')}>{t('daemon.mgmt.cancel')}</Text>
              </Pressable>
              <Pressable
                testID="daemon-mgmt-confirm"
                accessibilityRole="button"
                disabled={busy || (pending === 'delete' && confirmAlias !== selected?.alias)}
                onPress={() => { void run(pending); }}
                style={({ pressed }) => [buttonStyle('primary'), pending === 'delete' && { backgroundColor: colors.failed }, (busy || (pending === 'delete' && confirmAlias !== selected?.alias)) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
              >
                <Text style={buttonTextStyle('primary')}>{busy ? t('daemon.mgmt.working') : t('daemon.mgmt.confirm')}</Text>
              </Pressable>
            </View>
          )}
        >
          <View style={{ gap: spacing.md }}>
            <Text style={{ color: colors.textSecondary, fontSize: type.body, lineHeight: 20 }}>
              {pending === 'delete'
                ? t('daemon.mgmt.confirmDeleteBody', { alias: selected?.alias ?? '' })
                : pending === 'start'
                  ? t('daemon.mgmt.confirmStartBody', { alias: selected?.alias ?? '' })
                  : t('daemon.mgmt.confirmBody', { alias: selected?.alias ?? '' })}
            </Text>
            {pending === 'delete' ? (
              <TextInput
                testID="daemon-mgmt-confirm-alias"
                value={confirmAlias}
                onChangeText={setConfirmAlias}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={selected?.alias}
                placeholderTextColor={colors.textMuted}
                style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: spacing.md, fontSize: type.body }}
              />
            ) : null}
          </View>
        </DialogFrame>
      ) : null}
    </View>
  );
}

const DAEMON_WIDE = 960;
const DAEMON_NARROW = 390;

function messageTone(message: string): string {
  const submitted = (['start', 'restart', 'stop', 'delete'] as const).some(id => message === t(`daemon.mgmt.submitted.${id}`));
  return submitted ? colors.running : colors.failed;
}

function Fact({ label, value, dot, testID }: { label: string; value: string; dot?: string; testID?: string }) {
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 }}>
      <Text style={{ color: colors.textMuted, fontSize: type.small, width: 72 }}>{label}</Text>
      {dot ? <View style={{ width: 7, height: 7, borderRadius: radius.pill, backgroundColor: dot }} /> : null}
      <Text style={{ color: colors.text, fontSize: type.body, flex: 1 }} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function ActionNotes({ actions }: { actions: MgmtAction[] }) {
  const notes = [...new Set(actions.map(action => actionReason(action)).filter(Boolean))];
  return (
    <View style={{ gap: spacing.xs }}>
      {notes.map(reason => {
        return (
          <Text key={reason} style={{ color: colors.textMuted, fontSize: type.small, lineHeight: 18 }}>
            {reason}
          </Text>
        );
      })}
    </View>
  );
}

function MgmtButton({ action, onPress, testID, busy, tone }: {
  action: MgmtAction;
  onPress: () => void;
  testID: string;
  busy: boolean;
  tone?: NodeActionTone;
}) {
  const reason = actionReason(action);
  const label = t(ACTION_LABEL[action.id]);
  const visual = tone ? nodeActionVisual({
    card: colors.card, border: colors.border, textSecondary: colors.textSecondary,
    blocked: colors.blocked, failed: colors.failed, accent: colors.accent,
  }, tone) : null;
  const primary = action.id === 'create';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !action.enabled || busy }}
      accessibilityLabel={reason ? `${label}. ${reason}` : label}
      disabled={!action.enabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        visual ? {
          minHeight: 40,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          borderRadius: radius.control,
          borderWidth: 1,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          borderColor: visual.borderColor,
          backgroundColor: visual.backgroundColor,
        } : buttonStyle(primary ? 'primary' : 'secondary'),
        (!action.enabled || busy) && { opacity: 0.45 },
        pressed && action.enabled && !busy && { opacity: 0.85 },
      ]}
    >
      <Text style={visual ? { color: visual.textColor, fontSize: type.body, fontWeight: weight.strong } : buttonTextStyle(primary ? 'primary' : 'secondary')}>{label}</Text>
    </Pressable>
  );
}

function Row({ row, selected, compact, onPress }: {
  row: ReturnType<typeof managedRows>[number];
  selected: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  const dot = row.status.online === null ? colors.rest : statusColor(row.status.text, row.status.online);
  return (
    <Pressable
      testID={`daemon-mgmt-row-${row.nodeId}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${row.name}, ${statusLabel(row.status)}, ${runtimeLabel(row.runtime)}, ${nodeTypeLabel(row.type)}`}
      onPress={onPress}
      style={({ pressed }) => [{
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        gap: spacing.xs,
        backgroundColor: selected ? colors.rowActive : 'transparent',
      }, pressed && { backgroundColor: colors.rowHover }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ width: 7, height: 7, borderRadius: radius.pill, backgroundColor: dot }} />
        <Text style={{ color: colors.text, fontSize: type.body, fontWeight: weight.strong, flex: 1 }} numberOfLines={1}>{row.name}</Text>
      </View>
      {row.name !== row.alias ? <Text style={{ color: colors.textMuted, fontSize: type.small, paddingLeft: 15 }} numberOfLines={1}>{row.alias}</Text> : null}
      <Text style={{ color: colors.textSecondary, fontSize: type.small, paddingLeft: 15 }} numberOfLines={compact ? 1 : 3}>
        {compact
          ? `${statusLabel(row.status)} · ${nodeTypeLabel(row.type)}`
          : `${t('daemon.mgmt.field.status')} ${statusLabel(row.status)}\n${t('daemon.mgmt.field.runtime')} ${runtimeLabel(row.runtime)}\n${t('daemon.mgmt.field.type')} ${nodeTypeLabel(row.type)}`}
      </Text>
    </Pressable>
  );
}

const makeScreenStyles = () =>
  StyleSheet.create({
    body: { flex: 1, minHeight: 0, flexDirection: 'row' },
    bodyStack: { flexDirection: 'column' },
    sectionNav: {
      width: 248,
      flexShrink: 0,
      paddingVertical: spacing.sm,
      borderRightWidth: 1,
      borderRightColor: colors.border,
      backgroundColor: colors.bg,
    },
    sectionNavStack: {
      width: '100%',
      borderRightWidth: 0,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingBottom: spacing.md,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: type.caption,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    sectionItem: {
      minHeight: 42,
      marginHorizontal: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.item,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    sectionItemActive: { backgroundColor: colors.rowActive },
    sectionItemText: { color: colors.textSecondary, fontSize: 13, fontWeight: weight.medium, flex: 1 },
    sectionItemTextActive: { color: colors.text, fontWeight: weight.strong },
    content: { flex: 1, minWidth: 0 },
    contentInner: { width: '100%', padding: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.lg },
    pageHeading: { gap: spacing.md },
    pageTitle: { color: colors.text, fontSize: type.title, fontWeight: weight.strong },
    nodeGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    nodeGridStack: { flexDirection: 'column' },
    nodeList: { flexGrow: 1, flexShrink: 1, flexBasis: 420, minWidth: 0, paddingHorizontal: 0, overflow: 'hidden' },
    nodeDetail: { flexGrow: 2, flexShrink: 1, flexBasis: 520, minWidth: 0 },
  });

let screenStyles = makeScreenStyles();
onThemeChange(() => {
  screenStyles = makeScreenStyles();
});
