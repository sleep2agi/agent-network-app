// `flex: 0` 守卫(2026-09-30,Windows 桌面 0.2.161:任务列表「标题」列整列空白)。ck 风格,自执行。
//
// 为什么:原生 Yoga 的 flex:0 是「不伸不缩、按内容定尺寸」;react-native-web 却把它原样写成 CSS `flex: 0`,
// 而 CSS 的 `flex: 0` = `0 1 0%` —— 基准 0、不伸长。只要再有 overflow:hidden(numberOfLines 就会加)或
// minWidth:0,这个元素在 web / 桌面上就是 0 宽 / 0 高,内容还在 DOM 里(textContent 照样对),
// 所以只查文字的检查全绿、平板真机也正常。0.2.159–0.2.162 的列表标题文字就是这样没的(#564 引入)。
//
// 规则:代码里不写 `flex: 0`。要「按内容定尺寸、放不下再缩」用 `flex: -1`(两个引擎都是 `0 1 auto`:
// react-native-web 把 -1 展开成 flexGrow 0 / flexShrink 1 / flexBasis auto,Yoga 同义);
// 真要写 flex:0 只许在 web 专用分支里(同一行有 `Platform.OS === 'web'`)。
// 别用「叠 flexBasis: 'auto' 撤回」—— 那条在原生上不生效(flex-basis-auto-rule.test.ts)。
//
// 两层分开自检:判据(给它一行,看它报不报)与取集(造一棵目录树,看该收的收进来了没有)。
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import Yoga, { Align, FlexDirection, Justify } from 'yoga-layout';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

const here = import.meta.dir;
// JS 样式对象里的 flex: 0(后面是 , 或 })。CSS 字符串里的 `flex: 0 0 auto;` 不算(那是完整的三值写法)。
const FLEX_ZERO = /\bflex\s*:\s*0(?:\.0*)?\s*[,}]/;
const WEB_ONLY = /Platform\.OS\s*===\s*['"]web['"]/;
// 只看代码:注释里讲这条规则的说明文字不算。
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** 判据:返回违规行号(1 起)。 */
export function violations(src: string): number[] {
  const out: number[] = [];
  stripComments(src.replace(/\r\n?/g, '\n')).split('\n').forEach((line, i) => {
    if (FLEX_ZERO.test(line) && !WEB_ONLY.test(line)) out.push(i + 1);
  });
  return out;
}

/** 取集:目录下(递归)所有非测试的 .ts / .tsx。 */
export function collect(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root)) {
    const f = join(root, e);
    if (statSync(f).isDirectory()) { if (e !== 'node_modules') out.push(...collect(f)); }
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
}

console.log('判据自检');
// 0.2.159–0.2.162 的原样(TaskListTable.tsx 标题格)必须红。
ck('旧列表标题文字(内联 { flex: 0, flexShrink: 1 })→ 红',
  violations("<Text style={[s.tdTitle, { flex: 0, flexShrink: 1 }, item.column === 'done' && s.cardDone]} numberOfLines={1}>").length === 1);
ck('旧聊天输入框 StyleSheet 条目 → 红', violations("  inputInWrap: { flex: 0, alignSelf: 'stretch' },").length === 1);
ck('没有空格 / 放在最后也认', violations('x: {flex:0}').length === 1 && violations('{ width: 3, flex: 0 }').length === 1);
ck('flex: -1 / flex: 1 / flex: 0.5 / flexGrow: 0 不管', violations('a: { flex: -1 }, b: { flex: 1 }, c: { flex: 0.5 }, d: { flexGrow: 0 }').length === 0);
ck('CSS 字符串里的三值写法不管(RichDescriptionEditor 的 label)', violations('.rt-body li > label { flex: 0 0 auto; user-select: none; }').length === 0);
ck('web 专用分支放行', violations("style={[s.a, Platform.OS === 'web' && { flex: 0 }]}").length === 0);
ck('注释里的说明文字不算', violations('// 不写 flex: 0,\n/* { flex: 0 } */').length === 0);
ck('报的是正确的行号', JSON.stringify(violations("a\n// flex: 0,\nx: { flex: 0 },")) === '[3]');

