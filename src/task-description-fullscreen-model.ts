// 任务描述的「⤢ 全屏」和语音输入:手机 / 桌面各一套(owner 09-27:「Windows Mac 跟安卓版肯定是不一样的」)。
// 纯逻辑,不 import react-native。
//
//   手机(手指):全屏 = 推入的一整页 —— ‹ 返回 · 编辑/预览 · 🖼;编辑时底部一条「按住 说话」(聊天同一个
//     VoiceHoldBar + 微信式 VoiceHoldOverlay),识别结果插到编辑框里按下那一刻的光标处(insertAtSelection)。
//     详情页里的小编辑框不放麦克风:那里没有地方放整条大按钮,也没有能铺满的浮层宿主。
//   桌面(鼠标):全屏 = 盖住整个窗口的编辑器 —— 阅读 / 编辑 / 左右(规则文件 #491 同一套零件,SplitEditorParts),
//     🖼、🎤;🎤 点一下开始,录音条(DesktopVoiceBar,#463)就地出现,Enter 完成、Esc 取消;
//     快捷键(#466,设置里的 按住说话 / 语音输入开关)在描述处于可编辑状态时归描述。详情页里的小编辑框也有 🎤。
//
// 判定只有一个:pointer(pointer-ui.ts,鼠标 vs 手指),和任务页其它地方一样。
//
// 所见即所得(owner 09-30「富文本的直接编辑,不需要点到 Markdown 里面去编辑,但底层还是存 Markdown」):
//   只在桌面 / 网页的鼠标界面(rich = pointer && web && 这段描述能保真地进富文本,见 rich-markdown.ts richSafety)。
//   小编辑框的 编辑/预览 换成 富文本/源码('rich' / 'edit');全屏的「阅读」换成可编辑的「富文本」。
//   手机不变:原生安卓没有 contenteditable,RN 的 TextInput 做不了富文本,仍是 Markdown 编辑 + 预览。

import type { RulesViewMode } from './node-rules-view';

export type InlineMode = 'edit' | 'preview' | 'rich';

/**
 * 打开描述时的模式:能用富文本就直接富文本(读和改是同一个地方);否则有内容先预览、空的直接编辑。
 * rich = null:富文本的判据还没加载完 —— 先预览,加载完能用时由 inlineModeFor 换成富文本(空描述也先预览,不先闪一下源码框)。
 */
export function initialInlineMode(value: string, rich: boolean | null): InlineMode {
  if (rich) return 'rich';
  if (rich === null) return 'preview';
  return value.trim() ? 'preview' : 'edit';
}

/** 富文本用不了了(源码里写进了 HTML 等)时,富文本模式退回预览。 */
export function inlineModeFor(mode: InlineMode, rich: boolean): InlineMode {
  if (rich) return mode === 'preview' ? 'rich' : mode;
  return mode === 'rich' ? 'preview' : mode;
}

/** 全屏的样子:桌面是带「阅读 / 编辑 / 左右」的全窗编辑器,手机是推入的一整页。 */
export function fullscreenKind(pointer: boolean): 'desktopEditor' | 'phonePage' {
  return pointer ? 'desktopEditor' : 'phonePage';
}

/**
 * 桌面全屏打开时的模式:从「预览」进来 = 阅读;从「编辑」进来 = 左右(放得下时),否则编辑。
 * 放不下左右时(窗口太窄)已选的「左右」退回「编辑」。
 */
export function desktopFullscreenMode(inline: InlineMode, splitOk: boolean): RulesViewMode {
  if (inline === 'preview' || inline === 'rich') return 'read';
  return splitOk ? 'split' : 'edit';
}

export function effectiveDesktopMode(mode: RulesViewMode, splitOk: boolean): RulesViewMode {
  return mode === 'split' && !splitOk ? 'edit' : mode;
}

/** 退出桌面全屏回到小编辑框时的模式:阅读 → 预览(富文本时 → 富文本),编辑 / 左右 → 编辑。 */
export function inlineModeAfterFullscreen(mode: RulesViewMode, rich = false): InlineMode {
  if (mode === 'read') return rich ? 'rich' : 'preview';
  return 'edit';
}

/**
 * 现在有没有一个能打字的编辑框(🖼 / 🎤 / 快捷键只在这时出现 / 生效)。full = 桌面全屏的模式(没开 = null)。
 * rich = 富文本可用:这时全屏的「阅读」就是富文本编辑器,也能打字。
 */
export function descriptionEditable(inline: InlineMode, full: RulesViewMode | null, rich = false): boolean {
  if (full) return full !== 'read' || rich;
  return inline === 'edit' || inline === 'rich';
}

/** 文字 / 图片插到哪:富文本编辑器(小编辑框的富文本、全屏的富文本)还是 Markdown 源码框。 */
export function richEditorActive(inline: InlineMode, full: RulesViewMode | null, rich: boolean): boolean {
  if (!rich) return false;
  return full ? full === 'read' : inline === 'rich';
}

/**
 * 语音入口放在哪。
 *   'desktopMic' = 🎤 按钮 + 就地录音条 + 快捷键(桌面,小编辑框和全屏都有)
 *   'holdBar'    = 底部「按住 说话」大条 + 微信式浮层(只在手机全屏页的编辑模式)
 *   null         = 不放(没有能打字的框;平台不支持语音 —— 纯网页没有安全存储;手机上的小编辑框)
 */
export function voiceEntry(p: { pointer: boolean; available: boolean; editable: boolean; phonePage: boolean }): 'desktopMic' | 'holdBar' | null {
  if (!p.available || !p.editable) return null;
  if (p.pointer) return 'desktopMic';
  return p.phonePage ? 'holdBar' : null;
}

/**
 * 未配置语音时「去设置」:详情里有没保存的修改,去设置页会卸掉详情、丢掉草稿 —— 这时不给跳转链接,
 * 只说先保存再去设置。
 */
export function settingsPromptKind(dirty: boolean, canOpenSettings: boolean): 'link' | 'saveFirst' | 'text' {
  if (!canOpenSettings) return 'text';
  return dirty ? 'saveFirst' : 'link';
}
