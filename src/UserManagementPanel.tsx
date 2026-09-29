// 设置 → 用户管理(多用户账号与 Agent 权限,hub agent-network#2084)。
// 列出当前网络的成员;owner / admin 行恒为「全部 Agent」;其他成员点进「可访问的 Agent」逐个分配,
// 每个 Agent 一个「可对话」开关。「新建用户」走 POST /api/admin/users。
// 宽屏右栏与手机子页共用这一份(settings-kit 的卡片 / 行),两个弹窗居中。纯判断在 user-admin.ts。
import { useCallback, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { fetchHubNodes, type HubConfig } from './api';
import { colors, onThemeChange, radius, spacing } from './theme';
import { elevated } from './elevation';
import { useTranslation } from './i18n-react';
import { t as tr } from './i18n';
import './i18n-users';
import { SettingsButton, SettingsGroup, SettingsRow } from './settings-kit';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import {
  aliasOnlyGrants, canAddAdminsIn, canManageUsers, manageableNetworks, currentNetworkRow, filterPickable, grantsChanged, grantsEditable, grantsPayload,
  memberAccessSummary, selectionFromGrants, setCanMessage, toggleAgent, validateNewUser,
  type AgentGrant, type AuthMe, type MemberRole, type NetworkChoice, type NetworkMember, type PickableAgent,
} from './user-admin';
import { createHubUser, fetchAgentGrants, fetchNetworkMembers, fetchNetworks, saveAgentGrants } from './user-admin-api';

const ROLE_KEY: Record<string, string> = { owner: 'users.role.owner', admin: 'users.role.admin', member: 'users.role.member', viewer: 'users.role.viewer' };
const roleLabel = (role: MemberRole) => (ROLE_KEY[role] ? tr(ROLE_KEY[role]) : String(role));

export default function UserManagementPanel({ cfg, me, networkId }: { cfg: HubConfig; me: AuthMe | null; networkId: string | undefined }) {
  useTranslation();
  const [members, setMembers] = useState<NetworkMember[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<NetworkMember | null>(null);
  const allowed = canManageUsers(me, networkId);
  const myId = me?.user?.user_id;
  // 新建用户能选的网络:Hub 管理员 = 全部网络;否则 = 我管的(owner / admin)。当前网络排第一、默认选中。
  const [allNetworks, setAllNetworks] = useState<Array<{ network_id: string; network_name?: string | null; name?: string | null }> | null>(null);
  useEffect(() => {
    if (!allowed || me?.user?.role !== 'admin') return;
    void fetchNetworks(cfg).then(setAllNetworks).catch(() => setAllNetworks(null));
  }, [cfg, allowed, me?.user?.role]);
  const networkChoices = useMemo(() => manageableNetworks(me, networkId, allNetworks), [me, networkId, allNetworks]);

  const load = useCallback(() => {
    if (!networkId || !allowed) return;
    setLoadError('');
    void fetchNetworkMembers(cfg, networkId).then(setMembers).catch(e => { setMembers(null); setLoadError(String((e as Error)?.message ?? e)); });
  }, [cfg, networkId, allowed]);
  useEffect(load, [load]);

  if (!allowed || !networkId) return null;
  return (
    <View testID="user-management">
      <SettingsGroup
        title={tr('users.members')}
        footer={loadError ? `${tr('users.loadFailed')}: ${loadError}` : notice || tr('users.footer')}
        footerTone={loadError ? 'danger' : notice ? 'accent' : 'muted'}
        testID="user-management-members"
      >
        {members === null && !loadError ? (
          <SettingsRow label={tr('users.loading')} busy testID="user-management-loading" />
        ) : null}
        {loadError ? <SettingsRow label={tr('users.retry')} tone="accent" onPress={load} testID="user-management-retry" /> : null}
        {(members ?? []).map(m => {
          const summary = memberAccessSummary(m);
          const value = summary.kind === 'all' ? tr('users.access.all') : summary.count ? tr('users.access.count', { count: summary.count }) : tr('users.access.none');
          const editable = grantsEditable(m);
          return (
            <SettingsRow
              key={m.user_id}
              testID={`user-row-${m.username}`}
              label={`${m.display_name || m.username}${m.user_id === myId ? tr('users.you') : ''}`}
              subtitle={`${m.username} · ${roleLabel(m.role)}`}
              value={value}
              valueTone={summary.kind === 'count' && !summary.count ? 'danger' : 'muted'}
              onPress={editable ? () => { setNotice(''); setEditing(m); } : undefined}
            />
          );
        })}
      </SettingsGroup>
      <SettingsButton label={tr('users.newUser')} onPress={() => { setNotice(''); setCreating(true); }} testID="user-management-new" />
      {creating ? (
        <NewUserDialog
          cfg={cfg}
          me={me}
          networkId={networkId}
          networks={networkChoices.length ? networkChoices : [{ network_id: networkId, name: currentNetworkRow(me, networkId)?.network_name ?? networkId }]}
          onClose={() => setCreating(false)}
          onCreated={(name, net) => { setCreating(false); setNotice(net === networkId ? tr('users.created', { name }) : tr('users.createdElsewhere', { name, network: networkChoices.find(n => n.network_id === net)?.name ?? net })); load(); }}
        />
      ) : null}
      {editing ? (
        <GrantsDialog
          cfg={cfg}
          networkId={networkId}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setNotice(tr('users.saved')); load(); }}
        />
      ) : null}
    </View>
  );
}

