// #3665 —— 管理员角色的「范围」：全部 / 仅某部门（Hub #3721 契约）。
//
// 落点：MemberEditor 的「成员·xxx」弹窗里，管理员那一栏原来是一句写死的提示。
// 现在：GET /api/users/:user_id/grants 读当前范围 → 选「全部 / 仅某部门」→
// PUT 整份 grants（只替换 manage_nodes 那一组，其它 capability 原样保留）。
//
// 负责人要求：部门负责人只能授自己子树内的部门 —— 候选先按 /api/auth/me 的
// managed_department_ids 过滤，不等到 403 才告诉用户。
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { fetchUserGrants, putUserGrants, type HubConfig } from './api';
import { fetchOrg } from './org-api';
import {
  departmentScopeErrorText,
  filterGrantableDepartments,
  grantErrorText,
  mergeUserGrants,
  scopeFromGrants,
  validateDepartmentScope,
  type DepartmentNode,
  type DepartmentScopeMode,
} from './member-department-grant';
import { deptScopeFor } from './create-node-department';
import type { AuthMe } from './user-admin';
import { SectionLabel, Segmented } from './MemberEditorKit';
import { colors, radius, spacing } from './theme';

export default function MemberAdminScope(props: { cfg: HubConfig; networkId: string; userId: string; me: AuthMe | null }) {
  const { cfg, networkId, userId, me } = props;
  const [loading, setLoading] = useState(true);
  const [grants, setGrants] = useState<Array<{ capability: string; scope_kind: string; scope_id: string; level: string }>>([]);
  const [mode, setMode] = useState<DepartmentScopeMode>('all');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DepartmentNode[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void Promise.all([fetchUserGrants(cfg, userId), fetchOrg(cfg, networkId).catch(() => null)]).then(([read, org]) => {
      if (!live) return;
      const scope = read.ok ? scopeFromGrants(read.grants) : { mode: 'all' as DepartmentScopeMode, departmentId: null };
      setGrants(read.ok ? read.grants : []);
      setMode(scope.mode);
      setDepartmentId(scope.departmentId);
      const deptScope = deptScopeFor(me, networkId, org ? { departments: org.departments as never, members: org.members as never } : null);
      const nodes: DepartmentNode[] = (org?.departments ?? []).map(d => ({ id: d.id, name: d.name }));
      // 部门负责人（不是 network owner/admin）只给自己子树内的部门；其它角色不过滤。
      setDepartments(filterGrantableDepartments(nodes, deptScope.all ? [] : deptScope.managed));
      if (!read.ok) setError(grantErrorText(read.error));
      setLoading(false);
    });
    return () => { live = false; };
  }, [cfg.serverUrl, cfg.profileId, cfg.token, networkId, userId]);

  const modeOptions = useMemo(() => ([
    { value: 'all' as const, label: '全部（默认管理员）' },
    { value: 'department' as const, label: '仅某部门' },
  ]), []);

  const save = async () => {
    if (busy) return;
    const check = validateDepartmentScope({ mode, departmentId });
    if (!check.ok) { setError(departmentScopeErrorText(check.error)); return; }
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await putUserGrants(cfg, userId, mergeUserGrants(grants, { mode, departmentId }));
    setBusy(false);
    if (!res.ok) {
      setError(grantErrorText(res.error));
      return;
    }
    setGrants(res.grants);
    const scope = scopeFromGrants(res.grants);
    setMode(scope.mode);
    setDepartmentId(scope.departmentId);
    setNotice(scope.mode === 'all' ? '已设为「全部」（默认管理员权限）' : '已设为「仅某部门」');
  };

  return (
    <View style={{ marginTop: spacing.sm }} testID="member-admin-scope">
      <SectionLabel>管理范围</SectionLabel>
      {loading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>正在读取当前范围…</Text>
        </View>
      ) : (
        <>
          <Segmented options={modeOptions} value={mode} onChange={value => { setMode(value); setError(null); setNotice(null); }} label="管理范围" testID="member-admin-scope-mode" />
          {mode === 'department' ? (
            <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="member-admin-scope-departments">
              {departments.length === 0 ? (
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>没有可选的部门（可能你不是任何部门的负责人）。</Text>
              ) : departments.map(d => (
                <Pressable
                  key={d.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: departmentId === d.id }}
                  onPress={() => { setDepartmentId(d.id); setError(null); setNotice(null); }}
                  testID={`member-admin-scope-dept-${d.id}`}
                >
                  <Text style={{
                    color: departmentId === d.id ? colors.accent : colors.textMuted,
                    fontSize: 12, paddingHorizontal: 8, paddingVertical: 4,
                    backgroundColor: colors.inputBg, borderRadius: radius.item,
                    borderWidth: StyleSheet.hairlineWidth, borderColor: departmentId === d.id ? colors.accent : 'transparent',
                  }}>{d.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Pressable testID="member-admin-scope-save" accessibilityRole="button" accessibilityState={{ busy, disabled: busy }} onPress={() => { void save(); }}>
              <Text style={{ color: colors.accent, fontSize: 12 }}>{busy ? '保存中…' : '保存管理范围'}</Text>
            </Pressable>
            {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
          </View>
          {error ? <Text testID="member-admin-scope-error" style={{ color: colors.failed, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
          {notice ? <Text testID="member-admin-scope-notice" style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{notice}</Text> : null}
          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>
            「全部」= 默认管理员（全网可见）；「仅某部门」只看见并管理该部门（含子部门）及其中的节点；不属于任何部门的节点只有全网管理员能看到。
          </Text>
        </>
      )}
    </View>
  );
}

