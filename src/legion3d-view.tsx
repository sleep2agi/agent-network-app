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
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, radius, spacing } from './theme';
import { ds } from './ui-scale';
import type { HubConfig } from './api';
import { loadAgentOrg } from './agent-org-api';
import { buildLegionLayout } from './legion/legion-layout';
import { legionInputFromOrg } from './legion-input-from-org';
import { buildLegionScene, type SceneCommand } from './legion3d-scene';

type Props = { cfg: HubConfig; networkId?: string; height?: number };

/** 环上每 4 个采样点画 1 个点:96 段 → 24 个点,足够看出轨道,又不会让视图数量失控。 */
const RING_DOT_STRIDE = 4;

export default function Legion3DView(p: Props) {
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error' | 'empty'; commands: SceneCommand[]; note?: string }>({ phase: 'loading', commands: [] });
  const [reloadKey, setReloadKey] = useState(0);
  const height = p.height ?? 360;
  const width = 520;
  // 相机(与 Dashboard 的视觉参数对齐):俯仰 ~26°、远一点让透视更平。
  // 放在组件内而不是模块级:模块级常量会在密度偏好加载前就把尺寸钉死(ui-scale 守卫会红)。
  const cam = useMemo(() => ({ yaw: 0.6, pitch: 0.45, dist: 6.2, focal: Math.round(width * 1.5) }), [width]);

  useEffect(() => {
    let live = true;
    const net = p.networkId;
    if (!net) { setState({ phase: 'empty', commands: [], note: '还没选网络' }); return; }
    setState({ phase: 'loading', commands: [] });
    void loadAgentOrg(p.cfg, net).then((org) => {
      if (!live) return;
      if (!org) { setState({ phase: 'error', commands: [], note: '读不到组织架构（Hub 没有部门/通讯录数据）' }); return; }
      const layout = buildLegionLayout(legionInputFromOrg(org));
      if (layout.nodes.filter((n) => n.kind !== 'core').length === 0) {
        setState({ phase: 'empty', commands: [], note: '这个网络里还没有人和 Agent' });
        return;
      }
      const commands = buildLegionScene(layout, cam, { width, height });
      setState({ phase: 'ready', commands });
    }).catch((e: unknown) => {
      if (!live) return;
      setState({ phase: 'error', commands: [], note: `读组织架构失败：${String((e as Error)?.message ?? e)}` });
    });
    return () => { live = false; };
  }, [p.cfg, p.networkId, reloadKey, height, cam]);

  const dots = useMemo(
    () => state.commands.filter((c) => c.kind === 'ring').flatMap((r) => (r as { points: Array<{ x: number; y: number }> }).points.filter((_, i) => i % RING_DOT_STRIDE === 0)),
    [state.commands],
  );
  const bodies = useMemo(() => state.commands.filter((c) => c.kind === 'body') as Array<Extract<SceneCommand, { kind: 'body' }>>, [state.commands]);
  const labels = useMemo(() => state.commands.filter((c) => c.kind === 'label') as Array<Extract<SceneCommand, { kind: 'label' }>>, [state.commands]);

  return (
    <View testID="legion3d-view" style={{ gap: spacing.sm }}>
      <View style={{ height, borderRadius: radius.surface, backgroundColor: colors.card, overflow: 'hidden' }}>
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
          <View testID={`legion3d-${state.phase}`} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.sm }}>
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center' }}>{state.note}</Text>
            <Pressable accessibilityRole="button" testID="legion3d-retry" onPress={() => setReloadKey((n) => n + 1)}
              style={({ pressed }) => [{ borderWidth: 1, borderColor: colors.accent, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: 6 }, pressed && { opacity: 0.7 }]}>
              <Text style={{ color: colors.accent, fontSize: 12 }}>重新读取</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {state.phase === 'ready' ? (
        <Text testID="legion3d-stats" style={{ color: colors.textMuted, fontSize: 11 }}>
          {bodies.length} 个节点 · {labels.length} 个标签 · 只读视图（还不自转）
        </Text>
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
