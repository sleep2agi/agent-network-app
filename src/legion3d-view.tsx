// 军团 3D 视图(2026-11-05)。
//
// 这一版只做**只读静态图**:把真实的组织架构数据(AgentOrgData)算成 3D 图元
// (`buildLegionScene`),然后用 React Native 的基础元素画出来:
//   · 体(圆心/部门盘/人/Agent) → 绝对定位的圆/椭圆 View
//   · 标签 → Text,贴在体下方
//   · 环 → 采样点(每 4 个点取 1),用极小的点连成一圈虚线轨道
// 不引新依赖(不装 react-native-svg / Skia):先让「军团 3D」在四端都看得见,
// 之后要不要换 canvas/WebView 由实测帧率决定。
//
// 静态图没有 rAF,所以不存在后台空转耗电;等做自转动画时再加节流与可见性判断。

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, radius, spacing } from './theme';
import { ds } from './ui-scale';
import type { HubConfig } from './api';
import { loadAgentOrg } from './agent-org-api';
import { buildLegionLayout } from './legion/legion-layout';
import { legionInputFromOrg } from './legion-input-from-org';
import { copyA11yLabel, focusEmptyText, focusHint, focusIdFromStored, focusLabel, focusOutline, focusStats, focusStatsLine, focusTrail, legionA11yLabel, nodeDepartmentPath, tapOutcome } from './legion/legion-focus';
import { buildLegionScene, nextYaw, nodeRefValue, pickBody, spinRate, parseSpinSpeed, SPIN_TICK_MS, type BodyCommand, type SceneCommand, type SpinSpeed } from './legion3d-scene';
import { loadLegion3DFocusId, saveLegion3DFocusId } from './agent-list-prefs';

type Props = { cfg: HubConfig; networkId?: string; height?: number };

/** 环上每 4 个采样点画 1 个点:96 段 → 24 个点,足够看出轨道,又不会让视图数量失控。 */
const RING_DOT_STRIDE = 4;

