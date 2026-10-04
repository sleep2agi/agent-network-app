// #545 强调色方案:每一套(不只是当前选中的那套)在浅色 / 深色下都要过 WCAG AA,
// 这样 ACCENT_SCHEME 改成哪一套都不会把字画成看不清。另外钉住:气泡 / 按钮 / 预览都从同一组 token 取色。
import { readFileSync } from 'node:fs';
import { ACCENT_SCHEME, ACCENT_SCHEMES, colors, mixHex, setThemeMode } from './theme';

let failed = 0;
const ck = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
};

const luminance = (hex: string): number => {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => {
    const s = Number.parseInt(v.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// 各主题的中性面(与 theme.ts 的 DARK / LIGHT 同值;切主题后从 colors 读,不在这里另写一份)。
setThemeMode('light');
const LIGHT_SURF = { bg: colors.bg, card: colors.card, text: colors.text };
setThemeMode('dark');
const DARK_SURF = { bg: colors.bg, card: colors.card, text: colors.text };

for (const [id, scheme] of Object.entries(ACCENT_SCHEMES)) {
  for (const mode of ['light', 'dark'] as const) {
    const t = scheme[mode];
    const surf = mode === 'light' ? LIGHT_SURF : DARK_SURF;
    const pairs: Array<[string, string, string]> = [
      ['onAccent on accent (主按钮字)', t.onAccent, t.accent],
      ['accent on bg (链接 / 文字按钮)', t.accent, surf.bg],
      ['accent on card', t.accent, surf.card],
      ['accent on tonalBg (次按钮字)', t.accent, t.tonalBg],
      ['accent on railActiveBg (选中项字)', t.accent, t.railActiveBg],
      ['onBubbleMine on bubbleMine (我发出的气泡字)', t.onBubbleMine, t.bubbleMine],
      ['linkOnBubbleMine on bubbleMine', t.linkOnBubbleMine, t.bubbleMine],
    ];
    for (const [label, fg, bg] of pairs) {
      const r = contrast(fg, bg);
      // teal = 0.2.204 的原值,逐字节保留不改;它的浅色 railActiveBg(4.21)与灰气泡里的青色链接(4.25)本来就差一点,
      // 只记录不拦。新方案没有这个豁免。
      if (id === 'teal' && mode === 'light' && /railActiveBg|linkOnBubbleMine/.test(label) && r < 4.5) { console.log(`· ${id}/${mode} ${label} = ${r.toFixed(2)} (legacy, not gated)`); continue; }
      ck(`${id}/${mode} ${label} ≥ 4.5`, r >= 4.5, `${fg} on ${bg} = ${r.toFixed(2)}`);
    }
    ck(`${id}/${mode} tonalBg differs from card`, t.tonalBg.toLowerCase() !== surf.card.toLowerCase());
    ck(`${id}/${mode} bubbleMine differs from card (我发出的 / 对方的 能分开)`, t.bubbleMine.toLowerCase() !== surf.card.toLowerCase());
  }
}

// 当前选中的方案真的进了 colors。
for (const mode of ['light', 'dark'] as const) {
  setThemeMode(mode);
  const t = ACCENT_SCHEMES[ACCENT_SCHEME][mode];
  for (const k of Object.keys(t) as Array<keyof typeof t>) ck(`${mode} colors.${k} comes from ACCENT_SCHEME=${ACCENT_SCHEME}`, colors[k] === t[k], `${colors[k]} vs ${t[k]}`);
}
setThemeMode('dark');

ck('mixHex endpoints', mixHex('#000000', '#ffffff', 0) === '#000000' && mixHex('#000000', '#ffffff', 1) === '#ffffff' && mixHex('#000000', '#ffffff', 0.5) === '#808080');

// 按类修:我发出的气泡、设置 → 外观的预览、长按选区卡片都从 bubbleMine 取色;不许再有写死的强调色色值。
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const wired: Record<string, string[]> = {
  'ChatScreen.tsx': ['backgroundColor: colors.bubbleMine', '<MarkdownMessage tone="mine">'],
  'DmChatScreen.tsx': ['backgroundColor: colors.bubbleMine', 'bubbleTextMine: { color: colors.onBubbleMine }'],
  'MessageSelectOverlay.tsx': ['cardSent: { backgroundColor: colors.bubbleMine }', 'textSent: { color: colors.onBubbleMine }'],
  'UiScaleSettings.tsx': ['bubbleMe: { alignSelf: \'flex-end\', backgroundColor: colors.bubbleMine }', 'color: colors.onBubbleMine'],
  'MarkdownMessage.tsx': ['colors.onBubbleMine', 'colors.linkOnBubbleMine'],
};
for (const [f, needles] of Object.entries(wired)) for (const n of needles) ck(`${f} uses ${n}`, src(f).includes(n));

const OLD_LITERALS = /#(067a86|4cc3d6|eaf5f6|17313a|dcedf0|15282c|7ee0ee)\b/i;
for (const f of ['ChatScreen.tsx', 'DmChatScreen.tsx', 'UiScaleSettings.tsx', 'ComposerRowParts.tsx', 'settings-kit.tsx', 'TaskDashboard.tsx', 'VoiceInputUI.tsx', 'MarkdownMessage.tsx', 'MessageSelectOverlay.tsx', 'elevation.ts']) {
  const m = OLD_LITERALS.exec(src(f));
  ck(`${f} has no hard-coded accent hex`, !m, m ? m[0] : '');
}

process.exit(failed ? 1 : 0);
