// 按住说话:把手势(responder)、录音(useVoiceRecorder)、识别(doubao-asr)接到
// voice-input-model 的状态机上。ChatScreen 只拿 micHandlers 挂到麦克风按钮上、
// 拿 overlay 状态画「正在录音」浮层,识别结果通过 onInsert 回到输入框(不自动发送)。

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { appFetch } from './app-fetch';
import { AsrError, asrErrorMessage, MAX_UTTERANCE_SECONDS, MIN_UTTERANCE_SECONDS, transcribeWav, type FetchLike } from './doubao-asr';
import { loadVoiceCredentials, subscribeVoiceCredentials, voiceStorageKind } from './voice-credentials';
import { IDLE, voiceStep, type VoiceEvent, type VoiceState } from './voice-input-model';
import { useVoiceRecorder, type Captured } from './useVoiceRecorder';
import { pcmChunksToWav } from './voice-wav';
import type { VoiceCredentials } from './voice-credentials-model';

export const LIMITS = { minSeconds: MIN_UTTERANCE_SECONDS, maxSeconds: MAX_UTTERANCE_SECONDS };

/** appFetch(桌面走 Tauri plugin-http,手机走 RN fetch)适配成 doubao-asr 的 FetchLike。 */
export const asrFetch: FetchLike = (url, init) => appFetch(url, init as RequestInit) as ReturnType<FetchLike>;

/** 录到的 PCM → 文本。设置页「测试」和聊天页共用。 */
export async function transcribeCaptured(creds: VoiceCredentials | null, captured: Captured): Promise<string> {
  const { wav, seconds } = pcmChunksToWav(captured.chunks, captured.sampleRate, captured.channels);
  if (seconds > MAX_UTTERANCE_SECONDS + 1) throw new AsrError('too_long');
  return transcribeWav(creds, wav, { fetchImpl: asrFetch });
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
  const startYRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const dispatch = useCallback((ev: VoiceEvent) => {
    const { state: next, effect } = voiceStep(stateRef.current, ev, LIMITS);
    const noticeChanged = next.notice && next.notice !== stateRef.current.notice;
    stateRef.current = next;
    setState(next);
    if (noticeChanged && effect.kind !== 'routeToSettings') optsRef.current.onNotice(next.notice!);
    switch (effect.kind) {
      case 'startRecording':
        void recorder.start().then(r => {
          if (r.ok) dispatch({ type: 'started', now: Date.now() });
          else dispatch({ type: 'startFailed', reason: r.reason });
        });
        break;
      case 'discardRecording':
        recorder.discard();
        break;
      case 'stopAndTranscribe': {
        const captured = recorder.stop();
        void (async () => {
          try {
            if (!captured) throw new AsrError('too_short');
            const text = await transcribeCaptured(await loadVoiceCredentials(), captured);
            dispatch({ type: 'transcribed', text });
          } catch (e) {
            const err = e instanceof AsrError ? e : new AsrError('upstream_error');
            if (err.code === 'not_configured') setSettingsPrompt(true);
            dispatch({ type: 'failed', message: asrErrorMessage(err.code, err.upstream) });
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

  // 录音中:计时 + 60 s 上限。
  const recording = state.phase === 'recording' || state.phase === 'cancelArmed';
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => { const t = Date.now(); setNow(t); dispatch({ type: 'tick', now: t }); }, 200);
    return () => clearInterval(id);
  }, [recording, dispatch]);

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
