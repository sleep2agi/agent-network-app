import fs from 'node:fs';
import path from 'node:path';

// 换主题时 `setThemeMode` 是**原地改** `colors` 这个对象;而写在模块顶层的
// `const styles = StyleSheet.create({ ... colors.bg ... })` 在 import 那一刻
// 就把当时的颜色算成了字面量 —— 之后再换主题它不会变。
//
// 🔴 这不是理论:白色主题下 `ServerSidebar` 整条侧栏仍是黑的
// (Vincent 2026-08-31「颜色都不对啊」),`DesktopUpdatePrompt` 同病。
// 而它们在深色主题下**完全正常** —— 默认就是 DARK,冻住的恰好是对的那个值,
// 所以这个缺陷只在切到白色时才现身。
//
// 判据只管**模块级**的 create:组件内 `useMemo(() => StyleSheet.create(...))`
// 随 App 的 keyed remount 重建,不算。
// (先按「文件里有没有 onThemeChange」写过一版,把 DesktopWindowPin 误报成缺陷 ——
//  那问的是"存不存在",不是"会不会被冻住"。)

const SRC = path.join(import.meta.dir);
const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

/** 纯判据:这段源码会不会把样式冻在 import 时刻的调色板上。 */
const freezesPalette = (source: string): boolean => {
  if (!/\bcolors\./.test(source)) return false;                                       // 不用主题色
  if (!/^(?:const|let)\s+\w+\s*=\s*StyleSheet\.create\(/m.test(source)) return false; // 非模块级
  return !source.includes('onThemeChange(');                                          // 没重建 ⇒ 冻住
};

// ── 判据层:合成输入两向自检,不依赖任何真实文件的写法 ──
check(
  freezesPalette("import { colors } from './theme';\nconst styles = StyleSheet.create({ a: { color: colors.text } });\n"),
  'the criterion flags a module-level StyleSheet that never rebuilds',
);
check(
  !freezesPalette(
    "import { colors, onThemeChange } from './theme';\n" +
      'const makeStyles = () => StyleSheet.create({ a: { color: colors.text } });\n' +
      'let styles = makeStyles();\nonThemeChange(() => { styles = makeStyles(); });\n',
  ),
  'the criterion clears a module that rebuilds on theme change',
);
check(
  !freezesPalette(
    "import { colors } from './theme';\n" +
      'function C() {\n  const styles = useMemo(() => StyleSheet.create({ a: { color: colors.text } }), []);\n}\n',
  ),
  'the criterion ignores component-level useMemo styles (they rebuild on remount)',
);

// ── 取集层:分母不能是空的,否则最后那条会空过 ──
const scanned = fs
  .readdirSync(SRC)
  .filter(f => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'))
  .sort();

check(scanned.length >= 30, `collection saw ${scanned.length} source files, expected >= 30`);
check(scanned.includes('ServerSidebar.tsx'), 'collection includes ServerSidebar.tsx');
check(scanned.includes('ServerScreen.tsx'), 'collection includes ServerScreen.tsx');

// ── 本体 ──
const frozen = scanned.filter(f => freezesPalette(fs.readFileSync(path.join(SRC, f), 'utf8')));
check(frozen.length === 0, `these modules freeze the palette at import time: ${frozen.join(', ')}`);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log(`theme restyle coverage: 7 checks passed (${scanned.length} source files scanned)`);
