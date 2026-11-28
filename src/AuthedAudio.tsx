// 手机端（iOS / Android）聊天音频内嵌播放器：走既有 downloadAttachment（含 S3 直传加速与本地校验缓存）
// + expo-audio 原生 AudioPlayer，点一下直接出声，且静音开关开启时也能正常外放。
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import AttachmentAudioCard from './AttachmentAudioCard';
import { etaLabel, nativeJobKey, runNativeDownload } from './AuthedThumb';
import { useDownloadJob } from './use-download-job';
import {
  audioMimeFor,
  claimAudioPlayback,
  nextPlaybackRate,
  releaseAudioPlayback,
  seekTargetSeconds,
  shouldRewindBeforePlay,
} from './attachment-audio-model';
import { useTranslation } from './i18n-react';
import './i18n-chat';

export default function AuthedAudio({
  fileId,
  name,
  mime,
  size,
  serverUrl,
  token,
}: {
  fileId: string;
  name: string;
  mime?: string;
  size?: number;
  serverUrl: string;
  token: string;
}) {
  const { t } = useTranslation();
  const instanceId = useId();
  const job = useDownloadJob(nativeJobKey(serverUrl, token, fileId));
  const mounted = useRef(true);
  const playerRef = useRef<AudioPlayer | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);
  const loadedUriRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const rateRef = useRef(1);
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const playIntentRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playError, setPlayError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const teardownPlayer = useCallback(() => {
    playIntentRef.current++;
    releaseAudioPlayback(instanceId);
    try { subRef.current?.remove(); } catch { /* ignore */ }
    subRef.current = null;
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch { /* ignore */ }
      try { playerRef.current.remove(); } catch { /* ignore */ }
      playerRef.current = null;
    }
    loadedUriRef.current = null;
    finishedRef.current = false;
    durationRef.current = 0;
    currentTimeRef.current = 0;
  }, [instanceId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      teardownPlayer();
    };
  }, [teardownPlayer]);

  // 切换 Hub / 凭据 / 附件时释放旧播放器与状态。
  useEffect(() => {
    teardownPlayer();
    setPlaying(false);
    setPreparing(false);
    setLoaded(false);
    setCurrentTime(0);
    setDuration(0);
    setPlayError(null);
  }, [serverUrl, token, fileId, teardownPlayer]);

  const pauseSelf = useCallback(() => {
    playIntentRef.current++;
    try { playerRef.current?.pause(); } catch { /* ignore */ }
    releaseAudioPlayback(instanceId);
    if (mounted.current) {
      setPlaying(false);
      setPreparing(false);
    }
  }, [instanceId]);

  const attachPlayer = useCallback((uri: string): AudioPlayer => {
    if (playerRef.current && loadedUriRef.current === uri) return playerRef.current;
    teardownPlayer();
    const player = createAudioPlayer(uri, { updateInterval: 200 });
    player.shouldCorrectPitch = true;
    if (rateRef.current !== 1) {
      try { player.setPlaybackRate(rateRef.current); } catch { /* ignore */ }
    }
    const sub = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (!mounted.current || playerRef.current !== player) return;
      if (typeof status.duration === 'number' && Number.isFinite(status.duration) && status.duration > 0) {
        durationRef.current = status.duration;
        setDuration(status.duration);
      }
      if (typeof status.currentTime === 'number' && Number.isFinite(status.currentTime)) {
        currentTimeRef.current = status.currentTime;
        setCurrentTime(status.currentTime);
      }
      if (status.isLoaded) setLoaded(true);
      if (status.error) {
        setPlayError(t('chat.audio.playbackFailed'));
        setPlaying(false);
        setPreparing(false);
        releaseAudioPlayback(instanceId);
        return;
      }
      if (status.didJustFinish) {
        finishedRef.current = true;
        setPlaying(false);
        setPreparing(false);
        releaseAudioPlayback(instanceId);
        return;
      }
      setPlaying(!!status.playing);
      if (status.playing || status.isLoaded) setPreparing(false);
    });
    playerRef.current = player;
    subRef.current = sub;
    loadedUriRef.current = uri;
    return player;
  }, [instanceId, t, teardownPlayer]);

  const togglePlay = useCallback(async () => {
    if (playing) {
      pauseSelf();
      return;
    }
    const intent = ++playIntentRef.current;
    setPlayError(null);
    setPreparing(true);
    claimAudioPlayback(instanceId, pauseSelf);

    try {
      const resolvedMime = audioMimeFor(name, mime);
      const localUri = job?.kind === 'done' && job.result
        ? job.result
        : await runNativeDownload(serverUrl, token, fileId, name, resolvedMime, size, etaLabel);
      if (!mounted.current || playIntentRef.current !== intent) return;

      // 关键：iPhone 静音开关打开或刚用完语音输入（.playAndRecord）时，强制走外放播放会话，
      // 避免用户点了播放却听不到声音或只从听筒极小声出来。
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        shouldRouteThroughEarpiece: false,
        interruptionMode: 'doNotMix',
      }).catch(() => {});
      if (!mounted.current || playIntentRef.current !== intent) return;

      const player = attachPlayer(localUri);
      setLoaded(true);
      if (shouldRewindBeforePlay(currentTimeRef.current, durationRef.current, finishedRef.current)) {
        finishedRef.current = false;
        currentTimeRef.current = 0;
        setCurrentTime(0);
        await player.seekTo(0).catch(() => {});
        if (!mounted.current || playIntentRef.current !== intent) return;
      }
      if (rateRef.current !== 1) {
        try { player.setPlaybackRate(rateRef.current); } catch { /* ignore */ }
      }
      player.play();
      setPlaying(true);
      setPreparing(false);
    } catch {
      if (!mounted.current || playIntentRef.current !== intent) return;
      releaseAudioPlayback(instanceId);
      setPlaying(false);
      setPreparing(false);
      // 下载失败文案留在 download-jobs 里展示；只有解码/播放失败才设本地错误。
      if (job?.kind === 'done') setPlayError(t('chat.audio.playbackFailed'));
    }
  }, [attachPlayer, fileId, instanceId, job, mime, name, pauseSelf, playing, serverUrl, size, t, token]);

  const seek = useCallback((ratio: number) => {
    const player = playerRef.current;
    if (!player || durationRef.current <= 0) return;
    const target = seekTargetSeconds(ratio, durationRef.current);
    finishedRef.current = false;
    currentTimeRef.current = target;
    setCurrentTime(target);
    void player.seekTo(target).catch(() => {});
  }, []);

  const cycleRate = useCallback(() => {
    const next = nextPlaybackRate(rateRef.current);
    rateRef.current = next;
    setPlaybackRate(next);
    if (playerRef.current) {
      try { playerRef.current.setPlaybackRate(next); } catch { /* ignore */ }
    }
  }, []);

  const shareOrSave = useCallback(async () => {
    if (sharing || job?.kind === 'downloading') return;
    setSharing(true);
    try {
      const resolvedMime = audioMimeFor(name, mime);
      const localUri = await runNativeDownload(serverUrl, token, fileId, name, resolvedMime, size, etaLabel);
      if (!mounted.current) return;
      await Sharing.shareAsync(localUri, {
        mimeType: resolvedMime,
        dialogTitle: name,
      });
    } catch { /* 错误留在任务表展示 */ }
    finally {
      if (mounted.current) setSharing(false);
    }
  }, [fileId, job?.kind, mime, name, serverUrl, sharing, size, token]);

  const downloading = job?.kind === 'downloading';
  const downloadError = job?.kind === 'error' ? job.message : null;
  const effectiveError = playError ?? downloadError;

  return (
    <AttachmentAudioCard
      testID={`authed-audio-${name}`}
      name={name}
      mime={mime}
      size={size}
      playing={playing}
      loading={preparing || downloading}
      loaded={loaded}
      currentTime={currentTime}
      duration={duration}
      playbackRate={playbackRate}
      progressText={downloading ? job.progress : undefined}
      error={effectiveError}
      onTogglePlay={() => { void togglePlay(); }}
      onSeek={seek}
      onCycleRate={cycleRate}
      actions={[
        {
          key: 'share',
          label: t('chat.audio.saveShare'),
          accessibilityLabel: `${t('chat.audio.saveShare')} ${name}`,
          onPress: () => { void shareOrSave(); },
          disabled: downloading || sharing,
          testID: 'attachment-audio-save',
        },
      ]}
    />
  );
}
