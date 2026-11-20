// 手机整窗渐变的几何单测：尺寸按短边、锚点按百分比、浅深两档半径不同。
import { mobileGlowLayout } from './mobile-glow';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

const phone = mobileGlowLayout(390, 844, 'light');
// 宽高各自缩放：浅色 0.75/0.80 → 宽 585、高 1350（与桌面 ellipse 同口径）
ck('浅色手机：左上光斑宽度按窗宽、高度按窗高', Math.round(phone.topLeft.width) === 585 && Math.round(phone.topLeft.height) === 1350, phone.topLeft);
ck('浅色手机：左上锚点 8%/10%', Math.round(phone.topLeft.left) === Math.round(0.08 * 390 - 585 / 2) && Math.round(phone.topLeft.top) === Math.round(0.10 * 844 - 1350 / 2), phone.topLeft);
ck('浅色手机：右下锚点 94%/92%（同一张暖图）', Math.round(phone.bottomRight.left) === Math.round(0.94 * 390 - 585 / 2) && Math.round(phone.bottomRight.top) === Math.round(0.92 * 844 - 1350 / 2), phone.bottomRight);

const dark = mobileGlowLayout(390, 844, 'dark');
ck('深色半径更小（60%/65%）', Math.round(dark.topLeft.width) === Math.round(390 * 2 * 0.60) && Math.round(dark.topLeft.height) === Math.round(844 * 2 * 0.65), dark.topLeft);

const fold = mobileGlowLayout(1000, 700, 'light');
// 折叠屏展开（admin 2026-11-20「一半有一半没有」）：光晕宽度跟着窗宽走到 1500，盖住整个宽窗
ck('折叠屏展开：光晕跟着窗宽，不再只盖左边', Math.round(fold.topLeft.width) === 1500 && Math.round(fold.topLeft.height) === 1120, fold.topLeft);
ck('折叠屏：锚点仍按整窗百分比', Math.round(fold.topLeft.left) === Math.round(0.08 * 1000 - 1500 / 2), fold.topLeft.left);

const split = mobileGlowLayout(600, 700, 'light');
ck('分屏 600×700：宽度按 600', Math.round(split.topLeft.width) === 900, split.topLeft.width);

ck('零尺寸不炸', (() => { const g = mobileGlowLayout(0, 0, 'light'); return Number.isFinite(g.topLeft.width) && g.topLeft.width > 0; })());

console.log(`mobile-glow: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
