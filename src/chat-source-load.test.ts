import { readFileSync } from 'node:fs';
import { loadChatSources, mergeChatSource } from './chat-source-load';
import { createConversationRequestGate } from './conversation-store';
let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function main() {
  for (const fast of ['tasks', 'proactive']) {
    const task = deferred<string>(), proactive = deferred<string>();
    const painted: string[] = []; let done = false;
    const pending = loadChatSources({ tasks: () => task.promise, proactive: () => proactive.promise,
      isCurrent: () => true, onTasks: v => painted.push(v), onProactive: v => painted.push(v) }).then(r => { done = true; return r; });
    (fast === 'tasks' ? task : proactive).resolve(fast);
    await flush();
    ck(`${fast} paints without waiting for its peer`, painted.join() === fast);
    ck(`${fast} keeps poll in flight while peer pending`, !done);
    (fast === 'tasks' ? proactive : task).resolve('slow');
    ck(`${fast} peer eventually publishes`, (await pending).every(Boolean) && painted.join() === `${fast},slow`);
  }
  for (const fail of ['tasks', 'proactive']) {
    const painted: string[] = [];
    const read = async (name: string) => { if (name === fail) throw Error('unavailable'); return name; };
    const r = await loadChatSources({ tasks: () => read('tasks'), proactive: () => read('proactive'), isCurrent: () => true,
      onTasks: v => painted.push(v), onProactive: v => painted.push(v) });
    ck(`${fail} failure never publishes an empty replacement`, painted.length === 1 && painted[0] !== fail && r.filter(Boolean).length === 1);
  }
  const gate = createConversationRequestGate(), token = gate.open('network-A/agent');
  const late = deferred<string>(); const writes: string[] = [];
  const pending = loadChatSources({ tasks: () => late.promise, proactive: () => late.promise,
    isCurrent: () => gate.isCurrent(token), onTasks: v => writes.push(v), onProactive: v => writes.push(v) });
  gate.open('network-B/agent'); late.resolve('old network'); await pending;
  ck('late responses cannot write screen or cache after switching network', writes.length === 0);
  const rows = [
    { task_id: 'old-task', created_at: '2026-01-01T01:00:00Z' },
    { task_id: 'old-dm', _proactive: true, created_at: '2026-01-01T03:00:00Z' },
    { _localId: 'echo', created_at: '2026-01-01T04:00:00Z' },
  ];
  const tasks = [{ task_id: 'task', created_at: '2026-01-01T02:00:00Z' }];
  const one = mergeChatSource(rows, tasks, 'tasks');
  ck('task replacement retains proactive rows and local echoes', one.map(r => r.task_id || r._localId).join() === 'echo,old-dm,task');
  const two = mergeChatSource(one, [{ task_id: 'dm', _proactive: true, created_at: '2026-01-01T05:00:00Z' }], 'proactive');
  ck('proactive replacement retains tasks, echoes and chronological order', two.map(r => r.task_id || r._localId).join() === 'dm,echo,task');
  ck('repeated task refresh does not duplicate rows', mergeChatSource(two, tasks, 'tasks').length === 3);
  ck('successful empty source clears only that source', mergeChatSource(two, [], 'proactive').map(r => r.task_id || r._localId).join() === 'echo,task');
  const screen = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ck('screen invokes the tested parallel source loader', screen.includes('await loadChatSources({') && screen.includes("paint('tasks', rows, fetched, confirmed)") && screen.includes("paint('proactive', proactiveItemsForAgent("));
  ck('state updater rechecks ownership before cache and state writes', /setMessages\(prev => \{\s*if \(!isCurrent\(\)\) return prev;/.test(screen));
  ck('unread readiness waits for both successful reads, not first paint', screen.includes('if (results.every(Boolean)) setConversationReady(true)'));
  ck('older overlapping refresh cannot supersede newer issued read', screen.includes('sequence === loadSequenceRef.current'));
  console.log(`chat-source-load: ${p}/${n} passed`); if (p !== n) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
