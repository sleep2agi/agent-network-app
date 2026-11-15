// 桌面左侧一级栏「组织」(管理员 2026-11-15「移到一级啊」):把设置里的「组织与权限」整页搬到主窗口,
// 占满右侧(不要会话侧栏)。内容就是设置里那一页(OrgAccessPage:部门与 Agent / 成员与权限),
// 身份(/api/auth/me)自己读一次,权限判断与设置页同一套(canManageUsers)。
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, spacing, weight } from './theme';
import { useTranslation } from './i18n-react';
import { t } from './i18n';
import type { HubConfig } from './api';
import AgentOrgScreen from './AgentOrgScreen';
import OrgAccessPage from './OrgAccessPage';
import UserManagementPanel from './UserManagementPanel';
import { fetchAuthMe } from './user-admin-api';
import { canManageUsers, type AuthMe } from './user-admin';

export default function OrgWorkspace({ cfg }: { cfg: HubConfig }) {
  useTranslation();
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
  return (
    <View style={styles.root} testID="org-workspace">
      <OrgAccessPage
        fill
        header={<Text style={styles.title} accessibilityRole="header">{t('nav.org')}</Text>}
        canManageMembers={canManage}
        scope={scope}
        renderOrg={() => <AgentOrgScreen cfg={cfg} networkId={networkId} phone={false} canManageStructure={canManage} fullWidth />}
        renderMembers={() => <ScrollView style={styles.scroll}><UserManagementPanel cfg={cfg} me={authMe} networkId={networkId} /></ScrollView>}
      />
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  // 整页不滚:标题 + 页签一行,下面的组织卡片撑到窗口底,树和列表各自滚(2026-11-15 UI/UX)。
  root: { flex: 1, minHeight: 0, backgroundColor: colors.bg, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  title: { color: colors.text, fontSize: 20, fontWeight: weight.strong },
  scroll: { flex: 1, minHeight: 0 },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
