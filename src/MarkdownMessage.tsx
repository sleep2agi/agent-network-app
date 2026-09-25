import { Fragment, useState, type ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openUrl } from '@tauri-apps/plugin-opener';
import { colors, onThemeChange, spacing } from './theme';
import { isSafeMarkdownUrl, parseInline, parseMarkdownBlocks, type InlineNode } from './markdown-model';
import { foldCode, foldLabel } from './markdown-code-fold';
import { stackedRows, tableLayoutFor } from './table-layout';

export async function openMarkdownUrl(url: string) {
  if (!isSafeMarkdownUrl(url)) return;
  if ((globalThis as any).__TAURI_INTERNALS__) {
    await openUrl(url);
    return;
  }
  await Linking.openURL(url);
}

// 行内解析在 markdown-model.ts 的 parseInline(纯函数、有测试):裸链接 / 行内代码 / [文字](链接) 是原子段,
// 里面的 `_`、`*` 一个都不当记号;`_` 遵守 CommonMark 词内规则(snake_case 原样)。
function LinkText({ url, label }: { url: string; label: string }) {
  const safe = isSafeMarkdownUrl(url);
  return <Text accessibilityRole={safe ? 'link' : undefined} style={safe ? styles.link : undefined} onPress={safe ? (event) => { event.stopPropagation(); void openMarkdownUrl(url); } : undefined}>{label}</Text>;
}

function InlineNodes({ nodes }: { nodes: InlineNode[] }) {
  return <>{nodes.map((node, key) => {
    if (node.kind === 'text') return <Fragment key={key}>{node.text}</Fragment>;
    if (node.kind === 'code') return <Text key={key} style={styles.inlineCode}>{node.text}</Text>;
    if (node.kind === 'link' || node.kind === 'autolink') return <LinkText key={key} url={node.url} label={node.text} />;
    if (node.kind === 'strong') return <Text key={key} style={styles.strong}><InlineNodes nodes={node.children} /></Text>;
    return <Text key={key} style={styles.em}><InlineNodes nodes={node.children} /></Text>;
  })}</>;
}

function Inline({ text }: { text: string }) {
  return <InlineNodes nodes={parseInline(text)} />;
}

// 安卓:inverted FlatList 里嵌套横向 ScrollView 会把代码块/表格撑成看不见文字的整屏高气泡(2026-09-12 社区截图),
// 原生端一律不嵌套滚动、直接换行;web/桌面保留横向滚动(那边没有 inverted 变换)。
const NATIVE = Platform.OS !== 'web';
function WideBlock({ style, children }: { style: any; children: ReactNode }) {
  return NATIVE ? <View style={style}>{children}</View> : <ScrollView horizontal style={style}>{children}</ScrollView>;
}

// 源码行号挂到渲染元素上(web:dataSet → data-md-line / data-md-end)。只有规则文件阅读模式传
// sourceLines 才挂;聊天里 on=false,一个属性都不多。
type Src = (start?: number, end?: number) => object;
const NO_SRC: Src = () => ({});
const WITH_SRC: Src = (start, end) => (start == null ? {} : ({ dataSet: { mdLine: String(start), mdEnd: String(end ?? start) } } as object));

// 表格三种布局(table-layout.ts):web 横向滚动网格;原生 ≤2 列自适应网格;原生 ≥3 列每行一张卡。
// rootProps:挂在表格最外层元素上(规则文件原生阅读区用它报块布局)。
function TableBlock({ rows, rowLines, src = NO_SRC, rootProps }: { rows: string[][]; rowLines?: number[]; src?: Src; rootProps?: object }) {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const layout = tableLayoutFor(columns, NATIVE);
  if (layout === 'stacked') {
    return (
      <View style={styles.tableStack} {...rootProps}>
        {stackedRows(rows).map((cells, rowIndex) => (
          <View key={rowIndex} style={styles.tableCard} {...src(rowLines?.[rowIndex + 1])}>
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
  const grid = (
    <WideBlock style={styles.table}>
      <View>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHead]} {...src(rowLines?.[rowIndex])}>
            {row.map((cell, cellIndex) => (
              <Text key={cellIndex} style={[styles.text, cellStyle, rowIndex === 0 && styles.strong]}><Inline text={cell} /></Text>
            ))}
          </View>
        ))}
      </View>
    </WideBlock>
  );
  return rootProps && Object.keys(rootProps).length ? <View {...rootProps}>{grid}</View> : grid;
}

