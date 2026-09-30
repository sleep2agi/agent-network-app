// 任务列表「标题」列整列空白(owner 09-30,Windows 桌面 0.2.161;0.2.159–0.2.162 都有):标题文字的 style 带 `flex: 0`,
// react-native-web 把它原样写成 CSS `flex: 0` = `0 1 0%` —— 基准宽 0、不伸长,再加 numberOfLines 的 overflow:hidden,
// 字宽 0。textContent 还在,所以只查文字的检查一直绿。这里把标题文字真正的 style 过一遍 react-native-web 的样式编译,
// 断言它在 web 上不是 0 基准宽。ck 风格自执行,不是 bun:test。
import { readFileSync, readdirSync } from 'node:fs';
import createReactDOMStyle from 'react-native-web/dist/cjs/exports/StyleSheet/compiler/createReactDOMStyle';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

// CSS flex shorthand → basis: `flex: <number>` means `<n> 1 0%`.
const web = (style: Record<string, unknown>) => createReactDOMStyle(style) as Record<string, unknown>;
const zeroBasis = (css: Record<string, unknown>) => {
  const grow = css.flexGrow ?? (typeof css.flex === 'number' ? css.flex : 0);
  const basis = css.flexBasis ?? (typeof css.flex === 'number' ? '0%' : 'auto');
  return Number(grow) === 0 && (basis === '0%' || basis === 0 || basis === '0px');
};

console.log('\nreact-native-web 怎么写 flex(判据自检)');
ck('flex:0 → 0 基准宽(这就是那个坑)', zeroBasis(web({ flex: 0, flexShrink: 1 })));
ck('flex:-1 → 0 1 auto(按内容宽)', !zeroBasis(web({ flex: -1 })));
ck('flex:1 会伸长,不算 0 宽', !zeroBasis(web({ flex: 1 })));

console.log('\n列表标题格的标题文字');
const table = src('./TaskListTable.tsx');
const titleCase = table.split('\n').find(l => l.includes("case 'title':")) ?? '';
const m = titleCase.match(/<Text style=\{\[s\.tdTitle, (\{[^}]*\})/);
ck('找到标题文字的 style 覆盖', !!m, titleCase.slice(0, 80));
const tdTitle = (src('./TaskBoardParts.tsx').match(/tdTitle: (\{[^}]*\})/) ?? [])[1] ?? '';
const merged = { ...(Function(`const colors={},typeScale={};return ${tdTitle}`)() as object), ...(m ? Function(`return ${m[1]}`)() as object : {}) };
const css = web(merged);
ck('web 上不是 0 基准宽(否则整列标题空白)', !zeroBasis(css), JSON.stringify({ flex: css.flex, flexGrow: css.flexGrow, flexBasis: css.flexBasis }));
ck('能缩(长标题省略号,不撑破列宽)', Number(css.flexShrink ?? 1) >= 1 && parseFloat(String(css.minWidth)) === 0, JSON.stringify({ flexShrink: css.flexShrink, minWidth: css.minWidth }));

console.log('\n整个 src 里没有 Text 带 inline flex:0');
const offenders: string[] = [];
for (const f of readdirSync(new URL('.', import.meta.url))) {
  if (!f.endsWith('.tsx')) continue;
  src(`./${f}`).split('\n').forEach((l, i) => { if (/<Text\b[^>]*style=\{\[?[^>]*\{[^}]*\bflex: 0\b/.test(l)) offenders.push(`${f}:${i + 1}`); });
}
ck('没有(要按内容宽用 flex:-1)', offenders.length === 0, offenders.join(' '));

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
