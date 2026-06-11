import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from './theme';

// Server-side attachment thumbnails were black boxes on device (Vincent
// tg 756): the hub serves /api/files with nosniff + octet-stream +
// Content-Disposition: attachment, which Android's remote-image pipeline
// can refuse even with auth headers. Downloading to cache via the native
// FileSystem layer and rendering the local file sidesteps all of it —
// and gives us offline re-entry for free.

const cachePath = (fileId: string) => `${FileSystem.cacheDirectory}att-${fileId}`;

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
    (async () => {
      try {
        const dest = cachePath(fileId);
        const info = await FileSystem.getInfoAsync(dest);
        if (!info.exists || (info.size ?? 0) === 0) {
          const r = await FileSystem.downloadAsync(`${serverUrl}/api/files/${fileId}`, dest, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        }
        if (live) setUri(dest);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [fileId, serverUrl, token]);

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
