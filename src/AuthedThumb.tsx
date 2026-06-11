import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from './theme';

// Server-side attachment thumbnails were black boxes on device (Vincent
// tg 756): the hub serves /api/files with nosniff + octet-stream +
// Content-Disposition: attachment, which Android's remote-image pipeline
// can refuse even with auth headers. Downloading to cache via the native
// FileSystem layer and rendering the local file sidesteps all of it —
// and gives us offline re-entry for free.

const cachePath = (fileId: string, name?: string) => {
  // keep the extension so the system "open with" sheet picks the right app
  const ext = (name?.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '').toLowerCase();
  return `${FileSystem.cacheDirectory}att-${fileId}${ext}`;
};

export const downloadAttachment = async (
  serverUrl: string,
  token: string,
  fileId: string,
  name?: string,
): Promise<string> => {
  const dest = cachePath(fileId, name);
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
      const local = await downloadAttachment(serverUrl, token, fileId, name);
      await Sharing.shareAsync(local, {
        mimeType: mime || 'application/octet-stream',
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

const styles = StyleSheet.create({
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
