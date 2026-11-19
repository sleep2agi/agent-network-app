// 桌面「活的组织图」（admin 2026-11-19「这个组织架构还没改版上线」/ 11-19「这个感觉很 normal」）。
// 部门是一团簇、agent 是点（在跑亮、离线暗），近 10 分钟谁给谁派活画流动的线，点部门往里钻、点 agent 进聊天。
// 摆放 / 归桶 / 边的规则全在 live-org-model.ts（纯函数，有单测）。这里只负责取数和画：
//   - 组织结构、agent 归属：父组件已经读好的 AgentOrgData + placed（不重复请求）；
//   - 在线状态：/api/status?light=1，30 秒一次；
//   - 派活：/api/tasks 最近 200 条（skip_stats），30 秒一次；取满且最老一条仍在窗内时数字标「≥N」。
// 只在 web（桌面壳 / 网页）用：直接画 DOM <svg>，原生端不渲染这个组件（AgentOrgScreen 里分流）。
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import { Text } from './ui-text';
import { fetchScopedStatus, fetchTasks, type HubConfig, type HubTask } from './api';
import type { AgentOrgData, PlacedAgent } from './agent-org-model';
import { buildClusters, buildEdges, CORE, corePosition, dotPositions, dotRadius, edgeEnds, UNASSIGNED, type Cluster, type LiveAgent } from './live-org-model';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { Ionicons } from './icons';

const WINDOW_MS = 10 * 60_000;
const TASK_LIMIT = 200;
const POLL_MS = 30_000;

