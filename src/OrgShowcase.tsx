// 「组织 → 架构图」(管理员 2026-11-15「组织架构图做好看一点，还需要有那种宣传效果」)。
//
// 能直接截图拿去宣传的一页:
//   ① 品牌色横幅:一句标语 + 四个大数字(Agent / 部门 / 运行中 / 负责人)+ 头像墙;
//   ② 架构树:顶上「组织」根节点,一条总线连到每个根部门一栏;根部门是一张带主题色的卡(头像叠、人数、运行数),
//      子部门(任意层)挂在下面,竖线 + 短横线连着;「未归属」是最后一栏的虚线卡。
//   ③ 点任何部门卡 → 回到列表视图、选中那个部门(onOpenDept)。
// 数据只用组织页已有的那份(org-showcase-model.ts),不多读接口。颜色:横幅和每栏主题色是品牌色,浅深色都用同一组。
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, onThemeChange, radius, spacing, type as typeScale } from './theme';
import { useTranslation } from './i18n-react';
import type { AgentOrgData, PlacedAgent } from './agent-org-model';
import { pickAvatars, showcaseColumns, showcaseStats, type ShowcaseColumn } from './org-showcase-model';

/** 栏宽跟着可用宽度走(放得下就不横向滚),夹在 MIN..MAX 之间;实在放不下才横向滚。 */
const COL_MIN = 188;
const COL_MAX = 260;
const COL_GAP = 20;
const HERO_GRADIENT = 'linear-gradient(135deg, #0b2f73 0%, #1b65db 48%, #0891b2 100%)';
const HERO_BASE = '#1b65db';
const ON_HERO = '#ffffff';

function gradient(css: string, base: string): ViewStyle {
  return Platform.OS === 'web'
    ? ({ backgroundColor: base, backgroundImage: css } as ViewStyle)
    : ({ backgroundColor: base, experimental_backgroundImage: css } as ViewStyle);
}

/** hex + 透明度(两位十六进制)。 */
const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

export default function OrgShowcase(p: { data: AgentOrgData; placed: PlacedAgent[]; title: string; onOpenDept: (id: string | null) => void }) {
  const { t } = useTranslation();
  const stats = showcaseStats(p.data, p.placed);
  const columns = showcaseColumns(p.data, p.placed);
  const cloud = pickAvatars(p.placed, 9);
  const n = columns.length + (stats.unassigned > 0 ? 1 : 0);
  const [avail, setAvail] = useState(0);
  const COL_W = Math.round(Math.max(COL_MIN, Math.min(COL_MAX, avail && n ? (avail - Math.max(0, n - 1) * COL_GAP) / n : COL_MAX)));
  const rowW = n * COL_W + Math.max(0, n - 1) * COL_GAP;
  return (
    <ScrollView testID="org-showcase" style={{ flex: 1, minHeight: 0 }} contentContainerStyle={styles.page}>
      <View testID="org-showcase-hero" style={[styles.hero, gradient(HERO_GRADIENT, HERO_BASE)]}>
        <View style={styles.heroTop}>
          <View style={{ flex: 1, minWidth: 240, gap: spacing.sm }}>
            <Text style={styles.kicker}>{t('agentOrg.showcase.kicker')}</Text>
            <Text style={styles.heroTitle}>{t('agentOrg.showcase.headline')}</Text>
            <Text style={styles.heroSub}>{t('agentOrg.showcase.sub', { agents: stats.agents, departments: stats.departments, running: stats.running })}</Text>
          </View>
          {cloud.aliases.length ? <View style={styles.cloud} testID="org-showcase-cloud">
            {cloud.aliases.map((alias, i) => (
              <View key={alias} style={[styles.cloudAvatar, i > 0 && { marginLeft: -14 }]}><AliasAvatar alias={alias} size={44} /></View>
            ))}
            {cloud.more ? <View style={[styles.cloudAvatar, styles.cloudMore, { marginLeft: -14 }]}><Text style={styles.cloudMoreText}>+{cloud.more}</Text></View> : null}
          </View> : null}
        </View>
        <View style={styles.stats}>
          <Stat value={stats.agents} label={t('agentOrg.showcase.agents')} icon="sparkles-outline" testID="org-showcase-stat-agents" />
          <Stat value={stats.departments} label={t('agentOrg.showcase.departments')} icon="git-network-outline" testID="org-showcase-stat-departments" />
          <Stat value={stats.running} label={t('agentOrg.showcase.running')} icon="pulse-outline" testID="org-showcase-stat-running" />
          <Stat value={stats.owners} label={t('agentOrg.showcase.owners')} icon="people-outline" testID="org-showcase-stat-owners" />
        </View>
      </View>

      <View style={styles.chartCard} testID="org-showcase-chart" onLayout={e => setAvail(Math.max(0, e.nativeEvent.layout.width - 2 * spacing.lg - 2))}>
        <View style={styles.chartHead}>
          <Text style={styles.chartTitle}>{t('agentOrg.showcase.chartTitle')}</Text>
          <Text style={styles.chartHint}>{t('agentOrg.showcase.chartHint')}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, minWidth: '100%', justifyContent: 'center' }}>
          <View style={{ width: Math.max(rowW, COL_W) }}>
            <View style={styles.rootWrap}>
              <View style={[styles.root, gradient(HERO_GRADIENT, HERO_BASE)]} testID="org-showcase-root">
                <Ionicons name="git-network-outline" size={18} color={ON_HERO} />
                <Text style={styles.rootText}>{p.title}</Text>
                <Text style={styles.rootCount}>{stats.agents}</Text>
              </View>
              {n > 0 ? <View style={styles.rootStem} /> : null}
            </View>
            {n > 1 ? <View style={[styles.bus, { left: COL_W / 2, width: rowW - COL_W }]} /> : null}
            <View style={{ flexDirection: 'row', gap: COL_GAP, alignItems: 'flex-start' }}>
              {columns.map(col => <Column key={col.dept.id} col={col} width={COL_W} onOpen={p.onOpenDept} />)}
              {stats.unassigned > 0 ? (
                <View style={{ width: COL_W }}>
                  <View style={[styles.stem, { backgroundColor: colors.border }]} />
                  <Pressable testID="org-showcase-unassigned" accessibilityRole="button" onPress={() => p.onOpenDept(null)}
                    style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.unassigned, hovered && { borderColor: colors.blocked }]}>
                    <Ionicons name="file-tray-outline" size={18} color={colors.blocked} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.deptName}>{t('agentOrg.unowned')}</Text>
                      <Text style={styles.deptMeta}>{t('agentOrg.agentsCount', { count: stats.unassigned })}</Text>
                    </View>
                    <Text style={{ color: colors.blocked, fontSize: typeScale.small, fontWeight: '600' }}>{t('agentOrg.showcase.assign')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </View>
      <Text style={styles.footer}>{t('agentOrg.showcase.footer')}</Text>
    </ScrollView>
  );
}

