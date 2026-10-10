import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { fetchStatus, type HubConfig } from './api';
import { railBadgeText } from './rail-nav';
import { colors, onThemeChange, spacing, radius } from './theme';
import { usePoll } from './usePoll';
import { summarize } from './server-stats';
import { displayHubAddress } from './mask-hub-address';
import { badgeOffsetCentered, labelClearanceMargin } from './badge-anchor';
import { ds } from './ui-scale';
import { useTranslation } from './i18n-react';
import { PendingSegmentedTabs, type PendingTab } from './backend-pending-ui';
import { HUB_NAV, type HubScreen, type HubSection } from './hub-scope-demo';

export type ServerSection = 'overview' | 'nodes' | 'create' | 'logs' | PendingTab | HubScreen;

const MANAGEMENT: Array<{ key: 'overview' | 'nodes' | 'create' | 'logs'; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'overview', label: 'server.overview', icon: 'grid-outline' },
  { key: 'nodes', label: 'server.nodes', icon: 'git-network-outline' },
  { key: 'create', label: 'server.create', icon: 'add-circle-outline' },
  { key: 'logs', label: 'server.logs', icon: 'pulse-outline' },
];

const PENDING_TABS: PendingTab[] = ['skills', 'tokens', 'provider'];

export function isHubPendingSection(section: ServerSection): section is PendingTab {
  return (PENDING_TABS as readonly string[]).includes(section);
}

const HUB_ICONS: Record<HubSection, keyof typeof Ionicons.glyphMap> = {
  skills: 'sparkles-outline',
  tokens: 'key-outline',
  env: 'options-outline',
  providers: 'cloud-outline',
};

const HUB_ITEMS: Array<{ key: HubScreen; label: string; icon: keyof typeof Ionicons.glyphMap }> = HUB_NAV.map(item => ({
  key: item.screen,
  label: item.labelKey,
  icon: HUB_ICONS[item.section],
}));

