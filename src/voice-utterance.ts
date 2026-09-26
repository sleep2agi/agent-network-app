// 一句话(按下 → 松手)的识别编排:聊天页的按住说话和设置页的「测试」共用。
//
//   const u = new Utterance({ route, loadCreds, openSession, onInterim });
//   u.start()                      按下:流式路线就立刻读凭据、建连(和开麦并行)
//   recorder.setChunkListener(u.onChunk)   每段 PCM → 转成 16 kHz 单声道 → 推给会话
//   await u.finish(captured, flash, onRemember)   松手:等流式终稿,失败则整段录音走极速版
//   u.cancel()                     取消:关连接,不识别
//
// 纯逻辑(依赖全部注入),不 import react-native。

import type { VoiceCredentials } from './voice-credentials-model';
import { finishUtterance, type UtteranceResult, type VoiceMode } from './voice-stream-policy';
import type { StreamFailure, StreamOutcome } from './doubao-stream';
import { downmixInt16, resampleInt16, TARGET_SAMPLE_RATE } from './voice-wav';

export type StreamSessionLike = { push(pcm: Int16Array): void; finish(): Promise<StreamOutcome>; cancel(): void };

export type UtteranceDeps = {
  route: VoiceMode;
  loadCreds: () => Promise<VoiceCredentials | null>;
  openSession: (creds: VoiceCredentials | null, onInterim: (text: string) => void) => StreamSessionLike;
  onInterim: (text: string) => void;
};

/** 任意采样率 / 声道的一段 → 16 kHz 单声道(流式协议只收这个)。 */
export function toStreamPcm(pcm: Int16Array, sampleRate: number, channels: number): Int16Array {
  return resampleInt16(downmixInt16(pcm, channels), sampleRate, TARGET_SAMPLE_RATE);
}

export class Utterance {
  private session: StreamSessionLike | null = null;
  private opening: Promise<void> | null = null;
  private early: Int16Array[] = [];
  private cancelled = false;
  private finished = false;

  constructor(private readonly deps: UtteranceDeps) {}

  get route(): VoiceMode { return this.deps.route; }

  start(): void {
    if (this.deps.route !== 'stream' || this.opening) return;
    this.opening = this.deps.loadCreds().then(
      creds => {
        if (this.cancelled) return;
        this.session = this.deps.openSession(creds, text => { if (!this.cancelled) this.deps.onInterim(text); });
        const early = this.early; this.early = [];
        for (const c of early) this.session.push(c);
      },
      () => { /* 读不到凭据:finish 时 session 为空 → 走极速版,极速版会报 not_configured */ },
    );
  }

  /** 录音回调:箭头函数,可以直接交给 recorder.setChunkListener。 */
  onChunk = (pcm: Int16Array, sampleRate: number, channels: number): void => {
    if (this.deps.route !== 'stream' || this.cancelled || this.finished) return;
    const mono = toStreamPcm(pcm, sampleRate, channels);
    if (this.session) this.session.push(mono);
    else this.early.push(mono);
  };

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.early = [];
    this.session?.cancel();
  }

  async finish(
    flash: () => Promise<string>,
    onRemember: (failure: StreamFailure, upstream?: string) => void,
  ): Promise<UtteranceResult> {
    this.finished = true;
    if (this.opening) await this.opening;
    return finishUtterance({ session: this.cancelled ? null : this.session, flash, onRemember });
  }
}
