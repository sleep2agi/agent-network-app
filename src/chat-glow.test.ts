import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatCornerGlowGradient, GLOW_BLUE, GLOW_YELLOW } from './chat-glow-gradient';

// admin 2026-11-19：左上角黄色发光、右下角蓝色发光；v1 浅色发脏，v2 加白色提亮层、深色用琥珀。
const light = chatCornerGlowGradient('light');
const dark = chatCornerGlowGradient('dark');
assert.match(light, new RegExp(`rgba\\(${GLOW_YELLOW.light}, 0\\.4\\) 0%`), 'light: saturated yellow');
assert.match(light, /rgba\(255, 255, 255, 0\.95\)/, 'light: white lift under the glows (no muddy beige on grey)');
assert.ok(light.indexOf(GLOW_YELLOW.light) < light.indexOf('255, 255, 255'), 'yellow layer sits above its white lift');
assert.match(light, /at 0% 0%/); assert.match(light, /at 100% 100%/);
assert.ok(!dark.includes('255, 255, 255'), 'dark: no white lift');
assert.ok(dark.includes(GLOW_YELLOW.dark) && GLOW_YELLOW.dark !== GLOW_YELLOW.light, 'dark: amber instead of pure yellow (pure yellow on black turns olive)');
assert.ok(dark.includes(GLOW_BLUE.dark));

const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
assert.match(chat, /desktop && chatCornerGlow\(colors\.bg, themeMode\(\)\)/, 'desktop chat root gets the glow');
assert.match(chat, /desktop && styles\.headerOverGlow/, 'desktop header lets the glow through');
assert.match(chat, /composerDivider: \{[\s\S]{0,200}backgroundColor: 'transparent'/, 'resize divider does not cut a band through the glow');
const session = readFileSync(new URL('./NodeSessionControl.tsx', import.meta.url), 'utf8');
assert.match(session, /backgroundColor: touch \? colors\.card : 'transparent'/, 'desktop session strip lets the glow through');
console.log('chat-glow: ok');
