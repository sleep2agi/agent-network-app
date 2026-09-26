// 麦克风 → PCM 分段。按平台两条路,对外一个接口(VoiceRecorder)。
//
//   安卓 / iOS:expo-audio 的 AudioStream(原生 AudioRecord / AVAudioEngine),请求 16 kHz
//              单声道 int16;设备给不了 16 kHz 时会回落到别的采样率,buffer 里带着实际值,
//              voice-wav.ts 统一重采样。
//   桌面(Tauri webview)/ 网页:getUserMedia + Web Audio(ScriptProcessor,WKWebView /
//              WebView2 / Chromium 都有),float32 → int16。macOS 要 Info.plist 的
//              NSMicrophoneUsageDescription + hardened runtime 的 audio-input entitlement
//              (src-tauri/Info.plist、Entitlements.plist),wry 自己会 grant 媒体权限请求。
//
// 🔴 录到的音频只在内存里,stop() 交出去后这里就丢掉引用;不落盘、不打日志。

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from 'expo-audio';
import { float32ToInt16, levelOf, TARGET_SAMPLE_RATE } from './voice-wav';

export type Captured = { chunks: Int16Array[]; sampleRate: number; channels: number };

export type StartResult =
  | { ok: true }
  /** 刚弹过系统授权框(按住的手势已被打断):授权成功也要用户再按一次。 */
  | { ok: false; reason: string; permissionJustGranted?: boolean };

export type VoiceRecorder = {
  /** 本平台能不能录音(纯网页无 getUserMedia 时为 false)。 */
  supported: boolean;
  start(): Promise<StartResult>;
  /** 停止并交出录到的 PCM;没在录返回 null。 */
  stop(): Captured | null;
  /** 停止并丢弃。 */
  discard(): void;
  /** 0..1,约 10 次/秒刷新,只在录音中有意义。 */
  level: number;
};

const isNative = Platform.OS === 'android' || Platform.OS === 'ios';

type WebSession = { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; source: MediaStreamAudioSourceNode };

const webSupported = (): boolean => {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  const AC = (globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext
    ?? (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
  return !!nav?.mediaDevices?.getUserMedia && !!AC;
};

export function useVoiceRecorder(): VoiceRecorder {
  const chunksRef = useRef<Int16Array[]>([]);
  const rateRef = useRef<number>(TARGET_SAMPLE_RATE);
  const channelsRef = useRef<number>(1);
  const activeRef = useRef(false);
  const webRef = useRef<WebSession | null>(null);
  const [level, setLevel] = useState(0);
  const levelAtRef = useRef(0);

  const pushLevel = (l: number) => {
    const now = Date.now();
    if (now - levelAtRef.current < 100) return;
    levelAtRef.current = now;
    setLevel(l);
  };

  const { stream: nativeStream } = useAudioStream({
    sampleRate: TARGET_SAMPLE_RATE,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buf) => {
      if (!activeRef.current) return;
      // 拷贝一份:原生 buffer 可能被复用。
      const copy = new Int16Array(buf.data.slice(0));
      rateRef.current = buf.sampleRate || rateRef.current;
      channelsRef.current = buf.channels || channelsRef.current;
      chunksRef.current.push(copy);
      pushLevel(levelOf(copy));
    },
  });

  const teardownWeb = () => {
    const s = webRef.current;
    webRef.current = null;
    if (!s) return;
    try { s.node.onaudioprocess = null; s.node.disconnect(); s.source.disconnect(); } catch { /* already gone */ }
    for (const t of s.stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
    void s.ctx.close().catch(() => {});
  };

  const stopCapture = () => {
    activeRef.current = false;
    if (isNative) {
      try { nativeStream?.stop(); } catch { /* not started */ }
      if (Platform.OS === 'ios') void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    } else {
      teardownWeb();
    }
    setLevel(0);
  };

  useEffect(() => () => { if (activeRef.current) stopCapture(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(async (): Promise<StartResult> => {
    if (activeRef.current) return { ok: true };
    chunksRef.current = [];
    if (isNative) {
      if (!nativeStream) return { ok: false, reason: '当前设备不支持录音' };
      try {
        const current = await getRecordingPermissionsAsync();
        if (!current.granted) {
          if (!current.canAskAgain) return { ok: false, reason: '麦克风权限被拒绝,请到系统设置里允许' };
          const asked = await requestRecordingPermissionsAsync();
          return asked.granted
            ? { ok: false, reason: '已允许麦克风,请再次按住说话', permissionJustGranted: true }
            : { ok: false, reason: '需要麦克风权限才能语音输入' };
        }
        if (Platform.OS === 'ios') await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        rateRef.current = TARGET_SAMPLE_RATE;
        channelsRef.current = 1;
        activeRef.current = true;
        await nativeStream.start();
        return { ok: true };
      } catch {
        activeRef.current = false;
        return { ok: false, reason: '麦克风被占用或无法启动' };
      }
    }
    if (!webSupported()) return { ok: false, reason: '当前环境不支持录音' };
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      const source = ctx.createMediaStreamSource(media);
      const node = ctx.createScriptProcessor(4096, 1, 1);
      rateRef.current = ctx.sampleRate;
      channelsRef.current = 1;
      node.onaudioprocess = (e) => {
        if (!activeRef.current) return;
        const pcm = float32ToInt16(new Float32Array(e.inputBuffer.getChannelData(0)));
        chunksRef.current.push(pcm);
        pushLevel(levelOf(pcm));
      };
      source.connect(node);
      node.connect(ctx.destination); // ScriptProcessor 不接到 destination 在部分引擎里不回调;输出是静音
      webRef.current = { stream: media, ctx, node, source };
      activeRef.current = true;
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      return { ok: true };
    } catch (e) {
      teardownWeb();
      const name = (e as { name?: string })?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, reason: '麦克风权限被拒绝' };
      if (name === 'NotFoundError') return { ok: false, reason: '没有找到麦克风' };
      return { ok: false, reason: '麦克风无法启动' };
    }
  }, [nativeStream]);

  const stop = useCallback((): Captured | null => {
    const was = activeRef.current;
    stopCapture();
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!was && chunks.length === 0) return null;
    return { chunks, sampleRate: rateRef.current, channels: channelsRef.current };
  }, [nativeStream]); // eslint-disable-line react-hooks/exhaustive-deps

  const discard = useCallback(() => {
    stopCapture();
    chunksRef.current = [];
  }, [nativeStream]); // eslint-disable-line react-hooks/exhaustive-deps

  return { supported: isNative ? !!nativeStream : webSupported(), start, stop, discard, level };
}
