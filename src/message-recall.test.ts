import { readFileSync } from 'node:fs';
import { isRecalledTask, markTaskRecalled, recallEligibility, reeditContentOf } from './message-recall';
import { messageMenuKeys } from './message-menu-model';
import { selectMenuItems } from './message-select-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

ck('isRecalledTask reads meta object and meta_json string',
  isRecalledTask({ meta: { recalled: true } })
  && isRecalledTask({ meta_json: '{"recalled":true,"recalled_at":"2026-11-25T00:00:00Z"}' })
  && !isRecalledTask({ meta_json: '{"recalled":false}' })
  && !isRecalledTask({}));

ck('queued own sent task is recallable without interrupt', (() => {
  const r = recallEligibility({ item: { task_id: 't1', status: 'delivered', content: 'hi' }, kind: 'sent', isMine: true, canInterrupt: false });
  return r.allowed && !r.needsInterrupt;
})());

ck('running own sent task requires interrupt capability', (() => {
  const noInt = recallEligibility({ item: { task_id: 't2', status: 'running', content: 'hi' }, kind: 'sent', isMine: true, canInterrupt: false });
  const withInt = recallEligibility({ item: { task_id: 't2', status: 'running', content: 'hi' }, kind: 'sent', isMine: true, canInterrupt: true });
  return !noInt.allowed && withInt.allowed && withInt.needsInterrupt;
})());

ck('replied, reply bubble, local echo, or already recalled are not recallable',
  !recallEligibility({ item: { task_id: 't3', status: 'replied', result: 'ok' }, kind: 'sent', isMine: true, canInterrupt: true }).allowed
  && !recallEligibility({ item: { task_id: 't4', status: 'delivered' }, kind: 'reply', isMine: true, canInterrupt: true }).allowed
  && !recallEligibility({ item: { task_id: 't5', status: 'delivered', _localId: 'loc1' }, kind: 'sent', isMine: true, canInterrupt: true }).allowed
  && !recallEligibility({ item: { task_id: 't6', status: 'cancelled', meta_json: '{"recalled":true}' }, kind: 'sent', isMine: true, canInterrupt: true }).allowed
  && !recallEligibility({ item: { task_id: 't7', status: 'delivered' }, kind: 'sent', isMine: false, canInterrupt: true }).allowed);

ck('markTaskRecalled preserves existing metadata and marks cancelled + recalled', (() => {
  const marked = markTaskRecalled({ task_id: 't1', status: 'delivered', meta_json: '{"client_request_id":"c1"}' }, '2026-11-25T00:00:00Z');
  const parsed = JSON.parse(marked.meta_json!);
  return marked.status === 'cancelled' && parsed.recalled === true && parsed.client_request_id === 'c1' && isRecalledTask(marked);
})());

ck('reeditContentOf strips quote prefix and keeps editable body',
  reeditContentOf('「@通信鸽: 旧消息」\n新的正文内容') === '新的正文内容'
  && reeditContentOf('  直接发的正文  ') === '直接发的正文');

ck('desktop and touch menus include recall only when canRecall=true',
  messageMenuKeys({ hasText: true, canRecall: true }).includes('recall')
  && !messageMenuKeys({ hasText: true, canRecall: false }).includes('recall')
  && selectMenuItems({ hasText: true, phase: 'menu', canRecall: true }).some(i => i.key === 'recall')
  && !selectMenuItems({ hasText: true, phase: 'menu', canRecall: false }).some(i => i.key === 'recall')
  && !selectMenuItems({ hasText: true, phase: 'select', canRecall: true }).some(i => i.key === 'recall'));

const chatScreen = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
ck('ChatScreen wires recallTask, chat-recalled-row, and chat-recalled-reedit',
  chatScreen.includes('recallTask')
  && chatScreen.includes('chat-recalled-row')
  && chatScreen.includes('chat-recalled-reedit'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
