// 设置 →「组织与权限」(2026-11-14):一个入口,两个页签。页签逻辑在 org-access-model.ts;
// 两页的内容仍是原来的组件(AgentOrgScreen / UserManagementPanel),Hub 接口与数据都不变。
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useTranslation } from './i18n-react';
import { settingsText } from './i18n-settings';
import { ORG_ACCESS_TAB_LABEL, orgAccessTabs, rememberedTab, resolveOrgAccessTab, type OrgAccessTab } from './org-access-model';

// 点进成员再返回会重新挂载这一页;记住上次的页签,别把人弹回第一页。按账号 + 网络记(rememberedTab)。
let lastTab: { scope: string; tab: OrgAccessTab } | null = null;

export default function OrgAccessPage({ canManageMembers, initialTab, scope = '', detailOpen = false, renderOrg, renderMembers }: {
  canManageMembers: boolean;
  /**
   * 手机:成员 / 分组三级页开着。成员面板必须留在**同一个树位置**,否则点成员时它被重新挂载、
   * 「正在编辑谁」这份状态丢掉,三级页打不开(#1432 stub drive test-member-editor 抓到)。
   * 所以三级页开着时不换组件,只藏页签条、强制停在成员页。
   */
  detailOpen?: boolean;
  /** 账号 + 网络:换了就不沿用上次的页签。 */
  scope?: string;
  initialTab?: OrgAccessTab | null;
  renderOrg: () => ReactNode;
  renderMembers: () => ReactNode;
}) {
  useTranslation();
  const tabs = orgAccessTabs(canManageMembers);
  const [want, setWantState] = useState<OrgAccessTab | null>(initialTab ?? rememberedTab(lastTab, scope));
  const setWant = (k: OrgAccessTab) => { lastTab = { scope, tab: k }; setWantState(k); };
  // 桌面:已经站在这页时原地搜索,initialTab 跟着搜索词变;只在非空时跟,不覆盖手动点的页签(#1432 审阅)。
  useEffect(() => { if (initialTab) setWantState(initialTab); }, [initialTab]);
  const tab = detailOpen && canManageMembers ? 'members' : resolveOrgAccessTab(want, tabs);
  return (
    <View testID="org-access-page">
      {tabs.length > 1 && !detailOpen ? (
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
