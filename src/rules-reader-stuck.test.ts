// 规则文件读取「一直转圈」回归 — run: bun src/rules-reader-stuck.test.ts
//
// 现场(2026-09-25,desktop 0.2.95 / hub .60 / grok agent-node .71):节点 1 秒内就答了(hub 上
// status=done),40 秒后界面还停在「正在向节点读取 AGENTS.md…」、「重新读取」灰着。
// 复现:第一次轮询的响应体卡住 → api.ts withTimeout 只管到响应头 → `await res.text()` 永不返回
// → 整条 await 链挂住,没有任何东西把加载态退掉(hub 行 done、first_read_at 为空)。
import { isTerminal, pollUntilTerminal, resultProblem, rulesErrorMessage, rulesMaxWaitMessage, rulesReadOutcome, rulesStatusMessage, RULES_HUB_STALE_MS, RULES_MAX_WAIT_MS, RULES_POLL_MAX_WAIT_MS, RULES_PURGED_MESSAGE } from './node-rules';
import { withDeadline } from './deadline';
// @ts-expect-error -- the app tsconfig has no node types; this test runs under bun, which has node:fs
import { readFileSync } from 'node:fs';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

// ── 终态:只有 pending / in_progress 算「还在等」 ──
ck('done/failed/timeout 是终态', isTerminal('done') && isTerminal('failed') && isTerminal('timeout'));
ck('pending/in_progress 不是终态', !isTerminal('pending') && !isTerminal('in_progress'));
ck('认不出的状态当终态(停下说清楚,不一直转)', isTerminal('expired') && isTerminal('cancelled') && isTerminal(''));
ck('缺 status 也当终态', isTerminal(undefined) && isTerminal(null));

// ── 兜底时长 ──
ck('区块兜底 > hub 60 秒陈旧门槛', RULES_MAX_WAIT_MS > RULES_HUB_STALE_MS, String(RULES_MAX_WAIT_MS));
ck('区块兜底 > 轮询自身上限(轮询先说出具体原因,兜底只接住卡死)', RULES_MAX_WAIT_MS > RULES_POLL_MAX_WAIT_MS);
ck('轮询上限 > hub 60 秒(hub 判 timeout 后还能再问到一次)', RULES_POLL_MAX_WAIT_MS > RULES_HUB_STALE_MS);
ck('兜底文案给出「重新读取」', /重新读取/.test(rulesMaxWaitMessage()) && rulesMaxWaitMessage().includes(String(RULES_MAX_WAIT_MS / 1000)));

// ── 终态结果里不能当内容用的几种 ──
const done = { ok: true as const, request_id: 'rf_1', op: 'read' as const, status: 'done', file_name: 'AGENTS.md', exists: true, error: null, age_ms: 5 };
ck('content_purged → 「内容已过期」+ 重新读取(只看旗,不靠「缺 content」兜住)', resultProblem({ ...done, content: 'x', content_purged: true }) === RULES_PURGED_MESSAGE && /内容已过期/.test(RULES_PURGED_MESSAGE) && /重新读取/.test(RULES_PURGED_MESSAGE));
ck('done 但没有 content(读)→ 当作过期,不当空文件', resultProblem({ ...done }) === RULES_PURGED_MESSAGE);
ck('done 有 content → 没问题', resultProblem({ ...done, content: '# x' }) === null);
ck('done 空串 content(文件是空的)→ 没问题', resultProblem({ ...done, content: '' }) === null);
ck('写操作 done 本来就没有 content → 没问题', resultProblem({ ...done, op: 'write' }) === null);
ck('failed/timeout 交给各区块自己的文案', resultProblem({ ...done, status: 'failed' }) === null && resultProblem({ ...done, status: 'timeout' }) === null);
ck('request_not_found → 一句中文 + 重新读取', /找不到这次请求/.test(resultProblem({ ok: false, error: 'request_not_found' }) ?? '') && /重新读取/.test(rulesErrorMessage('request_not_found')));
ck('认不出的状态 → 带上状态名', (resultProblem({ ...done, status: 'expired' }) ?? '').includes('expired'));
ck('本地卸载的 cancelled 不显示', rulesErrorMessage('cancelled') === '');
ck('rulesStatusMessage 对认不出的状态不再返回 undefined', typeof rulesStatusMessage({ op: 'read', status: 'weird' as any, error: null, exists: null, file_name: null }) === 'string' && rulesStatusMessage({ op: 'read', status: 'weird' as any, error: null, exists: null, file_name: null }).length > 0);

