// 节点权限「两个问题」(admin 2026-11-16「还是没有一个简单易用明了的权限方案」「交互体验要好」)。
// 换算规则见 node-permission-preset.ts;原来的细项卡片收进「高级」(NodePermissionSection)。
//
// 交互:点一下就生效(没有保存按钮),组标题旁短暂显示「已保存」;收窄「谁能找它」或覆盖自定义设置前,
// 先在原地说清后果再确认;选不了的项灰掉并写明原因;选「部门管理」时就地挑部门。
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import './i18n-node-permissions';
import { fetchNodeGrants, putNodeGrants, putNodeInboxAllowlist, putNodePermissionMode, type HubConfig, type HubNode, type NodeGrant } from './api';
import type { Human } from './human-dm';
import type { DeptChoice } from './node-allowlist-model';
import { allowlistErrorText } from './node-allowlist-model';
import { saveErrorText, type NodePermissionMode } from './node-permission-model';
import { deriveReach, deriveRole, reachInbox, reachNarrows, roleSettings, type NodeReach, type NodeRole } from './node-permission-preset';
import { useTranslation } from './i18n-react';
import { colors, radius, spacing, type as typeScale, weight } from './theme';

type Pending = { kind: 'role'; role: Exclude<NodeRole, 'custom'>; deptId?: string; message: string } | { kind: 'reach'; reach: Exclude<NodeReach, 'custom'>; message: string };

