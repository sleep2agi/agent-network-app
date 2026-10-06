// #609 语音输入不再是微信绿(Vincent 2026-10-06「语音输入…改成那个蓝色主题,那个蓝色现在是那个微信的绿」)。
//
// 两层分开守(判据 + 取集,见 CLAUDE.md 复核纪律 ⑤):
//   判据:一行源码里出现微信绿一族(#07c160 / #06ad56 / #09bb07 / #95ec69 / #3eb575 / rgb(a)(7,193,96))就报;
//   取集:递归收 src/ 下全部 .ts / .tsx(不含 *.test.ts),自检喂一棵带子目录的树,确认子目录里的也收得到。
// 唯一允许的地方:message-select-model.ts 的长按选区手柄 / 高亮(它画在「我发出的」晴蓝气泡上,换成蓝就看不见了;
// 理由写在那两行旁边)。语音气泡 / 「文」圈 / 电平条一律从 ACCENT token 取色。
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCENT, colors, setThemeMode } from './theme';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, detail = '') => {
  t++; if (ok) p++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

export const WECHAT_GREEN = /#(07c160|06ad56|09bb07|95ec69|3eb575)\b|rgba?\(\s*7\s*,\s*193\s*,\s*96\b/i;
const HERE = dirname(fileURLToPath(import.meta.url));
const ALLOW = new Set(['message-select-model.ts']);

const collect = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) { if (e !== 'node_modules') out.push(...collect(f)); }
    else if (/\.tsx?$/.test(e) && !e.endsWith('.test.ts')) out.push(f);
  }
  return out;
};
const scan = (root: string) => {
  const hits: string[] = [];
  const files = collect(root);
  for (const f of files) {
    const rel = relative(root, f).split(sep).join('/');
    if (ALLOW.has(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (WECHAT_GREEN.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`); });
  }
  return { files, hits };
};

// ── 自检:判据 ──
ck('判据认得 #07C160 / #95ec69 / #3eb575 / rgba(7,193,96,…)', ['x: \'#07C160\'', "voiceBubble: '#95ec69',", "voiceBubble: '#3eb575',", "c = 'rgba(7, 193, 96, 0.3)'"].every(l => WECHAT_GREEN.test(l)));
ck('判据不误报晴蓝 / 状态绿', !["'#1b65db'", "running: '#22c55e'", "running: '#15803d'", "'#07c1600'"].some(l => WECHAT_GREEN.test(l)));
// ── 自检:取集(子目录里的文件必须收进来,.test.ts 不收)──
{
  const d = mkdtempSync(join(tmpdir(), 'voice-green-'));
  mkdirSync(join(d, 'deep', 'er'), { recursive: true });
  writeFileSync(join(d, 'deep', 'er', 'X.tsx'), "const c = '#07c160';\n");
  writeFileSync(join(d, 'top.ts'), "const ok = '#1b65db';\n");
  writeFileSync(join(d, 'fixture.test.ts'), "const c = '#95ec69';\n");
  const r = scan(d);
  ck('取集递归:子目录里的 X.tsx 被扫到、*.test.ts 不扫', r.files.length === 2 && r.hits.length === 1 && r.hits[0].startsWith('deep/er/X.tsx:1'), r.hits.join(' | '));
}

// ── 真扫 src/ ──
const real = scan(HERE);
ck(`src/ 里没有微信绿(扫了 ${real.files.length} 个文件,允许:${[...ALLOW].join(', ')})`, real.files.length > 100 && real.hits.length === 0, real.hits.join('\n    '));

// ── 语音浮层的颜色从 ACCENT 取 ──
for (const m of ['light', 'dark'] as const) {
  setThemeMode(m);
  ck(`${m}:语音气泡 = bubbleMine(${ACCENT[m].bubbleMine})、字 = onBubbleMine`, colors.voiceBubble === ACCENT[m].bubbleMine && colors.onVoiceBubble === ACCENT[m].onBubbleMine, `${colors.voiceBubble}/${colors.onVoiceBubble}`);
}
const ui = readFileSync(join(HERE, 'VoiceInputUI.tsx'), 'utf8');
ck('VoiceInputUI:气泡 / 「文」圈用 voiceBubble,电平条用 ACCENT_ON_DARK,按下的大条用 accent', ui.includes('colors.voiceBubble') && ui.includes('holdCircleOn: { backgroundColor: colors.voiceBubble }') && ui.includes('backgroundColor: ACCENT_ON_DARK') && ui.includes('holdBarPressed: { backgroundColor: colors.accent'));

console.log(`voice accent guard: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
