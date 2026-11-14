// 设置 →「组织与权限」(2026-11-14):一个入口,两个页签。页签逻辑在 org-access-model.ts;
// 两页的内容仍是原来的组件(AgentOrgScreen / UserManagementPanel),Hub 接口与数据都不变。
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useTranslation } from './i18n-react';
import { settingsText } from './i18n-settings';
import { ORG_ACCESS_TAB_LABEL, orgAccessTabs, resolveOrgAccessTab, type OrgAccessTab } from './org-access-model';

// 点进成员再返回会重新挂载这一页;记住上次的页签,别把人弹回第一页。
let lastTab: OrgAccessTab | null = null;

export default function OrgAccessPage({ canManageMembers, initialTab, renderOrg, renderMembers }: {
  canManageMembers: boolean;
  initialTab?: OrgAccessTab | null;
  renderOrg: () => ReactNode;
  renderMembers: () => ReactNode;
}) {
  useTranslation();
  const tabs = orgAccessTabs(canManageMembers);
  const [want, setWantState] = useState<OrgAccessTab | null>(initialTab ?? lastTab);
  const setWant = (k: OrgAccessTab) => { lastTab = k; setWantState(k); };
  const tab = resolveOrgAccessTab(want, tabs);
  return (
    <View testID="org-access-page">
      {tabs.length > 1 ? (
        <View style={styles.tabs} accessibilityRole="tablist" testID="org-access-tabs">
          {tabs.map(k => (
            <Pressable
              key={k}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === k }}
              aria-selected={tab === k}
              onPress={() => setWant(k)}
              style={({ pressed }) => [styles.tab, tab === k && styles.tabOn, pressed && styles.pressed]}
              testID={`org-access-tab-${k}`}
            >
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{settingsText(ORG_ACCESS_TAB_LABEL[k])}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View testID={`org-access-panel-${tab}`}>{tab === 'members' ? renderMembers() : renderOrg()}</View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  tabs: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: colors.subtleFill, borderRadius: radius.control, padding: 3, marginBottom: spacing.md, gap: 2 },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.control },
  tabOn: { backgroundColor: colors.card },
  tabText: { fontSize: 14, color: colors.textMuted },
  tabTextOn: { color: colors.text, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
