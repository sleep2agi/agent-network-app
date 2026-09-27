// src/open-external.ts:三条路的分支 + 全仓静态守卫(外链只能经 openExternal 出去)。
// ck 风格:自执行,失败 exit 1。run: bun src/open-external.test.ts
//
// 守卫两层分开自检(CLAUDE.md ⑤):判据(给它一行坏代码,它报不报)与取集(子目录里的文件收没收进来)。
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { __setOpenExternalDeps, externalRoute, isExternalHttpUrl, openExternal, type OpenExternalDeps } from './open-external';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };

// ── 平台分支 ───────────────────────────────────────────────────────────────────
ck('Tauri 壳 → opener', externalRoute('web', true) === 'tauri');
ck('浏览器 → window.open', externalRoute('web', false) === 'window');
ck('安卓 → Linking', externalRoute('android', false) === 'linking');
ck('iOS → Linking', externalRoute('ios', false) === 'linking');
ck('native 兜底 → Linking', externalRoute('native', false) === 'linking');

ck('http(s) 放行', isExternalHttpUrl('https://console.volcengine.com/speech/app') && isExternalHttpUrl('http://example.com') && isExternalHttpUrl('  HTTPS://EXAMPLE.COM/a  '));
ck('其它 scheme 拒绝', !isExternalHttpUrl('javascript:alert(1)') && !isExternalHttpUrl('file:///etc/passwd') && !isExternalHttpUrl('tauri://localhost') && !isExternalHttpUrl('') && !isExternalHttpUrl('https://'));

type Call = [string, ...unknown[]];
const harness = (os: string, tauri: boolean, withWindow = true) => {
  const calls: Call[] = [];
  const deps: OpenExternalDeps = {
    os, tauri,
    tauriOpen: async (url) => { calls.push(['tauri', url]); },
    windowOpen: withWindow ? (url, target, features) => { calls.push(['window', url, target, features]); return {}; } : null,
    linkingOpen: async (url) => { calls.push(['linking', url]); },
  };
  __setOpenExternalDeps(deps);
  return calls;
};

{
  const calls = harness('web', true);
  const ok = await openExternal('https://console.volcengine.com/speech/app');
  ck('桌面:只走 opener,一次', ok && calls.length === 1 && calls[0][0] === 'tauri' && calls[0][1] === 'https://console.volcengine.com/speech/app', JSON.stringify(calls));
}
{
  const calls = harness('web', false);
  const ok = await openExternal(' https://example.com/x ');
  ck('网页:window.open(url, _blank, noopener),去掉首尾空白', ok && JSON.stringify(calls) === JSON.stringify([['window', 'https://example.com/x', '_blank', 'noopener']]), JSON.stringify(calls));
}
{
  // 网页那条路必须同步开窗(用户手势):openExternal 返回的 promise 还没 await,window.open 就已经调了。
  const calls = harness('web', false);
  const pending = openExternal('https://example.com/sync');
  ck('网页:window.open 在第一个 await 之前同步发生', calls.length === 1);
  await pending;
}
{
  const calls = harness('web', false, false);
  const ok = await openExternal('https://example.com');
  ck('网页没有 window.open:返回 false,不乱走别的路', ok === false && calls.length === 0);
}
{
  const calls = harness('android', false);
  const ok = await openExternal('https://example.com/apk');
  ck('手机:Linking.openURL', ok && calls.length === 1 && calls[0][0] === 'linking');
}
{
  const calls = harness('web', true);
  const ok = await openExternal('javascript:alert(1)');
  ck('非 http(s):哪条路都不走', ok === false && calls.length === 0);
}
{
  harness('web', true);
  __setOpenExternalDeps({ os: 'web', tauri: true, tauriOpen: async () => { throw new Error('denied'); }, windowOpen: null, linkingOpen: async () => {} });
  let threw = false;
  try { await openExternal('https://example.com'); } catch { threw = true; }
  ck('opener 失败照常抛给调用方(不假装打开了)', threw);
}
__setOpenExternalDeps(undefined);

// ── 静态守卫:外链只从 open-external.ts 出去 ─────────────────────────────────────
const posix = (s: string) => s.split(sep).join('/');
const normalizeEol = (src: string) => src.replace(/\r\n?/g, '\n');
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HELPER = 'src/open-external.ts';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|mts|mjs|js)$/.test(e) && !/\.test\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(full);
  }
  return out;
}

/** 收集:src/ 整棵树(递归)+ 根目录的 App.tsx / index.ts。 */
function collect(root: string): string[] {
  const files = walk(join(root, 'src'));
  for (const f of ['App.tsx', 'index.ts']) { try { if (statSync(join(root, f)).isFile()) files.push(join(root, f)); } catch { /* absent */ } }
  return files.map(f => posix(relative(root, f))).sort();
}

