import { strict as assert } from 'node:assert';
import fs from 'node:fs';

// Source-wiring regression only; native layout and mounted account changes
// require separate acceptance. Reuse the already scope/TTL-checked value.
const source = fs.readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const marker = source.indexOf('testID="chat-header-model"');
assert.ok(marker >= 0, 'header model remains present');
const header = source.slice(marker, source.indexOf('</Text>', marker));
assert.ok(header.includes('composerModelLine'), 'header uses render-scope and TTL checked model');
// admin 2026-11-21「这个地方也很奇怪了」：去掉了「节点上报：」前缀（和底部 composerModelPill 的
// 裸模型名对齐，固定宽度截断时不再把模型名本身切没），但仍然是 composerModelLine 原样展示——
// provenance 的保证还在（见上一行），只是不再重复印一遍「节点上报」这几个字。
assert.ok(header.includes('composerModelLine\n              : modelFixedByNode') || header.includes('? composerModelLine'), 'header shows the reported model unwrapped (no duplicate provenance prefix)');
// #573：未知/过期不再是「模型未知或已过期」的报错样子，而是「选择模型」/「模型由节点决定」。
assert.ok(header.includes("modelFixedByNode ? t('chat.modelFixed') : t('chat.modelSelect')"), 'header renders select/fixed copy');
assert.ok(!header.includes('sessionModel'), 'header does not bypass scope with asynchronous legacy state');
assert.ok(!source.includes('sessionModel || !compactViewport'), 'short viewport does not suppress unknown');
console.log('6 mobile model source-wiring checks passed');
