// 桌面端（Tauri）/ 浏览器 / 鸿蒙 ArkWeb 聊天音频内嵌播放器：
// 凭据永远只走 downloadAuthedBytes（支持 AWS S3 直传加速 + 自动回退），
// 拉到字节后转本地 blob: URL 交给 HTML5 Audio 播放，不泄露 Bearer 到 DOM，同时保留下载 / 另存为 / 文件夹定位。
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import AttachmentAudioCard, { type AttachmentAudioAction } from './AttachmentAudioCard';
import { appFetch } from './app-fetch';
import {
  chooseSavePath,
  displayDownloadPath,
  downloadAuthedBytes,
  isTauriDesktop,
  revealInFolder,
  saveBrowserDownload,
  saveToDownloads,
} from './desktop-download';
import { harmonyDownloadFile, harmonyOpenLocalFile, hasHarmonyFileBridge } from './harmony-bridge';
import { downloadEta, formatEta } from './download-eta';
import { attachmentCacheScope } from './attach-download';
import { runDownloadJob } from './download-jobs';
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

export default function AttachmentAudioDesktop({
  uri,
  name,
  token,
  size,
  mime,
}: {
  uri: string;
  name: string;
  token: string;
  size?: number;
  mime?: string;
}) {
  const { t } = useTranslation();
  const instanceId = useId();
  const jobKey = `desktop|${attachmentCacheScope(uri, token)}`;
  const job = useDownloadJob(jobKey);
  const harmony = hasHarmonyFileBridge();

  const mounted = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const finishedRef = useRef(false);
  const rateRef = useRef(1);
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const playIntentRef = useRef(0);
  const saveBusy = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playError, setPlayError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const teardownAudio = useCallback(() => {
    playIntentRef.current++;
    releaseAudioPlayback(instanceId);
    const el = audioRef.current;
    audioRef.current = null;
    if (el) {
      try { el.pause(); } catch { /* ignore */ }
      try { el.removeAttribute('src'); el.load(); } catch { /* ignore */ }
    }
    if (blobUrlRef.current) {
      try { URL.revokeObjectURL(blobUrlRef.current); } catch { /* ignore */ }
      blobUrlRef.current = null;
    }
    bytesRef.current = null;
    finishedRef.current = false;
    durationRef.current = 0;
    currentTimeRef.current = 0;
  }, [instanceId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      teardownAudio();
    };
  }, [teardownAudio]);

  // 切换 Hub / 凭据 / 附件时清空旧 blob 与播放状态。
  useEffect(() => {
    teardownAudio();
    setPlaying(false);
    setFetching(false);
    setFetchProgress(undefined);
    setLoaded(false);
    setCurrentTime(0);
    setDuration(0);
    setPlayError(null);
    setNote(null);
  }, [uri, token, teardownAudio]);

  const pauseSelf = useCallback(() => {
    playIntentRef.current++;
    try { audioRef.current?.pause(); } catch { /* ignore */ }
    releaseAudioPlayback(instanceId);
    if (mounted.current) {
      setPlaying(false);
      setFetching(false);
    }
  }, [instanceId]);

  const ensureBytes = useCallback(async (onReport?: (p?: string) => void): Promise<Uint8Array> => {
    if (bytesRef.current) return bytesRef.current;
    const startedAt = Date.now();
    let lastPaint = 0;
    const bytes = await downloadAuthedBytes(appFetch, uri, token, (received, total) => {
      const now = Date.now();
      if (now - lastPaint < 400 && received !== total) return;
      lastPaint = now;
      const { percent, etaSeconds } = downloadEta(received, total ?? size, now - startedAt);
      const eta = formatEta(etaSeconds);
      const label = percent !== null && eta ? `${percent}% · 剩余约 ${eta}` : (eta ? `剩余约 ${eta}` : undefined);
      onReport?.(label);
    });
    bytesRef.current = bytes;
    return bytes;
  }, [size, token, uri]);

  const attachElement = useCallback((blobUrl: string): HTMLAudioElement => {
    if (audioRef.current && blobUrlRef.current === blobUrl) return audioRef.current;
    const el = new Audio(blobUrl);
    el.preload = 'metadata';
    el.playbackRate = rateRef.current;

    const syncDuration = () => {
      if (!mounted.current || audioRef.current !== el) return;
      if (Number.isFinite(el.duration) && el.duration > 0) {
        durationRef.current = el.duration;
        setDuration(el.duration);
        setLoaded(true);
      }
    };
    el.addEventListener('loadedmetadata', syncDuration);
    el.addEventListener('durationchange', syncDuration);
    el.addEventListener('timeupdate', () => {
      if (!mounted.current || audioRef.current !== el) return;
      if (Number.isFinite(el.currentTime)) {
        currentTimeRef.current = el.currentTime;
        setCurrentTime(el.currentTime);
      }
    });
    el.addEventListener('play', () => {
      if (!mounted.current || audioRef.current !== el) return;
      finishedRef.current = false;
      setPlaying(true);
      setFetching(false);
    });
    el.addEventListener('pause', () => {
      if (!mounted.current || audioRef.current !== el) return;
      setPlaying(false);
    });
    el.addEventListener('ended', () => {
      if (!mounted.current || audioRef.current !== el) return;
      finishedRef.current = true;
      setPlaying(false);
      releaseAudioPlayback(instanceId);
    });
    el.addEventListener('error', () => {
      if (!mounted.current || audioRef.current !== el) return;
      setPlayError(t('chat.audio.playbackFailed'));
      setPlaying(false);
      setFetching(false);
      releaseAudioPlayback(instanceId);
    });

    audioRef.current = el;
    return el;
  }, [instanceId, t]);

  const togglePlay = useCallback(async () => {
    if (playing) {
      pauseSelf();
      return;
    }
    const intent = ++playIntentRef.current;
    setPlayError(null);
    setFetching(true);
    setFetchProgress(undefined);
    claimAudioPlayback(instanceId, pauseSelf);

    try {
      let blobUrl = blobUrlRef.current;
      if (!blobUrl) {
        const bytes = await ensureBytes(label => {
          if (mounted.current && playIntentRef.current === intent) setFetchProgress(label);
        });
        if (!mounted.current || playIntentRef.current !== intent) return;
        const resolvedMime = audioMimeFor(name, mime);
        blobUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: resolvedMime }));
        blobUrlRef.current = blobUrl;
      }

      const el = attachElement(blobUrl);
      setLoaded(true);
      if (shouldRewindBeforePlay(currentTimeRef.current, durationRef.current, finishedRef.current)) {
        finishedRef.current = false;
        currentTimeRef.current = 0;
        setCurrentTime(0);
        try { el.currentTime = 0; } catch { /* ignore */ }
      }
      el.playbackRate = rateRef.current;
      await el.play();
      if (!mounted.current || playIntentRef.current !== intent) {
        try { el.pause(); } catch { /* ignore */ }
        return;
      }
      setPlaying(true);
      setFetching(false);
    } catch {
      if (!mounted.current || playIntentRef.current !== intent) return;
      releaseAudioPlayback(instanceId);
      setPlaying(false);
      setFetching(false);
      setPlayError(t('chat.audio.playbackFailed'));
    }
  }, [attachElement, ensureBytes, instanceId, mime, name, pauseSelf, playing, t]);

  const seek = useCallback((ratio: number) => {
    const el = audioRef.current;
    if (!el || durationRef.current <= 0) return;
    const target = seekTargetSeconds(ratio, durationRef.current);
    finishedRef.current = false;
    currentTimeRef.current = target;
    setCurrentTime(target);
    try { el.currentTime = target; } catch { /* ignore */ }
  }, []);

  const cycleRate = useCallback(() => {
    const next = nextPlaybackRate(rateRef.current);
    rateRef.current = next;
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  const saveFile = useCallback(async (direct: boolean, harmonyMode: 'open' | 'save' = 'open') => {
    if (saveBusy.current || job?.kind === 'downloading') return;
    saveBusy.current = true;
    setNote(null);
    try {
      let target: string | null | undefined;
      if (isTauriDesktop() && !direct) {
        target = await chooseSavePath(name);
        if (target === null) return;
      }
      await runDownloadJob(jobKey, async (report) => {
        if (hasHarmonyFileBridge()) {
          return harmonyDownloadFile({ url: uri, token, fileName: name, mimeType: mime, mode: harmonyMode });
        }
        const bytes = await ensureBytes(report);
        if (isTauriDesktop()) return saveToDownloads(name, bytes, target ?? null);
        saveBrowserDownload(bytes, name, audioMimeFor(name, mime));
        return '';
      });
    } catch { /* 错误记在任务表 */ }
    finally {
      saveBusy.current = false;
    }
  }, [ensureBytes, job?.kind, jobKey, mime, name, token, uri]);

  const savedPath = job?.kind === 'done' && job.result ? job.result : undefined;
  const reveal = useCallback(async () => {
    if (!savedPath || saveBusy.current) return;
    saveBusy.current = true;
    try {
      if (hasHarmonyFileBridge()) await harmonyOpenLocalFile({ path: savedPath, fileName: name, mimeType: mime });
      else await revealInFolder(savedPath);
    } catch (error) {
      setNote(t('chat.file.revealFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      saveBusy.current = false;
    }
  }, [mime, name, savedPath, t]);

  const downloading = job?.kind === 'downloading';
  const effectiveError = playError ?? (job?.kind === 'error' ? job.message : null);
  const footerDetail = note
    ?? (savedPath ? displayDownloadPath(savedPath) : job?.kind === 'done' && !harmony ? t('chat.file.browserHandedOff') : undefined);

  const actions: AttachmentAudioAction[] = [];
  if (savedPath) {
    actions.push({
      key: 'reveal',
      label: t(harmony ? 'chat.file.harmonyOpen' : 'chat.file.reveal'),
      accessibilityLabel: `${t(harmony ? 'chat.file.harmonyOpen' : 'chat.file.reveal')} ${name}`,
      onPress: () => { void reveal(); },
      testID: 'attachment-audio-reveal',
    });
    actions.push({
      key: 'save-as',
      label: t('chat.file.saveAs'),
      accessibilityLabel: `${t('chat.file.saveAs')} ${name}`,
      onPress: () => { void saveFile(false, 'save'); },
      disabled: downloading,
      testID: 'attachment-audio-save-as',
    });
  } else {
    actions.push({
      key: 'download',
      label: t(harmony ? 'chat.file.saveAs' : 'chat.audio.download'),
      accessibilityLabel: `${t('chat.audio.download')} ${name}`,
      onPress: (e: any) => { void saveFile(!!(e?.nativeEvent?.altKey ?? e?.altKey), harmony ? 'save' : 'open'); },
      disabled: downloading,
      testID: 'attachment-audio-save',
    });
  }

  return (
    <AttachmentAudioCard
      testID={`attachment-audio-desktop-${name}`}
      name={name}
      mime={mime}
      size={size}
      playing={playing}
      loading={fetching || downloading}
      loaded={loaded}
      currentTime={currentTime}
      duration={duration}
      playbackRate={playbackRate}
      progressText={downloading ? job.progress : fetchProgress}
      error={effectiveError}
      detail={footerDetail}
      onTogglePlay={() => { void togglePlay(); }}
      onSeek={seek}
      onCycleRate={cycleRate}
      actions={actions}
    />
  );
}
