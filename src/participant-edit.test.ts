// 参与人能改状态和检查项(hub agent-network#2201:viewer_can.edit_fields)+ 任务通知私信点开任务(meta.task_notice)。
// ck 风格,自执行。请求体用假 fetch 截下来逐字比:参与人的写只带放开的键,从不整卡提交。
import { readFileSync } from 'node:fs';
import { canEditTaskField, editFieldsFromHub, readOnlyLabelKey } from './task-access';
import { moveRequirementOnHub, requirementFromHub, setChecklistItemOnHub, updateRequirementOnHub } from './requirements-hub';
import { taskNoticeOf } from './human-dm';
import { consumeDesktopMessageEvent } from './desktop-message-consume';
import { requestOpenTask, subscribeOpenTaskRequest, takeOpenTaskRequest } from './task-open-request';
import { t } from './i18n';
import './i18n-tasks';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

// —— viewer_can.edit_fields → editFields ——
{
  const part = { viewer_can: { edit: false, delete: false, edit_fields: ['column', 'checklist'] } };
  ck('参与人:edit=false + edit_fields → 两个都放开', JSON.stringify(editFieldsFromHub(part)) === '["column","checklist"]');
  ck('旧 Hub(只读、没有 edit_fields)→ 空(与今天一样全只读)', editFieldsFromHub({ viewer_can: { edit: false, delete: false } }).length === 0);
  ck('能整卡改 → 空(edit_fields 不该出现,出现了也不认)', editFieldsFromHub({ viewer_can: { edit: true, delete: true, edit_fields: ['column'] } }).length === 0);
  ck('没有 viewer_can → 空', editFieldsFromHub({}).length === 0);
  ck('看不懂的项丢掉,顺序固定', JSON.stringify(editFieldsFromHub({ viewer_can: { edit: false, edit_fields: ['name', 'checklist', 'column', 7] } })) === '["column","checklist"]');
  ck('edit_fields 不是数组 → 空', editFieldsFromHub({ viewer_can: { edit: false, edit_fields: 'column' } }).length === 0);

  const pr = requirementFromHub({ id: 'r1', name: '写测试', ...part });
  const old = requirementFromHub({ id: 'r2', name: '旧', viewer_can: { edit: false, delete: false } });
  const rw = requirementFromHub({ id: 'r3', name: '能改' });
  ck('requirementFromHub:参与人的卡 readOnly + editFields', pr?.readOnly === true && JSON.stringify(pr?.editFields) === '["column","checklist"]');
  ck('requirementFromHub:旧 Hub 只读卡没有 editFields 这个键', old?.readOnly === true && !!old && !('editFields' in old));
  ck('requirementFromHub:能改的卡两个键都没有', !!rw && !('readOnly' in rw) && !('editFields' in rw));

  ck('canEditTaskField:能改的卡什么都能改', canEditTaskField({}, 'column') && canEditTaskField({}, 'checklist'));
  ck('canEditTaskField:参与人能改状态 / 检查项', canEditTaskField(pr!, 'column') && canEditTaskField(pr!, 'checklist'));
  ck('canEditTaskField:旧 Hub 只读卡哪个都不能改', !canEditTaskField(old!, 'column') && !canEditTaskField(old!, 'checklist'));
  ck('canEditTaskField:只放开 checklist 时状态仍锁', !canEditTaskField({ readOnly: true, editFields: ['checklist'] }, 'column'));

  ck('标签:参与人 = 「仅可改状态和检查项」', t(readOnlyLabelKey(['column', 'checklist'])) === '仅可改状态和检查项' || t(readOnlyLabelKey(['column', 'checklist'])) === 'Status & checklist only');
  ck('标签:没有放开 = 「只读」(旧文案不变)', readOnlyLabelKey(undefined) === 'tasks.readOnly' && readOnlyLabelKey([]) === 'tasks.readOnly');
  ck('标签:只放开一个时说那一个', readOnlyLabelKey(['column']) === 'tasks.partialColumn' && readOnlyLabelKey(['checklist']) === 'tasks.partialChecklist');
}

// —— 请求体:只带放开的键 ——
{
  const cfg = { serverUrl: 'http://hub.local', token: 't', username: 'u', networkId: 'net', profileId: 'p' };
  const sent: { url: string; method: string; body: unknown }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: null };
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const back = (extra: Record<string, unknown>) => ({ requirement: { id: 'r1', name: '写测试', column: 'pool', viewer_can: { edit: false, delete: false, edit_fields: ['column', 'checklist'] }, ...extra } });
  try {
    reply = { status: 200, body: back({ column: 'doing' }) };
    await moveRequirementOnHub(cfg, 'r1', 'doing');
    ck('改状态:PATCH 体只有 column', sent[0]?.method === 'PATCH' && JSON.stringify(sent[0]?.body) === '{"column":"doing"}' && sent[0]?.url.includes('/api/requirements/r1'), JSON.stringify(sent[0]));

    const list = [{ id: 'i1', text: '写测试', done: false }, { id: 'i3', text: '回归', done: false }];
    reply = { status: 200, body: back({ checklist: list }) };
    sent.length = 0;
    await updateRequirementOnHub(cfg, 'r1', { checklist: list });
    ck('增删改检查项:PATCH 体只有 checklist', Object.keys(sent[0]?.body as object).join() === 'checklist', JSON.stringify(sent[0]?.body));

    reply = { status: 200, body: back({ checklist: [{ id: 'i1', text: '写测试', done: true }] }) };
    sent.length = 0;
    await setChecklistItemOnHub(cfg, 'r1', 'i1', true);
    ck('勾一项:PATCH …/checklist/i1 体只有 done', sent[0]?.url.includes('/api/requirements/r1/checklist/i1') && JSON.stringify(sent[0]?.body) === '{"done":true}', JSON.stringify(sent[0]));

    reply = { status: 403, body: { ok: false, error: 'task_read_only', field: 'name', message: '你参与了这张任务，只能改状态和检查项' } };
    let msg = '';
    try { await updateRequirementOnHub(cfg, 'r1', { name: 'x' }); } catch (e) { msg = (e as Error).message; }
    ck('403 task_read_only 带 message → 照 hub 说', msg === '你参与了这张任务，只能改状态和检查项', msg);
    reply = { status: 403, body: { ok: false, error: 'task_read_only' } };
    msg = '';
    try { await updateRequirementOnHub(cfg, 'r1', { name: 'x' }); } catch (e) { msg = (e as Error).message; }
    ck('403 不带 message(旧 Hub)→ 旧文案', msg === '你没有修改这条需求的权限', msg);
  } finally {
    (globalThis as any).fetch = realFetch;
  }
}

