import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import type { HubConfig, HubScheduledRun, HubTask } from './api';
import MarkdownMessage from './MarkdownMessage';
import AuthedThumb, { AttachmentFile, AuthedVideo } from './AuthedThumb';
import AuthedWebThumb from './AuthedWebThumb';
import AttachmentFileDesktop from './AttachmentFileDesktop';
import ImageViewer from './ImageViewer';
import { openGallery, viewerImageFor, type ViewerImage, type ViewerState } from './image-viewer-model';
import { attachmentCacheScope } from './attach-download';
import { cleanAttachmentDebugText } from './attachment-display';
import { runDisplay, runFailureText, runReplyAttachments, type RunAttachment } from './schedule-run-result';
import { colors, radius, spacing, type as fontSize, weight } from './theme';

/** 执行记录展开后的内容:任务结果(节点回复全文 + 附件)或失败原因,以及「去会话」。 */
export type RunTaskState = { loading: boolean; task: HubTask | null; error: string };

export default function ScheduleRunResult({ cfg, run, state, onRetry, onOpenChat }: {
  cfg: HubConfig;
  run: HubScheduledRun;
  /** undefined = 还没开始读(第一次展开的那一帧)。 */
  state?: RunTaskState;
  onRetry: () => void;
  onOpenChat?: () => void;
}) {
  const s = useMemo(makeStyles, []);
  const task = state?.task ?? null;
  const display = runDisplay(run, task);
  const failure = runFailureText(run, task);
  const attachments = useMemo(() => runReplyAttachments(task, cfg.serverUrl), [task, cfg.serverUrl]);
  const reply = cleanAttachmentDebugText(task?.result ?? task?.reply ?? '');
  // 预览随凭据/Hub 切换关掉(与聊天同一条边界):旧凭据取到的图不留在屏上。
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const scope = attachmentCacheScope(cfg.serverUrl, cfg.token);
  useEffect(() => setViewer(null), [scope]);
  const viewerEnv = { os: Platform.OS, tauri: !!(globalThis as any).__TAURI_INTERNALS__ };
  const gallery: ViewerImage[] = attachments.map(a => viewerImageFor(a, viewerEnv)).filter((v): v is ViewerImage => !!v);
  const openViewer = (key: string, resolvedUri?: string) => setViewer(openGallery(gallery, key, resolvedUri));

  let body;
  if (!run.task_id) {
    // 跳过 / 派发失败:没有任务可读,只有原因。
    body = <Text style={s.failure} selectable>{failure || '这次没有派发给节点'}</Text>;
  } else if (!state || (state.loading && !task)) {
    body = <View style={s.loadingRow}><ActivityIndicator size="small" color={colors.accent} /><Text style={s.muted}>正在读取执行结果…</Text></View>;
  } else if (state.error && !task) {
    body = (
      <View style={s.loadingRow}>
        <Text style={s.failure}>读取失败:{state.error}</Text>
        <Pressable onPress={onRetry} accessibilityRole="button" hitSlop={6}><Text style={s.link}>重试</Text></Pressable>
      </View>
    );
  } else if (!task) {
    body = <Text style={s.muted}>任务记录已不在 Hub 上(可能已被清理)</Text>;
  } else {
    body = (
      <>
        {display.kind === 'failed' && failure ? <Text style={s.failure} selectable>{failure}</Text> : null}
        {reply ? (
          <View style={s.reply} testID="schedule-run-reply">
            <MarkdownMessage>{reply}</MarkdownMessage>
            {attachments.map(a => renderAttachment(a))}
          </View>
        ) : attachments.length ? (
          <View style={s.reply}>{attachments.map(a => renderAttachment(a))}</View>
        ) : (
          <Text style={s.muted}>{display.kind === 'failed' ? '节点没有回复内容' : display.kind === 'done' ? '节点回复为空' : '节点还没有回复'}</Text>
        )}
      </>
    );
  }

  function renderAttachment(a: RunAttachment) {
    const key = `${scope}-${a.key}`;
    const tauri = viewerEnv.tauri;
    if (a.isImage && Platform.OS === 'web' && tauri) {
      return <AuthedWebThumb key={key} uri={a.uri} name={a.name} mime={a.mime} token={cfg.token} onPress={objectUrl => openViewer(a.key, objectUrl)} />;
    }
    if (a.isImage && Platform.OS !== 'web') {
      return (
        <View key={key} style={s.attachmentImage}>
          <AuthedThumb fileId={a.key} name={a.name} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} onPress={localUri => openViewer(a.key, localUri)} />
          <AttachmentFile fileId={a.key} name={a.name} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} label="下载原图" />
        </View>
      );
    }
    if (a.isVideo && Platform.OS !== 'web') {
      return <AuthedVideo key={key} fileId={a.key} name={a.name} mime={a.mime} size={a.size} serverUrl={cfg.serverUrl} token={cfg.token} />;
    }
    if (Platform.OS !== 'web') {
      return <AttachmentFile key={key} fileId={a.key} name={a.name} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} />;
    }
    if (tauri) return <AttachmentFileDesktop key={key} uri={a.uri} name={a.name} token={cfg.token} size={a.size} />;
    return <Text key={a.key} style={s.attachmentLine}>📎 {a.name}</Text>;
  }

  return (
    <View style={s.root} testID={`schedule-run-result-${run.run_id}`}>
      {body}
      {onOpenChat && run.task_id ? (
        <Pressable onPress={onOpenChat} accessibilityRole="button" accessibilityLabel="去会话" style={({ pressed }) => [s.chatButton, pressed && { opacity: 0.6 }]} testID="schedule-run-open-chat">
          <Text style={s.chatButtonText}>去会话 ›</Text>
        </Pressable>
      ) : null}
      <ImageViewer state={viewer} onClose={() => setViewer(null)} serverUrl={cfg.serverUrl} token={cfg.token} />
    </View>
  );
}

function makeStyles() { return StyleSheet.create({
  root: { paddingBottom: spacing.md, gap: spacing.sm },
  reply: { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { color: colors.textMuted, fontSize: fontSize.small },
  failure: { color: colors.failed, fontSize: fontSize.small, lineHeight: 18 },
  link: { color: colors.accent, fontSize: fontSize.small },
  attachmentImage: { alignItems: 'flex-start' },
  attachmentLine: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  chatButton: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 6 },
  chatButtonText: { color: colors.accent, fontSize: fontSize.small, fontWeight: weight.medium },
}); }
