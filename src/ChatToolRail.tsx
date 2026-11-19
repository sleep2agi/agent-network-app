// 聊天右侧「工具条」(admin 2026-10-30:类 Codex 最右侧工具栏)。
//
// 只放**现成只读能力**,不新增后端:
//   任务  —— 该节点被派到/在做的任务(NodeTasksSection)
//   技能  —— 这个节点装了哪些 skills(NodeSkillsSection)
// 文件 / 日志 需要完整的 node/session 上下文,留到下一版接(现在点了会给「需要节点上下文」的提示)。
//
// 形态:贴右侧边缘的竖直图标条(常驻);点开面板停靠在条左侧。0.2.563 起聊天页按
// chatToolRailReserve() 给自己留右边距,侧栏占自己的列宽,不再压住气泡(0.2.368 隐藏它的原因)。
// 展开状态、当前工具、面板宽度都按设备记忆(localStorage)。
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import NodeFilesSection from './NodeFilesSection';
import NodeLogsSection from './NodeLogsSection';
import NodeSkillsSection from './NodeSkillsSection';
import type { HubConfig, Session } from './api';
import { colors, radius, spacing, type as typeScale } from './theme';
import { useGlassChrome } from './glass-chrome';
import NodeSchedulesSection from './NodeSchedulesSection';
import RailTasksPanel from './RailTasksPanel';
import { CHAT_TOOL_RAIL_WIDTH } from './chat-tool-rail-layout';

const KEY = 'anet_chat_toolrail_v1';
type Tool = 'tasks' | 'schedules' | 'skills' | 'files' | 'logs';
export type ChatToolRailState = { open: boolean; tool: Tool; width: number };

/** needSession 的工具要拿到该会话的 Session(聊天页的 controlSession)才能发请求,没有就置灰。 */
const TOOLS: { key: Tool; label: string; icon: string; needSession?: boolean }[] = [
  { key: 'tasks', label: '任务', icon: 'checkbox-outline' },
  // admin 2026-11-19「这里来一个定时任务的入口？」：这个 agent 要执行的定时任务，就地新建 / 编辑（同节点页的分区）。
  { key: 'schedules', label: '定时任务', icon: 'time-outline' },
  { key: 'skills', label: '技能', icon: 'sparkles-outline' },
  { key: 'files', label: '文件', icon: 'folder-outline', needSession: true },
  { key: 'logs', label: '日志', icon: 'document-text-outline', needSession: true },
];

function readState(): ChatToolRailState {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY) ?? null;
    const v = raw ? JSON.parse(raw) : null;
    return {
      // 默认只亮 44px 图标条(常驻侧栏),点图标才展开面板;展开与否按设备记忆。
      // 不默认展开:1000~1200 宽的窗口里展开会把聊天区挤到 ~430。
      open: !!v?.open,
      tool: TOOLS.some(t => t.key === v?.tool) ? v.tool : 'tasks',
      width: Number.isFinite(v?.width) ? Math.min(560, Math.max(280, v.width)) : 340,
    };
  } catch { return { open: false, tool: 'tasks', width: 340 }; }
}
function writeState(s: ChatToolRailState): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, JSON.stringify(s)); } catch { /* 只是偏好 */ }
}

/** 状态提到聊天页:聊天页要按「图标条 + 展开面板」的宽度给自己留出右边距(停靠,不再浮在气泡上)。 */
export function useChatToolRail(): [ChatToolRailState, (f: (s: ChatToolRailState) => ChatToolRailState) => void] {
  const [state, setState] = useState(readState);
  useEffect(() => { writeState(state); }, [state]);
  return [state, setState];
}

