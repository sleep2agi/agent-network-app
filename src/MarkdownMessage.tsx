import { Fragment, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openUrl } from '@tauri-apps/plugin-opener';
import { colors, onThemeChange, spacing } from './theme';
import { isSafeMarkdownUrl, parseMarkdownBlocks } from './markdown-model';
import { foldCode, foldLabel } from './markdown-code-fold';
import { stackedRows, tableLayoutFor } from './table-layout';

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

// 表格三种布局(table-layout.ts):web 横向滚动网格;原生 ≤2 列自适应网格;原生 ≥3 列每行一张卡。
function TableBlock({ rows }: { rows: string[][] }) {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const layout = tableLayoutFor(columns, NATIVE);
  if (layout === 'stacked') {
    return (
      <View style={styles.tableStack}>
        {stackedRows(rows).map((cells, rowIndex) => (
          <View key={rowIndex} style={styles.tableCard}>
            {cells.map((cell, cellIndex) => (
              <View key={cellIndex} style={styles.tableCardLine}>
                <Text style={[styles.text, styles.tableCardLabel]} numberOfLines={2}>{cell.label}</Text>
                <Text style={[styles.text, styles.tableCardValue]}><Inline text={cell.value} /></Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }
  const cellStyle = layout === 'grid-flex' ? styles.tableCellFlex : styles.tableCell;
  return (
    <WideBlock style={styles.table}>
      <View>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHead]}>
            {row.map((cell, cellIndex) => (
              <Text key={cellIndex} style={[styles.text, cellStyle, rowIndex === 0 && styles.strong]}><Inline text={cell} /></Text>
            ))}
          </View>
        ))}
      </View>
    </WideBlock>
  );
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

// onHeadingLayout:第 n 个标题(全文序号,0 起)相对本组件顶部的 y —— 规则文件全屏目录靠它滚到标题。
// 不传就和以前一样,聊天里不多挂 onLayout。
export default function MarkdownMessage({ children, onHeadingLayout }: { children: string; onHeadingLayout?: (index: number, y: number) => void }) {
  let headingIndex = 0;
  return (
    <View style={styles.root}>
      {parseMarkdownBlocks(children).map((block, index) => {
        if (block.kind === 'heading') {
          const nth = headingIndex++;
          return <Text key={index} onLayout={onHeadingLayout ? (event) => onHeadingLayout(nth, event.nativeEvent.layout.y) : undefined} style={[styles.text, styles.heading, { fontSize: Math.max(15, 20 - block.level) }]}><Inline text={block.text} /></Text>;
        }
        if (block.kind === 'list') return <View key={index} style={styles.block}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listRow}><Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text><Text style={[styles.text, styles.listText]}><Inline text={item} /></Text></View>)}</View>;
        if (block.kind === 'quote') return <View key={index} style={styles.quote}><Text style={styles.text}><Inline text={block.text} /></Text></View>;
        if (block.kind === 'code') return <CodeBlock key={index} text={block.text} />;
        if (block.kind === 'table') return <TableBlock key={index} rows={block.rows} />;
        return <Text key={index} style={[styles.text, styles.block]}><Inline text={block.text} /></Text>;
      })}
    </View>
  );
}

// 长串(hash、URL、路径、行内代码)没有可断点时会把整行撑出气泡(2026-09-24 Vincent 截图)。
// web/桌面:允许在任意位置断行;原生端 Text 本来就按字符换行,不需要。
export const WRAP_ANYWHERE = Platform.OS === 'web' ? ({ overflowWrap: 'anywhere', wordBreak: 'break-word' } as any) : {};

const makeStyles = () => StyleSheet.create({
  // minWidth 0:气泡里的列与行是 flex 子项,默认 min-width:auto 会按内容宽度撑开父级
  root: { gap: spacing.sm, minWidth: 0, maxWidth: '100%' },
  text: { color: colors.text, fontSize: 14, lineHeight: 21, ...WRAP_ANYWHERE },
  block: { marginBottom: 2 },
  heading: { fontWeight: '600', marginTop: spacing.xs },
  strong: { fontWeight: '600' },
  em: { fontStyle: 'italic' },
  inlineCode: { color: colors.accent, backgroundColor: colors.inputBg, fontFamily: 'monospace', fontSize: 13, ...WRAP_ANYWHERE },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, minWidth: 0 },
  marker: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, minWidth: 16, textAlign: 'right' },
  listText: { flexShrink: 1, flexGrow: 1, flexBasis: 0, minWidth: 0 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.textMuted, paddingLeft: spacing.md, opacity: 0.9, minWidth: 0 },
  code: { maxWidth: '100%', backgroundColor: colors.inputBg, borderRadius: 8, padding: spacing.md },
  codeText: { color: colors.text, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  foldToggle: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  table: { maxWidth: '100%', borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  tableRow: { flexDirection: 'row' },
  tableHead: { backgroundColor: colors.inputBg },
  tableCell: { width: 150, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  // 原生 ≤2 列:列宽随气泡走,不再定宽 150 撑出屏幕
  tableCellFlex: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  // 原生 ≥3 列:每行一张卡,「表头: 值」逐行
  tableStack: { gap: spacing.sm },
  tableCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.inputBg + '55', gap: 2 },
  tableCardLine: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  tableCardLabel: { color: colors.textMuted, fontSize: 12, lineHeight: 20, minWidth: 64, maxWidth: '40%', flexShrink: 0 },
  tableCardValue: { flex: 1, minWidth: 0 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