function Stat(p: { value: number; label: string; icon: 'sparkles-outline' | 'git-network-outline' | 'pulse-outline' | 'people-outline'; testID: string }) {
  return <View style={styles.stat} testID={p.testID}>
    <View style={styles.statIcon}><Ionicons name={p.icon} size={16} color={ON_HERO} /></View>
    <Text style={styles.statValue}>{p.value.toLocaleString()}</Text>
    <Text style={styles.statLabel}>{p.label}</Text>
  </View>;
}

function AvatarStack(p: { aliases: string[]; more: number; size: number; ring: string }) {
  if (!p.aliases.length) return null;
  return <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    {p.aliases.map((alias, i) => (
      <View key={alias} style={{ marginLeft: i ? -p.size / 3 : 0, borderRadius: radius.pill, borderWidth: 2, borderColor: p.ring }}><AliasAvatar alias={alias} size={p.size} /></View>
    ))}
    {p.more ? <View style={{ marginLeft: -p.size / 3, height: p.size + 4, minWidth: p.size + 4, paddingHorizontal: 4, borderRadius: radius.pill, borderWidth: 2, borderColor: p.ring, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.textSecondary, fontSize: typeScale.caption, fontWeight: '600' }}>+{p.more}</Text>
    </View> : null}
  </View>;
}

