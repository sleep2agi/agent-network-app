// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/user-messages-window.test.ts
// 会话页 user_inbox 读:每拍 50 条并进手里的 200 条,结果必须和那一刻整读 200 条逐行相同。
import { readFileSync } from 'node:fs';
import {
  createUserMessagesWindow,
  mergeUserRows,
  pollOverlaps,
  USER_WINDOW_FULL,
  USER_WINDOW_POLL,
  USER_WINDOW_RESYNC_MS,
} from './user-messages-window';

let p = 0, t = 0;
const ck = (n: string, c: boolean, detail?: unknown) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, detail ?? ''); };

const T0 = Date.parse('2026-09-30T10:00:00Z');
const ts = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
let seq = 0;
const row = (at: number, from = 'A', kind = 'agent_message') => ({ message_id: `um-${String(++seq).padStart(6, '0')}`, from_session: from, kind, title: null, content: `m${seq}`, acked: 0, created_at: ts(at) });
type R = ReturnType<typeof row>;
// 假 hub:scope=user 的 SQL —— ORDER BY created_at DESC LIMIT n(同秒按 id 降序,与合并的次序一致)。
const hubPage = (rows: R[], limit: number) => [...rows].sort((a, b) => (a.created_at !== b.created_at ? (a.created_at < b.created_at ? 1 : -1) : a.message_id < b.message_id ? 1 : -1)).slice(0, limit);
const ids = (rows: readonly { message_id?: string }[]) => rows.map(r => r.message_id).join(',');

const a = row(T0), b = row(T0 + 1000), c = row(T0 + 2000);
ck('合并:按 id 去重、新→旧、留最新 cap 条', ids(mergeUserRows([a, b], [c, { ...b, acked: 1 }], 2)) === ids([c, b]));
ck('合并:新读到的同 id 行覆盖旧的', mergeUserRows([b], [{ ...b, acked: 1 }])[0].acked === 1);
ck('读到的不满 50 条 = 到底了,不会漏', pollOverlaps([], [a, b]));
ck('满 50 条且有一条是手里已有的 → 不漏', pollOverlaps([a], [a, ...Array.from({ length: 49 }, (_, i) => row(T0 + 10_000 + i))]));
ck('满 50 条全是没见过的 → 可能漏', !pollOverlaps([a], Array.from({ length: 50 }, (_, i) => row(T0 + 10_000 + i))));

// ── 等价性:模拟流量,每一拍的结果都和同一时刻整读 200 条逐行相同 ──
{
  const hub: R[] = [];
  let now = T0;
  for (let i = 0; i < 500; i++) hub.push(row(now - 86_400_000 + i * 60_000, `A${i % 6}`, i % 9 === 0 ? 'human_dm' : 'agent_message'));
  const w = createUserMessagesWindow();
  const limits: number[] = [];
  let bytesOld = 0, bytesNew = 0;
  let allEqual = true, firstDiff: unknown = null;
  let rng = 7;
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  for (let tick = 0; tick < 240; tick++) {
    const burst = tick === 100 ? 80 : rand() < 0.3 ? 1 + Math.floor(rand() * 3) : 0;
    for (let i = 0; i < burst; i++) hub.push(row(now + Math.floor(rand() * 5000), `A${Math.floor(rand() * 6)}`));
    now += 5000;
    const got = await w.read('k', async limit => { limits.push(limit); const page = hubPage(hub, limit); bytesNew += JSON.stringify(page).length; return { ok: true, messages: page }; }, now);
    const full = hubPage(hub, USER_WINDOW_FULL);
    bytesOld += JSON.stringify(full).length;
    if (ids(got.messages) !== ids(full)) { allEqual = false; firstDiff ??= { tick }; }
  }
  ck('240 拍(20 分钟,含一次 80 条突发):每一拍都与整读 200 条逐行相同', allEqual, firstDiff);
  const polls = limits.filter(l => l === USER_WINDOW_POLL).length;
  const fulls = limits.filter(l => l === USER_WINDOW_FULL).length;
  ck('整读只有:第一拍、突发后补的一次、每 10 分钟一次', fulls === 1 + 1 + Math.floor((240 * 5000 - 1) / USER_WINDOW_RESYNC_MS), { fulls, polls });
  ck(`传输量降到原来的 1/3 以下(原 ${bytesOld} B,现 ${bytesNew} B)`, bytesNew * 3 < bytesOld);
}

// ── 失败 / 换账号 ──
{
  const hub = [row(T0), row(T0 + 1000)];
  const w = createUserMessagesWindow();
  await w.read('k', async l => ({ messages: hubPage(hub, l) }), T0 + 2000);
  let threw = false;
  try { await w.read('k', async () => { throw new Error('HTTP 504'); }, T0 + 7000); } catch (e) { threw = (e as Error).message === 'HTTP 504'; }
  const seen: number[] = [];
  const after = await w.read('k', async l => { seen.push(l); return { messages: hubPage(hub, l) }; }, T0 + 12_000);
  ck('读失败 → 错误原样抛出;下一拍仍是 50 条的增量,手里的行没丢', threw && seen.join() === String(USER_WINDOW_POLL) && after.messages.length === 2);
  const other: number[] = [];
  await w.read('k2', async l => { other.push(l); return { messages: [] }; }, T0 + 17_000);
  ck('换了 hub / 账号 / 网络 → 整读 200 条', other.join() === String(USER_WINDOW_FULL));
}

// ── 接线:会话页走窗口读,人与人私信照旧剥掉 ──
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
ck('会话页不再每拍读 200 条,改走 fetchChatUserMessages', chat.includes('fetchChatUserMessages(cfg)') && !chat.includes('fetchUserMessages(cfg, 200)'));
ck('fetchChatUserMessages 在窗口合并之后剥私信(判断「有没有漏」用的是 hub 原始行)', /fetchChatUserMessages[\s\S]{0,400}chatUserWindow[\s\S]{0,300}\.then\(body => stripHumanDms\(/.test(api));

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
