// 轮询读 / 需求池读的硬上限 + 连接横幅口径 — run: bun src/read-deadline.test.ts
//
// 现场(2026-09-29,Vincent 折叠屏 0.2.142):任务页在「无法连接服务器」横幅下面一直转圈。
// 需求池的请求没有任何超时,轮询读的超时只管到响应头 —— 响应体卡在半开连接上时永远不返回。
import { readFileSync } from 'node:fs';
import { __setReadDeadlineForTest, fetchHubNodes } from './api';
import { __resetConnectivityForTest, connectivityState } from './connectivity';
import { __setRequirementsDeadlineForTest, listProjects, listRequirements, probeAgentOwnerSupport, RequirementsHubError, REQUIREMENTS_TIMEOUT_TEXT } from './requirements-hub';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };
const cfg = { serverUrl: 'http://hub.local', token: 't', username: 'u', networkId: 'net', profileId: 'p' };
const never = () => new Promise<never>(() => {});
const settle = async <T>(pr: Promise<T>) => {
  const started = Date.now();
  try { return { ok: true as const, value: await pr, ms: Date.now() - started }; }
  catch (error) { return { ok: false as const, error, ms: Date.now() - started }; }
};
const g = globalThis as { fetch: unknown };
const realFetch = g.fetch;
const respond = (status: number, json: () => Promise<unknown>) => { g.fetch = async () => ({ ok: status >= 200 && status < 300, status, json }); };

__setReadDeadlineForTest(150);
__setRequirementsDeadlineForTest(150);

// ── 轮询读(api.ts get) ──
__resetConnectivityForTest();
respond(200, never);
{
  const r = await settle(fetchHubNodes(cfg));
  ck('🔴 响应体卡住:到截止时间就失败,不永远 await', !r.ok && r.ms < 1_000, `${r.ms}ms`);
  ck('卡住算一次连接失败(数据没到)', connectivityState().consecutiveFailures === 1);
  ck('报错说清楚是超时', !r.ok && /秒内没有返回完整响应/.test(String((r.error as Error).message)));
}
__resetConnectivityForTest();
g.fetch = never;
{
  const r = await settle(fetchHubNodes(cfg));
  ck('🔴 连响应头都不来:同样到点失败', !r.ok && r.ms < 1_000, `${r.ms}ms`);
}
__resetConnectivityForTest();
respond(403, async () => ({}));
{
  const r = await settle(fetchHubNodes(cfg));
  ck('403:调用方照样拿到错误', !r.ok);
  ck('🔴 403 是 hub 自己答的:不算「连不上」', connectivityState().consecutiveFailures === 0 && connectivityState().lastSuccessAt === null);
}
__resetConnectivityForTest();
respond(504, async () => ({}));
{
  await settle(fetchHubNodes(cfg));
  ck('504(入口层够不着 hub):算连不上', connectivityState().consecutiveFailures === 1);
}
__resetConnectivityForTest();
respond(200, async () => ({ nodes: [] }));
{
  const r = await settle(fetchHubNodes(cfg));
  ck('200:成功,记下最后成功时刻', r.ok && connectivityState().lastSuccessAt !== null && connectivityState().consecutiveFailures === 0);
}

// ── 需求池(requirements-hub call) ──
g.fetch = never;
{
  const r = await settle(listRequirements(cfg));
  ck('🔴 需求池请求卡住:到点失败(任务页不再永远转圈)', !r.ok && r.ms < 1_000, `${r.ms}ms`);
  ck('需求池超时是 RequirementsHubError(不是 404「不支持」)', !r.ok && r.error instanceof RequirementsHubError && (r.error as RequirementsHubError).status !== 404);
  ck('需求池超时文案', !r.ok && (r.error as Error).message === REQUIREMENTS_TIMEOUT_TEXT);
}
respond(200, never);
{
  const r = await settle(listRequirements(cfg));
  ck('需求池响应体卡住:同样到点失败', !r.ok && r.ms < 1_000, `${r.ms}ms`);
}
g.fetch = never;
{
  const probe = await settle(probeAgentOwnerSupport(cfg));
  ck('🔴 首次加载路径上的能力探针卡住:到点按旧 Hub 处理(false),不挂住看板', probe.ok && probe.value === false && probe.ms < 1_000, `${probe.ms}ms`);
  const projects = await settle(listProjects(cfg));
  ck('🔴 首次加载路径上的项目列表卡住:到点失败(看板那边 .catch 成没有项目)', !projects.ok && projects.ms < 1_000, `${projects.ms}ms`);
}
respond(200, async () => ({ requirements: [{ id: 'r1', name: '甲' }] }));
__resetConnectivityForTest();
{
  const r = await settle(listRequirements(cfg));
  ck('需求池正常返回不受影响', r.ok && r.value.length === 1);
  ck('需求池读成功也记进连接横幅(任务页主要轮询这一路)', connectivityState().lastSuccessAt !== null);
}
__resetConnectivityForTest();
g.fetch = never;
{
  await settle(listRequirements(cfg));
  ck('需求池读超时记为一次连接失败', connectivityState().consecutiveFailures === 1);
}
__resetConnectivityForTest();
respond(404, async () => ({}));
{
  await settle(listRequirements(cfg));
  ck('需求池 404(旧 Hub 没这个接口)不算连不上', connectivityState().consecutiveFailures === 0);
}
g.fetch = realFetch;

// ── 页面层:任务页不会停在转圈 / 失败后自己再试 / 有缓存就显示缓存 ──
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const board = norm('./RequirementBoard.tsx');
ck('首次加载失败后跟着轮询自动重试', board.includes("if (phase === 'error') { setReloadKey(n => n + 1); return; }"));
ck('重试时停在错误页(不在错误和转圈之间闪)', board.includes("setPhase(p => (p === 'error' ? p : 'loading'));"));
ck('连不上但有上次数据:显示数据,不整页报错', board.includes("phase === 'error' && !(hasCached || (mine && items.length))"));
const poll = norm('./usePoll.ts');
ck('usePoll 失败时指数退避', poll.includes('pollBackoffMs(intervalMs)'));
ck('usePoll 收到「立即重试」就跑一轮', poll.includes('subscribeReconnect('));

console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