function CodeBlock({ text, srcProps }: { text: string; srcProps?: object }) {
  const [expanded, setExpanded] = useState(false);
  const fold = foldCode(text, expanded);
  const label = foldLabel(fold, expanded);
  return (
    <View style={styles.code} {...srcProps}>
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
// sourceLines:每个块(列表逐项、表格逐行)挂上它在原文里的行号,规则文件阅读模式双击跳源码用。
// onBlockLayout:原生端的同一件事(没有 DOM、读不到 data-md-line):顶层块和列表项各报一次 onLayout,
// 带行号;列表项的 y 相对所在列表(parent)。node-rules-view.ts resolveBlockRects / blockAtY 用它按手指位置找块。
// 都不传就和以前一样,聊天里不多挂 onLayout、不多挂属性。
export type MarkdownBlockLayout = { id: string; parent?: string; start: number; end: number; y: number; height: number };
export default function MarkdownMessage({ children, onHeadingLayout, sourceLines, onBlockLayout }: {
  children: string; onHeadingLayout?: (index: number, y: number) => void; sourceLines?: boolean; onBlockLayout?: (layout: MarkdownBlockLayout) => void;
}) {
  let headingIndex = 0;
  const src = sourceLines ? WITH_SRC : NO_SRC;
  // 报块布局的 onLayout;没有 onBlockLayout 或块没有行号时返回空对象(一个属性都不多挂)。
  const lay = (id: string, start?: number, end?: number, parent?: string) => (onBlockLayout && start != null
    ? { onLayout: (event: any) => { const { y, height } = event.nativeEvent.layout; onBlockLayout({ id, parent, start, end: end ?? start, y, height }); } }
    : {});
  return (
    <View style={styles.root}>
      {parseMarkdownBlocks(children).map((block, index) => {
        const id = `b${index}`;
        if (block.kind === 'heading') {
          const nth = headingIndex++;
          const report = lay(id, block.line, block.endLine) as { onLayout?: (event: any) => void };
          const onLayout = onHeadingLayout || report.onLayout ? (event: any) => { if (onHeadingLayout) onHeadingLayout(nth, event.nativeEvent.layout.y); report.onLayout?.(event); } : undefined;
          return <Text key={index} {...src(block.line, block.endLine)} onLayout={onLayout} style={[styles.text, styles.heading, { fontSize: Math.max(15, 20 - block.level) }]}><Inline text={block.text} /></Text>;
        }
        if (block.kind === 'list') return <View key={index} style={styles.block} {...lay(id, block.line, block.endLine)}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listRow} {...src(block.itemLines?.[itemIndex])} {...lay(`${id}.${itemIndex}`, block.itemLines?.[itemIndex], block.itemLines?.[itemIndex], id)}><Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : '•'}</Text><Text style={[styles.text, styles.listText]}><Inline text={item} /></Text></View>)}</View>;
        if (block.kind === 'quote') return <View key={index} style={styles.quote} {...src(block.line, block.endLine)} {...lay(id, block.line, block.endLine)}><Text style={styles.text}><Inline text={block.text} /></Text></View>;
        if (block.kind === 'code') return <CodeBlock key={index} text={block.text} srcProps={{ ...src(block.line, block.endLine), ...lay(id, block.line, block.endLine) }} />;
        if (block.kind === 'table') return <TableBlock key={index} rows={block.rows} rowLines={block.rowLines} src={src} rootProps={lay(id, block.line, block.endLine)} />;
        return <Text key={index} {...src(block.line, block.endLine)} {...lay(id, block.line, block.endLine)} style={[styles.text, styles.block]}><Inline text={block.text} /></Text>;
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
