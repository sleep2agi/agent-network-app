// 聊天信息(微信「聊天信息」页)的纯模型 —— 会话页右上角只剩一个「⋯」,原来散在页头的
// 🔍 搜索 / 🔔 免打扰 / 📌 置顶 / ⚙ 设置(桌面还有右上角的 📌 窗口置顶)全部收进这一页。
// Owner 2026-09-27:这些图标摆在外面很怪,要像微信那样收到里面去。
//
// 这里只决定「出现哪些行、每行是什么、用抽屉还是推一页」,渲染在 ChatInfoPanel.tsx,
// 接线在 ChatScreen.tsx。纯逻辑,不 import react-native(ck 测试直接 import)。
import { NODE_SECTIONS, visibleNodeSections, type NodeSectionKey } from './node-page-model';
import type { Session } from './api';
import { isAgentNodeSession } from './node-rules';
import { comboFromEvent, FIXED_SHORTCUTS, type KeyEventLike } from './shortcuts-model';

export type ChatInfoRowKey =
  | 'node'
  | 'search'
  | 'btw'
  | 'pin'
  | 'mute'
  | 'windowPin'
  | `section:${Exclude<NodeSectionKey, 'overview' | 'danger'>}`;

export interface ChatInfoRow {
  key: ChatInfoRowKey;
  /** profile = 头像 + 名字那一行;link = 右侧 ›;toggle = 右侧开关。 */
  kind: 'profile' | 'link' | 'toggle';
  label: string;
  /** toggle 的当前值。 */
  value?: boolean;
  /** link 到节点页的某个分区(头像行 = 概览)。 */
  section?: NodeSectionKey;
}

export interface ChatInfoInput {
  alias: string;
  /** 有「设置」入口(onOpenNodeSettings)—— 头像行和节点分区行都靠它。 */
  canOpenNode: boolean;
  /** 会话置顶:和列表长按 / 右键菜单的「置顶」是同一份状态。 */
  pin?: { value: boolean } | null;
  /** 消息免打扰:和列表菜单的「消息免打扰」、以前页头的 🔔 是同一份设置(notify-settings.ts)。 */
  mute?: { value: boolean } | null;
  /** 桌面(Tauri)窗口置顶 —— 以前是窗口右上角悬浮的 📌(DesktopWindowPin)。 */
  windowPin?: { value: boolean } | null;
  /** BTW 旁路入口(chat-entry-flags.ts SHOW_BTW_ENTRY,当前隐藏)。 */
  btw?: boolean;
  /** 节点分区是否出现,口径同 NodeDetailScreen 的只读页(visibleNodeSections)。 */
  hasRulesTarget: boolean;
  skillsCapable: boolean;
}

/**
 * 分组(每组之间留微信式的组间距)。顺序:节点 → 查找 → 开关 → 节点页各分区。
 * 头像行打开节点页「概览」;「危险操作」只读页本来就没有,这里也不给。
 */
export function chatInfoGroups(input: ChatInfoInput): ChatInfoRow[][] {
  const groups: ChatInfoRow[][] = [];
  if (input.canOpenNode) groups.push([{ key: 'node', kind: 'profile', label: input.alias, section: 'overview' }]);

  const tools: ChatInfoRow[] = [{ key: 'search', kind: 'link', label: '查找聊天内容' }];
  if (input.btw) tools.push({ key: 'btw', kind: 'link', label: 'BTW 旁路提问' });
  groups.push(tools);

  const toggles: ChatInfoRow[] = [];
  if (input.pin) toggles.push({ key: 'pin', kind: 'toggle', label: '置顶聊天', value: input.pin.value });
  if (input.mute) toggles.push({ key: 'mute', kind: 'toggle', label: '消息免打扰', value: input.mute.value });
  if (input.windowPin) toggles.push({ key: 'windowPin', kind: 'toggle', label: '窗口置顶', value: input.windowPin.value });
  if (toggles.length) groups.push(toggles);

  if (input.canOpenNode) {
    const visible = visibleNodeSections({ readOnly: true, hasRulesTarget: input.hasRulesTarget, skillsCapable: input.skillsCapable });
    const sections = NODE_SECTIONS
      .filter(s => s.key !== 'overview' && s.key !== 'danger' && visible.includes(s.key))
      .map((s): ChatInfoRow => ({ key: `section:${s.key}` as ChatInfoRowKey, kind: 'link', label: s.label, section: s.key }));
    if (sections.length) groups.push(sections);
  }
  return groups;
}

export interface ChatInfoCaps { rules: boolean; skills: boolean }

/**
 * 聊天信息里「规则文件」「技能」两行出不出现(口径同节点信息页只读态)。
 *
 * 🔴 能力位只在**全量** /api/status 里有:`?light=1` 的投影只有 alias/status/agent/task/server/
 *    updated_at/runtime/network_id,rules_file_capable / skills_capable 一律不带。2026-09-29 owner:
 *    claude-code 节点的聊天信息里没有「规则文件」「技能」—— 这里原来吃的是 light 行,
 *    所以凡是不走 agent-node 的会话(判据只剩 rules_file_capable)永远是 false,与 node_id 无关。
 *    调用方必须喂全量行;喂 light 行只能得到 agent-node 那一半(见 ChatScreen 的回退)。
 */
export function chatInfoCaps(s: Pick<Session, 'agent' | 'rules_file_capable' | 'skills_capable'> | null | undefined): ChatInfoCaps {
  return {
    rules: !!s && (isAgentNodeSession(s) || s.rules_file_capable === true),
    skills: s?.skills_capable === true,
  };
}

/** 宽(桌面 / 安卓双栏):聊天窗格右侧抽屉,Esc 或点外面关;手机单栏:推一页,‹ / 系统返回关。 */
export type ChatInfoPresentation = 'drawer' | 'page';
export function chatInfoPresentation(input: { desktop: boolean; hideBack: boolean }): ChatInfoPresentation {
  return input.desktop || input.hideBack ? 'drawer' : 'page';
}

/** 抽屉宽度:360,窗格太窄时给左边留 48 的遮罩(点它关闭)。 */
export function chatInfoDrawerWidth(paneWidth: number): number {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return 360;
  return Math.max(260, Math.min(360, paneWidth - 48));
}

// ── Ctrl/⌘+F:桌面直接打开「查找聊天内容」 ─────────────────────────────────────
//
// 登记在 设置 → 快捷键 的固定快捷键表里(shortcuts-model.ts FIXED_SHORTCUTS 'chatFind'),
// 这里按同一张表、同一个按键 → 组合串的换算来判,不另写一套。
export const CHAT_FIND_SHORTCUT = FIXED_SHORTCUTS.find(f => f.key === 'chatFind')!;

/** Mod+F:mac 上 ⌘F,其它平台 Ctrl+F;多带任何修饰键(⌃ / Win / Alt / Shift)都不算。输入法组字中不算。 */
export function isChatFindKey(e: KeyEventLike & { isComposing?: boolean }, mac: boolean): boolean {
  if (e.isComposing) return false;
  const combo = comboFromEvent(e, mac);
  return !!combo && CHAT_FIND_SHORTCUT.combos.includes(combo);
}
