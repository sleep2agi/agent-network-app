import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { appFetch } from './app-fetch';
import { colors, onThemeChange, spacing } from './theme';
import { downloadImageObjectUrl, saveImageObjectUrl } from './web-image-download';
import { chooseSavePath, isTauriDesktop, revealInFolder, saveToDownloads, displayDownloadPath } from './desktop-download';

/** Tauri 的 WebView 里 <a download> 不落盘(Vincent 2026-09-07):走 Rust 写进「下载」目录;
 *  点 → 另存为对话框选位置,⌥/Alt 点 → 直接存到下载。返回落盘路径(浏览器下载/取消时为 null)。
 *  多图气泡的预览层也用它(方格里放不下「下载原图」那一行)。 */
export const saveObjectUrlOriginal = async (url: string, name: string, direct = false): Promise<string | null> => {
  if (!isTauriDesktop()) { saveImageObjectUrl(url, name); return null; }
  let target: string | null | undefined;
  if (!direct) { target = await chooseSavePath(name).catch(() => undefined); if (target === null) return null; }
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  return saveToDownloads(name, bytes, target ?? null);
};

export default function AuthedWebThumb({
  uri,
  name,
  mime,
  token,
  onPress,
  compact = false,
}: {
  uri: string;
  name: string;
  mime?: string;
  token: string;
  onPress: (objectUrl: string) => void;
  /** 多图气泡的方格:84×84 cover,不带「下载原图」行(点开预览里下载)。 */
  compact?: boolean;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const saveOriginal = async (url: string, direct = false) => {
    try {
      const saved = await saveObjectUrlOriginal(url, name, direct);
      if (saved) setSavedPath(saved);
    } catch (reason) {
      setError(`保存失败(${reason instanceof Error ? reason.message : String(reason)})`);
    }
  };

  useEffect(() => {
    let live = true;
    let allocated: string | null = null;
    // A profile/Hub switch must blank the old authenticated pixels before the
    // new request resolves; otherwise one render can expose the prior profile.
    setObjectUrl(null);
    setError(null);
    downloadImageObjectUrl(appFetch, uri, token, name, undefined, mime)
      .then(url => {
        allocated = url;
        if (live) setObjectUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(reason => {
        if (!live) return;
        const detail = reason instanceof Error ? reason.message : String(reason ?? '');
        setError(detail ? `图片加载失败（${detail}）` : '图片加载失败');
      });
    return () => {
      live = false;
      if (allocated) URL.revokeObjectURL(allocated);
    };
  }, [uri, token, name, mime, attempt]);

  if (error) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name} 加载失败，点击重试`}
        style={compact ? styles.compact : styles.failed}
        onPress={() => { setError(null); setAttempt(value => value + 1); }}
      >
        <Text style={styles.failedIcon}>↻</Text>
        {compact ? null : <Text style={styles.name} numberOfLines={1}>{name}</Text>}
        <Text style={styles.failedText}>{compact ? '点击重试' : `${error} · 点击重试`}</Text>
      </Pressable>
    );
  }
  if (!objectUrl) {
    return <View style={compact ? styles.compact : styles.thumb}><ActivityIndicator size="small" color={colors.textMuted} /></View>;
  }
  if (compact) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`预览 ${name}`} onPress={() => onPress(objectUrl)}>
        <Image source={{ uri: objectUrl }} style={styles.compact} resizeMode="cover" />
      </Pressable>
    );
  }
  return (
    <View style={styles.imageCard}>
      <Pressable accessibilityRole="button" accessibilityLabel={`预览 ${name}`} onPress={() => onPress(objectUrl)}>
        <Image source={{ uri: objectUrl }} style={styles.thumb} resizeMode="contain" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`下载 ${name}`}
        hitSlop={6}
        onPress={(e: any) => { void saveOriginal(objectUrl, !!(e?.nativeEvent?.altKey ?? e?.altKey)); }}
      >
        <Text style={styles.download}>{savedPath ? `✓ 已保存到 ${displayDownloadPath(savedPath)}` : '↓ 下载原图'}</Text>
      </Pressable>
      {savedPath ? (
        <Pressable accessibilityRole="button" hitSlop={6} onPress={() => { void revealInFolder(savedPath).catch(() => undefined); }}>
          <Text style={styles.download}>在文件夹中显示</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  imageCard: { alignItems: 'flex-start' },
  compact: { width: 84, height: 84, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
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
  download: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
