// 按住说话:把手势(responder)、录音(useVoiceRecorder)、识别(doubao-stream 流式 / doubao-asr
// 极速版)接到 voice-input-model 的状态机上。ChatScreen 只拿 micHandlers 挂到麦克风按钮上、
// 拿 overlay 状态画「正在录音」浮层,识别结果通过 onInsert 回到输入框(不自动发送)。
//
// 流式(手机默认):按下就建连,边录边发,边说边在**录音浮层**里出字(interim);松手发最后一包、
// 等终稿(≤3 s),终稿才写进输入框。为什么不直接往输入框里写:上滑取消时输入框不用回滚;
// 终稿常会改写中间结果(标点、数字规整),直接写输入框会闪、还会和光标/手动编辑打架;
// 手机上输入框就在手指下面,浮层在消息区里反而看得见。

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { appFetch } from './app-fetch';
import { AsrError, asrErrorMessage, MAX_UTTERANCE_SECONDS, MIN_UTTERANCE_SECONDS, transcribeWav, type FetchLike } from './doubao-asr';
import { loadVoiceCredentials, subscribeVoiceCredentials, voiceStorageKind } from './voice-credentials';
import { hapticFor, IDLE, voiceStep, type VoiceEvent, type VoiceState } from './voice-input-model';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useVoiceRecorder, type Captured } from './useVoiceRecorder';
import { pcmChunksToWav } from './voice-wav';
import type { VoiceCredentials } from './voice-credentials-model';
import { StreamingAsrSession, type WsFactory, type WsLike } from './doubao-stream';
import { Utterance } from './voice-utterance';
import { chooseRoute, STREAM_UNAVAILABLE_HINT, type UtteranceResult, type VoiceMode } from './voice-stream-policy';
import { authMode } from './voice-credentials-model';
import { currentVoiceMode, loadVoiceMode, markStreamUnavailable, streamUnavailable, voicePlatform } from './voice-prefs';

export const LIMITS = { minSeconds: MIN_UTTERANCE_SECONDS, maxSeconds: MAX_UTTERANCE_SECONDS };

/** appFetch(桌面走 Tauri plugin-http,手机走 RN fetch)适配成 doubao-asr 的 FetchLike。 */
export const asrFetch: FetchLike = (url, init) => appFetch(url, init as RequestInit) as ReturnType<FetchLike>;

/** 录到的 PCM → 文本。设置页「测试」和聊天页共用。 */
export async function transcribeCaptured(creds: VoiceCredentials | null, captured: Captured): Promise<string> {
  const { wav, seconds } = pcmChunksToWav(captured.chunks, captured.sampleRate, captured.channels);
  if (seconds > MAX_UTTERANCE_SECONDS + 1) throw new AsrError('too_long');
  return transcribeWav(creds, wav, { fetchImpl: asrFetch });
}

/**
 * RN 原生 WebSocket 的第三个参数能带请求头(RN 0.85 Libraries/WebSocket/WebSocket.js:
 * `constructor(url, protocols, options: {headers})` → NativeWebSocketModule.connect(url, protocols, {headers}),
 * 安卓 OkHttp / iOS SocketRocket 都把 headers 加进握手请求)。浏览器 / webview 的 WebSocket 没有这个参数。
 */
export const nativeWsFactory: WsFactory = (url, headers) => {
  const WS = (globalThis as { WebSocket?: new (u: string, p?: string[] | null, o?: { headers: Record<string, string> }) => unknown }).WebSocket;
  if (!WS) throw new Error('no WebSocket');
  return new WS(url, null, { headers }) as WsLike;
};

/** 这一句走哪条路(读当前模式 + 本次运行内的「流式不可用」记忆)。 */
export function currentRoute(mode: VoiceMode = currentVoiceMode()): VoiceMode {
  return chooseRoute({ mode, platform: voicePlatform(), streamUnavailable: !!streamUnavailable() });
}

