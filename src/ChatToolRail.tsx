// 聊天右侧「工具条」(admin 2026-10-30:类 Codex 最右侧工具栏)。
//
// 只放**现成只读能力**,不新增后端:
//   任务  —— 该节点被派到/在做的任务(NodeTasksSection)
//   技能  —— 这个节点装了哪些 skills(NodeSkillsSection)
// 文件 / 日志 需要完整的 node/session 上下文,留到下一版接(现在点了会给「需要节点上下文」的提示)。
//
// 形态:贴右侧边缘的竖直图标条(常驻);点开面板浮在条左侧,不挤压聊天区,关掉即恢复。
// 展开状态、当前工具、面板宽度都按设备记忆(localStorage)。
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import NodeFilesSection from './NodeFilesSection';
import NodeLogsSection from './NodeLogsSection';
import NodeSkillsSection from './NodeSkillsSection';
import NodeTasksSection from './NodeTasksSection';
import type { HubConfig, Session } from './api';
import { colors, radius, spacing, type as typeScale } from './theme';

const KEY = 'anet_chat_toolrail_v1';
type Tool = 'tasks' | 'skills' | 'files' | 'logs';

/** needSession 的工具要拿到该会话的 Session(聊天页的 controlSession)才能发请求,没有就置灰。 */
const TOOLS: { key: Tool; label: string; icon: string; needSession?: boolean }[] = [
  { key: 'tasks', label: '任务', icon: 'checkbox-outline' },
  { key: 'skills', label: '技能', icon: 'sparkles-outline' },
  { key: 'files', label: '文件', icon: 'folder-outline', needSession: true },
  { key: 'logs', label: '日志', icon: 'document-text-outline', needSession: true },
];

function readState(): { open: boolean; tool: Tool; width: number } {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY) ?? null;
    const v = raw ? JSON.parse(raw) : null;
    return {
      open: !!v?.open,
      tool: v?.tool === 'skills' ? 'skills' : 'tasks',
      width: Number.isFinite(v?.width) ? Math.min(560, Math.max(280, v.width)) : 360,
    };
  } catch { return { open: false, tool: 'tasks', width: 360 }; }
}
function writeState(s: { open: boolean; tool: Tool; width: number }): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, JSON.stringify(s)); } catch { /* 只是偏好 */ }
}

export default function ChatToolRail({ cfg, alias, session }: { cfg: HubConfig; alias: string; session?: Session | null }) {
  const [state, setState] = useState(readState);
  useEffect(() => { writeState(state); }, [state]);
  const pick = (tool: Tool) => setState(s => (s.open && s.tool === tool ? { ...s, open: false } : { ...s, open: true, tool }));
  const active = state.open ? state.tool : null;
  // 只读区块要一个 session 形状;聊天页没有完整的 node 上下文,退到按 alias 发。
  const stubSession = { alias, status: 'online' } as unknown as Session;
  const realSession = session ?? null;
  return (
    <>
      {state.open ? (
        <View testID="chat-tool-panel" style={{ position: 'absolute', right: 44, top: 0, bottom: 0, width: state.width, zIndex: 25,
          backgroundColor: colors.bg, borderLeftWidth: 1, borderLeftColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, height: 44, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ flex: 1, color: colors.text, fontSize: typeScale.body, fontWeight: '600' }} testID="chat-tool-title">
              {TOOLS.find(t => t.key === active)?.label ?? ''}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭工具面板" testID="chat-tool-close"
              onPress={() => setState(s => ({ ...s, open: false }))} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md }} testID="chat-tool-body">
            {active === 'tasks' ? <NodeTasksSection cfg={cfg} alias={alias} embedded /> : null}
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
      <View testID="chat-tool-rail" style={{ width: 44, borderLeftWidth: 1, borderLeftColor: colors.border, backgroundColor: colors.bg, paddingTop: spacing.sm, gap: spacing.xs, alignItems: 'center' }}>
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
