// 聊天内嵌音频播放的纯逻辑与全局单活协调器（无 React Native 依赖，Node/Bun 可直跑单测）。
// admin 2026-11-28：音频附件（如 TTS 试听 .mp3）在 App 里原来只能点下载再走系统分享外部打开，
// 连续听多条非常折腾。这里提供格式判定、时长/进度计算、倍速循环与「同时只播一条」总线。

const PLAYABLE_AUDIO_EXT_RE = /\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i;
const UNPLAYABLE_AUDIO_EXT_RE = /\.(wma|aiff?)$/i;

const AUDIO_EXT_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
};

/** 能在聊天气泡内直接播放的常见音频格式（iOS AVPlayer / Android ExoPlayer / Web & Tauri HTML5 Audio）。 */
export function isPlayableAudio(name?: string, mime?: string): boolean {
  const cleanName = (name ?? '').trim();
  const cleanMime = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (UNPLAYABLE_AUDIO_EXT_RE.test(cleanName)) return false;
  if (PLAYABLE_AUDIO_EXT_RE.test(cleanName)) return true;
  if (!cleanMime.startsWith('audio/')) return false;
  if (cleanMime === 'audio/x-ms-wma' || cleanMime === 'audio/aiff' || cleanMime === 'audio/x-aiff') return false;
  return true;
}

/** 根据文件名与服务端 MIME 解析音频 MIME，供 Blob 构造与系统分享使用。 */
export function audioMimeFor(name?: string, mime?: string): string {
  const cleanMime = (mime ?? '').toLowerCase().split(';')[0].trim();
  if (cleanMime.startsWith('audio/')) return cleanMime;
  const ext = (name?.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
  return AUDIO_EXT_MIME[ext] ?? 'audio/mpeg';
}

/** 秒数 → M:SS（超 1 小时为 H:MM:SS）；非法或负值一律归零。 */
export function formatAudioTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** 当前播放进度比例 0..1。 */
export function clampAudioProgress(currentTime: number, duration: number): number {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, currentTime / duration));
}

/** 按点击比例计算跳转目标秒数（钳制在 0..duration）。 */
export function seekTargetSeconds(ratio: number, duration: number): number {
  if (!Number.isFinite(ratio) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, ratio)) * duration;
}

/** 播放结束后再次点播放应先归零，避免停在末尾无声音（AVPlayer / ExoPlayer 常见坑）。 */
export function shouldRewindBeforePlay(currentTime: number, duration: number, finished: boolean): boolean {
  if (finished) return true;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(currentTime)) return false;
  return currentTime >= Math.max(0, duration - 0.15);
}

export const AUDIO_PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;

export function nextPlaybackRate(current: number): number {
  const idx = AUDIO_PLAYBACK_RATES.findIndex(r => Math.abs(r - current) < 0.01);
  return AUDIO_PLAYBACK_RATES[(idx + 1) % AUDIO_PLAYBACK_RATES.length];
}

export function formatPlaybackRate(rate: number): string {
  const normalized = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return `${normalized}×`;
}

// ── 全局单活音频总线：同一时间只允许一条语音/音频附件在播放 ──────────────────────────────
type ActivePlayer = { id: string; pause: () => void };
let activePlayer: ActivePlayer | null = null;

/** 声明某张音频卡片开始播放；若此前有另一条在播，立即暂停旧卡片。 */
export function claimAudioPlayback(id: string, pause: () => void): void {
  if (activePlayer && activePlayer.id !== id) {
    const prev = activePlayer;
    activePlayer = null;
    try { prev.pause(); } catch { /* 旧实例已释放不阻断新播放 */ }
  }
  activePlayer = { id, pause };
}

/** 暂停/结束/卸载时释放总线占位（仅在仍是当前占用者时清空）。 */
export function releaseAudioPlayback(id: string): void {
  if (activePlayer?.id === id) activePlayer = null;
}

/** 停止任何正在播放的聊天音频（例如用户按下语音输入录音键或切换账号时）。 */
export function stopAllAudioPlayback(): void {
  if (!activePlayer) return;
  const prev = activePlayer;
  activePlayer = null;
  try { prev.pause(); } catch { /* ignore */ }
}

export function activeAudioPlaybackId(): string | null {
  return activePlayer?.id ?? null;
}
