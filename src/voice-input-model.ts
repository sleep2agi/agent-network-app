// 按住说话(微信式)的状态机。纯逻辑:ChatScreen / VoiceMicButton 只把手势和录音
// 回调翻译成事件喂进来,再按返回的 state + effect 去启动/停止录音、发识别、插文本。
//
//   idle ──press──▶ starting ──started──▶ recording ⇄ cancelArmed(桌面:上滑超过阈值;手机:手指在 ✕ 圈上)
//                                              recording ⇄ toTextArmed(只有手机:手指在「文」圈上,见 voice-hold-overlay-model.ts)
//     ▲               │ release/startFailed        │ release(够长)→ transcribing ──done──▶ idle(插入文本)
//     │               ▼                            │ release(太短)→ idle「说话时间太短」
//     └──────────── idle ◀─────── cancelArmed + release = 取消(不识别)
//   recording 满 60 s(tick)→ 自动当作松开 → transcribing
//   press 时未配置 → idle + route「去设置」;transcribing 期间再按无效。
//
// 纯逻辑,不 import react-native。

import { insertAtSelection } from './voice-insert-model';

export const CANCEL_SLIDE_PX = 60;

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'cancelArmed' | 'toTextArmed' | 'transcribing';

/** 手机按住浮层里手指所在的区:中间 / ✕ 取消圈 / 「文」圈。 */
export type VoiceZone = 'neutral' | 'cancel' | 'toText';

/** 正在录(含停在某个区上)。 */
export const isLivePhase = (phase: VoicePhase): boolean => phase === 'recording' || phase === 'cancelArmed' || phase === 'toTextArmed';

export function zoneOfPhase(phase: VoicePhase): VoiceZone {
  return phase === 'cancelArmed' ? 'cancel' : phase === 'toTextArmed' ? 'toText' : 'neutral';
}
const PHASE_OF_ZONE: Record<VoiceZone, VoicePhase> = { neutral: 'recording', cancel: 'cancelArmed', toText: 'toTextArmed' };

/**
 * 松手之后做什么。**中间区 = 现状**:识别结果进草稿卡片的光标处、不发送(#410 / #440 定的,见 holdBarLabel);
 * 「文」圈 = 同一条路(进草稿、不发送);✕ = 丢弃。所以今天中间区和「文」圈结果相同 ——
 * 以后要让中间区「松开 发送」,只改 NEUTRAL_RELEASE 这一处(和它的文案)。
 */
export type ReleaseAction = 'insertDraft' | 'discard';
export const NEUTRAL_RELEASE: ReleaseAction = 'insertDraft';
export const ZONE_RELEASE: Record<VoiceZone, ReleaseAction> = { neutral: NEUTRAL_RELEASE, cancel: 'discard', toText: 'insertDraft' };

/**
 * 在某区松手的结果(纯函数,voiceStep 的 release 就用它):
 *   cancel → discard(取消优先,不看时长);其余 → 不够 minSeconds 为 tooShort,否则 ZONE_RELEASE。
 */
export function releaseOutcome(zone: VoiceZone, heldSeconds: number, minSeconds: number): ReleaseAction | 'tooShort' {
  if (ZONE_RELEASE[zone] === 'discard') return 'discard';
  if (heldSeconds < minSeconds) return 'tooShort';
  return ZONE_RELEASE[zone];
}

export type VoiceState = {
  phase: VoicePhase;
  /** 录音开始的时间(ms);starting 阶段为 0。 */
  startedAt: number;
  /** 最近一次提示(给界面显示,几秒后由界面清掉)。 */
  notice: string | null;
};

export type VoiceEvent =
  | { type: 'press'; configured: boolean; now: number }
  | { type: 'started'; now: number }
  | { type: 'startFailed'; reason: string }
  | { type: 'move'; dy: number }
  /** 手机:手指进 / 出某个区(命中判定 + 滞回在 voice-hold-overlay-model.ts zoneAt)。 */
  | { type: 'zone'; zone: VoiceZone }
  | { type: 'release'; now: number }
  | { type: 'terminate' }
  | { type: 'tick'; now: number }
  | { type: 'transcribed'; text: string }
  | { type: 'failed'; message: string };

export type VoiceEffect =
  | { kind: 'none' }
  | { kind: 'startRecording' }
  /** 丢弃录音(取消、太短、开始失败后的清理)。 */
  | { kind: 'discardRecording' }
  /** 停止录音并把音频送去识别。 */
  | { kind: 'stopAndTranscribe' }
  | { kind: 'insertText'; text: string }
  | { kind: 'routeToSettings' };

/** 按住不够 minSeconds 就松手(微信同款文案)。 */
export const TOO_SHORT_NOTICE = '说话时间太短';

export const IDLE: VoiceState = { phase: 'idle', startedAt: 0, notice: null };

