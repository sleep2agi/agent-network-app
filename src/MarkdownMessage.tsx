import { Fragment, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openUrl } from '@tauri-apps/plugin-opener';
import { colors, onThemeChange, spacing } from './theme';
import { isSafeMarkdownUrl, parseMarkdownBlocks } from './markdown-model';
import { foldCode, foldLabel } from './markdown-code-fold';

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_([^_\n]+)_|\[[^\]\n]+\]\([^\s)]+\))/g;

export async function openMarkdownUrl(url: string) {
  if (!isSafeMarkdownUrl(url)) return;
  if ((globalThis as any).__TAURI_INTERNALS__) {
    await openUrl(url);
    return;
  }
  await Linking.openURL(url);
}

function Inline({ text }: { text: string }) {
  const out = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > cursor) out.push(<Fragment key={key++}>{text.slice(cursor, at)}</Fragment>);
    const token = match[0];
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const safe = isSafeMarkdownUrl(link[2]);
      out.push(<Text key={key++} accessibilityRole={safe ? 'link' : undefined} style={safe ? styles.link : undefined} onPress={safe ? (event) => { event.stopPropagation(); void openMarkdownUrl(link[2]); } : undefined}>{link[1]}</Text>);
    } else if (token.startsWith('`')) {
      out.push(<Text key={key++} style={styles.inlineCode}>{token.slice(1, -1)}</Text>);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<Text key={key++} style={styles.strong}>{token.slice(2, -2)}</Text>);
    } else {
      out.push(<Text key={key++} style={styles.em}>{token.slice(1, -1)}</Text>);
    }
    cursor = at + token.length;
  }
  if (cursor < text.length) out.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>);
  return <>{out}</>;
}

// 安卓:inverted FlatList 里嵌套横向 ScrollView 会把代码块/表格撑成看不见文字的整屏高气泡(2026-09-12 社区截图),
// 原生端一律不嵌套滚动、直接换行;web/桌面保留横向滚动(那边没有 inverted 变换)。
const NATIVE = Platform.OS !== 'web';
function WideBlock({ style, children }: { style: any; children: ReactNode }) {
  return NATIVE ? <View style={style}>{children}</View> : <ScrollView horizontal style={style}>{children}</ScrollView>;
}

function CodeBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const fold = foldCode(text, expanded);
  const label = foldLabel(fold, expanded);
  return (
    <View style={styles.code}>
      {NATIVE
        ? <Text selectable style={styles.codeText}>{fold.shown}</Text>
        : <ScrollView horizontal><Text selectable style={styles.codeText}>{fold.shown}</Text></ScrollView>}
      {label ? (
        <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
          <Text style={styles.foldToggle}>{label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function MarkdownMessage({ children }: { children: string }) {
  return (
    <View style={styles.root}>
      {parseMarkdownBlocks(children).map((block, index) => {
        if (block.kind === 'heading') return <Text key={index} style={[styles.text, styles.heading, { fontSize: Math.max(15, 20 - block.level) }]}><Inline text={block.text} /></Text>;
        if (block.kind === 'list') return <View key={index} style={styles.block}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listRow}><Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text><Text style={[styles.text, styles.listText]}><Inline text={item} /></Text></View>)}</View>;
        if (block.kind === 'quote') return <View key={index} style={styles.quote}><Text style={styles.text}><Inline text={block.text} /></Text></View>;
        if (block.kind === 'code') return <CodeBlock key={index} text={block.text} />;
        if (block.kind === 'table') return <WideBlock key={index} style={styles.table}><View>{block.rows.map((row, rowIndex) => <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHead]}>{row.map((cell, cellIndex) => <Text key={cellIndex} style={[styles.text, styles.tableCell, rowIndex === 0 && styles.strong]}><Inline text={cell} /></Text>)}</View>)}</View></WideBlock>;
        return <Text key={index} style={[styles.text, styles.block]}><Inline text={block.text} /></Text>;
      })}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { gap: spacing.sm },
  text: { color: colors.text, fontSize: 14, lineHeight: 21 },
  block: { marginBottom: 2 },
  heading: { fontWeight: '700', marginTop: spacing.xs },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  inlineCode: { color: colors.accent, backgroundColor: colors.inputBg, fontFamily: 'monospace', fontSize: 13 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  marker: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, minWidth: 16, textAlign: 'right' },
  listText: { flexShrink: 1 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.textMuted, paddingLeft: spacing.md, opacity: 0.9 },
  code: { maxWidth: '100%', backgroundColor: colors.inputBg, borderRadius: 8, padding: spacing.md },
  codeText: { color: colors.text, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  foldToggle: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  table: { maxWidth: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  tableRow: { flexDirection: 'row' },
  tableHead: { backgroundColor: colors.inputBg },
  tableCell: { width: 150, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