function Column(p: { col: ShowcaseColumn; width: number; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { col } = p;
  return <View style={{ width: p.width }} testID={`org-showcase-col-${col.dept.id}`}>
    <View style={[styles.stem, { backgroundColor: col.hue }]} />
    <Pressable testID={`org-showcase-dept-${col.dept.id}`} accessibilityRole="button" accessibilityLabel={`${col.dept.name}, ${t('agentOrg.agentsCount', { count: col.total })}`} onPress={() => p.onOpen(col.dept.id)}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.deptCard, { borderTopColor: col.hue }, (hovered || pressed) && { borderColor: alpha(col.hue, 0.6), borderTopColor: col.hue }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={[styles.deptIcon, { backgroundColor: alpha(col.hue, 0.14) }]}><Ionicons name="business-outline" size={16} color={col.hue} /></View>
        <Text numberOfLines={1} style={[styles.deptName, { flex: 1, minWidth: 0, fontSize: typeScale.title }]}>{col.dept.name}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={styles.deptBig}>{col.total}</Text>
        <Text numberOfLines={1} style={[styles.deptMeta, { flexShrink: 0 }]}>{t('agentOrg.showcase.agentsShort')}</Text>
        {col.running ? <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>{t('agentOrg.showcase.runningShort', { count: col.running })}</Text></View> : null}
      </View>
      <AvatarStack aliases={col.avatars} more={col.more} size={26} ring={colors.card} />
    </Pressable>
    {col.children.length ? <View style={[styles.children, { borderLeftColor: alpha(col.hue, 0.35) }]}>
      {col.children.map(ch => (
        <View key={ch.dept.id} style={{ flexDirection: 'row', alignItems: 'center', marginLeft: (ch.depth - 1) * 14 }}>
          <View style={[styles.branch, { backgroundColor: alpha(col.hue, 0.35) }]} />
          <Pressable testID={`org-showcase-dept-${ch.dept.id}`} accessibilityRole="button" accessibilityLabel={`${ch.dept.name}, ${t('agentOrg.agentsCount', { count: ch.total })}`} onPress={() => p.onOpen(ch.dept.id)}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.childChip, (hovered || pressed) && { borderColor: alpha(col.hue, 0.6) }]}>
            <View style={[styles.childDot, { backgroundColor: col.hue }]} />
            <Text numberOfLines={1} style={styles.childName}>{ch.dept.name}</Text>
            <AvatarStack aliases={ch.avatars} more={0} size={16} ring={colors.card} />
            <Text style={styles.childCount}>{ch.total}</Text>
          </Pressable>
        </View>
      ))}
    </View> : null}
  </View>;
}

const makeStyles = () => StyleSheet.create({
  page: { padding: spacing.xl, gap: spacing.xl },
  hero: { borderRadius: radius.surface, padding: spacing.xl, gap: spacing.xl, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xl },
  kicker: { color: ON_HERO, opacity: 0.75, fontSize: typeScale.small, fontWeight: '600', letterSpacing: 1.5 },
  heroTitle: { color: ON_HERO, fontSize: 30, lineHeight: 38, fontWeight: '600' },
  heroSub: { color: ON_HERO, opacity: 0.85, fontSize: typeScale.title, lineHeight: 24 },
  cloud: { flexDirection: 'row', alignItems: 'center' },
  cloudAvatar: { borderRadius: radius.pill, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' },
  cloudMore: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' },
  cloudMoreText: { color: ON_HERO, fontSize: typeScale.small, fontWeight: '600' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { flexGrow: 1, flexBasis: 140, padding: spacing.md, gap: 2, borderRadius: radius.control, backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  statIcon: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: spacing.xs },
  statValue: { color: ON_HERO, fontSize: 32, lineHeight: 38, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statLabel: { color: ON_HERO, opacity: 0.8, fontSize: typeScale.small },
  chartCard: { borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  chartHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: spacing.sm, padding: spacing.lg },
  chartTitle: { color: colors.text, fontSize: typeScale.heading, fontWeight: '600' },
  chartHint: { color: colors.textMuted, fontSize: typeScale.small },
  rootWrap: { alignItems: 'center' },
  root: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill },
  rootText: { color: ON_HERO, fontSize: typeScale.title, fontWeight: '600' },
  rootCount: { color: ON_HERO, fontSize: typeScale.small, fontWeight: '600', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  rootStem: { width: 2, height: 22, backgroundColor: colors.border },
  bus: { height: 2, backgroundColor: colors.border },
  stem: { width: 2, height: 22, alignSelf: 'center' },
  deptCard: { backgroundColor: colors.card, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, borderTopWidth: 4, padding: spacing.md, gap: spacing.sm },
  deptIcon: { width: 30, height: 30, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  deptName: { color: colors.text, fontSize: typeScale.body, fontWeight: '600' },
  deptBig: { color: colors.text, fontSize: 26, lineHeight: 30, fontWeight: '600', fontVariant: ['tabular-nums'] },
  deptMeta: { color: colors.textMuted, fontSize: typeScale.small },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.subtleFill },
  liveDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.running },
  liveText: { color: colors.textSecondary, fontSize: typeScale.caption },
  children: { marginLeft: 18, marginTop: spacing.xs, borderLeftWidth: 2, paddingVertical: spacing.xs, gap: spacing.xs },
  branch: { width: 12, height: 2 },
  childChip: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 32, paddingHorizontal: spacing.sm, borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  childDot: { width: 6, height: 6, borderRadius: radius.pill },
  childName: { flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.small },
  childCount: { color: colors.textMuted, fontSize: typeScale.caption, fontVariant: ['tabular-nums'], minWidth: 18, textAlign: 'right' },
  unassigned: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.control, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.card },
  footer: { color: colors.textMuted, fontSize: typeScale.small, textAlign: 'center' },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
