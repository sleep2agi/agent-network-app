// 「组织 → 架构图」(管理员 2026-11-15「组织架构图做好看一点，还需要有那种宣传效果」)。
//
// 能直接截图拿去宣传的一页:
//   ① 顶部概览:一句标语 + 四个大数字(Agent / 部门 / 运行中 / 负责人)+ 头像墙;
//   ② 架构树:顶上根节点,一条总线连到每个子部门一栏;每栏是一张带主题色的卡(头像叠、人数、运行数),
//      下级部门(任意层)挂在下面;整个组织那一层「未归属」是最后一栏的虚线卡。
//   ③ 下钻(管理员「点击这里能下钻吗」):点部门卡 / 下级部门 → 以它为根重画(面包屑「组织 › TMAI › …」能回去);
//      到了没有下级部门的部门,画它的 Agent 卡片墙(点卡片打开该节点页)。「在列表中查看」回到列表视图。
// 颜色(管理员「这个蓝色 AI 感太重了」):概览不再是蓝青渐变,改成跟页面同一套的卡片面 + 正文色;
//   每栏主题色是低饱和的大地色系(org-showcase-model.ts DEPT_HUES)。
// 数据只用组织页已有的那份,不多读接口。
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { BrandMark } from './brand-mark';
import { colors, onThemeChange, radius, spacing, type as typeScale } from './theme';
import { useTranslation } from './i18n-react';
import type { AgentOrgData, PlacedAgent } from './agent-org-model';
import { staleDays } from './agent-org-model';
import { deptTrail, isRunning, pickAvatars, scopedPlaced, showcaseColumns, showcaseStats, type ShowcaseColumn } from './org-showcase-model';

/** 栏宽跟着可用宽度走(放得下就不横向滚),夹在 MIN..MAX 之间;实在放不下才横向滚。 */
const COL_MIN = 188;
const COL_MAX = 260;
const COL_GAP = 20;
/** 叶子部门的 Agent 卡片墙:一页最多画这么多,余下的给「还有 N 个」。 */
const AGENT_CAP = 60;

/** hex + 透明度(两位十六进制)。 */
const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

type StatIcon = 'people-outline' | 'git-network-outline' | 'pulse-outline' | 'person-outline';