// —— 任务通知私信:meta.task_notice ——
{
  const meta = { task_notice: { requirement_id: 'req_9', seq: 42, network_id: 'net' } };
  ck('taskNoticeOf:对象(SSE 的 event.meta)', JSON.stringify(taskNoticeOf(meta)) === '{"requirementId":"req_9","seq":42,"networkId":"net"}');
  ck('taskNoticeOf:字符串(GET /api/dm 的 meta_json)', taskNoticeOf(JSON.stringify(meta))?.requirementId === 'req_9');
  ck('taskNoticeOf:seq 缺 / 坏 → null,卡照样能开', taskNoticeOf({ task_notice: { requirement_id: 'r', seq: 'x' } })?.seq === null);
  ck('taskNoticeOf:普通私信 / 坏 JSON / 没 id → null', taskNoticeOf(null) === null && taskNoticeOf('{bad') === null && taskNoticeOf({ attachments: [] }) === null && taskNoticeOf({ task_notice: { requirement_id: '' } }) === null);

  const ev = { type: 'desktop_message', scope: 'user', message_id: 'dm_task_1', kind: 'human_dm', from: 'cara', title: '任务更新', message: 'cara 把「写测试」改到 进行中', network_id: 'net', meta };
  const got = consumeDesktopMessageEvent(ev, { networkId: 'net' });
  ck('顶部提示:任务通知带 taskNotice', got.status === 'present' && got.notice.taskNotice?.requirementId === 'req_9' && got.notice.title === '任务更新');
  const plain = consumeDesktopMessageEvent({ ...ev, meta: undefined }, { networkId: 'net' });
  ck('顶部提示:普通私信没有 taskNotice 这个键', plain.status === 'present' && !('taskNotice' in plain.notice));
}

// —— 跨屏「打开这张任务」——
{
  requestOpenTask({ requirementId: 'req_9', networkId: 'net' });
  ck('别的网络的看板不取', takeOpenTaskRequest('other') === null);
  ck('本网络取一次就没了', takeOpenTaskRequest('net') === 'req_9' && takeOpenTaskRequest('net') === null);
  let woke = 0;
  const off = subscribeOpenTaskRequest(() => { woke++; });
  requestOpenTask({ requirementId: 'req_8', networkId: null });
  off();
  requestOpenTask({ requirementId: 'req_7', networkId: null });
  ck('开着的看板被叫醒;退订后不再叫', woke === 1);
  ck('没写网络 → 当前看板取最后一张', takeOpenTaskRequest('net') === 'req_7');
}

// —— 接线(源码级)——
{
  const detail = read('./TaskDetailPanel.tsx');
  ck('详情:参与人逐块锁(标题 / 主体 / 更多 / 其余),状态和检查项不锁', ['req-locked-title', 'req-locked-main', 'req-locked-more', 'req-locked-rest'].every(id => detail.includes(`<Locked on={partial} testID="${id}">`)) && detail.includes("pointerEvents={canColumn ? 'auto' : 'none'}") && detail.includes("pointerEvents={canChecklist ? 'auto' : 'none'}"));
  ck('详情:Locked 在模块级(组件里现定义会把输入框每次重挂)', /\nfunction Locked\(/.test(detail) && !/const Locked = /.test(detail));
  ck('详情:参与人不给「保存修改」(其余字段本来就改不了)', detail.includes('{readOnly ? null : ('));
  const board = read('./RequirementBoard.tsx');
  ck('看板:详情拿到 editFields', board.includes('editFields={selected.editFields}'));
  ck('看板:接「打开这张任务」条子(单卡窗口不接)', board.includes('takeOpenTaskRequest(cfg.networkId)') && board.includes('subscribeOpenTaskRequest(take)') && board.includes('if (single) return;'));
  const app = read('../App.tsx');
  ck('App:私信页三处 + 顶部提示两处都接 openTaskNotice', (app.match(/onOpenTask=\{id => openTaskNotice\(id, cfg, setScreen\)\}/g) ?? []).length === 5);
  const dm = read('./DmChatScreen.tsx');
  ck('私信气泡:任务通知画「查看任务 ›」', dm.includes('taskNoticeOf(item.meta_json)') && dm.includes('testID="dm-open-task"'));
  const toast = read('./DesktopMessageNotice.tsx');
  ck('顶部提示:任务通知点了打开任务', toast.includes('onOpenTask!(task.requirementId)') && toast.includes('desktop-message-open-task'));
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
