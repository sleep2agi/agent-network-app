import * as FileSystem from 'expo-file-system/legacy';
import {
  describeAttachmentError,
  downloadAttachmentWith,
  mimeFromName,
  MAX_ATTACHMENT_BYTES,
  type DownloadFs,
} from './attach-download';
import * as Sharing from 'expo-sharing';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, onThemeChange, spacing } from './theme';

// Server-side attachment thumbnails were black boxes on device (Vincent
// tg 756): the hub serves /api/files with nosniff + octet-stream +
// Content-Disposition: attachment, which Android's remote-image pipeline
// can refuse even with auth headers. Downloading to cache via the native
// FileSystem layer and rendering the local file sidesteps all of it —
// and gives us offline re-entry for free.

// Android resolves "open with" by MIME first, extension second. Agent
// text refs carry neither (Vincent tg 791: share sheet got a bare-hex
// octet-stream file it couldn't open), so derive both from whichever
// side we have.
// 纯逻辑(扩展名/MIME 推导、缓存路径、下载成败判定)搬到 ./attach-download,
// 那边没有 RN 依赖所以能直接单测 —— 见 attach-download.test.ts 的 witnessed-red。
export { MAX_ATTACHMENT_BYTES, mimeFromName };

export const downloadAttachment = (
  serverUrl: string,
  token: string,
  fileId: string,
  name?: string,
  mime?: string,
): Promise<string> =>
  downloadAttachmentWith(
    FileSystem as unknown as DownloadFs,
    FileSystem.cacheDirectory ?? '',
    serverUrl, token, fileId, name, mime,
  );


/** 任意文件附件：点 📎 → 鉴权下载到缓存 → 系统「打开方式」(视频/Excel/PDF…)
 *  (Vincent tg 760)。 */
export function AttachmentFile({
  fileId,
  name,
  mime,
  serverUrl,
  token,
}: {
  fileId: string;
  name: string;
  mime?: string;
  serverUrl: string;
  token: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const resolvedMime = mime || mimeFromName(name);
      const local = await downloadAttachment(serverUrl, token, fileId, name, resolvedMime);
      await Sharing.shareAsync(local, {
        mimeType: resolvedMime || 'application/octet-stream',
        dialogTitle: name,
      });
    } catch (e) {
      setError(describeAttachmentError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable onPress={open} hitSlop={6}>
      <Text style={[styles.fallback, error && { color: colors.failed }]}>
        {busy ? '⏳' : '📎'} {name}
        {error ? `（${error}，点击重试）` : ''}
      </Text>
    </Pressable>
  );
}

function VideoFrame({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, p => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
    />
  );
}

export function AuthedVideo({
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
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLarge = typeof size === 'number' && size > MAX_ATTACHMENT_BYTES;

  const load = async () => {
    if (busy || localUri || tooLarge) return;
    setBusy(true);
    setError(null);
    try {
      const local = await downloadAttachment(serverUrl, token, fileId, name, mime || mimeFromName(name));
      setLocalUri(local);
    } catch (e) {
      // #511 — say which LAYER failed. The generic "下载失败" sent Vincent
      // looking at the file itself when the file had never arrived; the
      // download error carries the server status, so show it.
      setError(`${describeAttachmentError(e)}，点击重试`);
    } finally {
      setBusy(false);
    }
  };

  if (tooLarge) {
    return (
      <View style={styles.videoPlaceholder}>
        <Text style={styles.videoTitle}>▶ {name}</Text>
        <Text style={styles.videoHint}>视频超过 12MB，无法在对话里播放；请用文件方式打开</Text>
        <AttachmentFile fileId={fileId} name={name} mime={mime} serverUrl={serverUrl} token={token} />
      </View>
    );
  }

  if (localUri) {
    return <VideoFrame uri={localUri} />;
  }

  return (
    <Pressable style={styles.videoPlaceholder} onPress={load} hitSlop={6}>
      <Text style={styles.videoTitle}>{busy ? '⏳' : '▶'} {name}</Text>
      <Text style={[styles.videoHint, error && { color: colors.failed }]}>
        {error ?? '点击下载并播放'}
      </Text>
    </Pressable>
  );
}

export default function AuthedThumb({
  fileId,
  name,
  serverUrl,
  token,
  onPress,
}: {
  fileId: string;
  name: string;
  serverUrl: string;
  token: string;
  onPress: (localUri: string) => void;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    downloadAttachment(serverUrl, token, fileId, name)
      .then(local => live && setUri(local))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [fileId, name, serverUrl, token]);

  if (failed) {
    return <Text style={styles.fallback}>📎 {name}</Text>;
  }
  if (!uri) {
    return (
      <View style={[styles.thumb, styles.loading]}>
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    );
  }
  return (
    <Pressable onPress={() => onPress(uri)}>
      <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
    </Pressable>
  );
}

const makeStyles = () =>
  StyleSheet.create({
  thumb: {
    width: 180,
    height: 180,
    borderRadius: 10,
    marginTop: spacing.sm,
    backgroundColor: colors.inputBg,
  },
  loading: { alignItems: 'center', justifyContent: 'center' },
  fallback: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  video: {
    width: 220,
    height: 150,
    borderRadius: 10,
    marginTop: spacing.sm,
    backgroundColor: colors.inputBg,
  },
  videoPlaceholder: {
    width: 220,
    minHeight: 78,
    borderRadius: 10,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
  videoTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  videoHint: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
