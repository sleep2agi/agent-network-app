// 键盘语音输入(设置 → 快捷键 → 输入:「按住说话」「语音输入开关」)的状态机。纯逻辑,不 import react-native。
//
// 桌面聊天页(ChatScreen)在 window 的捕获阶段把 keydown / keyup / 失焦喂进来,按返回的 effect 去驱动
// **输入框里的同一条录音条**(desktop-voice-bar-model.ts:开始 = 点 🎤、release = 完成 ✓、cancel = 取消 ✕),
// 所以用的是 #446 选的麦克风、#436 的插到光标处,这里不重复实现。
//
//   idle ──按住说话 keydown──▶ hold ──组合里任一键 keyup──▶ idle(release:识别并插入)
//     │                         └──Esc──▶ idle(cancel)          └──窗口失焦──▶ idle(release,见下)
//     └──开关 keydown──▶ toggle ──开关 keydown──▶ idle(release)
//                          └──Esc──▶ idle(cancel)
//   按住不放的自动重复(repeat)一律吃掉、不重开录音。录音自己结束了(60 s 上限、太短、开麦失败、未配置)
//   → sync 把这里也拉回 idle,之后的 keyup 不再发 release。
//
// 🔴 失焦(切到别的窗口 / 弹出系统对话框)时按住说话 = **当作松开:停止并插入**,不取消。
//   理由:插入只进草稿、不会发出去,不想要删掉就是;而取消会把一整段话丢掉、没法找回。
//   失焦后 keyup 发给别的窗口,我们永远等不到它 —— 不处理的话会一直录到 60 s 上限。
//   开关模式不看失焦(它本来就不需要一直按着),再按一次或 Esc 才结束。
//
// 🔴 mac 上按着 ⌘ 时,松开其它键**浏览器收不到 keyup**(macOS 的老问题),⌘⇧Space 松开 Space 没有事件;
//   所以组合里的修饰键松开也算松开 —— 用户总要把 ⌘ 放开,那一下一定有 keyup。

import { mainKeyOf, type KeyEventLike } from './shortcuts-model';

export type KbdVoiceMode = 'hold' | 'toggle';

export type KbdVoiceState =
  | { mode: 'idle' }
  /** combo:按下的那个组合(规范串),松开判定只看它里面的键。 */
  | { mode: KbdVoiceMode; combo: string };

export const KBD_IDLE: KbdVoiceState = { mode: 'idle' };

export type KbdVoiceEffect =
  | 'none'
  /** 开始录音(= 按下麦克风)。 */
  | 'press'
  /** 停止并识别、插到光标处(= 松开麦克风)。 */
  | 'release'
  /** 丢弃这段录音。 */
  | 'cancel'
  /** 没有打开的会话:提示「先打开一个会话」。 */
  | 'needComposer';

export type KbdVoiceStep = {
  state: KbdVoiceState;
  effect: KbdVoiceEffect;
  /** 这个按键事件要不要 preventDefault(吃掉,不让它再去打字 / 触发别的快捷键)。 */
  consume: boolean;
};

export const NEED_COMPOSER_NOTICE = '先打开一个会话';

export type KbdVoiceKeyDown = {
  /** 这个组合绑定的是哪一条语音快捷键(不是语音快捷键 = null)。 */
  shortcut: KbdVoiceMode | null;
  combo: string | null;
  /** 按住不放时浏览器补发的 keydown。 */
  repeat: boolean;
  escape: boolean;
};

export type KbdVoiceContext = {
  /** 当前页面上有没有聊天输入框。 */
  composer: boolean;
  /** 语音那边空闲吗(上一句还在识别时再按无效,和麦克风按钮一样)。 */
  voiceIdle: boolean;
};

const step = (state: KbdVoiceState, effect: KbdVoiceEffect, consume: boolean): KbdVoiceStep => ({ state, effect, consume });

export function kbdVoiceKeyDown(state: KbdVoiceState, ev: KbdVoiceKeyDown, ctx: KbdVoiceContext): KbdVoiceStep {
  if (ev.escape && !ev.shortcut) {
    // Esc 只在录音中归我们;空闲时放行给弹窗 / 图片预览自己的 Esc。
    return state.mode === 'idle' ? step(state, 'none', false) : step(KBD_IDLE, 'cancel', true);
  }
  if (!ev.shortcut || !ev.combo) return step(state, 'none', false);
  if (ev.repeat) return step(state, 'none', true);
  if (!ctx.composer) return step(state, state.mode === 'idle' ? 'needComposer' : 'none', true);
  if (state.mode === 'toggle' && ev.shortcut === 'toggle') return step(KBD_IDLE, 'release', true);
  // 一种模式进行中,另一条快捷键不插手(按住说话期间按开关、开关录音中按住说话)。
  if (state.mode !== 'idle') return step(state, 'none', true);
  if (!ctx.voiceIdle) return step(state, 'none', true);
  return step({ mode: ev.shortcut, combo: ev.combo }, 'press', true);
}

/** 组合串里的修饰键 → 松开时 KeyboardEvent.key 的值。Mod 在 mac 上是 ⌘(Meta),其它平台是 Ctrl。 */
export function comboReleaseKeys(combo: string, mac: boolean): { main: string; modifiers: string[] } {
  const parts = combo.split('+');
  const main = parts.pop() ?? '';
  const modifiers = parts.map(m => {
    if (m === 'Mod') return mac ? 'Meta' : 'Control';
    if (m === 'Ctrl') return 'Control';
    return m; // Meta / Alt / Shift 与 KeyboardEvent.key 同名
  });
  return { main, modifiers };
}

/** 松开一个键:按住说话模式下,组合里的主键或任一修饰键松开 = 松手。开关模式不看 keyup。 */
export function kbdVoiceKeyUp(state: KbdVoiceState, ev: KeyEventLike, mac: boolean): KbdVoiceStep {
  if (state.mode !== 'hold') return step(state, 'none', false);
  const { main, modifiers } = comboReleaseKeys(state.combo, mac);
  const key = ev.key === 'OS' ? 'Meta' : ev.key ?? '';
  const released = mainKeyOf(ev) === main || modifiers.includes(key);
  return released ? step(KBD_IDLE, 'release', true) : step(state, 'none', false);
}

/** 窗口失焦 / 页面隐藏。按住说话 = 松开(停止并插入,理由见文件头);开关模式不变。 */
export function kbdVoiceBlur(state: KbdVoiceState): KbdVoiceStep {
  if (state.mode !== 'hold') return step(state, 'none', false);
  return step(KBD_IDLE, 'release', false);
}

/**
 * 语音那边自己回到空闲 / 进入识别(60 s 上限自动松开、太短、开麦失败、未配置去设置):这里跟着回 idle,
 * 不发任何 effect —— 那一句已经由语音状态机处理完了。
 */
export function kbdVoiceSync(state: KbdVoiceState, voicePhase: string): KbdVoiceState {
  if (state.mode === 'idle') return state;
  return voicePhase === 'idle' || voicePhase === 'transcribing' ? KBD_IDLE : state;
}

/** 录音条(DesktopVoiceBar)上的提示:用快捷键录音时怎么结束、怎么取消。chips = 该组合的键帽文字。 */
export function kbdVoiceHint(mode: KbdVoiceMode, chips: readonly string[], mac: boolean, phase: string): string {
  if (phase === 'transcribing') return '识别中…';
  if (phase === 'starting') return '准备录音…';
  const keys = chips.join(mac ? '' : '+');
  return mode === 'hold' ? `松开 ${keys} 完成 · Esc 取消` : `再按 ${keys} 完成 · Esc 取消`;
}
