// 0.2.104 —— Vincent 0.2.102 小米折叠屏(展开、横屏)规则文件全屏 → 编辑:
// ① 状态栏(时钟 / VPN / 信号)压在全屏工具条上;② 编辑框行高。
// 根因与修法见 rules-fullscreen-layout.ts。这里钉:纯判定表、跳行滚动数学、以及全屏 / 编辑框确实用了它们。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 node/bun 提供。
import { readFileSync } from 'node:fs';
import { editorLineHeightPx, editorScrollTopForLine, rulesFullscreenPadding, RULES_EDITOR_FONT_SIZE, RULES_EDITOR_LINE_HEIGHT } from './rules-fullscreen-layout';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// ① 安全区判定表
const LAND = { top: 38, right: 0, bottom: 20, left: 44 }; // 横屏:挖孔在左边
const a = rulesFullscreenPadding('android', LAND, 38);
ck('android:顶边垫状态栏高度', a.paddingTop === 38);
ck('android 横屏:左边垫挖孔', a.paddingLeft === 44);
ck('android:底边垫手势条', a.paddingBottom === 20);
ck('android:右边 0 就是 0', a.paddingRight === 0);
ck('android:安全区在 Modal 里读成 0 ⇒ 顶边退到 StatusBar.currentHeight', rulesFullscreenPadding('android', { top: 0, right: 0, bottom: 0, left: 0 }, 31).paddingTop === 31);
ck('android:两者取大(安全区更大时用安全区)', rulesFullscreenPadding('android', { top: 48 }, 31).paddingTop === 48);
ck('android:安全区缺失 + 没有状态栏高度 ⇒ 0 不是 NaN', rulesFullscreenPadding('android', null, undefined).paddingTop === 0);
ck('ios:按安全区垫(刘海)', rulesFullscreenPadding('ios', { top: 47, bottom: 34 }, null).paddingTop === 47);
ck('ios:不看 StatusBar.currentHeight(iOS 上它是 undefined,且安全区已含状态栏)', rulesFullscreenPadding('ios', { top: 0 }, 99).paddingTop === 0);
const w = rulesFullscreenPadding('web', LAND, 38);
ck('web / Tauri 桌面:四边都 0(顶部空带归 MacTitleStrip / WinTitleBar)', w.paddingTop === 0 && w.paddingLeft === 0 && w.paddingBottom === 0 && w.paddingRight === 0);
ck('负数 / NaN 安全区当 0', rulesFullscreenPadding('android', { top: -5, left: NaN as any }, -1).paddingTop === 0 && rulesFullscreenPadding('android', { left: NaN as any }, 0).paddingLeft === 0);

// ② 行高常量 + 跳行滚动数学
ck('编辑框行高 > 字号(留出行距)', RULES_EDITOR_LINE_HEIGHT > RULES_EDITOR_FONT_SIZE);
ck('计算行高 "19px" → 19', editorLineHeightPx('19px') === 19);
ck('计算行高 "normal" → 退到常量', editorLineHeightPx('normal') === RULES_EDITOR_LINE_HEIGHT);
ck('计算行高读不到 → 退到常量', editorLineHeightPx(undefined) === RULES_EDITOR_LINE_HEIGHT);
ck('计算行高 0 → 退到常量', editorLineHeightPx('0px') === RULES_EDITOR_LINE_HEIGHT);
ck('跳行:目标行落在框中间', editorScrollTopForLine(1000, 400, 19) === 1000 - 200 + 9.5);
ck('跳行:靠顶的行不滚成负数', editorScrollTopForLine(50, 400, 19) === 0);

// ③ 组件确实用了它们
const src = readFileSync(new URL('./NodeRulesSection.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const fsStart = code.indexOf('function RulesFullscreen(');
const fs = fsStart >= 0 ? code.slice(fsStart) : '';
// 2026-09-26 起所有 Modal 都走同一个入口 useModalSafePadding(safe-area-runtime.ts → modal-safe-area.ts → 本表)。
ck('全屏:经 useModalSafePadding(\'fullScreen\') 取安全区(同一张表 / 同一个库)', /from '\.\/safe-area-runtime'/.test(src) && /const safe = useModalSafePadding\('fullScreen'\)/.test(fs));
const iModal = fs.indexOf('<Modal');
const iRoot = fs.indexOf('<View style={[{ flex: 1, backgroundColor: colors.bg }, safe]}');
const iToolbar = fs.indexOf('{toolbar}');
ck('全屏:Modal 根 View 挂上安全区垫子', iModal >= 0 && iRoot > iModal);
ck('全屏:工具条在垫过的根 View 里面', iRoot >= 0 && iToolbar > iRoot);
ck('编辑框:字号 / 行高用常量', /fontSize: RULES_EDITOR_FONT_SIZE, lineHeight: RULES_EDITOR_LINE_HEIGHT, fontFamily: MONO/.test(code));
ck('编辑框:源码里不再有写死的 lineHeight: 19', !/lineHeight: 19\b/.test(code));
ck('跳行:web 滚动用同一套数学(不再有 `|| 19` 兜底)', /editorLineHeightPx\(/.test(code) && /editorScrollTopForLine\(top, ta\.clientHeight, lh\)/.test(code) && !/\|\| 19\b/.test(code));

// ④ 阅读区:代码块 / 正文本来就有固定行高(防回退)
const md = readFileSync(new URL('./MarkdownMessage.tsx', import.meta.url), 'utf8');
ck('阅读区代码块有固定行高', /codeText: \{[^}]*fontFamily: 'monospace'[^}]*lineHeight: \d+/.test(md));
ck('阅读区正文有固定行高', /\n  text: \{[^}]*lineHeight: \d+/.test(md));

console.log(`\n${p}/${t} passed`);
if (p !== t) (globalThis as any).process.exit(1);
