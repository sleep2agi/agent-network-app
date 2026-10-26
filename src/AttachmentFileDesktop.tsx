import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ui-text';
import AttachmentFileCard from './AttachmentFileCard';
import { appFetch } from './app-fetch';
import { chooseSavePath, displayDownloadPath, downloadAuthedBytes, isTauriDesktop, revealInFolder, saveBrowserDownload, saveToDownloads } from './desktop-download';
import { colors } from './theme';
import { downloadEta, formatEta } from './download-eta';
import { useBubbleInk } from './bubble-ink';
import { useTranslation } from './i18n-react';
import './i18n-chat';

// Also handles plain web: credentials stay in the fetch header, never in an anchor.
export default function AttachmentFileDesktop({ uri, name, token, size, mime }: { uri: string; name: string; token: string; size?: number; mime?: string }) {
  const { t } = useTranslation();
  const linkInk = useBubbleInk('link');
  const busy = useRef(false);
  const [state, setState] = useState<{ kind: 'ready' | 'downloading' | 'saved' | 'error'; path?: string; message?: string; messageKey?: string; eta?: string }>({ kind: 'ready' });
  const download = async (direct: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const previous = state;
    setState({ kind: 'downloading' });
    try {
      let target: string | null | undefined;
      if (isTauriDesktop() && !direct) {
        target = await chooseSavePath(name);
        if (target === null) { setState(previous); return; }
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
        setState({ kind: 'downloading', eta: percent !== null && eta ? `${percent}% · 剩余约 ${eta}` : (eta ? `剩余约 ${eta}` : undefined) });
      };
      const bytes = await downloadAuthedBytes(appFetch, uri, token, onProgress);
      if (isTauriDesktop()) {
        const path = await saveToDownloads(name, bytes, target ?? null);
        setState({ kind: 'saved', path });
      } else {
        saveBrowserDownload(bytes, name, mime);
        // The browser does not report whether the user actually saved the file.
        setState({ kind: 'ready', messageKey: 'chat.file.browserHandedOff' });
      }
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      busy.current = false;
    }
  };
  const reveal = async () => {
    if (!state.path || busy.current) return;
    busy.current = true;
    try { await revealInFolder(state.path); }
    catch (error) { setState({ ...state, messageKey: 'chat.file.revealFailed', message: error instanceof Error ? error.message : String(error) }); }
    finally { busy.current = false; }
  };
  return (
    <View style={{ maxWidth: '100%' }} testID={`attachment-file-desktop-${name}`}>
      <AttachmentFileCard name={name} mime={mime} size={size} status={state.kind} progress={state.eta}
        detail={state.messageKey ? t(state.messageKey, { error: state.message ?? '' }) : state.message ?? (state.path ? displayDownloadPath(state.path) : t(isTauriDesktop() ? 'chat.file.saveHint' : 'chat.file.browserHint'))}
        onPress={state.kind === 'saved' ? () => { void reveal(); } : (e: any) => { void download(!!(e?.nativeEvent?.altKey ?? e?.altKey)); }} />
      {state.kind === 'saved' ? (
        <View style={{ flexDirection: 'row', gap: 16, paddingVertical: 8 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t('chat.file.reveal')} ${name}`} testID="attachment-file-reveal" onPress={() => { void reveal(); }}><Text style={[{ color: colors.accent, fontSize: 12 }, linkInk]}>{t('chat.file.reveal')}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t('chat.file.saveAs')} ${name}`} testID="attachment-file-save-as" onPress={() => { void download(false); }}><Text style={[{ color: colors.accent, fontSize: 12 }, linkInk]}>{t('chat.file.saveAs')}</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}