export default function OrgShowcase(p: { data: AgentOrgData; placed: PlacedAgent[]; title: string; onOpenDept: (id: string | null) => void; onOpenAgent?: (alias: string) => void;
  /** 手机(admin 2026-11-16「手机客户端看组织架构图的效果不好」):桌面那套海报式概览在 390pt 宽里
   *  标题折三行、头像墙出框、四个大数字占满一屏,架构树被挤到折叠线以下。compact = 小标题、一行四个数、小头像。 */
  compact?: boolean }) {
  const c = !!p.compact;
  const { t } = useTranslation();
  const [rootId, setRootId] = useState<string | null>(null);
  // 部门被删 / 换网络后,停在一个不存在的部门上 → 回到整个组织。
  useEffect(() => { if (rootId && !p.data.departments.some(d => d.id === rootId)) setRootId(null); }, [rootId, p.data]);
  const trail = deptTrail(p.data, rootId);
  const here = trail[trail.length - 1] ?? null;
  const stats = showcaseStats(p.data, p.placed, rootId);
  const columns = showcaseColumns(p.data, p.placed, { rootId });
  const scoped = scopedPlaced(p.data, p.placed, rootId);
  const cloud = pickAvatars(scoped, c ? 6 : 9);
  const showUnassigned = rootId === null && stats.unassigned > 0;
  const n = columns.length + (showUnassigned ? 1 : 0);
  const [avail, setAvail] = useState(0);
  // 一行放得下 → 树形(总线 + 竖线);放不下(比如 TMAI 下面 9 个部门)→ 换成网格,一行 fit 个,不横向滚(横向滚会把根节点滚出视野)。
  const fit = avail ? Math.max(1, Math.floor((avail + COL_GAP) / (COL_MIN + COL_GAP))) : n;
  const grid = n > fit;
  const perRow = grid ? fit : n;
  const COL_W = Math.floor(Math.max(grid ? 0 : COL_MIN, Math.min(COL_MAX, avail && perRow ? (avail - Math.max(0, perRow - 1) * COL_GAP) / perRow : COL_MAX)));
  const rowW = grid ? avail : n * COL_W + Math.max(0, n - 1) * COL_GAP;
  const drill = (id: string) => setRootId(id);
  return (
    <ScrollView testID="org-showcase" style={{ flex: 1, minHeight: 0 }} contentContainerStyle={[styles.page, c && styles.pageCompact]}>
      <View testID="org-showcase-hero" style={[styles.hero, c && styles.heroCompact]}>
        <View style={[styles.heroTop, c && { gap: spacing.md }]}>
          <View style={{ flex: 1, minWidth: c ? 0 : 240, gap: c ? spacing.xs : spacing.sm }}>
            {/* 管理员 2026-11-15「不放点 ANet 的 LOGO 吗？」:概览左上角品牌行(截图拿去宣传时一眼认得出是 ANet)。 */}
            <View style={styles.brandRow} testID="org-showcase-brand">
              <BrandMark size={c ? 20 : 28} />
              <Text style={[styles.brandName, c && { fontSize: typeScale.body }]}>ANet</Text>
              <View style={styles.brandDot} />
              <Text numberOfLines={1} style={[styles.kicker, c && { fontSize: typeScale.caption, letterSpacing: 0.6, flexShrink: 1 }]}>{here ? t('agentOrg.showcase.kickerDept') : t('agentOrg.showcase.kicker')}</Text>
            </View>
            <Text style={[styles.heroTitle, c && styles.heroTitleCompact]}>{here ? here.name : t('agentOrg.showcase.headline')}</Text>
            <Text style={[styles.heroSub, c && styles.heroSubCompact]}>{here
              ? t('agentOrg.showcase.subDept', { agents: stats.agents, departments: stats.departments, running: stats.running })
              : t('agentOrg.showcase.sub', { agents: stats.agents, departments: stats.departments, running: stats.running })}</Text>
          </View>
          {cloud.aliases.length ? <View style={styles.cloud} testID="org-showcase-cloud">
            {cloud.aliases.map((alias, i) => (
              <View key={alias} style={[styles.cloudAvatar, i > 0 && { marginLeft: c ? -8 : -12 }]}><AliasAvatar alias={alias} size={c ? 28 : 40} /></View>
            ))}
            {cloud.more ? <View style={[styles.cloudAvatar, styles.cloudMore, { marginLeft: c ? -8 : -12 }, c && { width: 32, height: 32 }]}><Text style={styles.cloudMoreText}>+{cloud.more}</Text></View> : null}
          </View> : null}
        </View>
        <View style={[styles.stats, c && { flexWrap: 'nowrap', gap: spacing.xs }]}>
          <Stat compact={c} value={stats.agents} label={t('agentOrg.showcase.agents')} icon="people-outline" testID="org-showcase-stat-agents" />
          <Stat compact={c} value={stats.departments} label={t('agentOrg.showcase.departments')} icon="git-network-outline" testID="org-showcase-stat-departments" />
          <Stat compact={c} value={stats.running} label={t('agentOrg.showcase.running')} icon="pulse-outline" testID="org-showcase-stat-running" live />
          <Stat compact={c} value={stats.owners} label={t('agentOrg.showcase.owners')} icon="person-outline" testID="org-showcase-stat-owners" />
        </View>
      </View>

      <View style={styles.chartCard} testID="org-showcase-chart" onLayout={e => setAvail(Math.max(0, e.nativeEvent.layout.width - 2 * spacing.lg - 2))}>
        <View style={styles.chartHead}>
          <View style={styles.crumbs} testID="org-showcase-crumbs">
            <Crumb label={p.title} active={!here} onPress={() => setRootId(null)} testID="org-showcase-crumb-root" />
            {trail.map((d, i) => <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="chevron-forward" size={13} color={colors.textMuted} />
              <Crumb label={d.name} active={i === trail.length - 1} onPress={() => setRootId(d.id)} testID={`org-showcase-crumb-${d.id}`} />
            </View>)}
          </View>
          <View style={{ flex: 1 }} />
          {here ? <Pressable testID="org-showcase-open-list" accessibilityRole="button" onPress={() => p.onOpenDept(here.id)}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.linkBtn, (hovered || pressed) && { backgroundColor: colors.rowHover }]}>
            <Ionicons name="list-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.linkText}>{t('agentOrg.showcase.openList')}</Text>
          </Pressable> : <Text style={styles.chartHint}>{t('agentOrg.showcase.chartHint')}</Text>}
        </View>
        {n === 0 && here ? (
          // 叶子部门:Agent 卡片墙。
          <AgentWall agents={scoped} onOpenAgent={p.onOpenAgent} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, minWidth: '100%', justifyContent: 'center' }}>
            <View style={{ width: Math.max(rowW, COL_W) }}>
              <View style={styles.rootWrap}>
                <View style={styles.root} testID="org-showcase-root">
                  {here ? <Ionicons name="business-outline" size={16} color={colors.bg} /> : <View style={styles.rootMark}><BrandMark size={18} /></View>}
                  <Text style={styles.rootText}>{here ? here.name : p.title}</Text>
                  <Text style={styles.rootCount}>{stats.agents}</Text>
                </View>
                {n > 0 ? <View style={styles.rootStem} /> : null}
              </View>
              {n > 1 && !grid ? <View style={[styles.bus, { left: COL_W / 2, width: rowW - COL_W }]} /> : null}
              <View testID={grid ? 'org-showcase-grid' : 'org-showcase-row'} style={{ flexDirection: 'row', flexWrap: grid ? 'wrap' : 'nowrap', gap: COL_GAP, rowGap: grid ? spacing.md : COL_GAP, alignItems: 'flex-start' }}>
                {columns.map(col => <Column key={col.dept.id} col={col} width={COL_W} onOpen={drill} stem={!grid} />)}
                {showUnassigned ? (
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
        )}
      </View>
      <View style={styles.footerRow} testID="org-showcase-footer">
        <BrandMark size={16} />
        <Text style={styles.footer}>{t('agentOrg.showcase.footer')}</Text>
      </View>
    </ScrollView>
  );
}

