// 一级栏「组织」→ 部门详情的「成员」页签(管理员 2026-11-15「这个 UI/UX 体验非常不好」:
// 以前人在部门里的管理只在「成员与权限」里,而那里又嵌了一棵部门树,和左边侧栏并排两棵)。
// 现在:部门由左侧栏选,这里画选中部门的人 —— 负责人、部门群、直属成员(调动 / 设为负责人 / 移出 / 添加成员)。
// 数据:部门树 + 网络成员各读一次(和 UserManagementPanel 同一组接口);改完重读部门树。
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Text } from './ui-text';
import { colors, spacing, type as typeScale } from './theme';
import type { HubConfig } from './api';
import { fetchOrg } from './org-api';
import { fetchNetworkMembers } from './user-admin-api';
import type { NetworkMember } from './user-admin';
import type { DeptKey, OrgData } from './org-model';
import { OrgDesktopPanel } from './OrgChart';
import { t } from './i18n';

export default function OrgDeptPeople(p: { cfg: HubConfig; networkId: string; networkName: string; deptId: DeptKey; onSelect: (id: DeptKey) => void }) {
  const [org, setOrg] = useState<OrgData | null | undefined>(undefined);
  const [members, setMembers] = useState<NetworkMember[] | null | undefined>(undefined);
  const reloadOrg = useCallback(() => { void fetchOrg(p.cfg, p.networkId).then(setOrg).catch(() => setOrg(null)); }, [p.cfg, p.networkId]);
  useEffect(() => {
    reloadOrg();
    void fetchNetworkMembers(p.cfg, p.networkId).then(setMembers).catch(() => setMembers(null));
  }, [p.cfg, p.networkId, reloadOrg]);
  if (org === undefined || members === undefined) return <View testID="org-dept-people-loading" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl }}><ActivityIndicator size="large" color={colors.accent} /><Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{t('agentOrg.people.loading')}</Text></View>;
  if (!org || !members) return <Note testID="org-dept-people-unavailable" text={t('agentOrg.people.unavailable')} />;
  return <OrgDesktopPanel cfg={p.cfg} networkId={p.networkId} networkName={p.networkName} org={org} people={members} onChanged={reloadOrg} embed={{ selected: p.deptId, onSelect: p.onSelect }} />;
}

function Note(p: { text: string; testID: string }) {
  return <View testID={p.testID} style={{ padding: spacing.xl, alignItems: 'center' }}><Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>{p.text}</Text></View>;
}
