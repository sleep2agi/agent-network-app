import { Fragment } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, onThemeChange, spacing } from './theme';
import { isSafeMarkdownUrl, parseMarkdownBlocks } from './markdown-model';

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_([^_\n]+)_|\[[^\]\n]+\]\([^\s)]+\))/g;

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
      out.push(<Text key={key++} style={safe ? styles.link : undefined} onPress={safe ? () => Linking.openURL(link[2]) : undefined}>{link[1]}</Text>);
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

export default function MarkdownMessage({ children }: { children: string }) {
  return (
    <View style={styles.root}>
      {parseMarkdownBlocks(children).map((block, index) => {
        if (block.kind === 'heading') return <Text key={index} style={[styles.text, styles.heading, { fontSize: Math.max(15, 20 - block.level) }]}><Inline text={block.text} /></Text>;
        if (block.kind === 'list') return <View key={index} style={styles.block}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listRow}><Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text><Text style={[styles.text, styles.listText]}><Inline text={item} /></Text></View>)}</View>;
        if (block.kind === 'quote') return <View key={index} style={styles.quote}><Text style={styles.text}><Inline text={block.text} /></Text></View>;
        if (block.kind === 'code') return <ScrollView key={index} horizontal style={styles.code}><Text selectable style={styles.codeText}>{block.text}</Text></ScrollView>;
        if (block.kind === 'table') return <ScrollView key={index} horizontal style={styles.table}><View>{block.rows.map((row, rowIndex) => <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHead]}>{row.map((cell, cellIndex) => <Text key={cellIndex} style={[styles.text, styles.tableCell, rowIndex === 0 && styles.strong]}><Inline text={cell} /></Text>)}</View>)}</View></ScrollView>;
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
  table: { maxWidth: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  tableRow: { flexDirection: 'row' },
  tableHead: { backgroundColor: colors.inputBg },
  tableCell: { width: 150, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