export default function ChatToolRail({ cfg, alias, session, state, setState, dockedWidth = null }: {
  cfg: HubConfig; alias: string; session?: Session | null;
  state: ChatToolRailState; setState: (f: (s: ChatToolRailState) => ChatToolRailState) => void;
  /** 停靠时的实际面板宽度(chat-tool-rail-layout.dockedPanelWidth);null = 窗口太窄,面板浮在聊天上。 */
  dockedWidth?: number | null;
}) {
  // 桌面整窗渐变时图标条透明，不在右下角把光切断；展开的面板仍是实底（要读文字）。
  const glass = useGlassChrome();
  const pick = (tool: Tool) => setState(s => (s.open && s.tool === tool ? { ...s, open: false } : { ...s, open: true, tool }));
  const active = state.open ? state.tool : null;
  // 只读区块要一个 session 形状;聊天页没有完整的 node 上下文,退到按 alias 发。
  const stubSession = { alias, status: 'online' } as unknown as Session;
  const realSession = session ?? null;
  // 定时任务按执行节点的 node_id 认；会话没上报 node_id 时 NodeSchedulesSection 会说明原因、不画「新建」。
  const scheduleNodeId = (realSession as { node_id?: string | null } | null)?.node_id ?? null;
  const [scheduleCreateSeq, setScheduleCreateSeq] = useState(0);
  return (
    <>
      {state.open ? (
        <View testID="chat-tool-panel" style={{ position: 'absolute', right: CHAT_TOOL_RAIL_WIDTH, top: 0, bottom: 0, width: dockedWidth ?? state.width, zIndex: 25,
          // 停靠时(聊天已经让出这块宽度)且整窗渐变打开:面板透明,和左边聊天、右边图标条连成一片;
          // 浮层(窗口太窄)时盖在聊天上面,必须实底,否则文字叠在一起。
          backgroundColor: glass && dockedWidth !== null ? 'transparent' : colors.bg, borderLeftWidth: 1, borderLeftColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, height: 44, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body, fontWeight: '600' }} testID="chat-tool-title">
              {TOOLS.find(t => t.key === active)?.label ?? ''}
            </Text>
            {active === 'schedules' && scheduleNodeId ? (
              <Pressable accessibilityRole="button" accessibilityLabel="新建定时任务" testID="chat-tool-schedule-create" hitSlop={6}
                onPress={() => setScheduleCreateSeq(n => n + 1)}
                style={({ pressed }) => ({ height: 26, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 })}>
                <Text style={{ color: colors.onAccent, fontSize: typeScale.small, fontWeight: '600' }}>＋ 新建</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="关闭工具面板" testID="chat-tool-close"
              onPress={() => setState(s => ({ ...s, open: false }))} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md }} testID="chat-tool-body">
            {active === 'tasks' ? <RailTasksPanel cfg={cfg} alias={alias} nodeId={(realSession as { node_id?: string | null } | null)?.node_id ?? null} /> : null}
            {active === 'schedules' ? (
              scheduleNodeId
                ? <NodeSchedulesSection cfg={cfg} nodeId={scheduleNodeId} editable createSeq={scheduleCreateSeq} emptyCreate={false} />
                : <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }} testID="chat-tool-schedules-no-node">
                    这个会话还没上报节点 id（或节点离线），暂时不能给它建定时任务；可以到左侧「定时任务」页新建。
                  </Text>
            ) : null}
            {active === 'skills' ? <NodeSkillsSection cfg={cfg} alias={alias} session={realSession ?? stubSession} /> : null}
            {active === 'files' && realSession ? <NodeFilesSection cfg={cfg} alias={alias} session={realSession} /> : null}
            {active === 'logs' && realSession ? <NodeLogsSection cfg={cfg} alias={alias} session={realSession} pointer /> : null}
            {(active === 'files' || active === 'logs') && !realSession ? (
              <Text style={{ color: colors.textMuted, fontSize: typeScale.small, lineHeight: 18 }} testID="chat-tool-need-session">
                这个会话还没有节点状态（或节点已离线），拿不到{active === 'files' ? '文件' : '日志'}。
              </Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      {/*
        🔴 admin 2026-10-30 现场：工具条被排到输入框**下方**，撑出一条几乎全宽的空白带。
        原因：ChatToolRail 是聊天页列布局里的最后一个兄弟，宽度 44 只约束了自己，
        但它在列流里占了一整行高度，于是输入框下面多出一大块空白。

        形态本来就该是「贴右侧边缘的常驻竖直图标条」（见文件头注释），
        所以这里改成绝对定位：不参与列流、不占高度、永远贴右边。
        zIndex 低于工具面板（面板是 25），面板浮在它左侧（right: 44）。
      */}
      <View testID="chat-tool-rail" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 20, width: CHAT_TOOL_RAIL_WIDTH, borderLeftWidth: 1, borderLeftColor: colors.border, backgroundColor: glass ? 'transparent' : colors.bg, paddingTop: spacing.sm, gap: spacing.xs, alignItems: 'center' }}>
        {TOOLS.map(t => {
          const on = active === t.key;
          const disabled = !!t.needSession && !realSession;
          return (
            <Pressable key={t.key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={t.label}
              testID={`chat-tool-${t.key}`} disabled={disabled} onPress={() => pick(t.key)}
              style={({ pressed }) => [{ width: 36, height: 36, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? colors.subtleFill : 'transparent' }, pressed && { opacity: 0.7 }]}>
              <Ionicons name={t.icon as never} size={18} color={disabled ? colors.textMuted : on ? colors.accent : colors.textSecondary} />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}