export default function NodePermissionSimple({ cfg, node, mode, inbox, humans, depts, grantsSupported, onModeSaved, onInboxSaved, onGrantsSaved }: {
  cfg: HubConfig;
  node: HubNode;
  mode: NodePermissionMode;
  inbox: string[] | null;
  humans: readonly Human[];
  depts: readonly DeptChoice[];
  grantsSupported: boolean;
  onModeSaved: (mode: NodePermissionMode) => void;
  onInboxSaved: (list: string[] | null) => void;
  onGrantsSaved: () => void;
}) {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<NodeGrant[] | null>(null);
  const [offered, setOffered] = useState<string[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'role' | 'reach' | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [deptPick, setDeptPick] = useState(false);

  useEffect(() => {
    if (!grantsSupported) { setGrants([]); return; }
    let alive = true;
    void fetchNodeGrants(cfg, node.node_id).then(r => {
      if (!alive) return;
      if (r.ok) { setGrants(r.grants); setOffered(r.capabilities); } else setGrants([]);
    });
    return () => { alive = false; };
  }, [cfg, node.node_id, grantsSupported]);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(null), 2200);
    return () => clearTimeout(id);
  }, [saved]);

  const ownerHuman = humans.find(h => h.user_id === node.owner_user_id) ?? null;
  const owner = node.owner_user_id ? { user_id: node.owner_user_id, username: ownerHuman?.username ?? null } : null;
  const ownerName = ownerHuman?.display_name || ownerHuman?.username || '';
  const nodeDept = node.department_id ?? null;
  const caps = offered ?? ['schedules', 'board', 'rules'];
  const roleState = grants === null ? null : deriveRole(mode, grants, caps);
  const reach = deriveReach(inbox, nodeDept, owner);
  const deptName = (id?: string) => depts.find(d => d.id === id)?.path ?? id ?? '';

  const applyRole = async (role: Exclude<NodeRole, 'custom'>, deptId?: string) => {
    const next = roleSettings(role, deptId, caps);
    setBusy(true); setError('');
    if (next.mode !== mode) {
      const r = await putNodePermissionMode(cfg, node.node_id, next.mode);
      if (!r.ok) { setBusy(false); setError(saveErrorText(r)); return; }
      onModeSaved(next.mode);
    }
    if (grantsSupported) {
      const g = await putNodeGrants(cfg, node.node_id, next.grants);
      if (!g.ok) { setBusy(false); setError(g.message || g.error); return; }
      setGrants(g.grants);
      onGrantsSaved();
    }
    setBusy(false); setSaved('role'); setDeptPick(false);
  };
  const applyReach = async (target: Exclude<NodeReach, 'custom'>) => {
    setBusy(true); setError('');
    const r = await putNodeInboxAllowlist(cfg, node.node_id, reachInbox(target, nodeDept, owner));
    setBusy(false);
    if (!r.ok) { setError(allowlistErrorText(r)); return; }
    onInboxSaved('senders' in r ? r.senders : null);
    setSaved('reach');
  };

  const chooseRole = (role: Exclude<NodeRole, 'custom'>, deptId?: string) => {
    if (busy || !roleState) return;
    if (role === 'dept' && !deptId) { setDeptPick(true); return; }
    if (role === roleState.role && (role !== 'dept' || deptId === roleState.deptId)) return;
    if (roleState.role === 'custom') {
      setPending({ kind: 'role', role, deptId, message: t('nodePerm.simple.overwriteConfirm', { to: t(`nodePerm.simple.role.${role}`) }) });
      return;
    }
    void applyRole(role, deptId);
  };
  const chooseReach = (target: Exclude<NodeReach, 'custom'>) => {
    if (busy || target === reach) return;
    if (reachNarrows(reach, target) || reach === 'custom') {
      const to = t(`nodePerm.simple.reach.${target}`);
      setPending({ kind: 'reach', reach: target, message: reach === 'custom' ? t('nodePerm.simple.overwriteConfirm', { to }) : t('nodePerm.simple.narrowConfirm', { to }) });
      return;
    }
    void applyReach(target);
  };
  const confirmPending = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === 'role') void applyRole(p.role, p.deptId);
    else void applyReach(p.reach);
  };

  const card = { backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.sm } as const;
  const roleDisabled = (role: NodeRole): string | null =>
    (role === 'dept' || role === 'network') && !grantsSupported ? t('nodePerm.simple.noGrants')
      : role === 'dept' && depts.length === 0 ? t('nodePerm.simple.noDept') : null;
  const reachDisabled = (r: NodeReach): string | null =>
    r === 'dept' && !nodeDept ? t('nodePerm.simple.noDept')
      : (r === 'dept' || r === 'owner') && !owner ? t('nodePerm.simple.noOwner') : null;

  return (
    <View style={card} testID="node-perm-simple">
      <GroupTitle text={t('nodePerm.simple.roleTitle')} saved={saved === 'role'} savedText={t('nodePerm.simple.saved')} testID="node-perm-simple-role-title" />
      {roleState === null ? <ActivityIndicator size="small" color={colors.accent} /> : (
        <View style={{ gap: 8 }} accessibilityRole="radiogroup">
          {(['readonly', 'member', 'dept', 'network'] as const).map(role => {
            const on = roleState.role === role;
            const why = roleDisabled(role);
            return (
              <Choice key={role} testID={`node-perm-role-${role}`} on={on} disabled={!!why || busy}
                title={role === 'dept' && on && roleState.deptId ? `${t('nodePerm.simple.role.dept')} · ${deptName(roleState.deptId)}` : t(`nodePerm.simple.role.${role}`)}
                desc={why ?? t(`nodePerm.simple.role.${role}.desc`)}
                onPress={() => chooseRole(role)}>
                {role === 'dept' && (deptPick || on) && !why ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }} testID="node-perm-role-dept-picker">
                    {depts.map(d => {
                      const sel = on && roleState.deptId === d.id;
                      return (
                        <Pressable key={d.id} accessibilityRole="radio" accessibilityState={{ selected: sel, disabled: busy }} disabled={busy}
                          testID={`node-perm-role-dept-${d.id}`} onPress={() => chooseRole('dept', d.id)}
                          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: sel ? colors.accent : colors.border, backgroundColor: sel ? colors.tonalBg : 'transparent' }}>
                          <Text style={{ color: sel ? colors.accent : colors.text, fontSize: typeScale.small }}>{d.path}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </Choice>
            );
          })}
          {roleState.role === 'custom' ? <Choice testID="node-perm-role-custom" on disabled title={t('nodePerm.simple.role.custom')} desc={t('nodePerm.simple.role.custom.desc')} onPress={() => {}} /> : null}
        </View>
      )}

      <View style={{ height: spacing.sm }} />
      <GroupTitle text={t('nodePerm.simple.reachTitle')} saved={saved === 'reach'} savedText={t('nodePerm.simple.saved')} testID="node-perm-simple-reach-title" />
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        {(['all', 'dept', 'owner'] as const).map(r => {
          const why = reachDisabled(r);
          return (
            <Choice key={r} testID={`node-perm-reach-${r}`} on={reach === r} disabled={!!why || busy}
              title={t(`nodePerm.simple.reach.${r}`)}
              desc={why ?? t(`nodePerm.simple.reach.${r}.desc`, { owner: ownerName || t('nodePerm.simple.reach.owner') })}
              onPress={() => chooseReach(r)} />
          );
        })}
        <Choice testID="node-perm-reach-custom" on={reach === 'custom'} disabled title={t('nodePerm.simple.reach.custom')} desc={t('nodePerm.simple.reach.custom.desc')} onPress={() => {}} />
      </View>

      {pending ? (
        <View testID="node-perm-simple-confirm" style={{ marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.control, backgroundColor: colors.subtleFill, gap: spacing.sm }}>
          <Text style={{ color: colors.text, fontSize: typeScale.small, lineHeight: 20 }}>{pending.message}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable accessibilityRole="button" testID="node-perm-simple-confirm-ok" onPress={confirmPending}
              style={{ minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.control, backgroundColor: colors.accent }}>
              <Text style={{ color: colors.onAccent, fontSize: typeScale.small, fontWeight: weight.strong }}>{t('nodePerm.simple.confirm')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" testID="node-perm-simple-confirm-cancel" onPress={() => setPending(null)}
              style={{ minHeight: 34, justifyContent: 'center', paddingHorizontal: spacing.md }}>
              <Text style={{ color: colors.accent, fontSize: typeScale.small }}>{t('nodePerm.simple.cancel')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {error ? <Text testID="node-perm-simple-error" style={{ color: colors.failed, fontSize: typeScale.small, lineHeight: 18 }}>{error}</Text> : null}
    </View>
  );
}

function GroupTitle({ text, saved, savedText, testID }: { text: string; saved: boolean; savedText: string; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Text testID={testID} style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{text}</Text>
      {saved ? <Text accessibilityLiveRegion="polite" testID={`${testID}-saved`} style={{ color: colors.running, fontSize: typeScale.small }}>{savedText}</Text> : null}
    </View>
  );
}

function Choice({ testID, on, disabled, title, desc, onPress, children }: { testID: string; on: boolean; disabled: boolean; title: string; desc: string; onPress: () => void; children?: React.ReactNode }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} aria-checked={on} disabled={disabled && !on} onPress={disabled ? undefined : onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 11,
        borderRadius: radius.control, borderWidth: 1,
        borderColor: on ? colors.accent : colors.border,
        backgroundColor: on ? colors.tonalBg : (hovered || pressed) && !disabled ? colors.rowHover : 'transparent',
        opacity: disabled && !on ? 0.55 : 1,
      }]}>
      <View style={{ width: 16, height: 16, marginTop: 3, borderRadius: radius.pill, borderWidth: on ? 5 : 2, borderColor: on ? colors.accent : colors.border }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }}>{title}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small, lineHeight: 18, marginTop: 2 }}>{desc}</Text>
        {children}
      </View>
    </Pressable>
  );
}
