import { strict as assert } from 'node:assert';
import { chatWindowLabel, chatWindowUrl, mergeDetachedChatWindow, requestedChatAlias, requestedChatProfileId } from './desktop-chat-menu';
import fs from 'node:fs';
import path from 'node:path';

assert.equal(chatWindowUrl('通信 牛'), '/?chat=%E9%80%9A%E4%BF%A1+%E7%89%9B');
assert.equal(chatWindowUrl('通信牛', 'p-1'), '/?chat=%E9%80%9A%E4%BF%A1%E7%89%9B&profile=p-1');
assert.equal(requestedChatAlias('?chat=%E9%80%9A%E4%BF%A1%E7%89%9B'), '通信牛');
assert.equal(requestedChatProfileId('?chat=x&profile=p-1'), 'p-1');
assert.equal(requestedChatAlias('?chat='), null);
assert.deepEqual(
  mergeDetachedChatWindow([{ alias: 'worker', context: 'old' }, { alias: 'other' }], { alias: 'worker', context: 'Hub B' }),
  [{ alias: 'other' }, { alias: 'worker', context: 'Hub B' }],
);
assert.equal(chatWindowLabel('通信牛'), chatWindowLabel('通信牛'));
assert.notEqual(chatWindowLabel('通信牛'), chatWindowLabel('工程牛'));
assert.notEqual(chatWindowLabel('通信牛', 'hub-a'), chatWindowLabel('通信牛', 'hub-b'));
assert.match(chatWindowLabel('通信牛'), /^chat-[a-f0-9]+$/);

const agentsSource = fs.readFileSync(path.join(process.cwd(), 'src/AgentsScreen.tsx'), 'utf8');
assert.ok(agentsSource.includes("addEventListener('contextmenu', handleContextMenu, true)"));
assert.ok(agentsSource.includes('event.preventDefault?.()'));
assert.ok(agentsSource.includes('event.stopImmediatePropagation?.()'));
assert.ok(agentsSource.includes('dataSet: { agentAlias: item.alias }'));

const chatSource = fs.readFileSync(path.join(process.cwd(), 'src/ChatScreen.tsx'), 'utf8');
assert.ok(chatSource.includes("addEventListener('contextmenu', handleMessageContextMenu, true)"));
assert.ok(chatSource.includes("messagePart: 'sent'") && chatSource.includes("messagePart: 'reply'"));
assert.ok(chatSource.includes('<Text style={styles.actionText}>转发</Text>'));
assert.ok(chatSource.includes('await sendTask(cfg, target, forwardFor.text, undefined, \'normal\', requestId)'));

console.log('desktop chat menu: 14 checks passed');
