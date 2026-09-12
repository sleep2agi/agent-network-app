// 安卓整屏高空气泡(2026-09-12 社区截图)—— 代码块折叠 + 原生端不嵌套横向 ScrollView 的契约。
import fs from 'node:fs';
import path from 'node:path';
import { FOLD_LINES, foldCode, foldLabel } from './markdown-code-fold';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const big = Array.from({ length: 123 }, (_, i) => `line ${i + 1}`).join('\n');
const short = foldCode('a\nb', false);
ck('短代码块原样返回、无折叠标签', short.shown === 'a\nb' && short.hiddenLines === 0 && short.totalLines === 2 && foldLabel(short, false) === null);
const folded = foldCode(big, false);
ck(`长代码块折到 ${FOLD_LINES} 行并给出隐藏行数`, folded.shown.split('\n').length === FOLD_LINES && folded.hiddenLines === 123 - FOLD_LINES);
ck('折叠标签写清还有多少行', foldLabel(folded, false) === `展开还有 ${123 - FOLD_LINES} 行`);
const expanded = foldCode(big, true);
ck('展开后全文 + 收起标签带总行数', expanded.shown === big && foldLabel(expanded, true) === '收起(共 123 行)');
ck(`恰好 ${FOLD_LINES} 行不折叠`, foldCode(Array.from({ length: FOLD_LINES }, () => 'x').join('\n'), false).hiddenLines === 0);
ck('空文本安全', foldCode('', false).shown === '' && foldCode('', false).totalLines === 1);

const src = fs.readFileSync(path.join(process.cwd(), 'src/MarkdownMessage.tsx'), 'utf8');
ck('原生端判定常量存在', src.includes("const NATIVE = Platform.OS !== 'web';"));
ck('代码块走 CodeBlock', src.includes('<CodeBlock key={index} text={block.text} />'));
ck('表格走 WideBlock', src.includes('<WideBlock key={index} style={styles.table}>'));
ck('原生端 WideBlock 是普通 View、web 才横向滚动', /NATIVE \? <View style=\{style\}>\{children\}<\/View> : <ScrollView horizontal/.test(src));
ck('代码块不再直接渲染成横向 ScrollView', !/block\.kind === 'code'\) return <ScrollView/.test(src));
ck('代码块有展开/收起按钮', src.includes('setExpanded((v) => !v)'));
console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
