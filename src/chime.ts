// 0.2.76 消息提示音:内置短铃(data URI,不依赖资源文件),网页/桌面用 HTMLAudio 播;
// 手机端(无 Audio 全局)静默跳过。同一秒内多次触发只响一次。

import { CHIME_DATA_URI } from './chime-data';

let lastPlayedAt = 0;
export const CHIME_MIN_GAP_MS = 800;

export function shouldPlayChime(nowMs: number, lastMs: number, gap = CHIME_MIN_GAP_MS): boolean {
  return nowMs - lastMs >= gap;
}

export function playChime(now = Date.now()): boolean {
  if (!shouldPlayChime(now, lastPlayedAt)) return false;
  const AudioCtor = (globalThis as any).Audio as (new (src: string) => HTMLAudioElement) | undefined;
  if (typeof AudioCtor !== 'function') return false;
  try {
    const audio = new AudioCtor(CHIME_DATA_URI);
    audio.volume = 0.6;
    const p = audio.play();
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => { /* autoplay 被拒就算了 */ });
    lastPlayedAt = now;
    return true;
  } catch {
    return false;
  }
}
