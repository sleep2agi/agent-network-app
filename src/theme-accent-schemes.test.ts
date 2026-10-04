// #545 强调色(晴蓝):浅色 / 深色下每一对前景 / 背景都要过 WCAG AA,改色值时不会把字画成看不清。
// 另外钉住:气泡 / 按钮 / 预览都从同一组 token 取色,不再有写死的旧墨青色值。
import { readFileSync } from 'node:fs';
import { ACCENT, colors, mixHex, setThemeMode } from './theme';

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

for (const mode of ['light', 'dark'] as const) {
  const t = ACCENT[mode];
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
    ck(`${mode} ${label} ≥ 4.5`, r >= 4.5, `${fg} on ${bg} = ${r.toFixed(2)}`);
  }
  ck(`${mode} tonalBg differs from card`, t.tonalBg.toLowerCase() !== surf.card.toLowerCase());
  ck(`${mode} bubbleMine differs from card (我发出的 / 对方的 能分开)`, t.bubbleMine.toLowerCase() !== surf.card.toLowerCase());
}

// 强调色一族真的进了 colors(浅 / 深两份都要)。
for (const mode of ['light', 'dark'] as const) {
  setThemeMode(mode);
  const t = ACCENT[mode];
  for (const k of Object.keys(t) as Array<keyof typeof t>) ck(`${mode} colors.${k} comes from ACCENT.${mode}`, colors[k] === t[k], `${colors[k]} vs ${t[k]}`);
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
  'MarkdownMessage.tsx': ['colors.onBubbleMine', 'colors.linkOnBubbleMine', 'useMineBubble()'],
  // 气泡里直接画在蓝底上的附件行 / 下载链接 / 上传状态(原 accent 字,蓝配蓝看不见):走 bubble-ink.ts。
  'AttachmentFileDesktop.tsx': ["useBubbleInk('link')"],
  'AuthedThumb.tsx': ["useBubbleInk('link')"],
  'AuthedWebThumb.tsx': ["useBubbleInk('link')"],
};
ck('ChatScreen.tsx wraps own bubble in <MineBubble value>', src('ChatScreen.tsx').includes('<MineBubble value>'));
ck('ChatScreen.tsx own-bubble attachments get mine=true', src('ChatScreen.tsx').includes('renderAttachments(sentAttachmentViews(item, cfg.serverUrl), item, true)'));
ck('DmChatScreen.tsx wraps bubble in <MineBubble value={out}>', src('DmChatScreen.tsx').includes('<MineBubble value={out}>'));
for (const [f, needles] of Object.entries(wired)) for (const n of needles) ck(`${f} uses ${n}`, src(f).includes(n));

const OLD_LITERALS = /#(067a86|4cc3d6|eaf5f6|17313a|dcedf0|15282c|7ee0ee)\b/i;
for (const f of ['ChatScreen.tsx', 'DmChatScreen.tsx', 'UiScaleSettings.tsx', 'ComposerRowParts.tsx', 'settings-kit.tsx', 'TaskDashboard.tsx', 'VoiceInputUI.tsx', 'MarkdownMessage.tsx', 'MessageSelectOverlay.tsx', 'elevation.ts']) {
  const m = OLD_LITERALS.exec(src(f));
  ck(`${f} has no hard-coded accent hex`, !m, m ? m[0] : '');
}

process.exit(failed ? 1 : 0);
