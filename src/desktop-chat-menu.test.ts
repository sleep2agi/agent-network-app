import { strict as assert } from 'node:assert';
import { chatWindowLabel, chatWindowUrl, mergeDetachedChatWindow, requestedChatAlias, requestedChatProfileId, workspaceWindowLabel } from './desktop-chat-menu';
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

// ── 应用多开:工作区窗口(Vincent 2026-09-07)──────────────────────────────────
{
  const { openWorkspaceWindow, requestedWorkspaceProfileId, workspaceWindowLabel, workspaceWindowTitle, workspaceWindowUrl } = await import('./desktop-chat-menu');
  assert.equal(workspaceWindowUrl('p-1'), '/?workspace=p-1');
  assert.equal(workspaceWindowUrl('a b'), '/?workspace=a+b');
  assert.equal(requestedWorkspaceProfileId('?workspace=p-1'), 'p-1');
  assert.equal(requestedWorkspaceProfileId('?workspace=%20'), null, 'blank workspace id is no workspace');
  assert.equal(requestedWorkspaceProfileId('?chat=x&profile=p-1'), null, 'a detached chat window is not a workspace window');
  assert.equal(requestedWorkspaceProfileId(workspaceWindowUrl('p 2').slice(1)), 'p 2', 'url and parser round-trip');
  // 同一账号 → 同一标签(去重、再点聚焦);不同账号 → 不同标签;和聊天窗口标签不撞。
  assert.equal(workspaceWindowLabel('p-1'), workspaceWindowLabel('p-1'));
  assert.notEqual(workspaceWindowLabel('p-1'), workspaceWindowLabel('p-2'));
  assert.match(workspaceWindowLabel('p-1'), /^workspace-[0-9a-f]+$/);
  assert.notEqual(workspaceWindowLabel('p-1'), chatWindowLabel('p-1'));
  // 标题:账号 · Hub 主机 · Agent Network;displayName 优先,其次 username;serverUrl 不是 URL 时原样。
  assert.equal(workspaceWindowTitle({ displayName: 'Vincent', username: 'admin', serverUrl: 'http://y.vansin.top:9300' }), 'Vincent · y.vansin.top:9300 · Agent Network');
  assert.equal(workspaceWindowTitle({ username: 'local-admin', serverUrl: 'http://127.0.0.1:9201' }), 'local-admin · 127.0.0.1:9201 · Agent Network');
  assert.equal(workspaceWindowTitle({ serverUrl: 'not a url' }), 'Hub 账号 · not a url · Agent Network');
  // 非 Tauri 环境是 no-op,不能抛。
  await openWorkspaceWindow({ profileId: 'p-1', serverUrl: 'http://x' });
  console.log('desktop chat menu: workspace window checks passed');
}

// ── Tauri 权限按窗口标签给(Vincent 2026-09-07 截图:新窗口「plugin:http|fetch not allowed by ACL」)。
// 这里铸出的每种标签前缀都必须在 capabilities/default.json 的 windows 里,否则新窗口里所有 invoke 全拒。
{
  const capability = JSON.parse(fs.readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8')) as { windows?: string[] };
  const granted = capability.windows ?? [];
  const covers = (label: string) => granted.some(pattern => pattern === label || (pattern.endsWith('*') && label.startsWith(pattern.slice(0, -1))));
  for (const label of ['main', chatWindowLabel('通信牛', 'p-1'), workspaceWindowLabel('p-1')]) {
    assert.ok(covers(label), `capability windows must cover window label ${label} (got ${JSON.stringify(granted)})`);
  }
  console.log('desktop chat menu: capability covers every minted window label');
}
