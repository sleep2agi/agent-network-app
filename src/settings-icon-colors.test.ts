// #4093:设置首页的分类图标色块 —— 白色图形(onBubbleMine)在每一档上对比 ≥ 4.5:1,深浅两色共用。
import { PHONE_ICON_COLOR } from './settings-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };

const lum = (hex: string): number => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const onWhite = (hex: string): number => 1.05 / (lum(hex) + 0.05);

const entries = Object.entries(PHONE_ICON_COLOR) as [string, string][];
ck('每个分类都有色(含 Hub 设置)', ['server', 'users', 'notifications', 'appearance', 'voice', 'about'].every(k => !!(PHONE_ICON_COLOR as Record<string, string>)[k]));
for (const [key, hex] of entries) {
  ck(`${key} ${hex} 是 #rrggbb`, /^#[0-9a-f]{6}$/i.test(hex));
  ck(`${key} ${hex} 上白色图形 ≥ 4.5:1(实测 ${onWhite(hex).toFixed(2)})`, onWhite(hex) >= 4.5);
}
ck('色块彼此不重复(一眼分得开)', new Set(entries.map(([, h]) => h.toLowerCase())).size === entries.length);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
