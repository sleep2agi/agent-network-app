// 安卓 / iOS 的「活的组织图」（admin 2026-11-20「安卓端跟折叠屏也要跟电脑同步一下，搞得好一点、炫一点」）。
//
// 桌面版（LiveOrgMap.tsx）直接画 DOM <svg>；原生没有 DOM，这里用 react-native-svg 画同一套几何：
//   · 摆放 / 归桶 / 边 —— 复用 live-org-model.ts 的纯函数（已经有单测），不另写一套；
//   · 颜色 —— 部门色簇（hue 表）+ 暖黄光晕（MobileWindowGlow 已在最外层铺）；
//   · 动 —— 只让「有 agent 在跑」的簇做很轻的呼吸（3s 一轮、半径 ±2%），派活线是静态虚线；
//           不做持续流光/粒子（负责人 2026-11-20 定的「安静设计」口径）。
//   · 交互 —— 点簇钻进去（有子部门才可钻），点 agent 点头像进聊天。
//
// 主形态先做单屏聚焦（<700dp）；≥700dp 的双栏（右侧详情）是第二阶段，这里预留 detail 插槽。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { Text } from './ui-text';
import { fetchScopedStatus, fetchTasks, type HubConfig, type HubTask } from './api';
import type { AgentOrgData, PlacedAgent } from './agent-org-model';
import { buildClusters, buildEdges, breathRadius, clusterTintHex, corePosition, edgeEnds, dotPositions, dotRadius, CORE, UNASSIGNED, type Cluster, type LiveAgent } from './live-org-model';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';

const WINDOW_MS = 10 * 60_000;
const TASK_LIMIT = 200;
const POLL_MS = 30_000;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const clusterTint = clusterTintHex;