function DialogShell({ title, children, onClose, testID }: { title: string; children: ReactNode; onClose: () => void; testID: string }) {
  const safe = useModalSafePadding('fullScreen');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, withBasePadding(safe, spacing.lg)]} testID={`${testID}-backdrop`}>
        <View style={styles.card} testID={testID}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={tr('users.close')} onPress={onClose} hitSlop={8} style={styles.closeBtn} testID={`${testID}-close`}>
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, hint, testID, ...input }: ComponentProps<typeof TextInput> & { label: string; hint?: string; testID: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}{hint ? <Text style={styles.fieldHint}>{`  ${hint}`}</Text> : null}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        {...input}
      />
    </View>
  );
}

function Actions({ onCancel, onConfirm, confirmLabel, disabled, busy, testID }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; disabled?: boolean; busy?: boolean; testID: string }) {
  return (
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]} testID={`${testID}-cancel`}>
        <Text style={styles.btnPlainText}>{tr('users.cancel')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy) }} disabled={disabled || busy} onPress={onConfirm} style={({ pressed }) => [styles.btn, styles.btnPrimary, (disabled || busy) && styles.disabled, pressed && styles.pressed]} testID={`${testID}-confirm`}>
        {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : null}
        <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
      </Pressable>
    </View>
  );
}