function Crumb(p: { label: string; active: boolean; onPress: () => void; testID: string }) {
  return <Pressable testID={p.testID} accessibilityRole="button" disabled={p.active} onPress={p.onPress}
    style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.crumb, hovered && !p.active && { backgroundColor: colors.rowHover }]}>
    <Text numberOfLines={1} style={p.active ? styles.crumbActive : styles.crumbText}>{p.label}</Text>
  </Pressable>;
}

function Stat(p: { value: number; label: string; icon: StatIcon; testID: string; live?: boolean; compact?: boolean }) {
  return <View style={[styles.stat, p.compact && styles.statCompact]} testID={p.testID}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: p.compact ? 3 : spacing.xs }}>
      {p.live ? <View style={styles.liveDot} /> : p.compact ? null : <Ionicons name={p.icon} size={14} color={colors.textMuted} />}
      <Text numberOfLines={1} style={[styles.statLabel, p.compact && { fontSize: typeScale.caption, flexShrink: 1 }]}>{p.label}</Text>
    </View>
    <Text style={[styles.statValue, p.compact && styles.statValueCompact]}>{p.value.toLocaleString()}</Text>
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

function Column(p: { col: ShowcaseColumn; width: number; onOpen: (id: string) => void; stem: boolean }) {
  const { t } = useTranslation();
  const { col } = p;
  return <View style={{ width: p.width }} testID={`org-showcase-col-${col.dept.id}`}>
    {p.stem ? <View style={[styles.stem, { backgroundColor: alpha(col.hue, 0.5) }]} /> : null}
    <Pressable testID={`org-showcase-dept-${col.dept.id}`} accessibilityRole="button" accessibilityLabel={`${col.dept.name}, ${t('agentOrg.agentsCount', { count: col.total })}`} onPress={() => p.onOpen(col.dept.id)}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.deptCard, { borderTopColor: col.hue }, (hovered || pressed) && { borderColor: alpha(col.hue, 0.55), borderTopColor: col.hue }]}>
      {({ hovered }: { hovered?: boolean; pressed: boolean }) => <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={[styles.deptIcon, { backgroundColor: alpha(col.hue, 0.13) }]}><Ionicons name="business-outline" size={16} color={col.hue} /></View>
          <Text numberOfLines={1} style={[styles.deptName, { flex: 1, minWidth: 0, fontSize: typeScale.title }]}>{col.dept.name}</Text>
          {/* 能下钻:悬停时右上角出「›」 */}
          <Ionicons name="chevron-forward" size={15} color={hovered ? col.hue : colors.border} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={styles.deptBig}>{col.total}</Text>
          <Text numberOfLines={1} style={[styles.deptMeta, { flexShrink: 0 }]}>{t('agentOrg.showcase.agentsShort')}</Text>
          {col.running ? <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>{t('agentOrg.showcase.runningShort', { count: col.running })}</Text></View> : null}
        </View>
        <AvatarStack aliases={col.avatars} more={col.more} size={26} ring={colors.card} />
      </>}
    </Pressable>
    {col.children.length ? <View style={[styles.children, { borderLeftColor: alpha(col.hue, 0.3) }]}>
      {col.children.map(ch => (
        <View key={ch.dept.id} style={{ flexDirection: 'row', alignItems: 'center', marginLeft: (ch.depth - 1) * 14 }}>
          <View style={[styles.branch, { backgroundColor: alpha(col.hue, 0.3) }]} />
          <Pressable testID={`org-showcase-dept-${ch.dept.id}`} accessibilityRole="button" accessibilityLabel={`${ch.dept.name}, ${t('agentOrg.agentsCount', { count: ch.total })}`} onPress={() => p.onOpen(ch.dept.id)}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.childChip, (hovered || pressed) && { borderColor: alpha(col.hue, 0.55), backgroundColor: colors.rowHover }]}>
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

function AgentWall(p: { agents: PlacedAgent[]; onOpenAgent?: (alias: string) => void }) {
  const { t } = useTranslation();
  const sorted = [...p.agents].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || Number(staleDays(a) !== null) - Number(staleDays(b) !== null) || a.alias.localeCompare(b.alias, 'zh'));
  const shown = sorted.slice(0, AGENT_CAP);
  if (!shown.length) return <View testID="org-showcase-agents-empty" style={styles.wallEmpty}>
    <Ionicons name="people-outline" size={28} color={colors.textMuted} />
    <Text style={styles.chartHint}>{t('agentOrg.noAgents')}</Text>
  </View>;
  return <View testID="org-showcase-agents" style={styles.wall}>
    {shown.map(agent => (
      <Pressable key={agent.nodeId} testID={`org-showcase-agent-${agent.nodeId}`} accessibilityRole="button" disabled={!p.onOpenAgent} onPress={() => p.onOpenAgent?.(agent.alias)}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.agentCard, (hovered || pressed) && p.onOpenAgent && { borderColor: colors.textMuted }]}>
        <View style={staleDays(agent) !== null ? { opacity: 0.45 } : undefined}>
          <AliasAvatar alias={agent.alias} size={44} />
          {agent.lifecycleState != null ? <View style={[styles.agentDot, { backgroundColor: isRunning(agent) ? colors.running : colors.rest }]} /> : null}
        </View>
        <Text numberOfLines={1} style={styles.agentName}>{agent.alias}</Text>
        <Text numberOfLines={1} style={styles.deptMeta}>{staleDays(agent) !== null ? t('agentOrg.staleDays', { days: staleDays(agent)! }) : agent.ownerName ?? t('agentOrg.noOwner')}</Text>
      </Pressable>
    ))}
    {sorted.length > shown.length ? <Text style={[styles.chartHint, { alignSelf: 'center' }]}>{t('agentOrg.moreAgents', { count: sorted.length - shown.length })}</Text> : null}
  </View>;
}

