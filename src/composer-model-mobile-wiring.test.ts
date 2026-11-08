import { strict as assert } from 'node:assert';
import fs from 'node:fs';

// Source-wiring regression only; native layout and mounted account changes
// require separate acceptance. Reuse the already scope/TTL-checked value.
const source = fs.readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const marker = source.indexOf('testID="chat-header-model"');
assert.ok(marker >= 0, 'header model remains present');
const header = source.slice(marker, source.indexOf('</Text>', marker));
assert.ok(header.includes('composerModelLine'), 'header uses render-scope and TTL checked model');
assert.ok(header.includes("t('chat.reportedModel', { model: composerModelLine })"), 'header identifies report provenance');
assert.ok(header.includes("t('chat.modelUnknown')"), 'header explicitly renders unknown');
assert.ok(!header.includes('sessionModel'), 'header does not bypass scope with asynchronous legacy state');
assert.ok(!source.includes('sessionModel || !compactViewport'), 'short viewport does not suppress unknown');
console.log('6 mobile model source-wiring checks passed');
