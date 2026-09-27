// 设置 → 快捷键(桌面端)的纯模型:有哪些快捷键、默认组合、按键事件 → 组合串、显示成哪几个键帽、
// 冲突与保留组合、存储格式。纯逻辑,不 import react-native。
//
// 🔴 只登记**真的生效**的快捷键(settings-model.ts 同一条规矩):
//   - 可改的:全部由 DesktopWorkspace 的全局 keydown 执行(App.tsx → runShortcut)。
//   - 固定的:别的组件里早就写死的按键(图片预览 ←/→ 与 Esc、规则文件 Ctrl/⌘+F、弹窗 Esc),
//     这里只是如实列出来,不能改 —— 改它们要动五六处各自的监听,那是另一件事。
//   - 发送键:聊天输入框的 onKeyPress 读 sendKey(chat-actions.ts shouldSendOnEnter)。
//
// 组合串格式:修饰键按 Mod, Ctrl, Alt, Shift 的顺序 + 主键,用 '+' 连接,如 'Mod+K'、'Mod+Shift+1'。
// Mod = mac 上的 ⌘ / 其它平台的 Ctrl;Ctrl 只在 mac 上单独出现(⌃)。

export type ShortcutGroupKey = 'nav' | 'chat' | 'input';

export const SHORTCUT_GROUPS: readonly { key: ShortcutGroupKey; label: string }[] = [
  { key: 'nav', label: '导航' },
  { key: 'chat', label: '会话' },
  { key: 'input', label: '输入' },
];

export type ShortcutId =
  | 'nav.search'
  | 'nav.settings'
  | 'nav.tab.agents'
  | 'nav.tab.tasks'
  | 'nav.tab.scheduled'
  | 'nav.tab.messages'
  | 'nav.tab.server';

export type ShortcutDef = { id: ShortcutId; group: ShortcutGroupKey; label: string; defaultCombo: string };

// 桌面导航栏的顺序(App.tsx DESKTOP_MAIN_TABS):Agents / Tasks / 定时 / Messages / 服务器设置。
export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'nav.search', group: 'nav', label: '搜索 agent', defaultCombo: 'Mod+K' },
  { id: 'nav.settings', group: 'nav', label: '打开设置', defaultCombo: 'Mod+,' },
  { id: 'nav.tab.agents', group: 'nav', label: '切换到 Agents', defaultCombo: 'Mod+1' },
  { id: 'nav.tab.tasks', group: 'nav', label: '切换到 Tasks', defaultCombo: 'Mod+2' },
  { id: 'nav.tab.scheduled', group: 'nav', label: '切换到 定时', defaultCombo: 'Mod+3' },
  { id: 'nav.tab.messages', group: 'nav', label: '切换到 Messages', defaultCombo: 'Mod+4' },
  { id: 'nav.tab.server', group: 'nav', label: '切换到 服务器设置', defaultCombo: 'Mod+5' },
];

/** 导航栏 tab 快捷键 → 屏幕名(与 DESKTOP_MAIN_TABS 的 key 一致)。 */
export const TAB_FOR_SHORTCUT: Partial<Record<ShortcutId, string>> = {
  'nav.tab.agents': 'agents',
  'nav.tab.tasks': 'tasks',
  'nav.tab.scheduled': 'scheduled',
  'nav.tab.messages': 'messages',
  'nav.tab.server': 'server',
};

/** 固定的(别处写死、不可改)快捷键:只展示。combos 是「任一」关系。 */
export type FixedShortcut = { key: string; group: ShortcutGroupKey; label: string; combos: readonly string[] };
export const FIXED_SHORTCUTS: readonly FixedShortcut[] = [
  { key: 'closeOverlay', group: 'chat', label: '关闭弹窗 / 图片预览', combos: ['Escape'] },
  { key: 'viewerPrevNext', group: 'chat', label: '图片预览:上一张 / 下一张', combos: ['ArrowLeft', 'ArrowRight'] },
  { key: 'rulesFind', group: 'chat', label: '规则文件内查找', combos: ['Mod+F'] },
];

// ── 发送键 ─────────────────────────────────────────────────────────────────────
export type SendKey = 'enter' | 'modEnter';
export const DEFAULT_SEND_KEY: SendKey = 'enter';
export const parseSendKey = (v: unknown): SendKey => (v === 'modEnter' ? 'modEnter' : 'enter');
/** 「发送」「换行」两行各自显示的组合。 */
export const sendCombo = (k: SendKey): string => (k === 'modEnter' ? 'Mod+Enter' : 'Enter');
export const newlineCombo = (k: SendKey): string => (k === 'modEnter' ? 'Enter' : 'Shift+Enter');