export default function Legion3DView(p: Props) {
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error' | 'empty'; reason?: string; commands: SceneCommand[]; note?: string }>({ phase: 'loading', commands: [] });
  const [reloadKey, setReloadKey] = useState(0);
  // 自转:默认关(先看清静态图再决定要不要转),用户点了才转。
  const [spinning, setSpinning] = useState(false);
  const [yaw, setYaw] = useState(0.6);
  const [speed, setSpeed] = useState<SpinSpeed>('normal');
  // 点中的节点:底部给一行「这个点是谁」,不然 3D 图对着一堆圆点没法用。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 聚焦到某个部门(只看它和它的下级)。全图看体量,聚焦看编制。
  // 0.2.463:记住上次看的是哪个部门 —— 只想看某个部门时,每次进来重新点一遍太烦。
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusRestored, setFocusRestored] = useState(false);
  // 复制反馈:点一下选中行就把 id 复制走(3D 里看到谁之后,下一步往往就是去找他/贴给别人)。
  const [copied, setCopied] = useState(false);
  const height = p.height ?? 360;
  const width = 520;
  // 相机(与 Dashboard 的视觉参数对齐):俯仰 ~26°、远一点让透视更平。
  // 放在组件内而不是模块级:模块级常量会在密度偏好加载前就把尺寸钉死(ui-scale 守卫会红)。
  const cam = useMemo(() => ({ yaw, pitch: 0.45, dist: 6.2, focal: Math.round(width * 1.5) }), [width, yaw]);

  // 布局只在数据变化时算一次;自转只重算投影,不重排整棵树。
  const [layout, setLayout] = useState<ReturnType<typeof buildLegionLayout> | null>(null);

  // 恢复上次聚焦：只在布局算好后判断一次（id 不在了就作废，退回全图）。
  useEffect(() => {
    if (focusRestored || !layout) return;
    let live = true;
    loadLegion3DFocusId()
      .then((stored) => { if (live) setFocusId((cur) => cur ?? focusIdFromStored(stored, layout)); })
      .catch(() => {})
      .finally(() => { if (live) setFocusRestored(true); });
    return () => { live = false; };
  }, [layout, focusRestored]);

  // 记住/忘记聚焦（点和面包屑都会改 focusId）。
  useEffect(() => {
    if (!focusRestored) return;
    saveLegion3DFocusId(focusId).catch(() => {});
  }, [focusId, focusRestored]);

  useEffect(() => {
    let live = true;
    const net = p.networkId;
    setLayout(null);
    if (!net) { setState({ phase: 'empty', reason: 'no-network', commands: [], note: '还没选网络，先在上面选一个网络' }); return; }
    setState({ phase: 'loading', commands: [] });
    void loadAgentOrg(p.cfg, net).then((org) => {
      if (!live) return;
      if (!org) { setState({ phase: 'error', reason: 'no-org-data', commands: [], note: 'Hub 上还没有部门与通讯录数据（不是网络问题）' }); return; }
      const built = buildLegionLayout(legionInputFromOrg(org));
      if (built.nodes.filter((n) => n.kind !== 'core').length === 0) {
        setState({ phase: 'empty', reason: 'no-people', commands: [], note: '这个网络里还没有人和 Agent' });
        return;
      }
      setLayout(built);
      setState({ phase: 'ready', commands: buildLegionScene(built, cam, { width, height }) });
    }).catch((e: unknown) => {
      if (!live) return;
      setState({ phase: 'error', reason: 'fetch-failed', commands: [], note: `读组织架构失败：${String((e as Error)?.message ?? e)}` });
    });
    return () => { live = false; };
  }, [p.cfg, p.networkId, reloadKey, height]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 自转:20fps 定时器(SPIN_TICK_MS),不是 rAF —— 手机上 60fps 只会多烧电。
  // App 切到后台就停,回来再接着转;离开这个页面(卸载)自然清掉定时器。
  useEffect(() => {
    if (!spinning || !layout) return;
    let alive = true;
    const timer = setInterval(() => {
      if (!alive) return;
      setYaw((y) => nextYaw(y, SPIN_TICK_MS, spinRate(speed)));
    }, SPIN_TICK_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      clearInterval(timer);   // 后台不再推进;回到前台由下面的 effect 重新接管
    });
    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, [spinning, layout, speed]);

  // 自转/聚焦时只重算图元(原始布局不动)。
  // 聚焦时范围外的部门保留成暗色轮廓(0.2.456):不删掉,才看得出「军团还有多大」。
  const outline = useMemo(() => (layout ? focusOutline(layout, focusId) : null), [layout, focusId]);
  const shownLayout = outline?.layout ?? null;
  const dimmedIds = outline?.dimmedIds;
  useEffect(() => {
    if (!shownLayout) return;
    setState((prev) => (prev.phase === 'ready'
      ? { ...prev, commands: buildLegionScene(shownLayout, cam, { width, height }, { dimmedIds }) }
      : prev));
  }, [shownLayout, dimmedIds, cam, height]);

  const dots = useMemo(
    () => state.commands.filter((c) => c.kind === 'ring').flatMap((r) => (r as { points: Array<{ x: number; y: number }> }).points.filter((_, i) => i % RING_DOT_STRIDE === 0)),
    [state.commands],
  );
  const bodies = useMemo(() => state.commands.filter((c) => c.kind === 'body') as Array<Extract<SceneCommand, { kind: 'body' }>>, [state.commands]);
  const selected = useMemo(() => {
    if (!selectedId || !layout) return null;
    const node = layout.nodes.find((n) => n.id === selectedId);
    return node ? { id: node.id, label: node.label, sublabel: node.sublabel, kind: node.kind } : null;
  }, [selectedId, layout]);
  const labels = useMemo(() => state.commands.filter((c) => c.kind === 'label') as Array<Extract<SceneCommand, { kind: 'label' }>>, [state.commands]);

  return (
    <View testID="legion3d-view" style={{ gap: spacing.sm }}>
      <Pressable testID="legion3d-canvas" accessibilityRole="image"
        accessibilityLabel={layout ? legionA11yLabel({
          focusLabel: focusId ? focusLabel(layout, focusId) : null,
          people: focusStats(layout, focusId).people,
          agents: focusStats(layout, focusId).agents,
          groups: focusStats(layout, focusId).groups,
          dimmedCount: dimmedIds?.size ?? 0,
          selectedLabel: selected ? `${selected.label}${selected.kind === 'agent' ? '（Agent）' : selected.kind === 'person' ? '（人）' : selected.kind === 'group' ? '（部门）' : ''}` : null,
        }) : '军团 3D 视图，点节点可看是谁'}
        onPress={(e) => {
          const { locationX, locationY } = (e.nativeEvent ?? {}) as { locationX?: number; locationY?: number };
          if (typeof locationX !== 'number' || typeof locationY !== 'number') return;
          const hit = pickBody(bodies as BodyCommand[], locationX, locationY);
          // 点暗色部门 = 直接切到那块(0.2.457),不用再点一次「只看这个部门」。
          const outcome = tapOutcome(hit?.id, dimmedIds);
          if (outcome.focusId !== undefined) setFocusId(outcome.focusId);
          setSelectedId(outcome.selectedId);
        }}
        // 长按是手机手势:桌面上按住鼠标是在拖选文字,绑上去会被当成误触(phone-only guard)。
        onLongPress={Platform.OS === 'web' ? undefined : () => { setSelectedId(null); setCopied(false); }}
        style={{ height, borderRadius: radius.surface, backgroundColor: colors.card, overflow: 'hidden' }}>
        {/* 轨道:采样点画成一圈小点,不做描边(椭圆描边需要 svg/变换,先不引依赖)。 */}
        {dots.map((d, i) => {
          const dot = ds(3);
          return (
            <View key={`d${i}`} pointerEvents="none"
              style={{ position: 'absolute', left: d.x - dot / 2, top: d.y - dot / 2, width: dot, height: dot, borderRadius: radius.pill, backgroundColor: colors.border }} />
          );
        })}
        {/* 体:远的先画(commands 里已经按深度排好序,直接顺序渲染即是遮挡关系)。 */}
        {bodies.map((b) => (
          <View key={b.id} pointerEvents="none" testID={`legion3d-body-${b.nodeKind}`}
            style={{
              position: 'absolute',
              left: b.x - b.rx,
              top: b.y - b.ry,
              width: Math.max(2, b.rx * 2),
              height: Math.max(2, b.ry * 2),
              borderRadius: Math.max(b.rx, b.ry),
              backgroundColor: bodyColor(b.nodeKind, b.dimmed),
              opacity: b.dimmed ? 0.35 : 1,
              ...(b.id === selectedId ? { borderWidth: 2, borderColor: colors.text } : null),
            }} />
        ))}
        {labels.map((l) => (
          <Text key={`l${l.id}`} numberOfLines={1}
            style={{ position: 'absolute', left: l.x - 40, top: l.y, width: 80, textAlign: 'center', fontSize: 9, color: colors.textSecondary }}
            testID="legion3d-label">{l.text}</Text>
        ))}
        {state.phase === 'loading' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="small" color={colors.accent} /></View>
        ) : null}
        {state.phase !== 'ready' && state.phase !== 'loading' ? (
          <View testID={state.reason ? `legion3d-${state.phase}-${state.reason}` : `legion3d-${state.phase}`} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>{state.note}</Text>
            <Pressable accessibilityRole="button" testID="legion3d-retry" onPress={() => setReloadKey((n) => n + 1)}
              style={({ pressed }) => [{ borderWidth: 1, borderColor: colors.accent, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 6 }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: colors.accent, fontSize: 12 }}>重新读取</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
      {selected ? (
        <Pressable testID="legion3d-selected" accessibilityRole="button" accessibilityLabel={copyA11yLabel(copied)}
          onPress={() => {
            void import('expo-clipboard')
              .then((m) => m.setStringAsync(nodeRefValue(selected.id)))
              .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
              .catch(() => undefined);
          }}>
          {/* 复制结果对读屏要能听见（0.2.466）：视觉上是行尾一句「（已复制 id）」。 */}
          <Text testID="legion3d-selected-text" accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 11 }}>
            {selected.label}{selected.sublabel ? ` · ${selected.sublabel}` : ''}{selected.kind === 'agent' ? '（Agent）' : selected.kind === 'person' ? '（人）' : selected.kind === 'group' ? '（部门）' : ''}
            {/* 选中人/Agent 时给出所属部门路径（0.2.461），3D 里靠位置判断归属不可靠。 */}
            {(() => {
              const path = nodeDepartmentPath(layout, selected.id);
              return path.length ? ` · ${path.join(' / ')}` : '';
            })()}
            {copied ? '（已复制 id）' : ' · 点这行复制 id'}
          </Text>
        </Pressable>
      ) : null}
      {selected && selected.kind === 'group' && focusId !== selected.id ? (
        <Pressable accessibilityRole="button" testID="legion3d-focus-dept" onPress={() => { setFocusId(selected.id); setSelectedId(selected.id); }}
          style={({ pressed }) => [{ alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.accent, borderRadius: radius.control, paddingHorizontal: spacing.sm, paddingVertical: 3 }, pressed && { opacity: 0.7 }]}>
          <Text style={{ color: colors.accent, fontSize: 11 }}>只看 {selected.label}</Text>
        </Pressable>
      ) : null}
      {/* 面包屑:军团 / 平台部 / 前端组 —— 每一级都能点,退到上一级不用先回全图。 */}
      {focusId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }} testID="legion3d-focus-trail">
          {focusTrail(layout ?? null, focusId).map((crumb, i, all) => {
            const last = i === all.length - 1;
            return (
              <View key={`crumb-${crumb.id ?? 'all'}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {i > 0 ? <Text style={{ color: colors.textMuted, fontSize: 11, marginHorizontal: 4 }}>/</Text> : null}
                <Pressable accessibilityRole="button" testID={`legion3d-crumb-${i}`}
                  disabled={last}
                  onPress={() => { setFocusId(crumb.id); setSelectedId(crumb.id); }}
                  style={({ pressed }) => [{ paddingVertical: 2 }, pressed && { opacity: 0.7 }]}>
                  <Text style={{ color: last ? colors.accent : colors.textSecondary, fontSize: 11 }}>
                    {crumb.label}{last ? '（当前）' : ''}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
      {/* 聚焦到空部门时说清楚「这里没人」，并给退出口（0.2.462）。 */}
      {layout && focusId && focusEmptyText({
        focusLabel: focusLabel(layout, focusId),
        people: focusStats(layout, focusId).people,
        agents: focusStats(layout, focusId).agents,
      }) ? (
        <Text testID="legion3d-focus-empty" style={{ color: colors.textMuted, fontSize: 11 }}>
          {focusEmptyText({
            focusLabel: focusLabel(layout, focusId),
            people: focusStats(layout, focusId).people,
            agents: focusStats(layout, focusId).agents,
          })}
        </Text>
      ) : null}
      {focusHint(dimmedIds?.size ?? 0, focusId) ? (
        <Text testID="legion3d-focus-hint" style={{ color: colors.textMuted, fontSize: 10 }}>
          {focusHint(dimmedIds?.size ?? 0, focusId)}
        </Text>
      ) : null}
      {/* 0.2.464: 去掉了独立的「看全图」按钮 —— 面包屑首项「军团」就是回全图的入口，
          同一个动作留两个控件只会让人多想一秒。 */}
      {state.phase === 'ready' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Text testID="legion3d-stats" style={{ color: colors.textMuted, fontSize: 11 }}>
            {/* 汇总用布局层统计(全量口径),别用图元数 —— 折叠/标签预算会让图元数少于真实人数。 */}
            {/* 聚焦时把全量口径也带上（0.2.458），否则看不出这块占军团多少。 */}
            {layout ? focusStatsLine(layout, focusId) : `${bodies.length} 个节点`}
          </Text>
          <Pressable accessibilityRole="button" testID="legion3d-spin-toggle" onPress={() => setSpinning((v) => !v)}
            style={({ pressed }) => [{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, paddingHorizontal: spacing.sm, paddingVertical: 3 }, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{spinning ? '暂停' : '自转'}</Text>
          </Pressable>
          {/* 速度档:慢 / 中 / 快。只改角速度,帧率上限仍是 20fps。 */}
          {spinning ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} testID="legion3d-speed">
              {(['slow', 'normal', 'fast'] as const).map((k) => (
                <Pressable key={k} accessibilityRole="button" testID={`legion3d-speed-${k}`}
                  onPress={() => setSpeed(parseSpinSpeed(k))}
                  style={({ pressed }) => [{ borderWidth: 1, borderColor: speed === k ? colors.accent : colors.border, borderRadius: radius.control, paddingHorizontal: 6, paddingVertical: 2 }, pressed && { opacity: 0.7 }]}>
                  <Text style={{ color: speed === k ? colors.accent : colors.textMuted, fontSize: 10 }}>{k === 'slow' ? '慢' : k === 'fast' ? '快' : '中'}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** 节点配色沿用主题语义色:圆心亮、部门次之、人/Agent 递减。 */
function bodyColor(kind: string, dimmed: boolean): string {
  if (dimmed) return colors.textMuted;
  switch (kind) {
    case 'core': return colors.accent;
    case 'group': return colors.accent;
    case 'person': return colors.textSecondary;
    default: return colors.text;
  }
}
