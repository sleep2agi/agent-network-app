import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { appFetch } from './app-fetch';
import { colors, onThemeChange, spacing } from './theme';
import { downloadImageObjectUrl } from './web-image-download';

export default function AuthedWebThumb({
  uri,
  name,
  token,
  onPress,
}: {
  uri: string;
  name: string;
  token: string;
  onPress: (objectUrl: string) => void;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    let allocated: string | null = null;
    downloadImageObjectUrl(appFetch, uri, token, name)
      .then(url => {
        allocated = url;
        if (live) setObjectUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      if (allocated) URL.revokeObjectURL(allocated);
    };
  }, [uri, token, name, attempt]);

  if (failed) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} 加载失败，点击重试`}
        style={styles.failed}
        onPress={() => { setFailed(false); setAttempt(value => value + 1); }}
      >
        <Text style={styles.failedIcon}>↻</Text>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.failedText}>图片加载失败 · 点击重试</Text>
      </Pressable>
    );
  }
  if (!objectUrl) {
    return <View style={styles.thumb}><ActivityIndicator size="small" color={colors.textMuted} /></View>;
  }
  return (
    <Pressable onPress={() => onPress(objectUrl)}>
      <Image source={{ uri: objectUrl }} style={styles.thumb} resizeMode="contain" />
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  thumb: {
    width: 180,
    height: 180,
    borderRadius: 10,
    marginTop: spacing.sm,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failed: {
    width: 180,
    height: 112,
    borderRadius: 10,
    marginTop: spacing.sm,
    padding: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
  },
  failedIcon: { color: colors.failed, fontSize: 22, marginBottom: 4 },
  name: { color: colors.text, fontSize: 12, maxWidth: 156 },
  failedText: { color: colors.failed, fontSize: 11, marginTop: 3 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