const makeStyles = () => StyleSheet.create({
  page: { padding: spacing.xl, gap: spacing.xl },
  pageCompact: { padding: spacing.md, gap: spacing.md },
  heroCompact: { padding: spacing.md, gap: spacing.md },
  heroTitleCompact: { fontSize: 20, lineHeight: 26 },
  heroSubCompact: { fontSize: typeScale.small, lineHeight: 18 },
  statCompact: { flexBasis: 0, minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: 2 },
  statValueCompact: { fontSize: 20, lineHeight: 24 },
  // 概览:和页面同一套的卡片面(不再是蓝青渐变)。
  hero: { borderRadius: radius.surface, padding: spacing.xl, gap: spacing.xl, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  heroTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xl },
  kicker: { color: colors.textMuted, fontSize: typeScale.small, fontWeight: '600', letterSpacing: 1.2 },
  heroTitle: { color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '600' },
  heroSub: { color: colors.textSecondary, fontSize: typeScale.title, lineHeight: 24 },
  cloud: { flexDirection: 'row', alignItems: 'center' },
  cloudAvatar: { borderRadius: radius.pill, borderWidth: 2, borderColor: colors.card },
  cloudMore: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.subtleFill },
  cloudMoreText: { color: colors.textSecondary, fontSize: typeScale.small, fontWeight: '600' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { flexGrow: 1, flexBasis: 140, paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.xs, borderRadius: radius.control, backgroundColor: colors.subtleFill },
  statValue: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: '600', fontVariant: ['tabular-nums'] },
  statLabel: { color: colors.textMuted, fontSize: typeScale.small },
  chartCard: { borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  chartHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  crumbs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 2, flexShrink: 1 },
  crumb: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.item },
  crumbText: { color: colors.textSecondary, fontSize: typeScale.title },
  crumbActive: { color: colors.text, fontSize: typeScale.heading, fontWeight: '600' },
  chartHint: { color: colors.textMuted, fontSize: typeScale.small },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, height: 30, borderRadius: radius.item },
  linkText: { color: colors.textSecondary, fontSize: typeScale.small },
  rootWrap: { alignItems: 'center' },
  // 根节点:反色(正文色底 + 页面底色字),不带品牌渐变。
  root: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.text },
  rootText: { color: colors.bg, fontSize: typeScale.title, fontWeight: '600' },
  rootCount: { color: colors.bg, opacity: 0.75, fontSize: typeScale.small, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rootStem: { width: 2, height: 22, backgroundColor: colors.border },
  bus: { height: 2, backgroundColor: colors.border },
  stem: { width: 2, height: 22, alignSelf: 'center' },
  deptCard: { backgroundColor: colors.card, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, borderTopWidth: 3, padding: spacing.md, gap: spacing.sm },
  deptIcon: { width: 30, height: 30, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  deptName: { color: colors.text, fontSize: typeScale.body, fontWeight: '600' },
  deptBig: { color: colors.text, fontSize: 26, lineHeight: 30, fontWeight: '600', fontVariant: ['tabular-nums'] },
  deptMeta: { color: colors.textMuted, fontSize: typeScale.small },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.subtleFill },
  liveDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.running },
  liveText: { color: colors.textSecondary, fontSize: typeScale.caption },
  children: { marginLeft: 18, marginTop: spacing.xs, borderLeftWidth: 2, paddingVertical: spacing.xs, gap: spacing.xs },
  branch: { width: 12, height: 2 },
  childChip: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, height: 32, paddingHorizontal: spacing.sm, borderRadius: radius.item, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  childDot: { width: 6, height: 6, borderRadius: radius.pill },
  childName: { flex: 1, minWidth: 0, color: colors.text, fontSize: typeScale.small },
  childCount: { color: colors.textMuted, fontSize: typeScale.caption, fontVariant: ['tabular-nums'], minWidth: 18, textAlign: 'right' },
  unassigned: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.control, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.card },
  wall: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  wallEmpty: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl * 2 },
  agentCard: { width: 148, alignItems: 'center', gap: 4, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  agentDot: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.card },
  agentName: { color: colors.text, fontSize: typeScale.body, fontWeight: '600', marginTop: spacing.xs, maxWidth: '100%' },
  footer: { color: colors.textMuted, fontSize: typeScale.small, textAlign: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandName: { color: colors.text, fontSize: typeScale.title, fontWeight: '600', letterSpacing: 0.3 },
  brandDot: { width: 4, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  rootMark: { width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
