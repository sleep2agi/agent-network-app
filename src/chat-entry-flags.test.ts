// ck-style (self-executing; run by scripts/run-tests.mjs).
// 0.2.105 (Vincent): the ⚡ priority toggle and the BTW entries are hidden in the chat UI
// on every platform. The features stay: `/btw` still opens the drawer, priority send
// still works end to end (task-priority-send.test.ts). Flip the flags to bring them back.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { SHOW_BTW_ENTRY, SHOW_BOLT_ENTRY } = await import('./chat-entry-flags');
const { plusPanelItems } = await import('./composer-plus-panel');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

check(SHOW_BTW_ENTRY === false, 'BTW entries hidden (SHOW_BTW_ENTRY = false)');
check(SHOW_BOLT_ENTRY === false, '⚡ entry hidden (SHOW_BOLT_ENTRY = false)');

for (const env of [
  { os: 'android', desktop: false, attachEnabled: true },
  { os: 'ios', desktop: false, attachEnabled: true },
  { os: 'web', desktop: false, attachEnabled: true },
  { os: 'web', desktop: true, attachEnabled: true },
]) {
  check(!plusPanelItems(env).some(i => i.key === 'btw'), `no 旁路提问 cell (${env.os}${env.desktop ? ', desktop' : ''})`);
}

const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const count = (needle: string) => chat.split(needle).length - 1;

// Every entry-point JSX is behind its flag (source contract).
{
  const header = chat.slice(chat.indexOf('<View style={styles.header}>'), chat.indexOf('<View style={styles.header}>') + 6000);
  const btwAt = header.indexOf('accessibilityLabel="打开 BTW 旁路线程"');
  check(btwAt > 0, 'header BTW button still in source (for the flag)');
  check(header.lastIndexOf('{SHOW_BTW_ENTRY ? (', btwAt) > header.lastIndexOf(') : null}', btwAt), 'header BTW button is wrapped in SHOW_BTW_ENTRY');
}
check(count('{SHOW_BOLT_ENTRY ? (') === 2, 'both ⚡ buttons (desktop toolbar chip + mobile composer row) are gated');
for (const glyph of ['>⚡ 优先</Text>', '>⚡</Text>']) {
  const at = chat.indexOf(glyph);
  check(at > 0 && chat.lastIndexOf('{SHOW_BOLT_ENTRY ? (', at) > chat.lastIndexOf(') : null}', at), `${glyph} sits inside a SHOW_BOLT_ENTRY block`);
}
check(count("onPress={() => setSendPriority(value => value === 'high' ? 'normal' : 'high')}") === 2, 'no other ⚡ toggle outside the gated blocks');
check(count('打开 BTW 旁路线程') === 1, 'no other BTW header entry');

// Hiding the toggle must not break sending: priority still defaults to normal and flows to sendTask.
check(chat.includes("useState<'high' | 'normal'>('normal')"), 'send priority defaults to normal');
check(chat.includes('sendTask(cfg, alias, outgoing, attachments, priority,'), 'priority still passed to sendTask');

console.log(`chat entry flags: ${ck}/${ck} checks passed`);
