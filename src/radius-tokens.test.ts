// 圆角门禁(2026-09-29 Vincent「四个角圆角一点」):全仓圆角只从 theme.ts 的 radius token 来。
//
// 为什么要门:2026-09-24 已经收过一次刻度(radius sm/md/lg),五天后源码里仍散着 251 处写死的数字、
// 24 种值 —— 刻度在,没人被拦。这道门拦的是「新写一个数字」。
//
// 判据:每个 borderRadius / borderTopLeftRadius / … 的值表达式,以及字符串里的 CSS `border-radius:`,
// 去掉 `radius.<token>`、`avatarRadius(…)` / `appIconRadius(…)`(括号里是尺寸,不是圆角)之后,
// 不许再有数字。`size / 2`、`ds(16)`、`10`、`'2px'` 都算。
// 取集:src/ 下递归全部 .ts/.tsx(不含 *.test.ts)+ App.tsx;token 文件 src/theme.ts 本身除外。
// 路径按 POSIX 写、CRLF 先转 LF,Windows 检出上也同一份结果。
//
// 例外只能进下面的 ALLOW:文件 + 那一行值的原文 + 一句理由。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

// fileURLToPath, not URL.pathname: on Windows .pathname is '/D:/…' (CI windows-latest ENOENT).
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const TOKEN_FILE = 'src/theme.ts';

/** 显式例外。key = `<posix 路径>|<值原文>`。 */
const ALLOW: Record<string, string> = {
  // 手画的键盘图标:3×3 的键帽点。圆角 1 是图形本身的形状,不是 UI 圆角档位。
  'src/VoiceInputUI.tsx|1': '键盘图标的键帽点(图形几何)',
  // 「按住说话」气泡下方旋转 45° 的小方块尾巴:2 只是把尖角磨钝,属于图形几何。
  'src/VoiceInputUI.tsx|2': '语音气泡尾巴(旋转方块的尖角)',
  // 分享图的 RN 版(ShareCardNative):是一张按 1080 宽画、再整体缩放的图片,圆角与 Canvas 版(task-share-card.ts)同值,
  // 属于图的几何,不是界面圆角档位。
  'src/ShareCardNative.tsx|u(28)': '分享图面板(与 Canvas 版同值,随 scale 缩放)',
  'src/ShareCardNative.tsx|u(22)': '分享图 logo 圆角方块',
  'src/ShareCardNative.tsx|u(6)': '分享图柱子顶端',
  'src/ShareCardNative.tsx|u(3)': '分享图热力格',
};

export interface Finding { file: string; line: number; value: string }

const RN_PROP = /\bborder(?:Top|Bottom)?(?:Left|Right)?Radius\s*:\s*/g;
const CSS_PROP = /border-radius\s*:\s*([^;'"`\n]+)/g;

/** 从 `borderRadius:` 之后取值表达式:到深度 0 的 `,` `}` 或换行为止。 */
function takeValue(src: string, from: number): string {
  let depth = 0;
  let i = from;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; }
    else if ((c === ',' || c === '\n') && depth === 0) break;
  }
  return src.slice(from, i).trim();
}

/** 值里去掉 token 与「按尺寸算」的函数之后还有没有数字。 */
export function isHardCoded(value: string): boolean {
  const rest = value
    .replace(/\$\{\s*radius\.\w+\s*\}/g, '')
    .replace(/\bradius\.\w+/g, '')
    .replace(/\b(?:avatarRadius|appIconRadius)\([^)]*\)/g, '');
  return /\d/.test(rest);
}

/** 一个文件里所有写死的圆角(注释行不算:`// borderRadius: 10` 是说明,不是样式)。 */
export function scanSource(file: string, raw: string): Finding[] {
  const src = raw.replace(/\r\n/g, '\n');
  const out: Finding[] = [];
  const lineOf = (i: number) => src.slice(0, i).split('\n').length;
  const inComment = (i: number) => {
    const start = src.lastIndexOf('\n', i - 1) + 1;
    const head = src.slice(start, i);
    // 行内注释:去掉字符串之后还有 `//`(`'http://…'` 里的不算)
    return /^\s*(\/\/|\*|\/\*)/.test(head) || head.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '').includes('//');
  };
  for (const m of src.matchAll(RN_PROP)) {
    const at = m.index! + m[0].length;
    if (inComment(m.index!)) continue;
    const value = takeValue(src, at);
    if (isHardCoded(value)) out.push({ file, line: lineOf(m.index!), value });
  }
  for (const m of src.matchAll(CSS_PROP)) {
    if (inComment(m.index!)) continue;
    const value = m[1].trim();
    if (isHardCoded(value)) out.push({ file, line: lineOf(m.index!), value });
  }
  return out;
}