export default function ServerSidebar({ cfg, active, onSelect }: {
  cfg: HubConfig;
  active: ServerSection;
  onSelect: (section: ServerSection) => void;
}) {
  const { t } = useTranslation();
  const pendingActive = isHubPendingSection(active) ? active : null;
  // 在线 / 总数 —— 与服务器页、Agent 列表分组头同一口径(server-stats.ts)。
  // 以前这里是 `sessions.length`,把全部已注册会话当成「在线节点」。
  const [counts, setCounts] = useState<{ online: number; total: number } | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await fetchStatus(cfg);
      const stats = summarize(result.sessions ?? []);
      setCounts({ online: stats.online, total: stats.total });
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, [cfg]);
  usePoll(load, 10000, [load]);

  // #649:侧栏常驻在桌面窗口里,一律打码(展开完整地址在「概览 → 连接 → 地址」的眼睛按钮)。
  const host = displayHubAddress(cfg.serverUrl, false);
  return (
    <View style={styles.root} testID="server-sidebar">
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.serverIcon, reachable === false && styles.serverIconFailed]}>
            <Ionicons name="server" size={18} color={colors.onAccent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{t('server.current')}</Text>
            <Text style={styles.host} numberOfLines={1} testID="server-sidebar-host">{host}</Text>
          </View>
        </View>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: reachable === false ? colors.failed : reachable ? colors.running : colors.textMuted }]} />
          <Text style={styles.status}>{t(reachable === null ? 'server.connecting' : reachable ? 'server.connected' : 'server.failed')}</Text>
          {counts === null ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Text style={styles.count}>{t('server.online', counts)}</Text>}
        </View>
      </View>

      <ScrollView style={styles.navScroll} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>{t('server.management')}</Text>
        <View style={styles.items}>
          {MANAGEMENT.map(item => (
            <Pressable
              key={item.key}
              testID={`server-nav-${item.key}`}
              accessibilityLabel={t('server.navLabel', { label: t(item.label) })}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [styles.item, active === item.key && styles.itemActive, pressed && { opacity: 0.65 }]}
            >
              <View style={styles.itemIcon} testID={`server-nav-icon-${item.key}`}>
                <Ionicons name={item.icon} size={ITEM_ICON_GLYPH} color={active === item.key ? colors.accent : colors.textSecondary} />
                {item.key === 'nodes' && railBadgeText(counts?.online ?? null) ? (
                  <View style={styles.badge} testID="server-nav-badge-nodes"><Text dense style={styles.badgeText}>{railBadgeText(counts?.online ?? null)}</Text></View>
                ) : null}
              </View>
              <Text style={[styles.itemText, active === item.key && styles.itemTextActive]} numberOfLines={1}>{t(item.label)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.pendingBlock}>
          <Text style={styles.sectionLabel} testID="server-integrations-label">{t('server.integrations')}</Text>
          <PendingSegmentedTabs
            stacked
            value={pendingActive}
            onChange={tab => onSelect(tab)}
            testID="server-pending-tabs"
            t={t}
          />
        </View>

        <Text style={styles.sectionLabel} testID="server-nav-hub">{t('server.hub')}</Text>
        <View style={styles.items}>
          {HUB_ITEMS.map(item => (
            <Pressable
              key={item.key}
              testID={`server-nav-${item.key}`}
              accessibilityLabel={t('server.navLabel', { label: t(item.label) })}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [styles.item, active === item.key && styles.itemActive, pressed && { opacity: 0.65 }]}
            >
              <View style={styles.itemIcon} testID={`server-nav-icon-${item.key}`}>
                <Ionicons name={item.icon} size={ITEM_ICON_GLYPH} color={active === item.key ? colors.accent : colors.textSecondary} />
              </View>
              <Text style={[styles.itemText, active === item.key && styles.itemTextActive]} numberOfLines={1}>{t(item.label)}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>{t('server.network')}</Text>
        <Text style={styles.footerValue} numberOfLines={1}>{cfg.networkId ?? 'default'}</Text>
      </View>
    </View>
  );
}

const ITEM_ICON_BOX = 24;
const ITEM_ICON_GLYPH = 18;
const ITEM_BADGE_H = 16;
/** 「99+」 at 9 px with 4 px padding (measured 28.1 px in the web build). */
const ITEM_BADGE_MAX_W = 29;

const makeStyles = () =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  serverIcon: { width: 36, height: 36, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  serverIconFailed: { backgroundColor: colors.failed },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  host: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: 7 },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  status: { color: colors.textSecondary, fontSize: 11 },
  count: { color: colors.textMuted, fontSize: 11, marginLeft: 'auto' },
  navScroll: { flex: 1 },
  navContent: { paddingBottom: spacing.md },
  sectionLabel: { color: colors.textMuted, fontSize: 11, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  items: { paddingHorizontal: spacing.sm, gap: 3 },
  pendingBlock: { marginTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  item: { height: 42, borderRadius: radius.item, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // 极简:二级导航的选中态用中性 rowActive(与会话列表一致);强调色只留给最左侧 rail。
  itemActive: { backgroundColor: colors.rowActive },
  // The badge grows outward, toward the label: keep the label clear of the widest badge.
  itemIcon: {
    width: ITEM_ICON_BOX, height: ITEM_ICON_BOX, alignItems: 'center', justifyContent: 'center',
    marginRight: labelClearanceMargin(badgeOffsetCentered(ITEM_ICON_BOX, ITEM_ICON_BOX, ds(ITEM_ICON_GLYPH), ITEM_BADGE_H).left, ITEM_BADGE_MAX_W, ITEM_ICON_BOX, spacing.md),
  },
  itemText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  itemTextActive: { color: colors.text, fontWeight: '600' },
  // 角标:图标右上角的小圆标(与桌面 rail 同款),不再是行尾灰字。左缘锚在图标右上角内侧一点
  // (badge-anchor.ts),「99+」变宽时向外长,不再盖住图标。
  badge: { position: 'absolute', ...badgeOffsetCentered(ITEM_ICON_BOX, ITEM_ICON_BOX, ds(ITEM_ICON_GLYPH), ITEM_BADGE_H), minWidth: ITEM_BADGE_H, height: ITEM_BADGE_H, borderRadius: radius.pill, paddingHorizontal: 4, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.onAccent, fontSize: 9, fontWeight: '600', lineHeight: 12 },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg },
  footerLabel: { color: colors.textMuted, fontSize: 10 },
  footerValue: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
});

// 🔴 模块级 StyleSheet 是在 import 那一刻按当时的 colors 算死的。
// 不重建的话,这个文件永远停在 DARK —— 白色主题下侧栏/弹窗仍是黑的。
// 同 ServerScreen.tsx 的写法;有一道测试守着,见 theme-restyle-coverage.test.ts。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
