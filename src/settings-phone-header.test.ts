// 设置子页顶栏(「关于 Agent Network」那条)在 iOS 上必须是一条实心、不透明、不叠在内容上的栏:
// owner 2026-10-01 iPhone 截图(v0.2.174,深色)里标题上压着一块磨砂药丸、读不清。iOS 上的模糊只能真机看
// (web 导出画不出原生模糊),所以这里钉住会产生它的那几种写法:原生导航头的透明 / 模糊选项、BlurView /
// 玻璃视图、半透明底色、绝对定位叠在滚动内容上。
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

const src = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
const theme = readFileSync(new URL('./theme.ts', import.meta.url), 'utf8');

const styleLine = (name: string) => src.match(new RegExp(`^\\s*${name}: \\{[^\\n]*\\},?$`, 'm'))?.[0] ?? '';
const header = styleLine('phoneHeader');
const title = styleLine('phoneHeaderTitle');

ck('phoneHeader style found', header.length > 0 && title.length > 0);
ck('header background is the opaque page colour', /backgroundColor: colors\.bg\b/.test(header));
ck('header is not overlaid on the scroll content', !/position:\s*'absolute'|zIndex|opacity/.test(header));
ck('title is solid text colour, not translucent', /color: colors\.text\b/.test(title) && !/opacity|textShadow/.test(title));
ck('no native-header blur / transparent options', !/headerTransparent|headerBlurEffect|headerLargeTitle|scrollEdgeAppearance/.test(src));
ck('no blur / glass view in the settings screen', !/expo-blur|BlurView|GlassView|expo-glass-effect|backdropFilter/.test(src));
// both themes: page bg must be a 6-digit hex (no alpha channel, no rgba) — the header paints it
const bgs = [...theme.matchAll(/^\s*bg: '([^']+)'/gm)].map(m => m[1]);
ck('both theme bg colours are opaque hex', bgs.length >= 2 && bgs.every(c => /^#[0-9a-f]{6}$/i.test(c)));
// list + subpage headers both render (no title swapped for an image / overlay)
ck('subpage header renders the title text', /<View style=\{styles\.phoneHeader\} testID="settings-subpage-header">/.test(src) && /testID="settings-subpage-title"/.test(src));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
