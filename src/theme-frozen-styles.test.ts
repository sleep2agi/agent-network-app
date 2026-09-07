// app#193 —— 「模块级 StyleSheet.create 在导入时冻住主题色」这个机制的门。
//
// theme.ts 的 colors 初值是深色,setThemeMode 就地改写;模块级 `const styles = StyleSheet.create({ … colors.x … })`
// 只在导入时求值一次,之后切主题不会跟着变(App 的 keyed remount 也救不了模块级求值)。仓里的正确写法是
// `const makeStyles = () => StyleSheet.create(…); let styles = makeStyles(); onThemeChange(() => { styles = makeStyles(); });`
// 或组件内 useMemo。#192/#193 的两处实例已改;这里把机制关掉:任何引用主题值的模块级 StyleSheet.create
// 都必须在同文件里被 onThemeChange 回调重新赋值。判据是纯函数,先喂已知阳性看它红,再扫真仓。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

/** 返回该文件里「冻住主题的模块级样式符号」;空数组 = 干净。 */
export function frozenThemeStyles(source: string): string[] {
  const out: string[] = [];
  const usesTheme = (block: string) => /\bcolors\.[A-Za-z_]+|\bthemeMode\(\)/.test(block);
  const blockFrom = (start: number) => { const end = source.indexOf('\n});', start); return source.slice(start, end < 0 ? undefined : end); };
  // 形状 A:模块级 `const styles = StyleSheet.create({ … colors.x … })`,永远不会重建。
  const direct = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*StyleSheet\.create\(/gm;
  let m: RegExpExecArray | null;
  while ((m = direct.exec(source))) {
    if (usesTheme(blockFrom(m.index))) out.push(m[1]);
  }
  // 形状 B:模块级工厂 `const makeStyles = () => StyleSheet.create(…)` + 模块级 `let styles = makeStyles()`,
  // 但没有任何 onThemeChange 回调把 styles 重新赋值 —— 和 A 一样冻住。
  const factory = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\)\s*=>\s*(?:\n\s*)?StyleSheet\.create\(/gm;
  while ((m = factory.exec(source))) {
    const f = m[1];
    if (!usesTheme(blockFrom(m.index))) continue;
    const bind = new RegExp(`^(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${f}\\(\\)`, 'gm');
    let b: RegExpExecArray | null;
    while ((b = bind.exec(source))) {
      const name = b[1];
      const rebuilt = new RegExp(`onThemeChange\\(\\(\\)\\s*=>\\s*\\{?[\\s\\S]{0,300}?\\b${name}\\s*=\\s*${f}\\(\\)`).test(source);
      if (!rebuilt) out.push(name);
    }
  }
  return out;
}

// 已知阳性:必须红。
const bad = `import { colors } from './theme';\nconst styles = StyleSheet.create({\n  card: { backgroundColor: colors.card },\n});\n`;
check('positive control: module-level StyleSheet.create reading colors.* without onThemeChange is flagged', frozenThemeStyles(bad).join() === 'styles');
// 形状 B 的阳性:工厂有了、也绑到了模块级 styles,但没人重建 → 必须红。
const factoryNeverRebuilt = `import { colors } from './theme';\nconst makeStyles = () =>\n  StyleSheet.create({\n  card: { backgroundColor: colors.card },\n});\nlet styles = makeStyles();\n`;
check('positive control: factory bound at module level but never rebuilt is flagged', frozenThemeStyles(factoryNeverRebuilt).join() === 'styles');
// 仓里的多行写法:onThemeChange(() => {\n  styles = makeStyles();\n}) → 干净。
const multiline = `import { colors, onThemeChange } from './theme';\nconst makeStyles = () =>\n  StyleSheet.create({\n  card: { backgroundColor: colors.card },\n});\nlet styles = makeStyles();\nonThemeChange(() => {\n  styles = makeStyles();\n});\n`;
check('multi-line onThemeChange rebuild is clean', frozenThemeStyles(multiline).length === 0);
// 正确写法:工厂 + onThemeChange 重建 → 干净。
const good = `import { colors, onThemeChange } from './theme';\nconst makeStyles = () =>\n  StyleSheet.create({\n  card: { backgroundColor: colors.card },\n});\nlet styles = makeStyles();\nonThemeChange(() => { styles = makeStyles(); });\n`;
check('factory + onThemeChange rebuild is clean', frozenThemeStyles(good).length === 0);
// 不引用主题值的模块级样式(纯布局)不算。
const layoutOnly = `const styles = StyleSheet.create({\n  row: { flexDirection: 'row', gap: 8 },\n});\n`;
check('layout-only module styles are not flagged', frozenThemeStyles(layoutOnly).length === 0);
// 组件内(有缩进)的 StyleSheet.create 不是模块级,不归这道门管。
const inComponent = `function X() {\n  const styles = useMemo(() => StyleSheet.create({ a: { color: colors.text } }), []);\n}\n`;
check('component-scoped create is out of scope', frozenThemeStyles(inComponent).length === 0);

// 真仓普查:src/**/*.tsx + App.tsx(不含测试)。
const root = new URL('..', import.meta.url).pathname;
const files: string[] = ['App.tsx'];
for (const e of readdirSync(join(root, 'src'))) if (e.endsWith('.tsx') && !e.endsWith('.test.tsx')) files.push(join('src', e));
const hits: string[] = [];
for (const f of files) {
  for (const sym of frozenThemeStyles(readFileSync(join(root, f), 'utf8'))) hits.push(`${f}:${sym}`);
}
check(`repo scan: no module-level theme-frozen styles (scanned ${files.length} files)${hits.length ? ' — ' + hits.join(', ') : ''}`, hits.length === 0 && files.length > 10);

console.log(`theme frozen styles gate: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