// 判据:直接开外链的三种写法。注释行不算(说明文字里会提到它们)。
const DIRECT = [
  { name: 'Linking.openURL', re: /\bLinking\s*\.\s*openURL\s*\(/ },
  { name: 'window.open', re: /\b(?:window|globalThis)\s*\.\s*open\s*\(/ },
  { name: 'plugin-opener openUrl', re: /(?:\bopenUrl\s*\(|['"]@tauri-apps\/plugin-opener['"][^;\n]*\bopenUrl\b|\{\s*[^}]*\bopenUrl\b[^}]*\}\s*from\s*['"]@tauri-apps\/plugin-opener['"])/ },
];
function findings(rel: string, src: string): string[] {
  if (rel === HELPER) return [];
  const out: string[] = [];
  normalizeEol(src).split('\n').forEach((line, i) => {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '').replace(/\/\/.*$/, '');
    for (const d of DIRECT) if (d.re.test(code)) out.push(`${rel}:${i + 1} ${d.name}`);
  });
  return out;
}

const scanned = collect(ROOT);
const all = scanned.flatMap(rel => findings(rel, readFileSync(join(ROOT, rel), 'utf8')));
ck(`全仓 ${scanned.length} 个源文件没有绕过 open-external 的外链调用`, all.length === 0, all.join('; '));
ck('取集包含 helper 自己和已知调用方', scanned.includes(HELPER) && scanned.includes('src/VoiceSettingsSection.tsx') && scanned.includes('src/MarkdownMessage.tsx') && scanned.includes('App.tsx'));
const helperSrc = readFileSync(join(ROOT, HELPER), 'utf8');
ck('helper 自己确实持有三条路', /openUrl\(/.test(helperSrc) && /Linking\.openURL\(/.test(helperSrc) && /g\.open!\(/.test(helperSrc));
ck('语音设置的控制台链接经 openExternal', readFileSync(join(ROOT, 'src/VoiceSettingsSection.tsx'), 'utf8').includes('openExternal(VOLC_CONSOLE_URL)'));

// 判据自检:坏行必须被报,注释里的提及和 helper 自身不报;CRLF 不影响。
ck('判据:Linking.openURL 被报', findings('src/X.tsx', "onPress={() => void Linking.openURL(URL)}").length === 1);
ck('判据:window.open 被报', findings('src/X.tsx', "window.open(url, '_blank')").length === 1);
ck('判据:plugin-opener openUrl 被报', findings('src/X.tsx', "import { openUrl } from '@tauri-apps/plugin-opener';\nawait openUrl(u);").length >= 1);
ck('判据:revealItemInDir 不误报', findings('src/X.ts', "const { revealItemInDir } = await import('@tauri-apps/plugin-opener');").length === 0);
ck('判据:注释里的提及不报', findings('src/X.ts', '// 以前直接 Linking.openURL(url)\n * window.open(url)').length === 0);
ck('判据:helper 自身豁免', findings(HELPER, 'Linking.openURL(url)').length === 0);
ck('判据:CRLF 行尾照样报且行号对', findings('src/X.ts', 'a\r\nLinking.openURL(u)\r\n')[0]?.endsWith(':2 Linking.openURL') === true);

// 取集自检:子目录里的新文件、根目录 App.tsx 都要被收进来。
{
  const tmp = mkdtempSync(join(tmpdir(), 'open-external-collect-'));
  try {
    mkdirSync(join(tmp, 'src', 'deep', 'er'), { recursive: true });
    writeFileSync(join(tmp, 'src', 'deep', 'er', 'Evil.tsx'), 'Linking.openURL(x)\n');
    writeFileSync(join(tmp, 'src', 'Fine.ts'), 'export const a = 1;\n');
    writeFileSync(join(tmp, 'src', 'Skip.test.ts'), 'Linking.openURL(x)\n');
    writeFileSync(join(tmp, 'App.tsx'), 'window.open(u)\n');
    const got = collect(tmp);
    ck('取集:递归收到 src/deep/er/Evil.tsx', got.includes('src/deep/er/Evil.tsx'), got.join(','));
    ck('取集:收到根目录 App.tsx', got.includes('App.tsx'));
    ck('取集:测试文件不收', !got.includes('src/Skip.test.ts'));
    const hits = got.flatMap(rel => findings(rel, readFileSync(join(tmp, rel), 'utf8')));
    ck('取集+判据:夹具树报 2 条', hits.length === 2, hits.join('; '));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