export default function LiveOrgMap(p: { cfg: HubConfig; data: AgentOrgData; placed: PlacedAgent[]; onOpenAgent?: (alias: string) => void }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [root, setRoot] = useState<string | null>(null);
  const [status, setStatus] = useState<ReadonlyMap<string, string>>(new Map());
  const [tasks, setTasks] = useState<HubTask[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [hover, setHover] = useState<string | null>(null);

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

  // 部门被删 / 换网络后停在不存在的部门上 → 回到整个组织。
  useEffect(() => { if (root && !p.data.departments.some(d => d.id === root)) setRoot(null); }, [root, p.data]);

  const agents: LiveAgent[] = useMemo(() => p.placed.filter(a => !a.demo).map(a => {
    const s = status.get(a.alias) ?? '';
    return { alias: a.alias, departmentId: a.departmentId, online: !!s && s !== 'offline' };
  }), [p.placed, status]);
  const W = size.w, H = Math.max(0, size.h);
  const clusters = useMemo(() => (W > 0 && H > 0 ? buildClusters(p.data.departments, agents, root, W, H, { unassigned: '未归属', direct: '直属' }) : []), [p.data.departments, agents, root, W, H]);
  const flow = useMemo(() => buildEdges(tasks, clusters, now, WINDOW_MS, TASK_LIMIT), [tasks, clusters, now]);
  const online = agents.filter(a => a.online).length;
  const trail = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    let cur = root ? p.data.departments.find(d => d.id === root) : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift({ id: cur.id, name: cur.name }); cur = cur.parent_id ? p.data.departments.find(d => d.id === cur!.parent_id) : undefined; }
    return out;
  }, [root, p.data.departments]);

  const dark = themeMode() === 'dark';
  const tint = (hue: number, l = 0) => (hue < 0 ? colors.textMuted : dark ? `hsl(${hue} 88% ${64 + l}%)` : `hsl(${hue} 62% ${50 + l}%)`);
  const byId = new Map(clusters.map(c => [c.id, c]));
  const core = useMemo(() => corePosition(clusters, W, H), [clusters, W, H]);
  const maxCount = Math.max(1, ...flow.edges.map(e => e.count));
  const countLabel = flow.truncated ? `≥${flow.total}` : String(flow.total);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 2 || Math.abs(height - size.h) > 2) setSize({ w: width, h: height });
  };

  const openCluster = (c: Cluster) => {
    if (c.id === UNASSIGNED || c.id.endsWith('::direct')) return;
    if (c.hasChildren) setRoot(c.id);
  };

  return (
    <View style={{ flex: 1, minHeight: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }} testID="live-org-map">
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, flexWrap: 'wrap' }}>
        <Text style={{ fontSize: 22, fontWeight: weight.strong, color: colors.text }}>组织在运转</Text>
        <Text style={{ color: colors.textSecondary, fontSize: typeScale.body }} testID="live-org-summary">
          <Text style={{ color: colors.text, fontWeight: weight.strong }}>{online}</Text> 在跑 · <Text style={{ color: colors.text, fontWeight: weight.strong }}>{agents.length}</Text> 个 Agent · 近 10 分钟 <Text style={{ color: colors.text, fontWeight: weight.strong }}>{countLabel}</Text> 次派活
        </Text>
        <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.running }} />
          <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>实时</Text>
        </View>
      </View>
      {trail.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm }} testID="live-org-trail">
          <Pressable onPress={() => setRoot(null)} accessibilityRole="button" hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="chevron-back" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontSize: typeScale.small }}>整个组织</Text>
          </Pressable>
          {trail.map((t, i) => (
            <Pressable key={t.id} onPress={() => setRoot(t.id)} disabled={i === trail.length - 1} hitSlop={6}>
              <Text style={{ color: i === trail.length - 1 ? colors.text : colors.textSecondary, fontSize: typeScale.small }}>/ {t.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flex: 1, minHeight: 320 }} onLayout={onLayout} testID="live-org-canvas">
        {W > 0 ? (
          <svg width={W} height={H} role="img" aria-label={`组织图：${clusters.length} 个部门，${online} 个 agent 在跑，近 10 分钟 ${countLabel} 次派活`} style={{ display: 'block', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' }}>
            <style>{`@keyframes anetFlow{to{stroke-dashoffset:-18}} .anet-flow{animation:anetFlow 1.2s linear infinite}`}</style>
            {flow.edges.map(e => {
              const a = e.from === CORE ? { ...core, r: 10 } : byId.get(e.from); const b = byId.get(e.to);
              if (!a || !b) return null;
              const { x1, y1, x2, y2 } = edgeEnds(a, b);
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1;
              const cx = mx - (dy / len) * len * 0.12, cy = my + (dx / len) * len * 0.12;
              const w = 1.2 + (e.count / maxCount) * 4;
              return (
                <g key={`${e.from}>${e.to}`}>
                  <path className="anet-flow" d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`} fill="none" stroke={colors.accent} strokeOpacity={dark ? 0.55 : 0.45} strokeWidth={w} strokeLinecap="round" strokeDasharray="3 6" />
                  <title>{`${e.from === CORE ? '定时 / 系统' : byId.get(e.from)?.name ?? ''} → ${b.name}：${e.count} 次`}</title>
                </g>
              );
            })}
            {flow.edges.some(e => e.from === CORE) ? (
              <g>
                <circle cx={core.x} cy={core.y} r={7} fill={colors.accent} fillOpacity={0.9} />
                <circle cx={core.x} cy={core.y} r={14} fill="none" stroke={colors.accent} strokeOpacity={0.3} />
                <text x={core.x} y={core.y + 28} textAnchor="middle" fill={colors.textMuted} fontSize={11}>定时 / 系统</text>
                <title>定时任务 / 系统派活从这里出发</title>
              </g>
            ) : null}
            {clusters.map(c => {
              const pts = dotPositions(c.agents.length, c.r);
              const ordered = [...c.agents].sort((x, y) => Number(y.online) - Number(x.online));
              const color = tint(c.hue);
              const clickable = c.hasChildren;
              return (
                <g key={c.id} data-cluster={c.id} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(h => (h === c.id ? null : h))}
                  onClick={() => openCluster(c)} style={{ cursor: clickable ? 'pointer' : 'default' }}>
                  <circle cx={c.x} cy={c.y} r={c.r} fill={color} fillOpacity={dark ? 0.1 : 0.08} stroke={color} strokeOpacity={hover === c.id ? 0.8 : dark ? 0.35 : 0.3} strokeWidth={hover === c.id ? 1.6 : 1} />
                  {ordered.map((a, i) => (
                    <circle key={a.alias} cx={c.x + pts[i].x} cy={c.y + pts[i].y} r={dotRadius(c.r, a.online)}
                      fill={a.online ? color : colors.border} fillOpacity={a.online ? 0.95 : 1}
                      style={{ cursor: p.onOpenAgent ? 'pointer' : undefined }}
                      onClick={(ev: { stopPropagation: () => void }) => { ev.stopPropagation(); p.onOpenAgent?.(a.alias); }}>
                      <title>{`${a.alias}${a.online ? '' : '（离线）'}`}</title>
                    </circle>
                  ))}
                  <text x={c.x} y={c.y + c.r + 17} textAnchor="middle" fill={colors.text} fontSize={13} fontWeight={600}>{c.name}{clickable ? ' ›' : ''}</text>
                  <text x={c.x} y={c.y + c.r + 33} textAnchor="middle" fill={colors.textMuted} fontSize={11}>{`${c.online} 在跑 / ${c.agents.length}`}</text>
                </g>
              );
            })}
          </svg>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.lg, paddingVertical: spacing.sm, borderTopWidth: 0 }} testID="live-org-legend">
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>● 在跑</Text>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small, opacity: 0.7 }}>● 离线</Text>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>┅ 近 10 分钟派活，越粗越多</Text>
        <Text style={{ color: colors.textMuted, fontSize: typeScale.small }}>点部门往里看 · 点头像进聊天</Text>
      </View>
    </View>
  );
}

export const LIVE_ORG_WINDOW_MS = WINDOW_MS;
