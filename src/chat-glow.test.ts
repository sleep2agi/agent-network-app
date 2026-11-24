import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatCornerGlowGradient, GLOW_WARM } from './chat-glow-gradient';

// admin 2026-11-19：光斑 → 「太丑」→「左侧也需要一样的」「学学这个配色」。
// admin 2026-11-20：「右下角还是有点丑，算了，统一用左上角这个暖黄色吧」→ v5 两角同色,只去掉了冷蓝。
const light = chatCornerGlowGradient('light');
const dark = chatCornerGlowGradient('dark');
assert.ok(light.includes(GLOW_WARM.light), 'light: warm peach in both washes');
assert.match(light, /at 8% 10%/, 'warm wash anchored top-left');
assert.match(light, /at 94% 92%/, 'second warm wash anchored bottom-right (same hue, no more cool blue)');
// Each wash() repeats its rgb triplet 3× (0% / 40% / 72% stops); two washes ⇒ 6, not a second color's triplets mixed in.
assert.equal(light.split(GLOW_WARM.light).length - 1, 6, 'both corners use the warm rgb triplet, not a second color');
assert.match(light, /ellipse 75% 80%/, 'large soft washes, not small corner spots');
assert.ok(!light.includes('255, 214, 10'), 'no saturated yellow (v1/v2 looked muddy)');
assert.ok(dark.includes(GLOW_WARM.dark));
assert.ok(!dark.includes('255, 255, 255'));

// 整窗一层：桌面 shell 带渐变并打开 glass；侧栏 / 列表 / 内容区透明。
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
assert.match(app, /<GlassChromeProvider value=\{true\}>/);
assert.match(app, /<WindowGlowRoot>[\s\S]{0,80}<MacTitleStrip \/>/, 'glow sits on the outermost root, so it starts under the macOS traffic lights');
assert.match(app, /style=\{\[desktopStyles\.shell, \{ backgroundColor: 'transparent' \}\]\}/);
const root = readFileSync(new URL('./window-glow-root.tsx', import.meta.url), 'utf8');
assert.match(root, /useSyncExternalStore\(onThemeChange, themeMode, themeMode\)/, 'root follows theme changes');
// 0.2.575：原生（安卓/iOS）改走预生成 PNG 的 MobileWindowGlow；web 仍用 CSS 渐变。
assert.match(root, /mobileGlowActive\(\)/, 'root 用统一判定决定原生/网页分支');
assert.match(root, /return <MobileWindowGlow>/, '原生用 MobileWindowGlow');
assert.match(root, /chatCornerGlow\(colors\.bg, mode\)/, 'web 分支仍是 CSS 渐变');
const strip = readFileSync(new URL('./mac-title-strip.tsx', import.meta.url), 'utf8');
assert.match(strip, /height: MAC_TITLE_STRIP_HEIGHT, backgroundColor: 'transparent'/, 'macOS drag strip no longer paints a white band');
assert.match(app, /rail: \{ width: ds\(64\), backgroundColor: 'transparent'/);
assert.match(app, /conversations: \{[^}]*backgroundColor: 'transparent' \}/);
assert.match(app, /content: \{ flex: 1, minWidth: 0, backgroundColor: 'transparent' \}/);

// 嵌在主窗口里的聊天 / 私信 / 列表让出底色；独立弹出的聊天窗仍自带光斑。
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
assert.match(chat, /glass \|\| mobileGlowActive\(\) \? \{ backgroundColor: 'transparent' \} : desktop && chatCornerGlow\(colors\.bg, themeMode\(\)\)/);
assert.match(chat, /desktop && styles\.headerOverGlow/);
assert.match(chat, /composerDivider: \{[\s\S]{0,300}backgroundColor: 'transparent'/);
const dm = readFileSync(new URL('./DmChatScreen.tsx', import.meta.url), 'utf8');
assert.match(dm, /\(glass \|\| mobileGlowActive\(\)\) && \{ backgroundColor: 'transparent' \}/);
const list = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
assert.match(list, /const listChromeBg = glass \|\| mobileGlowActive\(\) \? 'transparent'/);
const session = readFileSync(new URL('./NodeSessionControl.tsx', import.meta.url), 'utf8');
assert.match(session, /backgroundColor: touch \? colors\.card : 'transparent'/);
const rail = readFileSync(new URL('./ChatToolRail.tsx', import.meta.url), 'utf8');
assert.match(rail, /backgroundColor: glass \? 'transparent' : colors\.bg/, 'right tool rail lets the window glow through');
assert.match(app, /if \(desktop && cfg && screen\.name !== 'login'\) \{[\s\S]{0,300}style=\{\[styles\.root, rootInset, \{ backgroundColor: 'transparent' \}\]\}/, 'desktop main window root does not cover the window glow');
// admin 2026-11-24：设置窗口（含独立设置窗）不能盖死暖黄整窗渐变，左右两栏都透出同一层光。
const settings = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
assert.ok(!settings.includes('glassOpaque'), 'SettingsScreen does not opt out of GlassContent (would cut the warm glow at the macOS title strip)');
assert.match(settings, /sidebar:\s*\{[^}]*backgroundColor:\s*'transparent'/, 'SettingsScreen sidebar lets the warm window glow through');
console.log('chat-glow: ok');