/** 新建一句话的编排器。设置页「测试」和聊天页共用。 */
export function newUtterance(route: VoiceMode, onInterim: (text: string) => void): Utterance {
  return new Utterance({
    route,
    loadCreds: loadVoiceCredentials,
    openSession: (creds, cb) => new StreamingAsrSession(creds, { wsFactory: nativeWsFactory, onInterim: cb }),
    onInterim,
  });
}

/** 松手:流式终稿,失败则用整段录音走极速版。失败原因要记住时顺手记下。 */
export async function finishUtteranceWith(u: Utterance, captured: Captured | null): Promise<UtteranceResult & { rememberedNow: boolean }> {
  const hadMemory = !!streamUnavailable();
  const r = await u.finish(
    async () => {
      if (!captured) throw new AsrError('too_short');
      return transcribeCaptured(await loadVoiceCredentials(), captured);
    },
    (failure, upstream) => markStreamUnavailable(failure, upstream),
  );
  return { ...r, rememberedNow: !!r.remembered && !hadMemory };
}

// 模块级「配没配」快照,供 useSyncExternalStore。
let configuredSnapshot = false;
const refreshConfigured = () => loadVoiceCredentials().then(c => { configuredSnapshot = !!c; }).catch(() => { configuredSnapshot = false; });
const subscribeConfigured = (cb: () => void) => {
  void refreshConfigured().then(cb);
  return subscribeVoiceCredentials(() => { void refreshConfigured().then(cb); });
};
const getConfigured = () => configuredSnapshot;

export type VoiceInput = {
  /** 本平台是否提供语音输入(纯网页没有安全存储 → 不显示麦克风)。 */
  available: boolean;
  configured: boolean;
  state: VoiceState;
  level: number;
  elapsedMs: number;
  /** 流式识别的中间结果(录音浮层里实时显示;松手后终稿才进输入框)。 */
  interim: string;
  /** 未配置时按麦克风 → 显示「去设置」链接(true 直到被点或超时)。 */
  settingsPrompt: boolean;
  dismissSettingsPrompt(): void;
  micHandlers: {
    onStartShouldSetResponder: () => boolean;
    onMoveShouldSetResponder: () => boolean;
    onResponderTerminationRequest: () => boolean;
    onResponderGrant: (e: GestureResponderEvent) => void;
    onResponderMove: (e: GestureResponderEvent) => void;
    onResponderRelease: (e: GestureResponderEvent) => void;
    onResponderTerminate: () => void;
  };
};