// ── 平台 ───────────────────────────────────────────────────────────────────────
export const isMacLike = (platformOrUa: string): boolean => /Mac|iPhone|iPad|iPod/i.test(platformOrUa);

// ── 事件 → 组合串 ──────────────────────────────────────────────────────────────
export type KeyEventLike = { key?: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };

const CODE_KEYS: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter',
};
const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'OS', 'AltGraph', 'CapsLock', 'Fn', 'Hyper', 'Super']);

/**
 * 主键。优先看 `code`(物理键):mac 上 ⌥+K 的 key 是 '˚'、Shift+1 的 key 是 '!',按 key 判会
 * 永远对不上默认组合。没有 code(旧 WebView)再退回 key。纯修饰键返回 null。
 */
export function mainKeyOf(e: KeyEventLike): string | null {
  const code = e.code ?? '';
  let m: RegExpMatchArray | null;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^(?:Digit|Numpad)([0-9])$/))) return m[1];
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  const key = e.key ?? '';
  if (!key || MODIFIER_KEYS.has(key) || key === 'Dead' || key === 'Unidentified' || key === 'Process') return null;
  if (key === ' ') return 'Space';
  if (key === 'Esc') return 'Escape';
  if (key.length === 1) return key.toUpperCase();
  return key; // Enter / Escape / Tab / ArrowLeft / F1 …
}

export function comboFromEvent(e: KeyEventLike, mac: boolean): string | null {
  const key = mainKeyOf(e);
  if (!key) return null;
  const parts: string[] = [];
  const mod = mac ? !!e.metaKey : !!e.ctrlKey;
  if (mod) parts.push('Mod');
  if (mac && e.ctrlKey) parts.push('Ctrl');
  if (!mac && e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const MOD_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'];
/** 存储里读出来的串 → 规范形(修饰键顺序、大小写);认不出返回 null。 */
export function normalizeCombo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // 主键本身可能是 '+' 以外的任何单字符;按 '+' 切,最后一段是主键。
  const parts = s.split('+');
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set<string>();
  for (const p of parts) {
    const hit = MOD_ORDER.find(m => m.toLowerCase() === p.toLowerCase());
    if (!hit || mods.has(hit)) return null;
    mods.add(hit);
  }
  const mainKey = key.length === 1 ? key.toUpperCase() : key;
  return [...MOD_ORDER.filter(m => mods.has(m)), mainKey].join('+');
}

// ── 显示 ───────────────────────────────────────────────────────────────────────
const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter',
};
/** 一个组合 → 键帽文字列表。mac:⌘ ⌃ ⌥ ⇧;其它:Ctrl Win Alt Shift。 */
export function comboChips(combo: string, mac: boolean): string[] {
  const parts = combo.split('+');
  // 'Mod++' 这种主键是 '+' 的情况本模型不产生(Equal 键记作 '='),不特判。
  const key = parts.pop() ?? '';
  const mods = parts.map(m => {
    if (m === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (m === 'Ctrl') return '⌃';
    if (m === 'Meta') return 'Win';
    if (m === 'Alt') return mac ? '⌥' : 'Alt';
    if (m === 'Shift') return mac ? '⇧' : 'Shift';
    return m;
  });
  return [...mods, KEY_LABELS[key] ?? key];
}

// ── 校验 / 冲突 ─────────────────────────────────────────────────────────────────
/** 编辑器 / 系统会用到的组合:不许绑(绑了要么抢走复制粘贴,要么根本收不到)。 */
export const RESERVED_COMBOS: Readonly<Record<string, string>> = {
  'Mod+A': '全选', 'Mod+C': '复制', 'Mod+V': '粘贴', 'Mod+X': '剪切', 'Mod+Z': '撤销', 'Mod+Shift+Z': '重做', 'Mod+Y': '重做',
  'Mod+Q': '退出应用', 'Mod+W': '关闭窗口', 'Mod+H': '隐藏窗口', 'Mod+M': '最小化',
  'Mod+Enter': '发送 / 换行',
};

export type CaptureVerdict =
  | { ok: true; combo: string }
  | { ok: false; reason: 'needsModifier' | 'reserved' | 'conflict'; message: string; conflictWith?: ShortcutId | string };

const isFunctionKey = (key: string) => /^F([1-9]|1[0-9]|2[0-4])$/.test(key);

/**
 * 录入一个新组合时的判定:必须带 ⌘/Ctrl(或是 F1–F24)—— 不带的话在输入框里打字就会误触发;
 * 不能是保留组合、固定快捷键,也不能和另一条可改快捷键重复。
 */
export function judgeCapture(id: ShortcutId, combo: string, bindings: Readonly<Record<ShortcutId, string>>, mac: boolean): CaptureVerdict {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const hasMod = parts.includes('Mod') || parts.includes('Ctrl');
  if (!hasMod && !isFunctionKey(key)) {
    return { ok: false, reason: 'needsModifier', message: `需要带 ${mac ? '⌘' : 'Ctrl'}(或用 F1–F12)` };
  }
  if (RESERVED_COMBOS[combo]) return { ok: false, reason: 'reserved', message: `${comboChips(combo, mac).join(' ')} 是「${RESERVED_COMBOS[combo]}」,不能占用`, conflictWith: combo };
  const fixed = FIXED_SHORTCUTS.find(f => f.combos.includes(combo));
  if (fixed) return { ok: false, reason: 'conflict', message: `和「${fixed.label}」冲突`, conflictWith: fixed.key };
  const other = SHORTCUTS.find(s => s.id !== id && bindings[s.id] === combo);
  if (other) return { ok: false, reason: 'conflict', message: `和「${other.label}」冲突`, conflictWith: other.id };
  return { ok: true, combo };
}

// ── 存储 ───────────────────────────────────────────────────────────────────────
export type ShortcutPrefs = { overrides: Partial<Record<ShortcutId, string>>; sendKey: SendKey };
export const EMPTY_PREFS: ShortcutPrefs = { overrides: {}, sendKey: DEFAULT_SEND_KEY };

export function defaultBindings(): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const s of SHORTCUTS) out[s.id] = s.defaultCombo;
  return out;
}