// ── 读取终局 → 区块显示什么 ──
{
  const purged = rulesReadOutcome({ ...done, content_purged: true });
  ck('purged → problem(不进编辑器)', purged.kind === 'problem' && purged.message === RULES_PURGED_MESSAGE);
  const ok = rulesReadOutcome({ ...done, content: '# 规则' });
  ck('有内容 → content', ok.kind === 'content' && ok.content === '# 规则' && ok.fileName === 'AGENTS.md');
  const missing = rulesReadOutcome({ ...done, exists: false, content: '' });
  ck('文件不存在 → content 空 + 「保存后会新建」', missing.kind === 'content' && missing.content === '' && /新建/.test(missing.message));
  const failed = rulesReadOutcome({ ...done, status: 'failed', error: 'EACCES' });
  ck('failed → problem 带原因', failed.kind === 'problem' && /EACCES/.test(failed.message));
  const timeout = rulesReadOutcome({ ...done, status: 'timeout' });
  ck('timeout → problem 超时文案', timeout.kind === 'problem' && /60 秒/.test(timeout.message));
  const unknown = rulesReadOutcome({ ...done, status: 'expired', content: 'stale' });
  ck('认不出的状态 → problem(即便带着 content 也不用)', unknown.kind === 'problem' && unknown.message.includes('expired'));
  const nf = rulesReadOutcome({ ok: false, error: 'request_not_found' });
  ck('request_not_found → problem', nf.kind === 'problem' && /找不到/.test(nf.message));
  const netErr = rulesReadOutcome({ ok: false, error: 'HTTP 500' });
  ck('其他错误原样带出', netErr.kind === 'problem' && netErr.message === 'HTTP 500');
}

// ── withDeadline ──
{
  const hung = await withDeadline(new Promise<string>(() => {}), 20, () => 'fallback');
  ck('withDeadline:永不返回的 Promise → 到点给 fallback', hung === 'fallback');
  const fast = await withDeadline(Promise.resolve('v'), 1000, () => 'fallback');
  ck('withDeadline:按时返回的值原样给', fast === 'v');
}

