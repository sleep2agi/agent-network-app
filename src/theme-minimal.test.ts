// 极简 UI(2026-09-24)的 token 契约:对比度、刻度、以及已迁移界面不再有散落的颜色/粗体字面量。
import { readFileSync, readdirSync } from 'node:fs';
import { colors, radius, setThemeMode, type, weight } from './theme';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const rgb = (hex: string): [number, number, number] => {
  const v = hex.replace('#', '');
  return [0, 2, 4].map(i => Number.parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
};
const lum = (hex: string) => {
  const ch = (n: number) => { const s = n / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = rgb(hex).map(ch);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

for (const mode of ['dark', 'light'] as const) {
  setThemeMode(mode);
  // 正文/次要/弱化文字在所有会承载文字的面上都 ≥ 4.5:1(AA 正文)。
  for (const surface of ['bg', 'card', 'listBg', 'rowHover', 'rowActive'] as const) {
    ck(`${mode} text on ${surface} ≥ 7:1`, contrast(colors.text, colors[surface]) >= 7);
    ck(`${mode} textSecondary on ${surface} ≥ 4.5:1`, contrast(colors.textSecondary, colors[surface]) >= 4.5);
  }
  // 弱化文字(时间戳/提示)也是文字:在所有承载面上 ≥ 4.5:1(深色旧值 #52525b 仅 2.6:1)。
  for (const surface of ['bg', 'card', 'listBg', 'rowHover', 'rowActive'] as const) {
    ck(`${mode} textMuted on ${surface} ≥ 4.5:1`, contrast(colors.textMuted, colors[surface]) >= 4.5);
  }
  // 强调色会被当文字用(链接、「复制」「刷新」):在卡片与地面上 ≥ 4.5:1;按钮字在强调色上 ≥ 4.5:1。
  ck(`${mode} accent as text on card ≥ 4.5:1`, contrast(colors.accent, colors.card) >= 4.5);
  ck(`${mode} accent as text on bg ≥ 4.5:1`, contrast(colors.accent, colors.bg) >= 4.5);
  ck(`${mode} onAccent on accent ≥ 4.5:1`, contrast(colors.onAccent, colors.accent) >= 4.5);
  // 状态面要能被看出来,但不能抢:行悬停/选中与列表底色各差一档。
  ck(`${mode} rowHover differs from listBg`, colors.rowHover !== colors.listBg);
  ck(`${mode} rowActive differs from rowHover`, colors.rowActive !== colors.rowHover);
}
setThemeMode('dark');

ck('radius scale is 6/10/14/pill', radius.sm === 6 && radius.md === 10 && radius.lg === 14 && radius.pill === 999);
ck('type scale is 11/12/14/16/20', type.caption === 11 && type.small === 12 && type.body === 14 && type.title === 16 && type.heading === 20);
ck('heaviest weight token is 600', weight.strong === '600' && !Object.values(weight).some(w => Number(w) > 600));

// 已迁移界面:不再有散落的 hex 颜色字面量(颜色只从 token 来)。
for (const f of ['AgentsScreen.tsx', 'DesktopWindowPin.tsx', 'TasksScreen.tsx']) {
  const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  ck(`${f} has no raw hex color literals`, !/['"]#[0-9a-fA-F]{6}['"]/.test(src));
}

// 全局:没有 700/800/bold 字重(最重 600)。取集:src 下全部 .tsx + App.tsx。
const tsx = readdirSync(new URL('.', import.meta.url)).filter((f: string) => f.endsWith('.tsx')).map((f: string) => `./${f}`).concat('../App.tsx');
ck('collected at least 30 tsx files', tsx.length >= 30);
const heavy = tsx.filter((f: string) => /fontWeight:\s*['"](700|800|900|bold)['"]/.test(readFileSync(new URL(f, import.meta.url), 'utf8')));
ck(`no font weight above 600 in any tsx (${heavy.join(', ') || 'none'})`, heavy.length === 0);

// 聊天:气泡不描边,引用是左侧细线而不是灰底块。
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const bubble = /\n  bubble: \{([\s\S]*?)\n  \},/.exec(chat)?.[1] ?? '';
ck('chat bubble style block found', bubble.length > 0);
ck('chat bubble has no border', !/borderWidth/.test(bubble));
ck('quote chip is a left rule, not a filled block', /quoteChip: \{[^}]*borderLeftWidth: 2/.test(chat) && !/quoteChip: \{[^}]*backgroundColor/.test(chat));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