/** 默认 + 覆盖。覆盖里认不出的 id / 组合丢掉;两条撞成同一组合时,后者退回默认(不让一个组合对两个动作)。 */
export function resolveBindings(prefs: ShortcutPrefs): Record<ShortcutId, string> {
  const out = defaultBindings();
  for (const s of SHORTCUTS) {
    const combo = normalizeCombo(prefs.overrides[s.id]);
    if (combo) out[s.id] = combo;
  }
  const seen = new Map<string, ShortcutId>();
  for (const s of SHORTCUTS) {
    const combo = out[s.id];
    if (seen.has(combo)) out[s.id] = s.defaultCombo;
    seen.set(out[s.id], s.id);
  }
  return out;
}

export function parseShortcutPrefs(raw: string | null | undefined): ShortcutPrefs {
  if (!raw) return { overrides: {}, sendKey: DEFAULT_SEND_KEY };
  try {
    const v = JSON.parse(raw);
    const overrides: Partial<Record<ShortcutId, string>> = {};
    if (v && typeof v.overrides === 'object' && v.overrides) {
      for (const s of SHORTCUTS) {
        const combo = normalizeCombo(v.overrides[s.id]);
        if (combo) overrides[s.id] = combo;
      }
    }
    return { overrides, sendKey: parseSendKey(v?.sendKey) };
  } catch {
    return { overrides: {}, sendKey: DEFAULT_SEND_KEY };
  }
}

export const serializeShortcutPrefs = (p: ShortcutPrefs): string => JSON.stringify({ overrides: p.overrides, sendKey: p.sendKey });

/** 设成默认值就不存覆盖(以后改了默认,没动过的人跟着新默认走)。 */
export function withBinding(p: ShortcutPrefs, id: ShortcutId, combo: string | null): ShortcutPrefs {
  const overrides = { ...p.overrides };
  const def = SHORTCUTS.find(s => s.id === id)?.defaultCombo;
  if (combo === null || combo === def) delete overrides[id];
  else overrides[id] = combo;
  return { ...p, overrides };
}

export const isCustomized = (p: ShortcutPrefs, id: ShortcutId): boolean => p.overrides[id] !== undefined;
export const anyCustomized = (p: ShortcutPrefs): boolean => Object.keys(p.overrides).length > 0 || p.sendKey !== DEFAULT_SEND_KEY;

/** 全局 keydown:这个组合对应哪个可改快捷键(没有 = null)。 */
export function shortcutForCombo(bindings: Readonly<Record<ShortcutId, string>>, combo: string | null): ShortcutId | null {
  if (!combo) return null;
  for (const s of SHORTCUTS) if (bindings[s.id] === combo) return s.id;
  return null;
}

/** 可改快捷键 → 要做的事。App.tsx DesktopWorkspace 照此执行。 */
export type ShortcutAction = { kind: 'screen'; screen: string } | { kind: 'agentSearch' };
export function shortcutAction(id: ShortcutId): ShortcutAction {
  if (id === 'nav.search') return { kind: 'agentSearch' };
  if (id === 'nav.settings') return { kind: 'screen', screen: 'settings' };
  return { kind: 'screen', screen: TAB_FOR_SHORTCUT[id] ?? 'agents' };
}