export type Limits = { minSeconds: number; maxSeconds: number };
const DEFAULT_LIMITS: Limits = { minSeconds: 0.6, maxSeconds: 60 };

const none: VoiceEffect = { kind: 'none' };

export function voiceStep(state: VoiceState, ev: VoiceEvent, limits: Limits = DEFAULT_LIMITS): { state: VoiceState; effect: VoiceEffect } {
  switch (ev.type) {
    case 'press':
      if (state.phase !== 'idle') return { state, effect: none };
      if (!ev.configured) return { state: { ...IDLE, notice: '未配置语音识别，去设置' }, effect: { kind: 'routeToSettings' } };
      return { state: { phase: 'starting', startedAt: 0, notice: null }, effect: { kind: 'startRecording' } };

    case 'started':
      if (state.phase === 'starting') return { state: { phase: 'recording', startedAt: ev.now, notice: null }, effect: none };
      // 录音刚起来手已经松开了(starting 时 release 回到 idle):把刚起的录音丢掉。
      return { state, effect: { kind: 'discardRecording' } };

    case 'startFailed':
      if (state.phase !== 'starting') return { state, effect: none };
      return { state: { ...IDLE, notice: ev.reason }, effect: none };

    case 'move': {
      if (state.phase !== 'recording' && state.phase !== 'cancelArmed') return { state, effect: none };
      const armed = ev.dy <= -CANCEL_SLIDE_PX;
      const phase: VoicePhase = armed ? 'cancelArmed' : 'recording';
      return phase === state.phase ? { state, effect: none } : { state: { ...state, phase }, effect: none };
    }

    case 'zone': {
      if (!isLivePhase(state.phase)) return { state, effect: none };
      const phase = PHASE_OF_ZONE[ev.zone];
      return phase === state.phase ? { state, effect: none } : { state: { ...state, phase }, effect: none };
    }

    case 'release': {
      if (state.phase === 'starting') return { state: { ...IDLE }, effect: none };
      if (!isLivePhase(state.phase)) return { state, effect: none };
      const outcome = releaseOutcome(zoneOfPhase(state.phase), (ev.now - state.startedAt) / 1000, limits.minSeconds);
      if (outcome === 'discard') return { state: { ...IDLE, notice: '已取消' }, effect: { kind: 'discardRecording' } };
      if (outcome === 'tooShort') return { state: { ...IDLE, notice: TOO_SHORT_NOTICE }, effect: { kind: 'discardRecording' } };
      return { state: { ...state, phase: 'transcribing' }, effect: { kind: 'stopAndTranscribe' } };
    }

    // 手势被系统夺走(来电、滚动容器抢了 responder):按取消处理,绝不偷偷发出去。
    case 'terminate':
      if (isLivePhase(state.phase)) return { state: { ...IDLE, notice: '已取消' }, effect: { kind: 'discardRecording' } };
      if (state.phase === 'starting') return { state: { ...IDLE }, effect: none };
      return { state, effect: none };

    case 'tick':
      if (isLivePhase(state.phase) && (ev.now - state.startedAt) / 1000 >= limits.maxSeconds) {
        // 满 60 s 时手指停在「取消」区 = 用户已经表态要取消,尊重它。
        if (state.phase === 'cancelArmed') return { state: { ...IDLE, notice: '已取消' }, effect: { kind: 'discardRecording' } };
        return { state: { ...state, phase: 'transcribing', notice: `已达 ${limits.maxSeconds} 秒上限` }, effect: { kind: 'stopAndTranscribe' } };
      }
      return { state, effect: none };

    case 'transcribed':
      if (state.phase !== 'transcribing') return { state, effect: none };
      if (!ev.text.trim()) return { state: { ...IDLE, notice: '没有识别到文字' }, effect: none };
      return { state: { ...IDLE }, effect: { kind: 'insertText', text: ev.text.trim() } };

    case 'failed':
      if (state.phase !== 'transcribing') return { state, effect: none };
      return { state: { ...IDLE, notice: ev.message }, effect: none };
  }
}

/** 录音中覆盖层的文案。 */
export function overlayHint(phase: VoicePhase): string {
  if (phase === 'cancelArmed') return '松开手指,取消';
  if (phase === 'transcribing') return '正在识别…';
  if (phase === 'starting') return '准备录音…';
  return '松开 转文字 · 上滑 取消';
}

/**
 * 识别结果插进输入框:接在已有草稿后面,不自动发送。
 * 只有两边交界都是拉丁字母/数字时才补一个空格(「hello」+「world」);
 * 中文、标点、已有空白处直接相接(「你好。」+「在吗」)。
 */
export function insertRecognized(draft: string, text: string): string {
  // 同一条空格规则的「光标在末尾」特例;插到光标处见 voice-insert-model.ts insertAtSelection。
  return insertAtSelection(draft, text, null).value;
}

