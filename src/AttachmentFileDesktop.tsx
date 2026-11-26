import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import AttachmentFileCard from './AttachmentFileCard';
import AttachmentTextPreview, { TextPreviewLink } from './AttachmentTextPreview';
import { isTextPreviewable } from './attachment-file-model';
import { appFetch } from './app-fetch';
import { chooseSavePath, displayDownloadPath, downloadAuthedBytes, isTauriDesktop, revealInFolder, saveBrowserDownload, saveToDownloads } from './desktop-download';
import { harmonyDownloadFile, harmonyOpenLocalFile, hasHarmonyFileBridge } from './harmony-bridge';
import { colors } from './theme';
import { downloadEta, formatEta } from './download-eta';
import { useBubbleInk } from './bubble-ink';
import { attachmentCacheScope } from './attach-download';
import { runDownloadJob } from './download-jobs';
import { useDownloadJob } from './use-download-job';
import { useTranslation } from './i18n-react';
import './i18n-chat';

// Also handles plain web: credentials stay in the fetch header, never in an anchor.
export default function AttachmentFileDesktop({ uri, name, token, size, mime }: { uri: string; name: string; token: string; size?: number; mime?: string }) {
  const { t } = useTranslation();
  const linkInk = useBubbleInk('link');
  const busy = useRef(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewable = isTextPreviewable(name, mime, size);
  // 下载任务挂在模块级任务表里(download-jobs.ts):切会话卸载这张卡,下载照样跑完,回来还能看到进度/结果。
  const jobKey = `desktop|${attachmentCacheScope(uri, token)}`;
  const job = useDownloadJob(jobKey);
  const harmony = hasHarmonyFileBridge();
  const [note, setNote] = useState<{ message?: string; messageKey?: string } | null>(null);
  const state: { kind: 'ready' | 'downloading' | 'saved' | 'error'; path?: string; message?: string; messageKey?: string; eta?: string } =
    job?.kind === 'downloading' ? { kind: 'downloading', eta: job.progress }
      : job?.kind === 'error' ? { kind: 'error', message: job.message }
        : job?.kind === 'done' && job.result ? { kind: 'saved', path: job.result, ...note }
          : job?.kind === 'done' && !harmony ? { kind: 'ready', messageKey: 'chat.file.browserHandedOff' }
            : { kind: 'ready', ...note };
  const download = async (direct: boolean, harmonyMode: 'open' | 'save' = 'open') => {
    if (busy.current || job?.kind === 'downloading') return;
    busy.current = true;
    setNote(null);
    try {
      let target: string | null | undefined;
      if (isTauriDesktop() && !direct) {
        target = await chooseSavePath(name);
        if (target === null) return;
      }
      await runDownloadJob(jobKey, async (report) => {
        if (hasHarmonyFileBridge()) {
          // 鸿蒙原生直下 + 预览/另存为：大文件不经 JS Base64 往返，规避 OOM。
          return harmonyDownloadFile({ url: uri, token, fileName: name, mimeType: mime, mode: harmonyMode });
        }
        // 边下边算剩余时长:每 ~400ms 更新一次,避免每个 chunk 都触发重绘。
        const startedAt = Date.now();
        let lastPaint = 0;
        const onProgress = (received: number, total?: number) => {
          const now = Date.now();
          if (now - lastPaint < 400 && received !== total) return;
          lastPaint = now;
          const { percent, etaSeconds } = downloadEta(received, total ?? size, now - startedAt);
          const eta = formatEta(etaSeconds);
          report(percent !== null && eta ? `${percent}% · 剩余约 ${eta}` : (eta ? `剩余约 ${eta}` : undefined));
        };
        const bytes = await downloadAuthedBytes(appFetch, uri, token, onProgress);
        if (isTauriDesktop()) return saveToDownloads(name, bytes, target ?? null);
        saveBrowserDownload(bytes, name, mime);
        // The browser does not report whether the user actually saved the file.
        return '';
      });
    } catch { /* 失败已记在任务表里,卡片显示 */ }
    finally {
      busy.current = false;
    }
  };
  const reveal = async () => {
    if (!state.path || busy.current) return;
    busy.current = true;
    try {
      if (hasHarmonyFileBridge()) await harmonyOpenLocalFile({ path: state.path, fileName: name, mimeType: mime });
      else await revealInFolder(state.path);
    }
    catch (error) { setNote({ messageKey: 'chat.file.revealFailed', message: error instanceof Error ? error.message : String(error) }); }
    finally { busy.current = false; }
  };
  return (
    <View style={{ maxWidth: '100%' }} testID={`attachment-file-desktop-${name}`}>
      <AttachmentFileCard name={name} mime={mime} size={size} status={state.kind} progress={state.eta}
        detail={state.messageKey ? t(state.messageKey, { error: state.message ?? '' }) : state.message ?? (state.path ? displayDownloadPath(state.path) : t(harmony ? 'chat.file.harmonyHint' : isTauriDesktop() ? 'chat.file.saveHint' : 'chat.file.browserHint'))}
        onPress={state.kind === 'saved' ? () => { void reveal(); } : (e: any) => { void download(!!(e?.nativeEvent?.altKey ?? e?.altKey), 'open'); }} />
      {previewable || state.kind === 'saved' || harmony ? (
        <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 8 }}>
          {previewable ? <TextPreviewLink name={name} onPress={() => setPreviewOpen(true)} /> : null}
          {state.kind === 'saved' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${t(harmony ? 'chat.file.harmonyOpen' : 'chat.file.reveal')} ${name}`} testID="attachment-file-reveal" onPress={() => { void reveal(); }}><Text style={[{ color: colors.accent, fontSize: 12 }, linkInk]}>{t(harmony ? 'chat.file.harmonyOpen' : 'chat.file.reveal')}</Text></Pressable>
          ) : null}
          {state.kind === 'saved' || harmony ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('chat.file.saveAs')} ${name}`} testID="attachment-file-save-as" onPress={() => { void download(false, 'save'); }}><Text style={[{ color: colors.accent, fontSize: 12 }, linkInk]}>{t('chat.file.saveAs')}</Text></Pressable>
          ) : null}
        </View>
      ) : null}
      {previewOpen ? <AttachmentTextPreview url={uri} token={token} name={name} mime={mime} onClose={() => setPreviewOpen(false)} /> : null}
    </View>
  );
}
