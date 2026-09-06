import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { appFetch } from './app-fetch';
import { displayDownloadPath, downloadAuthedBytes, revealInFolder, saveToDownloads } from './desktop-download';
import { colors, onThemeChange, spacing } from './theme';

// 桌面端非图片附件:点一下 → 带凭据下载 → 存到「下载」→ 显示路径 + 「在文件夹中显示」。
export default function AttachmentFileDesktop({ uri, name, token, size }: { uri: string; name: string; token: string; size?: number }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'saved'; path: string } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const download = async () => {
    if (state.kind === 'busy') return;
    setState({ kind: 'busy' });
    try {
      const bytes = await downloadAuthedBytes(appFetch, uri, token);
      const path = await saveToDownloads(name, bytes);
      setState({ kind: 'saved', path });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const sizeText = size ? ` · ${size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`}` : '';
  return (
    <View style={styles.wrap} testID={`attachment-file-desktop-${name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel={`下载 ${name}`} hitSlop={6} onPress={() => { void download(); }}>
        <Text style={[styles.line, state.kind === 'error' && { color: colors.failed }]}>
          {state.kind === 'busy' ? '⏳' : state.kind === 'saved' ? '✓' : '📎'} {name}{sizeText}
          {state.kind === 'idle' ? '  ·  点击下载' : state.kind === 'busy' ? '  ·  下载中…' : state.kind === 'error' ? `  ·  失败:${state.message},点击重试` : ''}
        </Text>
      </Pressable>
      {state.kind === 'saved' ? (
        <Pressable accessibilityRole="button" hitSlop={6} onPress={() => { void revealInFolder(state.path).catch(() => undefined); }}>
          <Text style={styles.saved}>已保存到 {displayDownloadPath(state.path)}  ·  在文件夹中显示</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  wrap: { marginTop: spacing.xs },
  line: { color: colors.accent, fontSize: 13, lineHeight: 19 },
  saved: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
