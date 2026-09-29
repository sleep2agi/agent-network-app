// 设置 → 用户管理(多用户账号与 Agent 权限,hub agent-network#2084)。
// 列出当前网络的成员;owner / admin 行恒为「全部 Agent」;点成员可改「可访问范围」(全部 / 仅指定)、
// 逐个分配 Agent 与「可对话」、改角色、移出网络(RFC-038 第 1 步)。「新建用户」走 POST /api/admin/users。
// 成员列表宽屏右栏与手机子页共用;点进成员后两端分开画:
//   宽屏 —— 居中弹窗(分段控件 + 可搜的勾选清单 + 左下角「移出网络」);
//   手机 —— 设置三级页「成员」(微信式分组:角色单选、范围单选、Agent ✓ 多选、可对话开关组、整宽按钮、底部确认单)。
// 纯判断在 user-admin.ts。
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
import { SettingsButton, SettingsChoiceRow, SettingsGroup, SettingsRow, SettingsSwitchRow, SettingsTextField } from './settings-kit';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import {
  ASSIGNABLE_ROLES, aliasOnlyGrants, canAddAdminsIn, canManageUsers, manageableNetworks, currentNetworkRow, filterPickable, grantsEditable, grantsPayload,
  initialAccessMode, memberAccessSummary, memberActions, memberSavePlan, prefillOnRestrict, selectionFromGrants, setCanMessage, showsCanMessage, toggleAgent, validateNewUser,
  type AgentAccess, type AgentGrant, type AuthMe, type MemberRole, type NetworkChoice, type NetworkMember, type PickableAgent,
} from './user-admin';
import { createHubUser, fetchAgentGrants, fetchNetworkMembers, fetchNetworks, removeNetworkMember, saveAgentGrants, updateMemberRole } from './user-admin-api';

const ROLE_KEY: Record<string, string> = { owner: 'users.role.owner', admin: 'users.role.admin', member: 'users.role.member', viewer: 'users.role.viewer' };
const roleLabel = (role: MemberRole) => (ROLE_KEY[role] ? tr(ROLE_KEY[role]) : String(role));

/** 手机:点成员 = 推三级页「成员」(SettingsScreen 的 detail 机制,顶栏返回 / 安卓返回键都走它)。 */
export type PhoneMemberNav = { memberOpen: boolean; openMember: () => void; closeMember: () => void };

