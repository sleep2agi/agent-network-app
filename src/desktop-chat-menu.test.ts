import { strict as assert } from 'node:assert';
import { chatWindowLabel, chatWindowUrl, requestedChatAlias } from './desktop-chat-menu';
import fs from 'node:fs';
import path from 'node:path';

assert.equal(chatWindowUrl('通信 牛'), '/?chat=%E9%80%9A%E4%BF%A1%20%E7%89%9B');
assert.equal(requestedChatAlias('?chat=%E9%80%9A%E4%BF%A1%E7%89%9B'), '通信牛');
assert.equal(requestedChatAlias('?chat='), null);
assert.equal(chatWindowLabel('通信牛'), chatWindowLabel('通信牛'));
assert.notEqual(chatWindowLabel('通信牛'), chatWindowLabel('工程牛'));
assert.match(chatWindowLabel('通信牛'), /^chat-[a-f0-9]+$/);

const agentsSource = fs.readFileSync(path.join(process.cwd(), 'src/AgentsScreen.tsx'), 'utf8');
assert.ok(agentsSource.includes("addEventListener('contextmenu', handleContextMenu, true)"));
assert.ok(agentsSource.includes('event.preventDefault?.()'));
assert.ok(agentsSource.includes('event.stopImmediatePropagation?.()'));
assert.ok(agentsSource.includes('dataSet: { agentAlias: item.alias }'));

console.log('desktop chat menu: 10 checks passed');
