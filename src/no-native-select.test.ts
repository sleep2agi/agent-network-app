// 原生下拉框门禁(Owner 09-30 看着 设置 → 语音输入 → 麦克风「这个地方也太丑了」):
// DOM <select> 在 macOS WKWebView 里是系统灰色渐变按钮 + 系统弹出菜单,和 app 的其它控件完全不是一套;
// 手机上 RN 根本没有它。下拉选择一律用 AppSelect.tsx(桌面 = 行 + 自绘浮层,手机 = 行 + 底部面板)。
//
// 判据:源码里出现 `<select`(JSX / 字符串里的 HTML)或 `createElement('select'` / `createElement("select"`。
// 注释行不算(说明里提到 <select 不是用了它)。
// 取集:src/ 下递归全部 .ts/.tsx(不含 *.test.ts)+ App.tsx。路径按 POSIX 写。
// 例外只能进 ALLOW:文件 + 一句理由。现在是空的。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

// fileURLToPath, not URL.pathname: on Windows .pathname is '/D:/…' (CI windows-latest ENOENT).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');

/** 显式例外。key = posix 路径。 */
const ALLOW: Record<string, string> = {};

const NATIVE_SELECT = /<select\b|createElement\(\s*['"]select['"]/;

export function scanSource(raw: string): number[] {
  const out: number[] = [];
  raw.replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    if (NATIVE_SELECT.test(line)) out.push(i + 1);
  });
  return out;
}

export function collect(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(join(root, 'src'));
  files.push('App.tsx');
  return files.sort();
}

// ── 判据自检:给它一行,看它报不报 ──────────────────────────────────────────────────
ck('判据: JSX <select 报', scanSource('  <select value={x}>').length === 1);
ck('判据: 自闭合 <select/> 报', scanSource('return <select/>;').length === 1);
ck('判据: createElement(\'select\' 报', scanSource("const el = document.createElement('select');").length === 1);
ck('判据: createElement("select" 报', scanSource('React.createElement( "select", {})').length === 1);
ck('判据: 注释里提到 <select 不报', scanSource('// 原来是 DOM <select>').length === 0 && scanSource(' * 用 <select> 画').length === 0);
ck('判据: <selected / selectOption 不报', scanSource('<selectedItem /> onSelect selectOption').length === 0);
ck('判据: CRLF 行号不偏', scanSource('a\r\nb\r\n<select>').join() === '3');

// ── 取集自检:递归子目录、包含 App.tsx、排除测试文件 ─────────────────────────────────
const files = collect(ROOT);
ck('取集: 收进 src 顶层文件', files.includes('src/MicDeviceSetting.tsx'));
ck('取集: 收进 App.tsx', files.includes('App.tsx'));
ck('取集: 递归进子目录', files.some(f => /^src\/.+\/.+\.tsx?$/.test(f)));
ck('取集: 不含 *.test.ts', !files.some(f => /\.test\.tsx?$/.test(f)));
ck('取集: 数量像样(>100)', files.length > 100);

// ── 真门 ──────────────────────────────────────────────────────────────────────────
const findings: string[] = [];
for (const f of files) {
  if (ALLOW[f]) continue;
  for (const line of scanSource(readFileSync(join(ROOT, f), 'utf8'))) findings.push(`${f}:${line}`);
}
for (const f of findings) console.log(`  原生 <select>: ${f} —— 改用 AppSelect.tsx`);
ck(`src 里没有原生 <select>(扫了 ${files.length} 个文件)`, findings.length === 0);
for (const f of Object.keys(ALLOW)) ck(`ALLOW 里的 ${f} 还存在`, files.includes(f));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
