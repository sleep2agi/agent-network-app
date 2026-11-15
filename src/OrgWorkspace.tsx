// 桌面左侧一级栏「组织」(管理员 2026-11-15「移到一级啊」):把设置里的「组织与权限」整页搬到主窗口,
// 占满右侧(不要会话侧栏)。内容就是设置里那一页(OrgAccessPage:部门与 Agent / 成员与权限),
// 身份(/api/auth/me)自己读一次,权限判断与设置页同一套(canManageUsers)。
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from './icons';
import NodeDetailScreen from './NodeDetailScreen';
import type { ScheduleOpenRequest } from './node-schedules';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useTranslation } from './i18n-react';
import { t } from './i18n';
import type { HubConfig } from './api';
import AgentOrgScreen from './AgentOrgScreen';
import UserManagementPanel from './UserManagementPanel';
import OrgDeptPeople from './OrgDeptPeople';
import { fetchAuthMe } from './user-admin-api';
import { canManageUsers, type AuthMe } from './user-admin';

export default function OrgWorkspace({ cfg, onOpenScheduled }: { cfg: HubConfig; onOpenScheduled?: (request: ScheduleOpenRequest) => void }) {
  useTranslation();
  // 管理员 2026-11-15「点击 AGENT,设置不了权限什么鬼」:点 Agent 行 → 在这一页里打开它的节点页(落在「权限」),
  // 左上「← 组织」回来。组织页不卸载(只藏起来),回来时部门、搜索、滚动位置都还在。
  const [openAlias, setOpenAlias] = useState<string | null>(null);
  const [authMe, setAuthMe] = useState<AuthMe | null>(null);
  const [networkId, setNetworkId] = useState<string | undefined>(cfg.networkId);
  useEffect(() => {
    let alive = true;
    void fetchAuthMe(cfg).then((d: any) => {
      if (!alive) return;
      const net = d?.networks?.find((n: any) => n.network_id === cfg.networkId) ?? d?.networks?.[0];
      setAuthMe(d ?? null);
      setNetworkId(net?.network_id ?? cfg.networkId);
    }).catch(() => { /* 读不到身份 ⇒ 按普通成员只读显示 */ });
    return () => { alive = false; };
  }, [cfg]);
  const canManage = canManageUsers(authMe, networkId);
  const scope = `${cfg.serverUrl}|${authMe?.user?.user_id ?? ''}|${networkId ?? ''}`;
  const networkName = (authMe as any)?.networks?.find((n: any) => n.network_id === networkId)?.network_name || networkId || '';
  return (
    <View style={styles.shell} testID="org-workspace">
      {/* 管理员 2026-11-15「做的更好一下」:左边整条侧栏(标题「组织」+「成员与权限」+ 部门树),右边内容;不再套标题行和页签。 */}
      <View style={[styles.root, openAlias ? styles.hidden : null]}>
        <AgentOrgScreen cfg={cfg} networkId={networkId} phone={false} canManageStructure={canManage} fullWidth onOpenAgent={setOpenAlias}
          title={t('nav.org')}
          renderMembers={canManage ? () => <UserManagementPanel key={scope} cfg={cfg} me={authMe} networkId={networkId} hideOrg /> : undefined}
          renderPeople={canManage && networkId ? (deptId, onSelect) => <OrgDeptPeople key={scope} cfg={cfg} networkId={networkId} networkName={networkName} deptId={deptId} onSelect={onSelect} /> : undefined} />
      </View>
      {openAlias ? (
        <View style={styles.detail} testID="org-agent-detail">
          <View style={styles.crumbs}>
            <Pressable testID="org-agent-detail-back" accessibilityRole="button" accessibilityLabel={t('agentOrg.backToOrg')} onPress={() => setOpenAlias(null)}
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.crumbBack, (hovered || pressed) && { backgroundColor: colors.rowHover }]}>
              <Ionicons name="chevron-back" size={16} color={colors.accent} />
              <Text style={styles.crumbBackText}>{t('agentOrg.backToOrg')}</Text>
            </Pressable>
            <Text style={styles.crumbSep}>/</Text>
            <Text numberOfLines={1} style={styles.crumbHere}>{openAlias}</Text>
          </View>
          <NodeDetailScreen key={openAlias} cfg={cfg} alias={openAlias} desktop initialSection="permissions" onBack={() => setOpenAlias(null)} onOpenScheduled={onOpenScheduled} />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  // 整页不滚:标题 + 页签一行,下面的组织卡片撑到窗口底,树和列表各自滚(2026-11-15 UI/UX)。
  shell: { flex: 1, minHeight: 0, backgroundColor: colors.bg },
  hidden: { display: 'none' },
  detail: { flex: 1, minHeight: 0 },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  crumbBack: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.item },
  crumbBackText: { color: colors.accent, fontSize: 14, fontWeight: '500' },
  crumbSep: { color: colors.textMuted, fontSize: 14 },
  crumbHere: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  root: { flex: 1, minHeight: 0, backgroundColor: colors.bg },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
