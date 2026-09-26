// 按住说话(微信式)的状态机。纯逻辑:ChatScreen / VoiceMicButton 只把手势和录音
// 回调翻译成事件喂进来,再按返回的 state + effect 去启动/停止录音、发识别、插文本。
//
//   idle ──press──▶ starting ──started──▶ recording ⇄ cancelArmed(上滑超过阈值)
//     ▲               │ release/startFailed        │ release(够长)→ transcribing ──done──▶ idle(插入文本)
//     │               ▼                            │ release(太短)→ idle「说话时间太短」
//     └──────────── idle ◀─────── cancelArmed + release = 取消(不识别)
//   recording 满 60 s(tick)→ 自动当作松开 → transcribing
//   press 时未配置 → idle + route「去设置」;transcribing 期间再按无效。
//
// 纯逻辑,不 import react-native。

export const CANCEL_SLIDE_PX = 60;

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'cancelArmed' | 'transcribing';

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

    case 'release':
      if (state.phase === 'starting') return { state: { ...IDLE }, effect: none };
      if (state.phase === 'cancelArmed') return { state: { ...IDLE, notice: '已取消' }, effect: { kind: 'discardRecording' } };
      if (state.phase === 'recording') {
        const secs = (ev.now - state.startedAt) / 1000;
        if (secs < limits.minSeconds) return { state: { ...IDLE, notice: '说话时间太短' }, effect: { kind: 'discardRecording' } };
        return { state: { ...state, phase: 'transcribing' }, effect: { kind: 'stopAndTranscribe' } };
      }
      return { state, effect: none };

    // 手势被系统夺走(来电、滚动容器抢了 responder):按取消处理,绝不偷偷发出去。
    case 'terminate':
      if (state.phase === 'recording' || state.phase === 'cancelArmed') return { state: { ...IDLE, notice: '已取消' }, effect: { kind: 'discardRecording' } };
      if (state.phase === 'starting') return { state: { ...IDLE }, effect: none };
      return { state, effect: none };

    case 'tick':
      if ((state.phase === 'recording' || state.phase === 'cancelArmed') && (ev.now - state.startedAt) / 1000 >= limits.maxSeconds) {
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
  const t = text.trim();
  if (!t) return draft;
  if (!draft) return t;
  return /[A-Za-z0-9]$/.test(draft) && /^[A-Za-z0-9]/.test(t) ? `${draft} ${t}` : draft + t;
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
 * 切换按钮显示的是「点了会切到哪」:键盘模式下显示麦克风,语音模式下显示键盘(微信同款)。
 */
export function toggleButtonShows(m: ComposerInputMode): 'mic' | 'keyboard' {
  return m === 'voice' ? 'keyboard' : 'mic';
}

export type HoldBarTone = 'idle' | 'pressed' | 'cancel' | 'busy';

/**
 * 「按住 说话」条的文字。松手**不发送**:识别结果进输入框给用户改(#410 定的),
 * 所以按住时写「松开 转文字」而不是微信的「松开 发送」—— 文案不能承诺一个不会发生的动作。
 */
export function holdBarLabel(phase: VoicePhase): string {
  switch (phase) {
    case 'starting':
    case 'recording': return '松开 转文字';
    case 'cancelArmed': return '松开 取消';
    case 'transcribing': return '识别中…';
    default: return '按住 说话';
  }
}

export function holdBarTone(phase: VoicePhase): HoldBarTone {
  if (phase === 'cancelArmed') return 'cancel';
  if (phase === 'starting' || phase === 'recording') return 'pressed';
  if (phase === 'transcribing') return 'busy';
  return 'idle';
}

/** 录音浮层底部的取消区:手指要上滑多少才算进去(和状态机的阈值是同一个数)。 */
export function cancelZoneLabel(phase: VoicePhase): string {
  return phase === 'cancelArmed' ? '松开手指，取消' : '上滑到这里取消';
}

/** 状态转移时要不要震一下:按下开始录音 = 轻触;滑进取消区 = 提醒(微信也是这两下)。 */
export function hapticFor(prev: VoicePhase, next: VoicePhase): 'press' | 'cancelArmed' | null {
  if (prev === 'idle' && next === 'starting') return 'press';
  if (prev !== 'cancelArmed' && next === 'cancelArmed') return 'cancelArmed';
  return null;
}

// ── 语音模式下的草稿卡片(owner:「按住说话之后，别直接把输入法弹出来」,微信同款) ──
//
// 松手识别完:**留在语音模式、不聚焦输入框**(聚焦 = 安卓软键盘弹出)。识别文字接进草稿,
// 在「按住 说话」条上方的一张小卡片里显示;右格因为有草稿而变「发送」,点它直接发、全程不弹键盘。
// 点卡片 = 唯一一条会弹键盘的路:切到键盘模式并聚焦(临时状态,不写回偏好,记住的仍是语音)。
// 再按住说话 → 接在已有草稿后面(insertRecognized);上滑取消 → 草稿原样不动。

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

/** 点语音草稿卡片:切到键盘并聚焦,不写偏好。 */
export function onVoiceDraftCardTap(): ComposerModeTransition {
  return { mode: 'keyboard', focusInput: true, persist: false };
}

/** 语音模式下草稿卡片要不要画:有非空白草稿才画。 */
export function showVoiceDraftCard(voiceMode: boolean, draft: string): boolean {
  return voiceMode && (draft || '').trim().length > 0;
}

/** 卡片最多直接显示几行,再多就在卡片里滚动。 */
export const VOICE_DRAFT_CARD_MAX_LINES = 4;
