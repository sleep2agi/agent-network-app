// #632 会话草稿存储:存 / 取 / 清、键隔离(账号 / Hub / 网络 / 会话)、上限与淘汰、去抖落盘、读-改-写合并、写失败重试。
import fs from 'node:fs';
import {
  createDraftStore, draftKey, draftPreview, enforceDraftLimits, hasDraftText, parseDraftBlob, serializeDraftBlob,
  DRAFT_PREVIEW_CHARS, MAX_DRAFT_CHARS, MAX_DRAFTS, type DraftBackend, type DraftMap,
} from './composer-draft-core';

let pass = 0;
let fail = 0;
const ck = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
};

// 手动时钟 + 手动计时器:去抖不靠真等。
const makeClock = () => {
  let t = 1_000;
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    now: () => t,
    tick: (ms = 1) => { t += ms; },
    setTimer: (fn: () => void) => { const h = ++id; timers.set(h, fn); return h; },
    clearTimer: (h: unknown) => { timers.delete(h as number); },
    fire: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach(f => f()); },
    pending: () => timers.size,
  };
};
const memBackend = (seed: DraftMap = {}) => {
  let blob = serializeDraftBlob(seed);
  let writes = 0;
  let failNext = 0;
  const b: DraftBackend & { blob: () => string; writes: () => number; failNext: (n: number) => void; poke: (m: DraftMap) => void } = {
    read: () => parseDraftBlob(blob),
    write: all => { if (failNext > 0) { failNext--; throw new Error('disk full'); } writes++; blob = serializeDraftBlob(all); },
    blob: () => blob,
    writes: () => writes,
    failNext: n => { failNext = n; },
    poke: m => { blob = serializeDraftBlob(m); },
  };
  return b;
};

const acct = { serverUrl: 'https://hub.example.com', username: 'tester', networkId: 'net-a' };
const kA = draftKey(acct, { kind: 'node', alias: '示例-A' });
const kB = draftKey(acct, { kind: 'node', alias: '示例-B' });

// ── 键隔离 ──
ck('不同会话不同键', kA !== kB);
ck('换账号不同键', kA !== draftKey({ ...acct, username: 'other' }, { kind: 'node', alias: '示例-A' }));
ck('换 Hub 不同键', kA !== draftKey({ ...acct, serverUrl: 'https://hub2.example.com' }, { kind: 'node', alias: '示例-A' }));
ck('换网络不同键', kA !== draftKey({ ...acct, networkId: 'net-b' }, { kind: 'node', alias: '示例-A' }));
ck('节点 / 私信 / 群 同名不同键', new Set([
  draftKey(acct, { kind: 'node', alias: 'x' }), draftKey(acct, { kind: 'dm', userId: 'x' }), draftKey(acct, { kind: 'group', groupId: 'x' }),
]).size === 3);
ck('Hub 地址末尾斜杠 / 大小写不影响键', kA === draftKey({ ...acct, serverUrl: 'https://HUB.example.com/' }, { kind: 'node', alias: '示例-A' }));
ck('分隔符注入不串键', draftKey({ ...acct, username: 'a|b' }, { kind: 'node', alias: 'c' }) !== draftKey({ ...acct, username: 'a' }, { kind: 'node', alias: 'b|c' }));
ck('没有用户名时退到 profileId', draftKey({ serverUrl: 'h', profileId: 'p1' }, { kind: 'node', alias: 'a' }) !== draftKey({ serverUrl: 'h', profileId: 'p2' }, { kind: 'node', alias: 'a' }));