export default function LiveOrgMapNative(p: {
  cfg: HubConfig;
  data: AgentOrgData;
  placed: PlacedAgent[];
  onOpenAgent?: (alias: string) => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [root, setRoot] = useState<string | null>(null);
  const [status, setStatus] = useState<ReadonlyMap<string, string>>(new Map());
  const [tasks, setTasks] = useState<HubTask[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const [st, tk] = await Promise.all([
        fetchScopedStatus(p.cfg).catch(() => null),
        fetchTasks(p.cfg, { limit: TASK_LIMIT, skipStats: true }).catch(() => null),
      ]);
      if (!live) return;
      if (st) setStatus(new Map((st.sessions ?? []).map(s => [s.alias, String(s.status ?? '')] as const)));
      if (tk) setTasks(tk.tasks ?? []);
      setNow(Date.now());
    };
    void tick();
    const id = setInterval(() => { void tick(); }, POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [p.cfg]);

  useEffect(() => { if (root && !p.data.departments.some(d => d.id === root)) setRoot(null); }, [root, p.data]);

  const agents: LiveAgent[] = useMemo(() => p.placed.filter(a => !a.demo).map(a => {
    const s = status.get(a.alias) ?? '';
    return { alias: a.alias, departmentId: a.departmentId, online: !!s && s !== 'offline' };
  }), [p.placed, status]);

  const W = size.w, H = Math.max(0, size.h);
  const clusters = useMemo(() => (W > 0 && H > 0 ? buildClusters(p.data.departments, agents, root, W, H, { unassigned: '未归属', direct: '直属' }) : []), [p.data.departments, agents, root, W, H]);
  const flow = useMemo(() => buildEdges(tasks, clusters, now, WINDOW_MS, TASK_LIMIT), [tasks, clusters, now]);
  const online = agents.filter(a => a.online).length;
  const dark = themeMode() === 'dark';
  const byId = new Map(clusters.map(c => [c.id, c]));
  const core = useMemo(() => corePosition(clusters, W, H), [clusters, W, H]);
  const maxCount = Math.max(1, ...flow.edges.map(e => e.count));
  const countLabel = flow.truncated ? `≥${flow.total}` : String(flow.total);

  // 呼吸相位：只在原生跑（web 上也有这个组件是为了截图，动效照旧）。
  const phase = useRef(new Animated.Value(0)).current;
  const [breath, setBreath] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }));
    loop.start();
    const id = phase.addListener(({ value }) => setBreath(value));
    return () => { id && phase.removeListener(id); loop.stop(); };
  }, [phase]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 2 || Math.abs(height - size.h) > 2) setSize({ w: width, h: height });
  };

  const openCluster = (c: Cluster) => {
    if (c.id === UNASSIGNED || c.id.endsWith('::direct')) return;
    if (c.hasChildren) setRoot(c.id);
  };

  return (
    <View style={{ flex: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }} testID="live-org-map-native">
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 20, fontWeight: weight.strong, color: colors.text }}>组织在运转</Text>
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.small }} testID="live-org-native-summary">
          <Text style={{ color: colors.text, fontWeight: weight.strong }}>{online}</Text> 在跑 · <Text style={{ color: colors.text, fontWeight: weight.strong }}>{agents.length}</Text> 个 Agent · 近 10 分钟 <Text style={{ color: colors.text, fontWeight: weight.strong }}>{countLabel}</Text> 次派活
        </Text>
      </View>

      <View style={{ flex: 1, minHeight: 320 }} onLayout={onLayout} testID="live-org-native-canvas">
        {W > 0 && H > 0 ? (
          <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {/* 派活线：静态虚线（不做持续流光） */}
            {flow.edges.map(e => {
              const a = e.from === CORE ? { ...core, r: 10 } : byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const { x1, y1, x2, y2 } = edgeEnds(a, b);
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
              const cx = mx - (dy / len) * len * 0.12, cy = my + (dx / len) * len * 0.12;
              return (
                <Path
                  key={`${e.from}>${e.to}`}
                  d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
                  fill="none"
                  stroke={colors.accent}
                  strokeOpacity={dark ? 0.5 : 0.4}
                  strokeWidth={1.2 + (e.count / maxCount) * 3.6}
                  strokeLinecap="round"
                  strokeDasharray="3 6"
                />
              );
            })}

            {/* 部门簇 + agent 点 */}
            {clusters.map(c => {
              const tint = clusterTint(c.hue, dark);
              const r = c.online > 0 ? breathRadius(c.r, breath) : c.r;
              return (
                <Circle
                  key={`halo-${c.id}`}
                  cx={c.x}
                  cy={c.y}
                  r={r + Math.max(8, r * 0.35)}
                  fill={tint}
                  fillOpacity={dark ? 0.10 : 0.08}
                  onPress={() => openCluster(c)}
                />
              );
            })}
            {clusters.map(c => {
              const tint = clusterTint(c.hue, dark);
              return (
                <Circle
                  key={`ring-${c.id}`}
                  cx={c.x}
                  cy={c.y}
                  r={c.r}
                  fill={colors.card}
                  fillOpacity={0.9}
                  stroke={tint}
                  strokeOpacity={0.65}
                  strokeWidth={1.2}
                  onPress={() => openCluster(c)}
                />
              );
            })}
            {clusters.map(c => (
              <SvgText
                key={`name-${c.id}`}
                x={c.x}
                y={c.y - 2}
                fill={colors.text}
                fontSize={c.r > 46 ? 13 : 11}
                fontWeight="600"
                textAnchor="middle"
              >
                {c.name}
              </SvgText>
            ))}
            {clusters.map(c => (
              <SvgText
                key={`meta-${c.id}`}
                x={c.x}
                y={c.y + 14}
                fill={colors.textSecondary}
                fontSize={10}
                textAnchor="middle"
              >
                {`${c.online}/${c.agents.length} 在跑`}
              </SvgText>
            ))}
            {clusters.flatMap(c => dotPositions(c.agents.length, c.r).map((pos, i) => {
              const agent = c.agents[i];
              if (!agent) return null;
              const tint = clusterTint(c.hue, dark, 10);
              return (
                <Circle
                  key={`dot-${c.id}-${agent.alias}`}
                  cx={c.x + pos.x}
                  cy={c.y + pos.y}
                  r={dotRadius(c.r, agent.online)}
                  fill={agent.online ? tint : colors.textMuted}
                  fillOpacity={agent.online ? 1 : 0.5}
                  onPress={() => p.onOpenAgent?.(agent.alias)}
                />
              );
            }))}
          </Svg>
        ) : null}
      </View>

      {root ? (
        <Pressable onPress={() => setRoot(null)} accessibilityRole="button" testID="live-org-native-back" style={{ position: 'absolute', left: spacing.lg, bottom: spacing.lg }}>
          <Text style={{ color: colors.accent, fontSize: typeScale.small }}>‹ 整个组织</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * 安卓（含折叠屏）与截图模拟用这个组件；iOS 暂不切（负责人说 iOS 单独评估），web 桌面仍走 DOM 版。
 * `?orgSim=native` 只在 web 导出里打开它，给截图/回归用（与 safeAreaSim / glowSim 同类做法）。
 */
export function nativeOrgMapActive(): boolean {
  if (Platform.OS === 'android') return true;
  if (Platform.OS !== 'web') return false;
  try { return new URLSearchParams((globalThis as any).location?.search ?? '').get('orgSim') === 'native'; } catch { return false; }
}
