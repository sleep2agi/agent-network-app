// 桌面语音输入的交互模型:输入框里的一条录音条(DesktopVoiceBar),不是手机那张「按住 说话」浮层。
// 纯逻辑,不 import react-native。
//
// owner 09-27(Windows 0.2.127 截图):点输入框的 🎤 后,手机式浮层出现在聊天区**顶部中间** —— 深色卡片
// 「请说话…」、电平条和计时叠在一起、「松开 转文字 · 上滑 取消」「上滑到这里取消」两行手势提示(鼠标没有
// 「上滑」)、只盖住上半截的灰色遮罩。布局和交互模型都是手机的,桌面上两样都不对。
//
// 桌面改成:
//   · 点 🎤 = 开始录音(不用按住);录音中输入框底部那一行(＋ / 发送键提示 / 🎤 / 发送)整行换成录音条:
//     红点 · 电平条 · 计时 · 提示 ……「取消 ✕」「完成 ✓」。没有遮罩、没有手势提示。
//   · 完成 ✓ / Enter = 停止、识别、插到按下 🎤 时的光标处(不发送);取消 ✕ / Esc = 丢弃。
//   · 流式中间结果(桌面目前固定极速版,没有;见 voice-stream-policy.ts)作为灰色预览字显示在输入框里。
//   · 识别中:条上显示「识别中…」,两个按钮禁用;这时的 Enter 被吃掉 —— 否则会在文字插进来之前把草稿发出去。
//
// 手机 / 双栏(触屏)照旧是按住说话 + 浮层。判定只有一个:ChatScreen 的 desktop(Tauri 桌面工作区)。

import type { VoicePhase } from './voice-input-model';

export type VoiceSurface = 'inlineBar' | 'phoneOverlay';

/** 录音时用哪种界面。桌面工作区 = 输入框里的录音条;其它 = 手机浮层。 */
export function voiceSurface(desktop: boolean): VoiceSurface {
  return desktop ? 'inlineBar' : 'phoneOverlay';
}

/** 录音条什么时候代替输入框底部那一行:只要这一句还没结束(准备 / 录音 / 识别中)。 */
export function showVoiceBar(phase: VoicePhase): boolean {
  return phase !== 'idle';
}

export const isRecordingPhase = (phase: VoicePhase): boolean => phase === 'starting' || phase === 'recording' || phase === 'cancelArmed';

/** 点 🎤:空闲 → 开始;录音中 → 完成(和 ✓ 一样);识别中 → 不理。 */
export function micClickAction(phase: VoicePhase): 'start' | 'done' | null {
  if (phase === 'idle') return 'start';
  if (isRecordingPhase(phase)) return 'done';
  return null;
}

export type BarKey = { key?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean };

/**
 * 录音条显示时的按键:Enter = 完成、Esc = 取消;识别中的 Enter 吃掉(不能在插入之前把草稿发出去)。
 * 带修饰键的 Enter(Shift+Enter 换行、Ctrl+Enter 发送)录音中也吃掉 —— 这时候发送 / 换行都会和马上插进来的文字打架。
 * 输入法组词中的键不管。返回 null = 不归录音条管。
 */
export function barKeyAction(phase: VoicePhase, e: BarKey): 'done' | 'cancel' | 'swallow' | null {
  if (!showVoiceBar(phase) || e.isComposing) return null;
  const k = e.key;
  if (k === 'Escape' || k === 'Esc') return isRecordingPhase(phase) ? 'cancel' : 'swallow';
  if (k === 'Enter') {
    if (!isRecordingPhase(phase)) return 'swallow';
    return e.shiftKey || e.ctrlKey || e.metaKey || e.altKey ? 'swallow' : 'done';
  }
  return null;
}

/** 录音条上的提示文字。 */
export function barHint(phase: VoicePhase): string {
  if (phase === 'transcribing') return '识别中…';
  if (phase === 'starting') return '准备录音…';
  return '正在录音 · Enter 完成 · Esc 取消';
}

/**
 * 语音状态机的提示是按手机「按住说话」写的,桌面上换成对得上鼠标 / 键盘的说法。
 * 没列出的原样用(「已取消」「没有识别到文字」「已达 60 秒上限」、开麦失败原因都与手势无关)。
 */
const DESKTOP_NOTICE: Readonly<Record<string, string>> = {
  '说话时间太短': '录音太短,没有识别',
};
export function desktopVoiceNotice(text: string): string {
  return DESKTOP_NOTICE[text] ?? text;
}

/** 点击触发的麦克风处理只读 nativeEvent 的坐标(给手机上滑取消用);点击 / 按键没有位移,给 0。 */
export const DESKTOP_CLICK_EVENT = { nativeEvent: { pageX: 0, pageY: 0 } };
