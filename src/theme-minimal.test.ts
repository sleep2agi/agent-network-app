// 极简 UI(2026-09-24)的 token 契约:对比度、刻度、以及已迁移界面不再有散落的颜色/粗体字面量。
import { readFileSync, readdirSync } from 'node:fs';
import { colors, radius, setThemeMode, type, weight } from './theme';
import { bubbleLayout } from './bubble-layout';

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
  // 次按钮(tonal):强调色字在 tonal 底上 ≥ 4.5:1;tonal 底要能和卡片分开。
  ck(`${mode} accent text on tonalBg ≥ 4.5:1`, contrast(colors.accent, colors.tonalBg) >= 4.5);
  ck(`${mode} tonalBg differs from card`, colors.tonalBg !== colors.card);
  // 浮起的面:深色下没有阴影,面要比地面亮一档、边要看得见;正文在浮起面上仍 ≥ 7:1。
  ck(`${mode} text on floatingBg ≥ 7:1`, contrast(colors.text, colors.floatingBg) >= 7);
  if (mode === 'dark') {
    ck('dark floatingBg is lighter than bg', lum(colors.floatingBg) > lum(colors.bg));
    ck('dark floatingBorder is visible on floatingBg (≥ 1.2:1)', contrast(colors.floatingBorder, colors.floatingBg) >= 1.2);
  }
}
setThemeMode('dark');

// 2026-09-29「四个角圆角一点」:按用途的档位(见 theme.ts);sm/md/lg 是旧名,跟着新档走。
ck('radius tokens: surface 16 / control 12 / thumb 12 / item 8 / mark 4 / inline 2 / bubble 18 / pill 999',
  radius.surface === 16 && radius.control === 12 && radius.thumb === 12 && radius.item === 8 && radius.mark === 4 && radius.inline === 2 && radius.bubble === 18 && radius.pill === 999);
ck('legacy radius names follow the new steps (sm=item, md=control, lg=surface)', radius.sm === radius.item && radius.md === radius.control && radius.lg === radius.surface);
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
ck('quote chip is a left rule, not a filled block', bubbleLayout().quoteChip.borderLeftWidth === 2 && /quoteChip: \{ \.\.\.B\.quoteChip, borderLeftColor/.test(chat) && !/quoteChip: \{[^}]*backgroundColor/.test(chat));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