function NewUserDialog({ cfg, me, networkId, networks, onClose, onCreated }: {
  cfg: HubConfig; me: AuthMe | null; networkId: string; networks: NetworkChoice[]; onClose: () => void; onCreated: (name: string, networkId: string) => void;
}) {
  const [targetNet, setTargetNet] = useState(networkId);
  const canAddAdmins = canAddAdminsIn(me, targetNet);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problem = validateNewUser({ username, password });
  const touched = username.length > 0 || password.length > 0;
  const roles: MemberRole[] = canAddAdmins ? ['member', 'viewer', 'admin'] : ['member', 'viewer'];
  useEffect(() => { if (!canAddAdmins && role === 'admin') setRole('member'); }, [canAddAdmins, role]);
  const submit = () => {
    if (problem) return;
    setBusy(true); setError('');
    void createHubUser(cfg, { username: username.trim(), password, ...(displayName.trim() ? { display_name: displayName.trim() } : {}), network_id: targetNet, role })
      .then(() => onCreated(username.trim(), targetNet))
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false));
  };
  return (
    <DialogShell title={tr('users.newUser')} onClose={onClose} testID="new-user-dialog">
      <Field label={tr('users.username')} value={username} onChangeText={setUsername} testID="new-user-username" />
      <Field label={tr('users.password')} hint={tr('users.passwordHint')} value={password} onChangeText={setPassword} secureTextEntry testID="new-user-password" />
      <Field label={tr('users.displayName')} hint={tr('users.optional')} value={displayName} onChangeText={setDisplayName} testID="new-user-display-name" />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('users.network')}</Text>
        {networks.length > 1 ? (
          <View style={styles.netChips} accessibilityRole="radiogroup" testID="new-user-network">
            {networks.map(n => (
              <Pressable key={n.network_id} accessibilityRole="radio" accessibilityState={{ selected: targetNet === n.network_id, checked: targetNet === n.network_id }} onPress={() => setTargetNet(n.network_id)} style={[styles.netChip, targetNet === n.network_id && styles.segmentOn]} testID={`new-user-network-${n.network_id}`}>
                <Text style={[styles.segmentText, targetNet === n.network_id && styles.segmentTextOn]} numberOfLines={1}>{n.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.readonly} numberOfLines={1} testID="new-user-network">{networks[0]?.name ?? networkId}</Text>
        )}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{tr('users.role')}</Text>
        <View style={styles.segmented} accessibilityRole="radiogroup">
          {roles.map(r => (
            <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: role === r, checked: role === r }} onPress={() => setRole(r)} style={[styles.segment, role === r && styles.segmentOn]} testID={`new-user-role-${r}`}>
              <Text style={[styles.segmentText, role === r && styles.segmentTextOn]} numberOfLines={1}>{roleLabel(r)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {error ? <Text style={styles.error} testID="new-user-error">{error}</Text> : touched && problem ? <Text style={styles.hint} testID="new-user-problem">{tr(`users.err.${problem}`)}</Text> : null}
      <Actions onCancel={onClose} onConfirm={submit} confirmLabel={tr('users.create')} disabled={!!problem} busy={busy} testID="new-user" />
    </DialogShell>
  );
}

function GrantsDialog({ cfg, networkId, member, onClose, onSaved }: { cfg: HubConfig; networkId: string; member: NetworkMember; onClose: () => void; onSaved: () => void }) {
  const [agents, setAgents] = useState<PickableAgent[] | null>(null);
  const [original, setOriginal] = useState<AgentGrant[]>([]);
  const [selection, setSelection] = useState<Map<string, boolean>>(new Map());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void Promise.all([fetchHubNodes({ ...cfg, networkId }), fetchAgentGrants(cfg, networkId, member.user_id)])
      .then(([nodes, grants]) => {
        if (!live) return;
        setAgents((nodes.nodes ?? []).map(n => ({ node_id: n.node_id, alias: n.alias, display_name: (n as any).display_name ?? null, role: n.role ?? null })));
        setOriginal(grants.grants ?? []);
        setSelection(selectionFromGrants(grants.grants ?? []));
      })
      .catch(e => { if (live) { setAgents([]); setError(String((e as Error)?.message ?? e)); } });
    return () => { live = false; };
  }, [cfg, networkId, member.user_id]);
  const visible = useMemo(() => filterPickable(agents ?? [], query), [agents, query]);
  const before = useMemo(() => selectionFromGrants(original), [original]);
  const changed = grantsChanged(before, selection);
  const save = () => {
    setBusy(true); setError('');
    void saveAgentGrants(cfg, networkId, member.user_id, grantsPayload(selection, aliasOnlyGrants(original)))
      .then(onSaved)
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false));
  };
  return (
    <DialogShell title={`${tr('users.agents')} · ${member.display_name || member.username}`} onClose={onClose} testID="grants-dialog">
      <View style={styles.search}>
        <Ionicons name="search-outline" size={15} color={colors.textMuted} />
        <TextInput value={query} onChangeText={setQuery} placeholder={tr('users.search')} placeholderTextColor={colors.textMuted} accessibilityLabel={tr('users.search')} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} testID="grants-search" />
      </View>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="grants-list">
        {agents === null ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.textMuted} /> : null}
        {agents && !visible.length ? <Text style={styles.empty}>{agents.length ? tr('users.noMatch') : tr('users.noAgents')}</Text> : null}
        {visible.map(a => {
          const on = selection.has(a.node_id);
          return (
            <View key={a.node_id} style={styles.agentRow} testID={`grant-row-${a.alias}`}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={a.alias} onPress={() => setSelection(s => toggleAgent(s, a.node_id))} style={styles.agentPick} testID={`grant-toggle-${a.alias}`}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.accent : colors.textMuted} />
                <AliasAvatar alias={a.alias} size={28} />
                <Text style={styles.agentName} numberOfLines={1}>{a.display_name || a.alias}</Text>
              </Pressable>
              {on ? (
                <View style={styles.canMessage}>
                  <Text style={styles.canMessageText}>{tr('users.canMessage')}</Text>
                  <Switch
                    accessibilityLabel={`${tr('users.canMessage')} ${a.alias}`}
                    value={selection.get(a.node_id) === true}
                    onValueChange={v => setSelection(s => setCanMessage(s, a.node_id, v))}
                    trackColor={{ true: colors.accent, false: colors.border }}
                    thumbColor={colors.card}
                    testID={`grant-can-message-${a.alias}`}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      <Text style={styles.hint} testID="grants-count">{tr('users.selected', { count: selection.size })}</Text>
      {error ? <Text style={styles.error} testID="grants-error">{error}</Text> : null}
      <Actions onCancel={onClose} onConfirm={save} confirmLabel={tr('users.save')} disabled={!changed} busy={busy} testID="grants" />
    </DialogShell>
  );
}

const makeStyles = () => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 460, maxHeight: '100%', backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md, ...elevated('floating') },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' },
  closeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  field: { gap: 6 },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  fieldHint: { color: colors.textMuted, fontSize: 12, fontWeight: '400' },
  input: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 14, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  readonly: { color: colors.text, fontSize: 14, paddingVertical: 4 },
  netChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  netChip: { maxWidth: '100%', paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border },
  segmented: { flexDirection: 'row', borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.textSecondary, fontSize: 13 },
  segmentTextOn: { color: colors.onAccent, fontWeight: '600' },
  error: { color: colors.failed, fontSize: 12, lineHeight: 18 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: spacing.lg, borderRadius: radius.control, justifyContent: 'center' },
  btnPlain: { borderWidth: 1, borderColor: colors.border },
  btnPlainText: { color: colors.text, fontSize: 14 },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, paddingVertical: 8, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}) },
  list: { maxHeight: 360, flexGrow: 0 },
  listContent: { gap: 2 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  agentPick: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  agentName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  canMessage: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  canMessageText: { color: colors.textSecondary, fontSize: 12 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
