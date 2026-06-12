import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const extOf = (name?: string) =>
  (name?.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();

export const mimeFromName = (name?: string): string | undefined => EXT_MIME[extOf(name)];

const extFromMime = (mime?: string): string => {
  if (!mime) return '';
  for (const [ext, m] of Object.entries(EXT_MIME)) if (m === mime) return ext;
  return '';
};

const cachePath = (fileId: string, name?: string, mime?: string) => {
  const ext = extOf(name) || extFromMime(mime);
  return `${FileSystem.cacheDirectory}att-${fileId}${ext}`;
};

export const downloadAttachment = async (
  serverUrl: string,
  token: string,
  fileId: string,
  name?: string,
  mime?: string,
): Promise<string> => {
  const dest = cachePath(fileId, name, mime);
  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists || (info.size ?? 0) === 0) {
    const r = await FileSystem.downloadAsync(`${serverUrl}/api/files/${fileId}`, dest, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  }
  return dest;
};

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
  const [error, setError] = useState(false);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const resolvedMime = mime || mimeFromName(name);
      const local = await downloadAttachment(serverUrl, token, fileId, name, resolvedMime);
      await Sharing.shareAsync(local, {
        mimeType: resolvedMime || 'application/octet-stream',
        dialogTitle: name,
      });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable onPress={open} hitSlop={6}>
      <Text style={[styles.fallback, error && { color: colors.failed }]}>
        {busy ? '⏳' : '📎'} {name}
        {error ? '（打开失败，点击重试）' : ''}
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
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
