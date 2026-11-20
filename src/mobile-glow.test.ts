// 整窗渐变几何：一张图铺满窗口（v3，2026-11-20 折叠屏/关于页两次真机截图后的收敛）。
import { mobileGlowLayout } from './mobile-glow';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

const phone = mobileGlowLayout(390, 844);
ck('手机：铺满整窗', phone.left === 0 && phone.top === 0 && phone.width === 390 && phone.height === 844, phone);
const fold = mobileGlowLayout(1000, 700);
ck('折叠屏展开：同样铺满（不再只盖左边）', fold.width === 1000 && fold.height === 700, fold);
ck('零尺寸不炸', (() => { const g = mobileGlowLayout(0, 0); return g.width >= 1 && g.height >= 1; })());

console.log(`mobile-glow: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
