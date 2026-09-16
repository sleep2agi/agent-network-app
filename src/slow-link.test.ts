// 2026-09-16 Vincent:桌面端经 RELAY(~13 KB/s)连 hub,「消息被吞几秒」「历史很久才出来」。
import fs from 'node:fs';
import path from 'node:path';
import { nextPollDelay } from './poll-delay';
import { echoSupersededByFetched } from './chat-echo';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

ck('fast link keeps the nominal interval', nextPollDelay(10000, 300) === 10000);
ck('slow link backs off to 2× last duration', nextPollDelay(10000, 17000) === 34000);
ck('backoff is capped at 6× interval', nextPollDelay(10000, 120000) === 60000);
ck('zero duration → interval', nextPollDelay(5000, 0) === 5000);

const fetched = [{ task_id: 'T1', content: '你好', created_at: '2026-09-16T08:00:00Z' }];
ck('pending echo never yields', echoSupersededByFetched({ _localId: 'l1', _pending: true, _confirmedTaskId: 'T1' }, fetched) === false);
ck('confirmed echo yields once its task_id is fetched', echoSupersededByFetched({ _localId: 'l1', _confirmedTaskId: 'T1' }, fetched) === true);
ck('confirmed echo stays while its task_id is absent', echoSupersededByFetched({ _localId: 'l1', _confirmedTaskId: 'T9' }, fetched) === false);
ck('no id: same content within 6 min yields', echoSupersededByFetched({ _localId: 'l1', content: '你好 ', created_at: '2026-09-16T08:02:00Z' }, fetched) === true);
ck('no id: same content 10 min apart stays', echoSupersededByFetched({ _localId: 'l1', content: '你好', created_at: '2026-09-16T08:12:00Z' }, fetched) === false);
ck('no id: different content stays', echoSupersededByFetched({ _localId: 'l1', content: '再见', created_at: '2026-09-16T08:00:30Z' }, fetched) === false);

const chat = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8');
ck('send success marks the echo delivered instead of removing it', chat.includes("{ ...t, _pending: false, _confirmedTaskId: confirmedTaskId }") && !chat.includes("prev.filter(t => t._localId !== localId)"));
ck('load() drops echoes only once superseded by a fetched row', chat.includes('!echoSupersededByFetched(t, fetched)'));
const poll = fs.readFileSync(path.join(__dirname, 'usePoll.ts'), 'utf8');
ck('usePoll schedules the next tick after the previous one finishes', poll.includes('schedule(nextPollDelay(intervalMs, Date.now() - started))') && !poll.includes('setInterval('));
const cargo = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'Cargo.toml'), 'utf8');
ck('desktop HTTP plugin enables reqwest gzip', /tauri-plugin-http = \{ version = "2", features = \["gzip"\] \}/.test(cargo));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