export default function UserManagementPanel({ cfg, me, networkId, phone }: { cfg: HubConfig; me: AuthMe | null; networkId: string | undefined; phone?: PhoneMemberNav }) {
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
  // 三级页被返回键关掉了 → 丢掉编辑中的成员;三级页开着却没有成员(状态丢了)→ 退回列表。
  const memberOpen = !!phone?.memberOpen;
  useEffect(() => { if (phone && !memberOpen && editing) setEditing(null); }, [phone, memberOpen, editing]);
  useEffect(() => { if (phone && memberOpen && !editing) phone.closeMember(); }, [phone, memberOpen, editing]);
  const openMember = (m: NetworkMember) => { setNotice(''); setEditing(m); phone?.openMember(); };
  const doneMember = (message: string) => { setEditing(null); if (phone?.memberOpen) phone.closeMember(); setNotice(message); load(); };

  if (!allowed || !networkId) return null;
  if (phone && memberOpen && editing) {
    return <MemberPage cfg={cfg} me={me} networkId={networkId} member={editing} onDone={doneMember} />;
  }
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
          const acts = memberActions(me, networkId, m);
          const editable = acts.editAccess || acts.editRole || acts.remove;
          return (
            <SettingsRow
              key={m.user_id}
              testID={`user-row-${m.username}`}
              label={`${m.display_name || m.username}${m.user_id === myId ? tr('users.you') : ''}`}
              subtitle={`${m.username} · ${roleLabel(m.role)}`}
              value={value}
              valueTone={summary.kind === 'count' && !summary.count ? 'danger' : 'muted'}
              onPress={editable ? () => openMember(m) : undefined}
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
      {editing && !phone ? (
        <MemberDialog
          cfg={cfg}
          me={me}
          networkId={networkId}
          member={editing}
          onClose={() => setEditing(null)}
          onDone={doneMember}
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

function Actions({ onCancel, onConfirm, confirmLabel, disabled, busy, danger, left, testID }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; disabled?: boolean; busy?: boolean; danger?: boolean; left?: ReactNode; testID: string }) {
  return (
    <View style={styles.actions}>
      {left ? <View style={styles.actionsLeft}>{left}</View> : null}
      <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.btn, styles.btnPlain, pressed && styles.pressed]} testID={`${testID}-cancel`}>
        <Text style={styles.btnPlainText}>{tr('users.cancel')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!(disabled || busy) }} disabled={disabled || busy} onPress={onConfirm} style={({ pressed }) => [styles.btn, danger ? styles.btnDanger : styles.btnPrimary, (disabled || busy) && styles.disabled, pressed && styles.pressed]} testID={`${testID}-confirm`}>
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

/** 成员编辑的状态与保存/移出(宽屏弹窗与手机三级页共用;两端只换画法)。 */
function useMemberEditor(cfg: HubConfig, me: AuthMe | null, networkId: string, member: NetworkMember, onDone: (message: string) => void) {
  const acts = memberActions(me, networkId, member);
  const name = member.display_name || member.username;
  const [agents, setAgents] = useState<PickableAgent[] | null>(null);
  const [original, setOriginal] = useState<AgentGrant[]>([]);
  const [mode0, setMode0] = useState<AgentAccess>('granted');
  const [mode, setModeState] = useState<AgentAccess>('granted');
  const [selection, setSelection] = useState<Map<string, boolean>>(new Map());
  const [role, setRole] = useState<MemberRole>(member.role);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const needGrants = grantsEditable(member);
  useEffect(() => {
    if (!needGrants) { setAgents([]); return; }
    let live = true;
    void Promise.all([fetchHubNodes({ ...cfg, networkId }), fetchAgentGrants(cfg, networkId, member.user_id)])
      .then(([nodes, grants]) => {
        if (!live) return;
        setAgents((nodes.nodes ?? []).map(n => ({ node_id: n.node_id, alias: n.alias, display_name: (n as any).display_name ?? null, role: n.role ?? null })));
        setOriginal(grants.grants ?? []);
        setSelection(selectionFromGrants(grants.grants ?? []));
        const m = initialAccessMode(grants.agent_access);
        setMode0(m); setModeState(m);
      })
      .catch(e => { if (live) { setAgents([]); setError(String((e as Error)?.message ?? e)); } });
    return () => { live = false; };
  }, [cfg, networkId, member.user_id, needGrants]);
  const before = useMemo(() => selectionFromGrants(original), [original]);
  const visible = useMemo(() => filterPickable(agents ?? [], query), [agents, query]);
  const setMode = (next: AgentAccess) => {
    if (next === 'granted' && mode === 'all') setSelection(s => prefillOnRestrict(s, agents ?? [], role));
    setModeState(next);
  };
  const plan = memberSavePlan({ role: member.role, nextRole: role, mode: mode0, nextMode: mode, before, after: selection });
  const accessEditable = acts.editAccess && grantsEditable({ role });
  const save = () => {
    setBusy(true); setError('');
    void (async () => {
      if (plan.role) await updateMemberRole(cfg, networkId, member.user_id, role);
      if (plan.grants) await saveAgentGrants(cfg, networkId, member.user_id, grantsPayload(selection, aliasOnlyGrants(original), { mode, role }));
    })()
      .then(() => onDone(tr('users.saved')))
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => setBusy(false));
  };
  const remove = () => {
    setBusy(true); setError('');
    void removeNetworkMember(cfg, networkId, member.user_id)
      .then(() => onDone(tr('users.removed', { name })))
      .catch(e => { setConfirmRemove(false); setError(String((e as Error)?.message ?? e)); })
      .finally(() => setBusy(false));
  };
  return {
    acts, name, agents, visible, selection, setSelection, mode, setMode, role, setRole, query, setQuery,
    busy, error, confirmRemove, setConfirmRemove, accessEditable, changed: plan.role || plan.grants, save, remove,
  };
}

/** 宽屏:居中弹窗。角色 / 范围用分段控件,清单可搜,「全部 Agent」时清单置灰不可点;「移出网络」在左下角,点了换成确认条。 */
function MemberDialog({ cfg, me, networkId, member, onClose, onDone }: { cfg: HubConfig; me: AuthMe | null; networkId: string; member: NetworkMember; onClose: () => void; onDone: (message: string) => void }) {
  const ed = useMemberEditor(cfg, me, networkId, member, onDone);
  const restricted = ed.mode === 'granted';
  const chat = showsCanMessage(ed.role);
  return (
    <DialogShell title={`${tr('users.member')} · ${ed.name}`} onClose={onClose} testID="grants-dialog">
      {ed.acts.editRole ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{tr('users.role')}</Text>
          <View style={styles.segmented} accessibilityRole="radiogroup" testID="member-role">
            {ASSIGNABLE_ROLES.map(r => (
              <Pressable key={r} accessibilityRole="radio" accessibilityState={{ selected: ed.role === r, checked: ed.role === r }} aria-checked={ed.role === r} onPress={() => ed.setRole(r)} style={[styles.segment, ed.role === r && styles.segmentOn]} testID={`member-role-${r}`}>
                <Text style={[styles.segmentText, ed.role === r && styles.segmentTextOn]} numberOfLines={1}>{roleLabel(r)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {ed.accessEditable ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{tr('users.access')}</Text>
            <View style={styles.segmented} accessibilityRole="radiogroup" testID="grants-mode">
              {(['all', 'granted'] as const).map(m => (
                <Pressable key={m} accessibilityRole="radio" accessibilityState={{ selected: ed.mode === m, checked: ed.mode === m }} aria-checked={ed.mode === m} onPress={() => ed.setMode(m)} style={[styles.segment, ed.mode === m && styles.segmentOn]} testID={`grants-mode-${m}`}>
                  <Text style={[styles.segmentText, ed.mode === m && styles.segmentTextOn]} numberOfLines={1}>{m === 'all' ? tr('users.access.all') : tr('users.access.granted')}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint} testID="grants-mode-hint">{restricted ? (chat ? tr('users.access.grantedHint') : tr('users.viewerHint')) : tr('users.access.allHint')}</Text>
          </View>
          <View style={[styles.field, !restricted && styles.inactive]} pointerEvents={restricted ? 'auto' : 'none'} testID="grants-picker">
            <View style={styles.search}>
              <Ionicons name="search-outline" size={15} color={colors.textMuted} />
              <TextInput value={ed.query} onChangeText={ed.setQuery} editable={restricted} placeholder={tr('users.search')} placeholderTextColor={colors.textMuted} accessibilityLabel={tr('users.search')} autoCapitalize="none" autoCorrect={false} style={styles.searchInput} testID="grants-search" />
            </View>
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="grants-list">
              {ed.agents === null ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.textMuted} /> : null}
              {ed.agents && !ed.visible.length ? <Text style={styles.empty}>{ed.agents.length ? tr('users.noMatch') : tr('users.noAgents')}</Text> : null}
              {ed.visible.map(a => {
                const on = ed.selection.has(a.node_id);
                return (
                  <View key={a.node_id} style={styles.agentRow} testID={`grant-row-${a.alias}`}>
                    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !restricted }} aria-checked={on} disabled={!restricted} accessibilityLabel={a.alias} onPress={() => ed.setSelection(s => toggleAgent(s, a.node_id))} style={styles.agentPick} testID={`grant-toggle-${a.alias}`}>
                      <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.accent : colors.textMuted} />
                      <AliasAvatar alias={a.alias} size={28} />
                      <Text style={styles.agentName} numberOfLines={1}>{a.display_name || a.alias}</Text>
                    </Pressable>
                    {on && chat ? (
                      <View style={styles.canMessage}>
                        <Text style={styles.canMessageText}>{tr('users.canMessage')}</Text>
                        <Switch
                          accessibilityLabel={`${tr('users.canMessage')} ${a.alias}`}
                          value={ed.selection.get(a.node_id) === true}
                          disabled={!restricted}
                          onValueChange={v => ed.setSelection(s => setCanMessage(s, a.node_id, v))}
                          trackColor={{ true: colors.accent, false: colors.border }}
                          thumbColor={colors.card}
                          testID={`grant-can-message-${a.alias}`}
                        />
                      </View>
                    ) : on ? (
                      <Text style={styles.readOnlyTag} testID={`grant-read-only-${a.alias}`}>{tr('users.readOnly')}</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            <Text style={styles.hint} testID="grants-count">{tr('users.selected', { count: ed.selection.size })}</Text>
          </View>
        </>
      ) : null}
      {ed.error ? <Text style={styles.error} testID="grants-error">{ed.error}</Text> : null}
      {ed.confirmRemove ? (
        <View style={styles.confirmBox} testID="member-remove-box">
          <Text style={styles.confirmText}>{tr('users.removeConfirm', { name: ed.name })}</Text>
          <Actions onCancel={() => ed.setConfirmRemove(false)} onConfirm={ed.remove} confirmLabel={tr('users.removeYes')} danger busy={ed.busy} testID="member-remove" />
        </View>
      ) : (
        <Actions
          onCancel={onClose}
          onConfirm={ed.save}
          confirmLabel={tr('users.save')}
          disabled={!ed.changed}
          busy={ed.busy}
          testID="grants"
          left={ed.acts.remove ? (
            <Pressable accessibilityRole="button" onPress={() => ed.setConfirmRemove(true)} hitSlop={6} style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]} testID="member-remove-open">
              <Text style={styles.linkDanger}>{tr('users.remove')}</Text>
            </Pressable>
          ) : undefined}
        />
      )}
    </DialogShell>
  );
}

/** 手机:设置三级页「成员」,只用 settings-kit 的积木(微信式分组)。移出走底部确认单。 */
function MemberPage({ cfg, me, networkId, member, onDone }: { cfg: HubConfig; me: AuthMe | null; networkId: string; member: NetworkMember; onDone: (message: string) => void }) {
  const ed = useMemberEditor(cfg, me, networkId, member, onDone);
  const restricted = ed.mode === 'granted';
  const chat = showsCanMessage(ed.role);
  const picked = (ed.agents ?? []).filter(a => ed.selection.has(a.node_id)).sort((a, b) => a.alias.localeCompare(b.alias));
  return (
    <View testID="member-page">
      <SettingsGroup testID="member-page-head">
        <SettingsRow label={ed.name} subtitle={`${member.username} · ${roleLabel(member.role)}`} chevron={false} testID="member-page-identity" />
      </SettingsGroup>
      {ed.acts.editRole ? (
        <SettingsGroup title={tr('users.role')} testID="member-page-role">
          {ASSIGNABLE_ROLES.map(r => (
            <SettingsChoiceRow key={r} label={roleLabel(r)} selected={ed.role === r} onPress={() => ed.setRole(r)} testID={`member-role-${r}`} />
          ))}
        </SettingsGroup>
      ) : null}
      {ed.accessEditable ? (
        <SettingsGroup title={tr('users.access')} footer={restricted ? (chat ? tr('users.access.grantedHint') : tr('users.viewerHint')) : tr('users.access.allHint')} testID="member-page-mode">
          <SettingsChoiceRow label={tr('users.access.all')} selected={!restricted} onPress={() => ed.setMode('all')} testID="grants-mode-all" />
          <SettingsChoiceRow label={tr('users.access.granted')} selected={restricted} onPress={() => ed.setMode('granted')} testID="grants-mode-granted" />
        </SettingsGroup>
      ) : null}
      {ed.accessEditable && restricted ? (
        <SettingsGroup title={tr('users.agents')} footer={tr('users.selected', { count: ed.selection.size })} testID="member-page-agents">
          <SettingsTextField value={ed.query} onChangeText={ed.setQuery} placeholder={tr('users.search')} accessibilityLabel={tr('users.search')} testID="grants-search" />
          {ed.agents === null ? <SettingsRow label={tr('users.loading')} busy testID="member-page-loading" /> : null}
          {ed.agents && !ed.visible.length ? <SettingsRow label={ed.agents.length ? tr('users.noMatch') : tr('users.noAgents')} tone="muted" testID="member-page-empty" /> : null}
          {ed.visible.map(a => (
            <SettingsChoiceRow
              key={a.node_id}
              label={a.display_name || a.alias}
              subtitle={a.display_name ? a.alias : undefined}
              selected={ed.selection.has(a.node_id)}
              onPress={() => ed.setSelection(s => toggleAgent(s, a.node_id))}
              testID={`grant-toggle-${a.alias}`}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {ed.accessEditable && restricted && chat && picked.length ? (
        <SettingsGroup title={tr('users.canMessageGroup')} footer={tr('users.canMessageFooter')} testID="member-page-chat">
          {picked.map(a => (
            <SettingsSwitchRow
              key={a.node_id}
              label={a.display_name || a.alias}
              value={ed.selection.get(a.node_id) === true}
              onValueChange={v => ed.setSelection(s => setCanMessage(s, a.node_id, v))}
              testID={`grant-can-message-${a.alias}`}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {ed.error ? <SettingsGroup footer={ed.error} footerTone="danger" testID="grants-error" /> : null}
      <SettingsButton label={tr('users.save')} onPress={ed.save} disabled={!ed.changed} busy={ed.busy && !ed.confirmRemove} testID="grants-confirm" />
      {ed.acts.remove ? <SettingsButton label={tr('users.remove')} variant="destructive" onPress={() => ed.setConfirmRemove(true)} testID="member-remove-open" /> : null}
      {ed.confirmRemove ? <RemoveSheet name={ed.name} busy={ed.busy} onCancel={() => ed.setConfirmRemove(false)} onConfirm={ed.remove} /> : null}
    </View>
  );
}

/** 手机的底部确认单(微信「删除联系人」那种):说明 + 红字确认 + 取消。 */
function RemoveSheet({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const safe = useModalSafePadding('fullScreen');
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.sheetBackdrop} onPress={onCancel} testID="member-remove-backdrop">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(safe.paddingBottom ?? 0, spacing.sm) }]} onPress={() => {}} testID="member-remove-sheet">
          <Text style={styles.sheetText}>{tr('users.removeConfirm', { name })}</Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={({ pressed }) => [styles.sheetBtn, styles.sheetDivider, pressed && styles.pressed]} testID="member-remove-confirm">
            {busy ? <ActivityIndicator size="small" color={colors.failed} /> : <Text style={styles.sheetDanger}>{tr('users.removeYes')}</Text>}
          </Pressable>
          <View style={styles.sheetGap} />
          <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.sheetBtn, pressed && styles.pressed]} testID="member-remove-cancel">
            <Text style={styles.sheetCancel}>{tr('users.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm },
  actionsLeft: { marginRight: 'auto' },
  linkBtn: { minHeight: 38, justifyContent: 'center' },
  linkDanger: { color: colors.failed, fontSize: 14 },
  btnDanger: { backgroundColor: colors.failed },
  inactive: { opacity: 0.45 },
  readOnlyTag: { color: colors.textMuted, fontSize: 12 },
  confirmBox: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  confirmText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, overflow: 'hidden' },
  sheetText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sheetBtn: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  sheetDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetGap: { height: 8, backgroundColor: colors.bg },
  sheetCancel: { color: colors.text, fontSize: 16 },
  sheetDanger: { color: colors.failed, fontSize: 16, fontWeight: '600' },
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