console.log('取集自检');
{
  const tmp = mkdtempSync(join(tmpdir(), 'flex-zero-rule-'));
  try {
    mkdirSync(join(tmp, 'deep', 'er'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules'));
    for (const f of ['a.tsx', 'b.ts', 'deep/er/c.tsx', 'x.test.ts', 'node_modules/y.tsx', 'z.md']) writeFileSync(join(tmp, f), '');
    const got = collect(tmp).map(f => relative(tmp, f).replace(/\\/g, '/')).sort();  // Windows: \ → /
    ck(`递归收进子目录的 .ts / .tsx,跳过测试与 node_modules(收到 ${got.join(', ')})`, JSON.stringify(got) === JSON.stringify(['a.tsx', 'b.ts', 'deep/er/c.tsx']));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log('src/');
const files = collect(here);
ck(`取集收到了真实文件(${files.length} 个,含 TaskListTable.tsx 和 ChatScreen.tsx)`, files.length > 100 && files.some(f => /[\\/]TaskListTable\.tsx$/.test(f)) && files.some(f => /[\\/]ChatScreen\.tsx$/.test(f)));
const bad: string[] = [];
for (const f of files) for (const line of violations(readFileSync(f, 'utf8'))) bad.push(`${relative(here, f)}:${line}`);
ck(`没有在 web 上会生效的 flex: 0${bad.length ? ` —— ${bad.join(', ')}(web 上是 0 1 0%,内容宽 / 高归零;按内容定尺寸用 flex: -1)` : ''}`, bad.length === 0);

// 改过的站点在原生上布局不变:聊天输入框(input 的 flex:1 被 inputInWrap 撤掉)在 yoga 里排一遍,
// flex:0 → flex:-1 前后高度逐一相同(1 行 / 多行 / 超过 maxHeight)。标题格的同一检查在 task-title-web-width.test.ts。
console.log('改过的站点:原生(yoga)布局不变');
{
  const composer = (inputInWrap: Record<string, unknown>, contentH: number, rowH?: number) => {
    const row = Yoga.Node.create(); row.setFlexDirection(FlexDirection.Row); row.setAlignItems(Align.FlexEnd); row.setWidth(390);
    if (rowH !== undefined) { row.setHeight(rowH); row.setAlignItems(Align.Stretch); }
    const side = Yoga.Node.create(); side.setWidth(36); side.setHeight(36);
    const wrap = Yoga.Node.create(); wrap.setFlex(1); wrap.setJustifyContent(Justify.FlexEnd);
    const input = Yoga.Node.create();
    input.setFlex(1); input.setMinHeight(36); input.setMaxHeight(120); input.setAlignSelf(Align.Stretch);  // styles.input
    if (typeof inputInWrap.flex === 'number') input.setFlex(inputInWrap.flex);                           // styles.inputInWrap
    input.setMeasureFunc(() => ({ width: 300, height: contentH }));
    wrap.insertChild(input, 0); row.insertChild(side, 0); row.insertChild(wrap, 1);
    row.calculateLayout(undefined, undefined);
    const out = { h: input.getComputedHeight(), w: input.getComputedWidth() };
    row.freeRecursive();
    return out;
  };
  const now = (f: string) => Function(`return ${(readFileSync(join(here, f), 'utf8').match(/inputInWrap: (\{[^}]*\})/) ?? [])[1]}`)() as Record<string, unknown>;
  for (const f of ['ChatScreen.tsx', 'DmChatScreen.tsx']) {
    const style = now(f);
    const diffs = [20, 36, 60, 100, 200].filter(h => { const a = composer({ flex: 0 }, h), b = composer(style, h); return a.h !== b.h || a.w !== b.w; });
    ck(`${f} 输入框:flex ${String(style.flex)} 与原来的 flex:0 在原生上高 / 宽逐一相同${diffs.length ? `(不同:内容高 ${diffs.join(', ')})` : ''}`, diffs.length === 0 && style.flex !== 0);
  }
  // 唯一的差别(有意的):输入行被外面压到比内容矮时,flex:0 在原生上不缩(溢出),flex:-1 缩到给的高 —— 和 web 一致
  // (web 那一行本来就有 web 专用的 flexBasis:'auto',一直是 0 1 auto)。输入行的高由内容决定,正常不会被压。
  ck('模型会动(自检):行被压到 80 时 flex:0 → 120(溢出)、flex:-1 → 80', composer({ flex: 0 }, 200, 80).h === 120 && composer({ flex: -1 }, 200, 80).h === 80);
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
