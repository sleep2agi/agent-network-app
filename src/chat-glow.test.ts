import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chatCornerGlowGradient, GLOW_BLUE, GLOW_YELLOW } from './chat-glow-gradient';

// admin 2026-11-19：左上角黄色发光、右下角蓝色发光。
for (const mode of ['light', 'dark'] as const) {
  const g = chatCornerGlowGradient(mode);
  assert.match(g, /at 0% 0%/, 'yellow glow anchored top-left');
  assert.match(g, /at 100% 100%/, 'blue glow anchored bottom-right');
  assert.ok(g.indexOf(GLOW_YELLOW[mode]) < g.indexOf('at 100% 100%'), 'yellow belongs to the top-left layer');
  assert.ok(g.includes(GLOW_BLUE[mode]));
}
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
assert.match(chat, /desktop && chatCornerGlow\(colors\.bg, themeMode\(\)\)/, 'desktop chat root gets the glow');
assert.match(chat, /desktop && styles\.headerOverGlow/, 'desktop header lets the glow through');
assert.match(chat, /composerDivider: \{[\s\S]{0,200}backgroundColor: 'transparent'/, 'resize divider does not cut a band through the glow');
console.log('chat-glow: ok');