/** 00:07 这种计时。 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ── 微信式输入区(手机 / 双栏):左边 🎤/⌨ 切换,语音模式下输入框整条变成「按住 说话」 ──

export type ComposerInputMode = 'keyboard' | 'voice';

/** 存储里读出来的值;没存过 / 读坏了 = 键盘。 */
export function parseComposerInputMode(raw: string | null | undefined): ComposerInputMode {
  return raw === 'voice' ? 'voice' : 'keyboard';
}

export function toggleComposerInputMode(m: ComposerInputMode): ComposerInputMode {
  return m === 'voice' ? 'keyboard' : 'voice';
}

/**
 * 切换按钮显示的是「点了会切到哪」:键盘模式下显示语音(🔊 声波,微信同款),语音模式下显示键盘。
 * 键盘模式下**不再用麦克风**:麦克风留给输入框里那个「按住说话,插到光标处」的小按钮,
 * 一行里只有一个麦克风(协调者按微信对齐规则定,#436)。
 */
export function toggleButtonShows(m: ComposerInputMode): 'voice' | 'keyboard' {
  return m === 'voice' ? 'keyboard' : 'voice';
}

/** 键盘模式下切换按钮的图标(Ionicons 音量 / 声波族;外面的圆圈是按钮自己的描边)。 */
export const VOICE_TOGGLE_ICON = 'volume-high-outline';

export type HoldBarTone = 'idle' | 'pressed' | 'cancel' | 'busy';

/**
 * 「按住 说话」条的文字。松手**不发送**:识别结果进输入框给用户改(#410 定的),
 * 所以按住时写「松开 转文字」而不是微信的「松开 发送」—— 文案不能承诺一个不会发生的动作。
 */
export function holdBarLabel(phase: VoicePhase): string {
  switch (phase) {
    case 'starting':
    case 'recording':
    case 'toTextArmed': return '松开 转文字';
    case 'cancelArmed': return '松开 取消';
    case 'transcribing': return '识别中…';
    default: return '按住 说话';
  }
}

export function holdBarTone(phase: VoicePhase): HoldBarTone {
  if (phase === 'cancelArmed') return 'cancel';
  if (phase === 'starting' || phase === 'recording' || phase === 'toTextArmed') return 'pressed';
  if (phase === 'transcribing') return 'busy';
  return 'idle';
}

/** 录音浮层底部的取消区:手指要上滑多少才算进去(和状态机的阈值是同一个数)。 */
export function cancelZoneLabel(phase: VoicePhase): string {
  return phase === 'cancelArmed' ? '松开手指，取消' : '上滑到这里取消';
}

/**
 * 状态转移时要不要震一下:按下开始录音 = 轻触(impact Light);进 / 出 ✕ 或「文」区 = 选择刻度(selection)。
 * 松手、识别完、取消后回到 idle 都不震(那是结果,不是手指的反馈)。
 */
export function hapticFor(prev: VoicePhase, next: VoicePhase): 'press' | 'zone' | null {
  if (prev === 'idle' && next === 'starting') return 'press';
  if (isLivePhase(prev) && isLivePhase(next) && zoneOfPhase(prev) !== zoneOfPhase(next)) return 'zone';
  return null;
}

// ── 语音模式下的草稿卡片(owner:「按住说话之后，别直接把输入法弹出来」,微信同款) ──
//
// 松手识别完:**留在语音模式、不聚焦输入框**(聚焦 = 安卓软键盘弹出)。识别文字接进草稿,
// 在「按住 说话」条上方的一张小卡片里显示;右格因为有草稿而变「发送」,点它直接发、全程不弹键盘。
// 卡片本身可以点着放光标、长按 / 拖动选中,但**不弹软键盘**;再按住说话 → 插到卡片的选区(没点过 = 末尾,
// 插完光标在插入文字之后,所以连着按就是依次往后接);上滑取消 → 草稿原样不动。要打字点左边 ⌨(选区带过去)。

export type ComposerModeTransition = {
  /** 切到哪个输入方式(null = 不变)。 */
  mode: ComposerInputMode | null;
  /** 要不要在输入框挂上后 focus()(= 弹软键盘)。 */
  focusInput: boolean;
  /** 要不要写回每设备偏好。 */
  persist: boolean;
};

const STAY: ComposerModeTransition = { mode: null, focusInput: false, persist: false };

/**
 * 识别结果进草稿之后输入区怎么动。手机 / 双栏:什么都不动(留在语音模式、不 focus)。
 * 桌面没有语音模式(工具栏麦克风),同样不动。
 */
export function afterRecognized(): ComposerModeTransition {
  return STAY;
}

/** 语音模式下草稿卡片要不要画:有非空白草稿才画。 */
export function showVoiceDraftCard(voiceMode: boolean, draft: string): boolean {
  return voiceMode && (draft || '').trim().length > 0;
}

/** 卡片最多直接显示几行,再多就在卡片里滚动。 */
export const VOICE_DRAFT_CARD_MAX_LINES = 4;
