// 头像状态动效（admin 2026-11-17「类似于 Grok Bot 的头像动效」）。
// Grok Bot 用头像的「动」来表达状态：在干活、在等人、卡住了、做完了各不一样，扫一眼就知道谁在忙、谁卡了。
// 这里只取三种，和列表圆点用的是同一份状态（agent-row-model.ts rowStatus）：
//   working   —— 在干活：头像外一圈弧线慢慢转。
//   attention —— 卡住 / 出错，需要人看：外圈呼吸式闪烁，颜色跟圆点一致（阻塞琥珀、异常红）。
//   none      —— 空闲 / 离线：不动，不加任何东西（不要让整列都在动）。
// 系统「减少动态效果」打开时：只画静止的圈，不转、不闪。
// 纯逻辑，不 import react-native。

export type AvatarMotion = 'working' | 'attention' | 'none';
export type AvatarMotionTone = 'running' | 'blocked' | 'failed';

export interface AvatarMotionState {
  motion: AvatarMotion;
  /** theme colors[...] key for the ring; null when there is no ring. */
  tone: AvatarMotionTone | null;
}

/** Hub session status (+ the chat's local 「正在处理」) → what the avatar ring does. */
export function avatarMotion(status?: string | null, processing = false): AvatarMotionState {
  switch (status) {
    case 'blocked':
      return { motion: 'attention', tone: 'blocked' };
    case 'error':
    case 'failed':
      return { motion: 'attention', tone: 'failed' };
    case 'working':
    case 'running':
      return { motion: 'working', tone: 'running' };
    default:
      // 刚发出去、Hub 还没把状态翻成 working 的那几秒，聊天页自己知道「正在处理」。
      return processing && status !== 'offline' ? { motion: 'working', tone: 'running' } : { motion: 'none', tone: null };
  }
}

/** One full turn of the working arc. Slow on purpose: a list of busy agents should not feel frantic. */
export const AVATAR_SPIN_MS = 1600;
/** One attention breath (in + out). */
export const AVATAR_PULSE_MS = 1400;
/** Gap between the avatar and the ring, and the ring's stroke, in design px (scaled by the caller). */
export const AVATAR_RING_GAP = 2;
export const AVATAR_RING_STROKE = 2;

/** Outer box of the ring for an avatar of `size` px. */
export function avatarRingBox(size: number): number {
  return size + 2 * (AVATAR_RING_GAP + AVATAR_RING_STROKE);
}