export function useVoiceInput(opts: { onInsert: (text: string) => void; onNotice: (text: string) => void }): VoiceInput {
  const recorder = useVoiceRecorder();
  const configured = useSyncExternalStore(subscribeConfigured, getConfigured, getConfigured);
  const [state, setState] = useState<VoiceState>(IDLE);
  const stateRef = useRef<VoiceState>(IDLE);
  const [now, setNow] = useState(Date.now());
  const [settingsPrompt, setSettingsPrompt] = useState(false);
  const [interim, setInterim] = useState('');
  const utteranceRef = useRef<Utterance | null>(null);
  const startYRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const dispatch = useCallback((ev: VoiceEvent) => {
    const { state: next, effect } = voiceStep(stateRef.current, ev, LIMITS);
    const buzz = hapticFor(stateRef.current.phase, next.phase);
    if (buzz && (Platform.OS === 'android' || Platform.OS === 'ios')) {
      void (buzz === 'press' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)).catch(() => {});
    }
    const noticeChanged = next.notice && next.notice !== stateRef.current.notice;
    stateRef.current = next;
    setState(next);
    if (noticeChanged && effect.kind !== 'routeToSettings') optsRef.current.onNotice(next.notice!);
    switch (effect.kind) {
      case 'startRecording': {
        utteranceRef.current?.cancel();
        setInterim('');
        const u = newUtterance(currentRoute(), text => { if (utteranceRef.current === u) setInterim(text); });
        utteranceRef.current = u;
        u.start(); // 流式:建连和开麦并行
        recorder.setChunkListener(u.route === 'stream' ? u.onChunk : null);
        void recorder.start().then(r => {
          if (r.ok) dispatch({ type: 'started', now: Date.now() });
          else dispatch({ type: 'startFailed', reason: r.reason });
          // 开麦失败 / 按下就松开:状态机已回到 idle,这一句的连接也要关掉。
          if (!r.ok || stateRef.current.phase === 'idle') { if (utteranceRef.current === u) { u.cancel(); utteranceRef.current = null; recorder.setChunkListener(null); } }
        });
        break;
      }
      case 'discardRecording':
        recorder.setChunkListener(null);
        recorder.discard();
        utteranceRef.current?.cancel();
        utteranceRef.current = null;
        setInterim('');
        break;
      case 'stopAndTranscribe': {
        recorder.setChunkListener(null);
        const captured = recorder.stop();
        const u = utteranceRef.current ?? newUtterance('flash', () => {});
        void (async () => {
          try {
            const r = await finishUtteranceWith(u, captured);
            if (r.rememberedNow) optsRef.current.onNotice(STREAM_UNAVAILABLE_HINT);
            dispatch({ type: 'transcribed', text: r.text });
          } catch (e) {
            const err = e instanceof AsrError ? e : new AsrError('upstream_error');
            if (err.code === 'not_configured') setSettingsPrompt(true);
            const creds = await loadVoiceCredentials().catch(() => null);
            dispatch({ type: 'failed', message: asrErrorMessage(err.code, err.upstream, creds ? authMode(creds) : undefined) });
          } finally {
            if (utteranceRef.current === u) { utteranceRef.current = null; setInterim(''); }
          }
        })();
        break;
      }
      case 'insertText':
        optsRef.current.onInsert(effect.text);
        break;
      case 'routeToSettings':
        setSettingsPrompt(true);
        break;
    }
  }, [recorder]);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // 录音中:计时 + 60 s 上限。
  const recording = state.phase === 'recording' || state.phase === 'cancelArmed';
  useEffect(() => {
    if (!recording) return;
    // 🔴 只依赖 recording:recorder 每次渲染都是新对象 → dispatch 每次渲染都变;电平 10 次/秒触发渲染,
    // 若把 dispatch 放进依赖,200 ms 的计时器每 100 ms 被重建一次、永远不触发 —— 计时停在 00:00,
    // 60 秒上限也不会生效(0.2.112 的实际表现,真应用截图里量到的)。
    const id = setInterval(() => { const t = Date.now(); setNow(t); dispatchRef.current({ type: 'tick', now: t }); }, 200);
    return () => clearInterval(id);
  }, [recording]);

  // 预读模式(第一句之前就把存储里的选择读进内存,currentRoute 同步可用)。
  useEffect(() => { void loadVoiceMode(); }, []);
  // 离开聊天页时关掉还开着的连接。
  useEffect(() => () => { utteranceRef.current?.cancel(); utteranceRef.current = null; }, []);

  useEffect(() => {
    if (!settingsPrompt) return;
    const id = setTimeout(() => setSettingsPrompt(false), 5000);
    return () => clearTimeout(id);
  }, [settingsPrompt]);

  const available = voiceStorageKind() !== 'unsupported' && recorder.supported;

  return {
    available,
    configured,
    state,
    level: recorder.level,
    elapsedMs: recording ? Math.max(0, now - state.startedAt) : 0,
    interim,
    settingsPrompt,
    dismissSettingsPrompt: () => setSettingsPrompt(false),
    micHandlers: {
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      // 按住期间不让列表 / ScrollView 把手势抢走(抢走 = terminate = 取消)。
      onResponderTerminationRequest: () => false,
      onResponderGrant: (e) => {
        startYRef.current = e.nativeEvent.pageY;
        setSettingsPrompt(false);
        dispatch({ type: 'press', configured: getConfigured(), now: Date.now() });
      },
      onResponderMove: (e) => dispatch({ type: 'move', dy: e.nativeEvent.pageY - startYRef.current }),
      onResponderRelease: () => dispatch({ type: 'release', now: Date.now() }),
      onResponderTerminate: () => dispatch({ type: 'terminate' }),
    },
  };
}