export function collect(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) { if (e !== 'node_modules') walk(full); continue; }
      if (!/\.tsx?$/.test(e) || e.endsWith('.test.ts') || e.endsWith('.d.ts')) continue;
      out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(join(root, 'src'));
  out.push('App.tsx');
  return out.filter(f => f !== TOKEN_FILE).sort();
}

// ── 判据自检:给它已知阳性 / 阴性,确认它会红、也不会乱红 ──
const pos = [
  'a: { borderRadius: 10 },', "a: { borderRadius: '2px' },", 'a: { borderRadius: size / 2 },', 'a: { borderRadius: ds(16) },',
  'a: { borderTopLeftRadius: 14, borderTopRightRadius: radius.surface },', 'a: { width: 4,\n  borderRadius: 1.5,\n}',
  'const css = `.x { border-radius: 999px; }`;', 'a: { borderRadius: touch ? 8 : radius.item },',
  "a: { uri: 'http://x', borderRadius: 10 },",
];
for (const s of pos) ck(`selftest: flags ${JSON.stringify(s).slice(0, 60)}`, scanSource('x.tsx', s).length >= 1);
const neg = [
  'a: { borderRadius: radius.control },', 'a: { borderRadius: radius.pill, width: 8, height: 8 },', 'a: { borderRadius: avatarRadius(44) },',
  'a: { borderRadius: appIconRadius(96) },', 'a: { borderRadius: m.radius },', 'o.style.borderRadius = x; a: { borderRadius: `${radius.inline}px` },',
  '// borderRadius: 10 是旧值', 'a: { width: 4 }, // 旧的 borderRadius: 10', 'const css = `.x { border-radius: ${radius.pill}px; }`;', 'a: { borderRadius: radius.control, padding: 12 },',
];
for (const s of neg) ck(`selftest: passes ${JSON.stringify(s).slice(0, 60)}`, scanSource('x.tsx', s).length === 0);
ck('selftest: CRLF source gives the same line numbers as LF', JSON.stringify(scanSource('x', 'a\r\nb: { borderRadius: 3 }')) === JSON.stringify(scanSource('x', 'a\nb: { borderRadius: 3 }')));
ck('selftest: the finding carries the file and line', (() => { const f = scanSource('src/A.tsx', 'x\ny\nz: { borderRadius: 7 }')[0]; return f?.file === 'src/A.tsx' && f.line === 3 && f.value === '7'; })());

// ── 取集自检:该收的收进来了(递归、tsx 与 ts 都收、App.tsx 收、测试与 token 文件不收)──
const files = collect(ROOT);
ck(`collected ≥ 150 source files (${files.length})`, files.length >= 150);
ck('collects App.tsx', files.includes('App.tsx'));
ck('collects .ts as well as .tsx (app-styles.ts, agent-row-menu.ts)', files.includes('src/app-styles.ts') && files.includes('src/agent-row-menu.ts'));
ck('recurses into subdirectories (src/lib/*)', files.some(f => f.startsWith('src/lib/')));
ck('skips *.test.ts', !files.some(f => f.endsWith('.test.ts')));
ck('skips the token file itself', !files.includes(TOKEN_FILE));
ck('paths are POSIX', files.every(f => !f.includes('\\')));

// ── 真门 ──
const findings = files.flatMap(f => scanSource(f, readFileSync(join(ROOT, f), 'utf8')));
const used = new Set<string>();
const violations = findings.filter(x => {
  const key = `${x.file}|${x.value}`;
  if (ALLOW[key]) { used.add(key); return false; }
  return true;
});
for (const v of violations) console.log(`   ${v.file}:${v.line}  borderRadius: ${v.value}  → 用 theme.ts 的 radius.<token>(或进 ALLOW 并写理由)`);
ck(`no hard-coded radius outside ${TOKEN_FILE} (${violations.length} found)`, violations.length === 0);
const stale = Object.keys(ALLOW).filter(k => !used.has(k));
ck(`every ALLOW entry still matches something (stale: ${stale.join(', ') || 'none'})`, stale.length === 0);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
