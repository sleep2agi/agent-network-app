// admin 2026-11-17「那学学他们的美学吧，你是 ANet 的负责人哦」（参照 yetone/magpie、pingdotgg/t3code）：
// 一个安静的底面，只留一个强调色给按钮 / 链接 / 选中态；「我发出的」气泡不再是整块实底蓝。
import { readFileSync } from 'node:fs';
import { ACCENT } from './theme';

let pass = 0;
const fails: string[] = [];
const ck = (name: string, ok: boolean) => { if (ok) pass += 1; else fails.push(name); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

for (const mode of ['light', 'dark'] as const) {
  const t = ACCENT[mode];
  const lum = (hex: string) => { const n = (i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16); return Math.max(n(0), n(1), n(2)) - Math.min(n(0), n(1), n(2)); };
  ck(`${mode}: my bubble is a neutral grey, not the accent`, t.bubbleMine.toLowerCase() !== t.accent.toLowerCase() && lum(t.bubbleMine) <= 8);
  ck(`${mode}: the solid brand block keeps the blue (settings profile card)`, t.solidBrand.toLowerCase() === (mode === 'light' ? '#1b65db' : '#2563d9') && t.onSolid === '#ffffff');
}
const settings = read('./settings-kit.tsx');
ck('settings profile card and icon tiles use solidBrand / onSolid, not the chat bubble', settings.includes('backgroundColor: colors.solidBrand') && !/colors\.(bubbleMine|onBubbleMine)/.test(settings));
const chat = read('./ChatScreen.tsx');
ck('agent → other node bubble is the same quiet card as replies', chat.includes('agentSentBubble: { backgroundColor: colors.card }'));

console.log(`quiet-aesthetics: ${pass}/${pass + fails.length}`);
if (fails.length) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