// ── 存 / 取 / 清 + 去抖 ──
{
  const clock = makeClock();
  const disk = memBackend();
  const store = createDraftStore({ backend: disk, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  let notified = 0;
  store.subscribe(() => { notified++; });
  store.set(kA, '你好');
  store.set(kA, '你好,还没');
  store.set(kA, '你好,还没写完');
  ck('内存立刻可读', store.get(kA) === '你好,还没写完');
  ck('去抖:连敲三次只排一个计时器、还没写盘', clock.pending() === 1 && disk.writes() === 0);
  ck('去抖期间不通知列表', notified === 0);
  clock.fire();
  await store.flush();
  ck('计时器到点写一次盘', disk.writes() === 1, `writes=${disk.writes()}`);
  ck('盘上是最新的字', parseDraftBlob(disk.blob())[kA]?.t === '你好,还没写完');
  ck('写盘后通知列表', notified >= 1);

  // 重启:新 store 从盘上读回来
  const reborn = createDraftStore({ backend: disk });
  await reborn.hydrate();
  ck('重启后读回草稿', reborn.get(kA) === '你好,还没写完');
  ck('别的会话没有草稿', reborn.get(kB) === '');

  // flush 不等计时器
  store.set(kB, 'B 的草稿');
  await store.flush();
  ck('flush 立刻落盘(离开会话 / 退后台)', parseDraftBlob(disk.blob())[kB]?.t === 'B 的草稿' && clock.pending() === 0);

  // 清空输入框 = 删草稿
  store.set(kB, '   \n ');
  await store.flush();
  ck('只剩空白 = 删', store.get(kB) === '' && !(kB in parseDraftBlob(disk.blob())));
  store.remove(kA);
  await store.flush();
  ck('remove 删掉并落盘', store.get(kA) === '' && !(kA in parseDraftBlob(disk.blob())));
  const before = disk.writes();
  store.set(kA, '');
  await store.flush();
  ck('删一个本来就没有的不写盘', disk.writes() === before);
}

// ── 上限 ──
{
  const store = createDraftStore({ backend: memBackend(), setTimer: () => 0, clearTimer: () => {} });
  store.set(kA, 'x'.repeat(MAX_DRAFT_CHARS + 500));
  ck('单条截到 MAX_DRAFT_CHARS', store.get(kA).length === MAX_DRAFT_CHARS, `${store.get(kA).length}`);
  ck('MAX_DRAFTS = 500 / 单条 20000 字', MAX_DRAFTS === 500 && MAX_DRAFT_CHARS === 20_000);
}
{
  const clock = makeClock();
  const disk = memBackend();
  const store = createDraftStore({ backend: disk, maxDrafts: 3, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const keys = [1, 2, 3, 4, 5].map(i => draftKey(acct, { kind: 'node', alias: `n${i}` }));
  for (const k of keys) { store.set(k, `draft ${k.slice(-3)}`); clock.tick(10); }
  await store.flush();
  const saved = parseDraftBlob(disk.blob());
  ck('超出条数:只留最新 3 条', Object.keys(saved).length === 3 && keys.slice(2).every(k => k in saved), Object.keys(saved).join(','));
  ck('超出条数:最旧的被淘汰(内存也同步)', store.get(keys[0]) === '' && store.get(keys[1]) === '');
  // 改一下最旧的那条留下来的(keys[2])→ 它变成最新,再加一条时淘汰的是 keys[3]
  store.set(keys[2], 'touched'); clock.tick(10);
  store.set(draftKey(acct, { kind: 'node', alias: 'n6' }), 'six'); clock.tick(10);
  await store.flush();
  const after = parseDraftBlob(disk.blob());
  ck('按最后修改时间淘汰(刚改的不淘汰)', keys[2] in after && !(keys[3] in after), Object.keys(after).join(','));
}
{
  const limited = enforceDraftLimits({ a: { t: 'aaaa', at: 1 }, b: { t: 'bbbb', at: 2 }, c: { t: 'cc', at: 3 } }, { maxTotalChars: 6 });
  ck('总字数上限:从旧的删', Object.keys(limited).sort().join(',') === 'b,c');
}

// ── 两个窗口:读-改-写合并,不互相覆盖 ──
{
  const disk = memBackend();
  const w1 = createDraftStore({ backend: disk, setTimer: () => 0, clearTimer: () => {} });
  const w2 = createDraftStore({ backend: disk, setTimer: () => 0, clearTimer: () => {} });
  w1.set(kA, 'from window 1');
  await w1.flush();
  w2.set(kB, 'from window 2');
  await w2.flush();
  const both = parseDraftBlob(disk.blob());
  ck('分离聊天窗写自己的键,不抹掉主窗口的', both[kA]?.t === 'from window 1' && both[kB]?.t === 'from window 2');
  await w1.hydrate();
  ck('hydrate 读到另一个窗口的草稿', w1.get(kB) === 'from window 2');
  w1.set(kA, 'typed but not flushed');
  disk.poke({});
  await w1.hydrate();
  ck('hydrate 不盖掉本窗口还没落盘的字', w1.get(kA) === 'typed but not flushed');
}

// ── 写失败:留着下次再写 ──
{
  const disk = memBackend();
  const store = createDraftStore({ backend: disk, setTimer: () => 0, clearTimer: () => {} });
  disk.failNext(1);
  store.set(kA, 'keep me');
  await store.flush();
  ck('写失败时内存还在', store.get(kA) === 'keep me' && !(kA in parseDraftBlob(disk.blob())));
  await store.flush();
  ck('下次 flush 补写成功', parseDraftBlob(disk.blob())[kA]?.t === 'keep me');
}

// ── 盘上数据坏了 / 旧格式 ──
ck('坏 JSON → 空', Object.keys(parseDraftBlob('{oops')).length === 0);
ck('别的版本 → 空', Object.keys(parseDraftBlob(JSON.stringify({ v: 9, drafts: { a: { t: 'x', at: 1 } } }))).length === 0);
ck('空白条目读入时丢掉', Object.keys(parseDraftBlob(serializeDraftBlob({ a: { t: '  ', at: 1 }, b: { t: 'ok', at: 2 } }))).join() === 'b');

// ── 预览 ──
ck('hasDraftText', hasDraftText('a') && !hasDraftText(' \n') && !hasDraftText(null));
ck('预览:换行压成空格', draftPreview('第一行\n第二行') === '第一行 第二行');
const long = '一'.repeat(DRAFT_PREVIEW_CHARS + 10);
ck('预览:截断并加省略号', draftPreview(long) === `${'一'.repeat(DRAFT_PREVIEW_CHARS)}…`);
ck('预览:不切半个 emoji', !draftPreview('😀'.repeat(DRAFT_PREVIEW_CHARS + 1)).includes('�') && Array.from(draftPreview('😀'.repeat(DRAFT_PREVIEW_CHARS + 1))).length === DRAFT_PREVIEW_CHARS + 1);

// ── 接线(源码断言:两个会话页都接上了草稿钩子,列表画 [草稿];发失败不删)──
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const chat = read('./ChatScreen.tsx');
const dm = read('./DmChatScreen.tsx');
const list = read('./AgentsScreen.tsx');
const runtime = read('./composer-drafts.ts');
ck('ChatScreen 用 useComposerDraft(节点键)', /conversationDraftKey\(cfg, \{ kind: 'node', alias \}\)/.test(chat) && /useComposerDraft\(composerDraftKey, draft, setDraftState\)/.test(chat));
ck('DmChatScreen 用 useComposerDraft(私信 / 群键)', /kind: 'group', groupId/.test(dm) && /kind: 'dm', userId/.test(dm) && /useComposerDraft\(composerDraftKey, draft, setDraftState\)/.test(dm));
ck('私信 / 群:清空输入框前先押住草稿,结果出来再结算', /holdForSend\(draft\);\s*setDraft\(''\)/.test(dm) && /draftSettled\(await deliver\(/.test(dm));
ck('会话列表四种行都画 [草稿]', (list.match(/draftLine\(rowDraft/g) ?? []).length >= 6);
ck('退后台 / 关页面立刻落盘', /AppState\.addEventListener\('change'/.test(runtime) && /'pagehide'/.test(runtime) && /'beforeunload'/.test(runtime));
ck('离开 / 切会话时落盘(effect cleanup flush)', /return \(\) => \{ void composerDrafts\.flush\(\); \};/.test(runtime));

console.log(`composer draft store: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
