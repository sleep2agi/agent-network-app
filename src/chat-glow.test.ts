import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatCornerGlowGradient, GLOW_COOL, GLOW_WARM } from './chat-glow-gradient';

// admin 2026-11-19：光斑 → 「太丑」→「左侧也需要一样的」「学学这个配色」（参考图：左上暖桃、右下淡紫蓝）。
const light = chatCornerGlowGradient('light');
const dark = chatCornerGlowGradient('dark');
assert.ok(light.includes(GLOW_WARM.light) && light.includes(GLOW_COOL.light), 'light: warm peach + soft periwinkle');
assert.match(light, /at 8% 10%/, 'warm wash anchored top-left');
assert.match(light, /at 94% 92%/, 'cool wash anchored bottom-right');
assert.ok(light.indexOf(GLOW_WARM.light) < light.indexOf(GLOW_COOL.light));
assert.match(light, /ellipse 75% 80%/, 'large soft washes, not small corner spots');
assert.ok(!light.includes('255, 214, 10'), 'no saturated yellow (v1/v2 looked muddy)');
assert.ok(dark.includes(GLOW_WARM.dark) && dark.includes(GLOW_COOL.dark));
assert.ok(!dark.includes('255, 255, 255'));

// 整窗一层：桌面 shell 带渐变并打开 glass；侧栏 / 列表 / 内容区透明。
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
assert.match(app, /<GlassChromeProvider value=\{true\}>/);
assert.match(app, /style=\{\[desktopStyles\.shell, chatCornerGlow\(colors\.bg, themeMode\(\)\)\]\}/);
assert.match(app, /rail: \{ width: ds\(64\), backgroundColor: 'transparent'/);
assert.match(app, /conversations: \{[^}]*backgroundColor: 'transparent' \}/);
assert.match(app, /content: \{ flex: 1, minWidth: 0, backgroundColor: 'transparent' \}/);

// 嵌在主窗口里的聊天 / 私信 / 列表让出底色；独立弹出的聊天窗仍自带光斑。
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
assert.match(chat, /glass \? \{ backgroundColor: 'transparent' \} : desktop && chatCornerGlow\(colors\.bg, themeMode\(\)\)/);
assert.match(chat, /desktop && styles\.headerOverGlow/);
assert.match(chat, /composerDivider: \{[\s\S]{0,300}backgroundColor: 'transparent'/);
const dm = readFileSync(new URL('./DmChatScreen.tsx', import.meta.url), 'utf8');
assert.match(dm, /glass && \{ backgroundColor: 'transparent' \}/);
const list = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
assert.match(list, /const listChromeBg = glass \? 'transparent'/);
const session = readFileSync(new URL('./NodeSessionControl.tsx', import.meta.url), 'utf8');
assert.match(session, /backgroundColor: touch \? colors\.card : 'transparent'/);
console.log('chat-glow: ok');
