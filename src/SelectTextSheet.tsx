import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, onThemeChange, spacing } from './theme';
import { selectableTextOf, selectTextSurface, type SelectTextMode } from './message-plain-text';

/**
 * 「选择文本」(微信同款,Vincent 2026-09-26 安卓折叠屏):长按消息 → 选择文本 → 全屏只读文本,
 * 用系统选区手柄拖过任意段落/句子,用系统浮条「复制」。
 *
 * 承载控件按平台分(理由见 message-plain-text.ts selectTextSurface):安卓一个 `<Text selectable>`,
 * iOS/web 一个只读多行 TextInput。两种都是**一个**原生节点,所以选区能跨段落。
 */
export default function SelectTextSheet({ text, author, onClose, onCopyAll }: {
  /** null = 关闭。原始消息内容(可能带「@作者: …」引用行和 Markdown)。 */
  text: string | null;
  author?: string;
  onClose: () => void;
  onCopyAll: (value: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<SelectTextMode>('plain');
  // 每次打开都从「纯文本」开始 —— 上一条消息切到了原文,不该带到下一条。
  useEffect(() => { if (text !== null) setMode('plain'); }, [text]);
  const value = selectableTextOf(text ?? '', mode);
  const surface = selectTextSurface(Platform.OS);
  return (
    <Modal visible={text !== null} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityLabel="选择文本">
        <View style={styles.header}>
          <Pressable accessibilityLabel="关闭选择文本" hitSlop={10} onPress={onClose}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{author ? `选择文本 · ${author}` : '选择文本'}</Text>
          <Pressable
            accessibilityLabel={mode === 'plain' ? '显示 Markdown 原文' : '显示纯文本'}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setMode(m => (m === 'plain' ? 'markdown' : 'plain'))}
            style={({ pressed }) => [styles.modeBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.modeText}>{mode === 'plain' ? '原文' : '纯文本'}</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>拖动选区手柄选中任意段落，用系统菜单复制</Text>
        {surface === 'selectable-text' ? (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text selectable style={styles.text} testID="select-text-body">{value}</Text>
          </ScrollView>
        ) : (
          <TextInput
            testID="select-text-body"
            accessibilityLabel="消息文本"
            value={value}
            editable={false}
            multiline
            scrollEnabled
            contextMenuHidden={false}
            textAlignVertical="top"
            style={[styles.body, styles.bodyContent, styles.text, styles.input]}
          />
        )}
        <Pressable
          accessibilityLabel="复制全文"
          style={({ pressed }) => [styles.copyAll, pressed && { opacity: 0.6 }]}
          onPress={() => onCopyAll(value)}
        >
          <Ionicons name="copy-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.copyAllText}>复制全文</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.card },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, fontWeight: '600' },
  modeBtn: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  modeText: { color: colors.textSecondary, fontSize: 13 },
  hint: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, width: '100%', maxWidth: 760, alignSelf: 'center' },
  // 折叠屏展开/平板上别铺满整宽:一行太长选区手柄难拖,阅读也累。
  body: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  bodyContent: { padding: spacing.lg },
  // 气泡正文同字号,选区手柄好抓;web 上允许在任意位置断行(长 URL/hash)。
  text: { color: colors.text, fontSize: 16, lineHeight: 26, ...(Platform.OS === 'web' ? ({ userSelect: 'text', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' } as any) : {}) },
  input: { borderWidth: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', resize: 'none' } as any) : {}) },
  copyAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  copyAllText: { color: colors.textSecondary, fontSize: 13 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