// ── 轮询循环 ──
type R = { ok: boolean; status?: string; error?: string; transient?: boolean; content?: string };
const fakeClock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };
const script = (steps: Array<() => Promise<R>>) => { let i = 0; const calls = () => i; const poll = () => (steps[Math.min(i++, steps.length - 1)])(); return { poll, calls }; };
const base = { nextDelayMs: () => 700, isTerminal };
{
  // 现场形状:第一次轮询卡住(响应体不返回),节点其实早答了。
  const c = fakeClock();
  const s = script([() => new Promise<R>(() => {}), async () => ({ ok: true, status: 'done', content: '# x' })]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c, callDeadlineMs: 20 });
  ck('一次轮询卡住 → 不挂住,下一次拿到 done', r.ok && (r as R).status === 'done' && s.calls() === 2, JSON.stringify(r));
}
{
  const c = fakeClock();
  const s = script([() => new Promise<R>(() => {})]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c, callDeadlineMs: 5, maxWaitMs: 3_000 });
  ck('每次都卡住 → 到上限返回错误(不是永远 await)', !r.ok && /超时/.test((r as R).error ?? '') && /没有响应/.test((r as R).error ?? ''), JSON.stringify(r));
}
{
  const c = fakeClock();
  const s = script([async () => ({ ok: false, error: 'fetch failed', transient: true }), async () => ({ ok: true, status: 'done', content: '' })]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c });
  ck('网络类错误(transient)→ 继续问', r.ok && s.calls() === 2);
}
{
  const c = fakeClock();
  const s = script([async () => ({ ok: false, error: 'request_not_found' }), async () => ({ ok: true, status: 'done' })]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c });
  ck('request_not_found → 立即返回', !r.ok && (r as R).error === 'request_not_found' && s.calls() === 1);
}
{
  const c = fakeClock();
  const s = script([async () => ({ ok: true, status: 'expired' })]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c });
  ck('认不出的状态 → 第一次就停(不再转 70 秒)', r.ok && (r as R).status === 'expired' && s.calls() === 1 && c.now() === 0);
}
{
  const c = fakeClock();
  const s = script([async () => ({ ok: true, status: 'pending' })]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c, maxWaitMs: 10_000 });
  ck('一直 pending → 到上限返回超时', !r.ok && (r as R).error === '等待节点响应超时' && c.now() <= 10_000 + 700);
}
{
  const c = fakeClock();
  const s = script([async () => { throw new Error('boom'); }, async () => ({ ok: true, status: 'done', content: 'x' })]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c });
  ck('poll 抛异常 → 不中断循环', r.ok && s.calls() === 2);
}
{
  const c = fakeClock();
  let cancel = false;
  const s = script([async () => { cancel = true; return { ok: true, status: 'pending' }; }]);
  const r = await pollUntilTerminal(s.poll, { ...base, ...c, isCancelled: () => cancel });
  ck('卸载/被新一次读取取代 → cancelled', !r.ok && (r as R).error === 'cancelled' && s.calls() === 1);
}

// ── 接线(源码层钉住;行为另由 Playwright + 一次性 hub 验证) ──
{
  const sec = readFileSync(new URL('./NodeRulesSection.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  const skills = readFileSync(new URL('./NodeSkillsSection.tsx', import.meta.url), 'utf8');
  const files = readFileSync(new URL('./NodeFilesSection.tsx', import.meta.url), 'utf8');
  const code = (s: string) => s.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ck('读取走 rulesReadOutcome(purged 不进编辑器)', /rulesReadOutcome\(res, support\)/.test(sec));
  ck('读取路径不再有 `res.content ?? \'\'`', !/res\.content \?\? ''/.test(code(sec)));
  ck('区块有独立于 await 链的兜底计时器', /setTimeout\([\s\S]{0,300}RULES_MAX_WAIT_MS\)/.test(sec) && /rulesMaxWaitMessage\(\)/.test(sec));
  ck('读取有代数守卫(晚到的结果不改界面)', /const gen = \+\+readGen\.current/.test(sec) && /gen !== readGen\.current/.test(sec));
  ck('挂载标志在 effect 里复位(不是只置一次的 cancelled)', /mounted\.current = true; return \(\) => \{ mounted\.current = false/.test(sec) && !/cancelled\.current = true/.test(code(sec)));
  ck('读取 try/catch:异常也退出加载态', /catch \(e\) \{\s*if \(stale\(\)\) return;\s*setPhase\('unavailable'\)/.test(sec));
  const hubTool = api.slice(api.indexOf('const callHubTool'), api.indexOf('const enqueueRulesFile'));
  ck('callHubTool 把响应体读取放在 withDeadline 里', /withDeadline\(\s*\(async \(\) => \{[\s\S]*await res\.text\(\)[\s\S]*\}\)\(\),\s*HUB_TOOL_DEADLINE_MS/.test(hubTool));
  ck('callHubTool 不在 deadline 外读 body', (code(hubTool).match(/res\.text\(\)/g) ?? []).length === 1);
  ck('waitForRulesFileResult 用 pollUntilTerminal', /pollUntilTerminal<RulesFileOutcome>\(\(\) => getRulesFileResult/.test(api));
  ck('技能区用 resultProblem(purged 不显示成 0 个技能)', (skills.match(/resultProblem\(res\)/g) ?? []).length === 2);
  ck('项目文件夹用 resultProblem', (files.match(/resultProblem\(res\)/g) ?? []).length === 2);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
