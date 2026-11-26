import { strict as assert } from 'node:assert';
import fs from 'node:fs';

// Source-wiring regression only; native layout and mounted account changes
// require separate acceptance. Model & thinking-level pills live in the
// composer toolbar (both desktop and mobile), not as a redundant row under the
// chat header avatar.
const source = fs.readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
assert.ok(!source.includes('testID="chat-header-model"'), 'redundant header model chip is removed');
assert.ok(!source.includes('headerModelRow'), 'header stays single-band without an extra model row below the avatar');
const matches = [...source.matchAll(/testID="composer-model"[^>]*>([\s\S]*?)<\/Text>/g)];
assert.equal(matches.length, 2, 'desktop and mobile composer model pills are both present');
for (const m of matches) {
  const body = m[1];
  assert.ok(body.includes('footerModel'), 'composer model pill uses render-scope and TTL checked model');
  assert.ok(body.includes("modelFixedByNode ? t('chat.modelFixed') : t('chat.modelSelect')"), 'composer model pill renders select/fixed copy');
  assert.ok(!body.includes('sessionModel'), 'composer model pill does not bypass scope with asynchronous legacy state');
}
assert.ok(!source.includes('sessionModel || !compactViewport'), 'short viewport does not suppress unknown');
console.log('10 composer model source-wiring checks passed');
