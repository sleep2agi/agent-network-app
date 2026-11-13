// 安卓镜像落后闸门(scripts/android-mirror-lag-gate.mjs + .github/workflows/android-mirror-lag.yml)。
//
// 为什么要单测:这道闸平时的「绿」有两种——「真的同步了」和「判定逻辑坏了、什么都没比」。
// 2026-11-09 的 0.2.494/0.2.497 漂移发生时 CI 全绿,正是因为没有东西问过这个问题。
// 这里用 stub fetch 把 (a)~(d) 四种红灯、同步绿、dry-run 各跑一遍,顺便验 dispatch 的入参。
import { readFileSync } from 'node:fs';
import {
  PUBLISH_WORKFLOW,
  failureMessages,
  gate,
  maxRunId,
  parseMirrorVersion,
  releaseCommit,
  selectBuildRun,
  selectNewestPublishedRelease,
  selectNewerRun,
} from '../scripts/android-mirror-lag-gate.mjs';

let passed = 0;
const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
  console.log(`PASS: ${name}`);
};

const SHA = 'd0a9bd67ff1dceb6b264ee135ed6a9a4e40555fc';
const OLD = '0.2.494';
const NEW = '0.2.497';

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  target_commitish: SHA,
  published_at: '2026-11-09T23:54:18Z',
  ...extra,
});
const run = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  head_sha: SHA,
  head_branch: 'main',
  status: 'completed',
  conclusion: 'success',
  ...extra,
});

// ── 纯规则 ────────────────────────────────────────────────────────────────────────
check('mirror VERSION is read as plain text, CRLF tolerated', parseMirrorVersion('0.2.497\r\n') === NEW);
check('mirror VERSION that is not X.Y.Z is "unreadable", never "equal"',
  parseMirrorVersion('<html>404</html>') === null && parseMirrorVersion('') === null && parseMirrorVersion('v0.2.497') === null);

check('newest published = highest non-draft, non-prerelease desktop-vX.Y.Z',
  selectNewestPublishedRelease([
    release('desktop-v0.2.494'),
    release('desktop-v0.2.497'),
    release('desktop-v0.2.500', { draft: true }),
    release('desktop-v0.2.499', { prerelease: true }),
    { tag_name: 'mobile-v0.2.47', draft: false, prerelease: false, target_commitish: SHA },
  ])?.tag_name === 'desktop-v0.2.497');
check('no published desktop release → null (refuse to guess)', selectNewestPublishedRelease([release('desktop-v1.0.0', { draft: true })]) === null);

check('release commit comes from the 40-hex target_commitish', releaseCommit({ target_commitish: SHA }, SHA).sha === SHA);
check('release commit falls back to the tag when target_commitish is a branch',
  releaseCommit({ target_commitish: 'main' }, 'b'.repeat(40)).sha === 'b'.repeat(40));
check('a moved tag is a conflict instead of a silent pick', releaseCommit({ target_commitish: SHA }, 'c'.repeat(40)).conflict !== null);

check('build run: newest successful run on main wins',
  selectBuildRun([run(9), run(11), run(10, { conclusion: 'cancelled' })], SHA).run?.id === 11);
check('build run: an older success is not hidden by a newer failure',
  selectBuildRun([run(9), run(11, { conclusion: 'failure' })], SHA).run?.id === 9);
check('build run: another branch / in-progress / other commit are all unusable',
  selectBuildRun([run(9, { head_branch: 'feature' })], SHA).run === null
  && selectBuildRun([run(9, { status: 'in_progress', conclusion: null })], SHA).run === null
  && selectBuildRun([run(9, { head_sha: 'e'.repeat(40) })], SHA).run === null);
check('build run: reports how many runs existed and the newest conclusion',
  (() => { const r = selectBuildRun([run(9, { conclusion: 'cancelled' })], SHA); return r.seen === 1 && r.newestConclusion === 'cancelled'; })());

check('dispatch proof: only a strictly newer run id counts', selectNewerRun([run(100), run(101)], 100)?.id === 101);
check('dispatch proof: an unchanged newest id is not proof (204 alone means nothing)',
  selectNewerRun([run(100)], 100) === null && selectNewerRun([], 100) === null);
check('max run id baseline', maxRunId([{ id: 3 }, { id: 9 }, { id: 5 }]) === 9 && maxRunId([]) === 0);

// ── 端到端:stub fetch 跑整个闸门 ───────────────────────────────────────────────────
type Reply = { status?: number; body?: unknown };
// queueOrString: 依次返回数组里的值,用尽后一直返回最后一个(轮询到"不变"很自然)。
const take = <T,>(queue: T[] | undefined, fallback: T): T => {
  if (!queue || queue.length === 0) return fallback;
  return queue.length === 1 ? queue[0] : (queue.shift() as T);
};
const stub = (plan: {
  releases?: unknown[];
  refSha?: string;
  buildRuns?: unknown[];
  publishRuns?: unknown[][]; // 第 1 次 = dispatch 前的基线,之后 = 轮询
  dispatchStatus?: number;
  mirror: string[]; // android/latest/VERSION 的应答队列
  runState?: unknown;
}) => {
  const calls: string[] = [];
  const dispatches: any[] = [];
  let publishListCalls = 0;
  const reply = (r: Reply) => ({
    ok: (r.status ?? 200) < 300,
    status: r.status ?? 200,
    text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
  });
  const fetchImpl = async (url: string, init: any = {}) => {
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url.includes('/releases?')) return reply({ body: plan.releases ?? [] });
    if (url.includes('/git/ref/tags/')) return reply({ body: { object: { type: 'commit', sha: plan.refSha ?? SHA } } });
    if (url.includes('/android/latest/VERSION')) return reply({ body: take(plan.mirror, plan.mirror[plan.mirror.length - 1]) });
    if (url.includes('/actions/workflows/android-build.yml/runs')) return reply({ body: { workflow_runs: plan.buildRuns ?? [] } });
    if (url.includes(`/actions/workflows/${PUBLISH_WORKFLOW}/dispatches`)) {
      dispatches.push(JSON.parse(init.body));
      return reply({ status: plan.dispatchStatus ?? 204, body: '' });
    }
    if (url.includes(`/actions/workflows/${PUBLISH_WORKFLOW}/runs`)) {
      const lists = plan.publishRuns ?? [[]];
      const index = Math.min(publishListCalls, lists.length - 1);
      publishListCalls += 1;
      return reply({ body: { workflow_runs: lists[index] } });
    }
    if (url.includes('/actions/runs/')) return reply({ body: plan.runState ?? { status: 'completed', conclusion: 'success', html_url: 'https://x/run' } });
    throw new Error(`stub: unexpected ${method} ${url}`);
  };
  return { fetchImpl, calls, dispatches };
};

const base = {
  repo: 'o/r',
  apiBase: 'https://api.test',
  mirrorBase: 'https://mirror.test',
  token: 't',
  dispatchPollSeconds: 0.01,
  mirrorPollSeconds: 0.01,
  dispatchWaitSeconds: 0,
  mirrorWaitSeconds: 0,
  now: () => 0,
  wait: async () => {},
};

const buildRun = run(424242);

// 1) 一致 → 绿,不 dispatch
{
  const s = stub({ releases: [release('desktop-v0.2.497')], mirror: [`${NEW}\n`] });
  const result = await gate({ ...base, ...s });
  check('in sync → exit 0, one-line conclusion, no dispatch',
    result.code === 0 && s.dispatches.length === 0 && result.lines.some(l => l.startsWith('OK') && l.includes(NEW)));
}

// 1b) app#1430：镜像比最新已发布 release 新（新版本桌面还是草稿）→ 绿,不 dispatch,不去读 android-build
{
  const s = stub({ releases: [release('desktop-v0.2.528'), release('desktop-v0.2.530', { draft: true })], mirror: ['0.2.529\n'], buildRuns: [buildRun] });
  const result = await gate({ ...base, ...s });
  check('(app#1430) mirror ahead of newest published → exit 0, AHEAD line, no rollback dispatch',
    result.code === 0 && s.dispatches.length === 0
    && result.lines.some(l => l.startsWith('AHEAD') && l.includes('0.2.529') && l.includes('0.2.528'))
    && !s.calls.some(c => c.includes('/actions/workflows/android-build.yml/runs')));
}

// 2) (a) 落后但没有成功的 android-build run → 红,什么都不发
{
  const s = stub({ releases: [release('desktop-v0.2.497')], mirror: [OLD], buildRuns: [] });
  const result = await gate({ ...base, ...s });
  check('(a) mirror behind + no android-build run → red, no dispatch, message says so',
    result.code === 1 && s.dispatches.length === 0 && result.lines.some(l => l.includes('MIRROR-GATE[a] NO-ANDROID-BUILD-RUN')));
}
{
  const s = stub({ releases: [release('desktop-v0.2.497')], mirror: [OLD], buildRuns: [run(1, { conclusion: 'cancelled' })] });
  const result = await gate({ ...base, ...s });
  check('(a) an existing but failed run is reported as such, still no dispatch',
    result.code === 1 && s.dispatches.length === 0 && result.lines.some(l => l.includes("newest concluded 'cancelled'")));
}

// 3) (b) dispatch 204 但没有新 run → 红
{
  const s = stub({
    releases: [release('desktop-v0.2.497')], mirror: [OLD], buildRuns: [buildRun],
    publishRuns: [[run(500)]],
  });
  const result = await gate({ ...base, ...s });
  check('(b) dispatch accepted (204) but no new run → red, 204 explicitly called not-evidence',
    result.code === 1 && s.dispatches.length === 1
    && result.lines.some(l => l.includes('MIRROR-GATE[b] DISPATCH-PRODUCED-NO-RUN') && l.includes('NOT evidence')));
}

// 4) dispatch 入参正确 + 新 run 出现 + 镜像跟上 → 绿
{
  const s = stub({
    releases: [release('desktop-v0.2.497'), release('desktop-v0.2.494')], mirror: [OLD, NEW], buildRuns: [buildRun],
    publishRuns: [[run(500)], [run(501, { status: 'queued', conclusion: null })]],
  });
  const result = await gate({ ...base, ...s });
  check('dispatch carries exactly {run_id, commit} on ref main',
    s.dispatches.length === 1 && s.dispatches[0].ref === 'main'
    && s.dispatches[0].inputs.run_id === '424242' && s.dispatches[0].inputs.commit === SHA
    && Object.keys(s.dispatches[0].inputs).sort().join() === 'commit,run_id');
  check('new run id > baseline id → dispatch proven, mirror advanced → exit 0',
    result.code === 0 && result.lines.some(l => l.includes('dispatch proven')) && result.lines.some(l => l.includes(`advanced to ${NEW}`)));
}

// 5) (d) 新 run 出现但还在跑、镜像没跟上 → 红,但文案说是"还在发布"
{
  const s = stub({
    releases: [release('desktop-v0.2.497')], mirror: [OLD], buildRuns: [buildRun],
    publishRuns: [[run(500)], [run(501, { status: 'in_progress', conclusion: null })]],
    runState: { status: 'in_progress', conclusion: null, html_url: 'https://x/run/501' },
  });
  const result = await gate({ ...base, ...s });
  check('(d) run confirmed but still running at the deadline → red with "still publishing", not a dispatch problem',
    result.code === 1 && result.lines.some(l => l.includes('MIRROR-GATE[d] MIRROR-LAG-STILL-PUBLISHING') && l.includes('https://x/run/501')));
}

// 6) (c) run 跑完了、镜像没动 → 红,文案指向 run 日志
{
  const s = stub({
    releases: [release('desktop-v0.2.497')], mirror: [OLD], buildRuns: [buildRun],
    publishRuns: [[run(500)], [run(501)]],
    runState: { status: 'completed', conclusion: 'failure', html_url: 'https://x/run/501' },
  });
  const result = await gate({ ...base, ...s });
  check('(c) run finished (failure) and mirror unchanged → red with the conclusion and the link',
    result.code === 1 && result.lines.some(l => l.includes('MIRROR-GATE[c] PUBLISH-RUN-DONE-MIRROR-NOT-ADVANCED') && l.includes("conclusion 'failure'")));
}

// 7) dry-run 只报告
{
  const s = stub({ releases: [release('desktop-v0.2.497')], mirror: [OLD], buildRuns: [buildRun] });
  const result = await gate({ ...base, ...s, dryRun: true });
  check('dry run never dispatches and says what it would have sent',
    result.code === 0 && s.dispatches.length === 0 && result.lines.some(l => l.includes('DRY-RUN') && l.includes('424242')));
}

// 8) 镜像读不到 → 不是绿
{
  const s = stub({ releases: [release('desktop-v0.2.497')], mirror: ['<html>oops</html>'] });
  const result = await gate({ ...base, ...s });
  check('unreadable mirror VERSION → red (never treated as equal)',
    result.code === 1 && result.lines.some(l => l.includes('unreadable anonymously')));
}

// 9) 缺 token → 立刻红(而不是当成"没落后")
{
  const result = await gate({ ...base, token: '' });
  check('missing GITHUB_TOKEN → red with an explicit message', result.code === 1 && result.lines[0].includes('GITHUB_TOKEN'));
}

// ── 失败文案必须能互相区分 ─────────────────────────────────────────────────────────
check('the four failure messages are distinct and self-labelled',
  [failureMessages.noBuildRun({ tag: 'desktop-v0.2.497', sha: SHA, seen: 0, newestConclusion: null }),
    failureMessages.dispatchNoRun({ runId: 1, sha: SHA, workflow: PUBLISH_WORKFLOW, httpStatus: 204, baselineId: 1, newestId: 1, waitedSeconds: 300 }),
    failureMessages.mirrorNotAdvanced({ runId: 1, conclusion: 'failure', mirrorVersion: OLD, version: NEW, url: 'u', waitedSeconds: 1200 }),
    failureMessages.mirrorLagStillPublishing({ runId: 1, status: 'in_progress', mirrorVersion: OLD, version: NEW, url: 'u', waitedSeconds: 1200 })]
    .every((m, index) => m.startsWith(`MIRROR-GATE[${'abcd'[index]}]`)));

// ── workflow 文件本身 ─────────────────────────────────────────────────────────────
// 🔴 必须先规范化换行：Windows runner 默认 core.autocrlf=true，检出的是 CRLF，
//    而下面这些断言用的是 `\n` 锚定的正则与 indexOf('…\n')。不规范化的话，
//    同一份 YAML 在 linux 上绿、在 windows 上红 —— 那不是代码坏了，是读取方式没对齐
//    （2026-11-10 实测：unit-tests (windows-latest) 只因这一条红）。
const toLf = (text: string) => text.replace(/\r\n/g, '\n');
const workflow = toLf(readFileSync(new URL('../.github/workflows/android-mirror-lag.yml', import.meta.url), 'utf8'));
const script = toLf(readFileSync(new URL('../scripts/android-mirror-lag-gate.mjs', import.meta.url), 'utf8'));
check('workflow: hourly schedule + manual dispatch',
  /schedule:\n(?:[ \t]*#[^\n]*\n)*[ \t]*- cron: '\d+ \* \* \* \*'/.test(workflow) && workflow.includes('workflow_dispatch:'));
check('workflow: permissions are exactly actions:write + contents:read',
  /permissions:\s*\n\s*actions: write\s*\n\s*contents: read/.test(workflow));
check('workflow: dispatch-only-from-main guard (this workflow really publishes)',
  workflow.includes("if: github.ref == 'refs/heads/main'"));
check('workflow: own concurrency group, nothing gets replaced mid-publish',
  /concurrency:\s*\n\s*group: android-mirror-lag-gate\s*\n\s*cancel-in-progress: false/.test(workflow));
check('workflow: every `uses:` pinned to a full commit SHA',
  [...workflow.matchAll(/uses:\s*(\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])));
check('workflow: runs the offline self-test before the live gate',
  workflow.indexOf('--self-test') > 0 && workflow.indexOf('--self-test') < workflow.indexOf('node scripts/android-mirror-lag-gate.mjs\n'));
check('workflow: GITHUB_TOKEN comes from github.token via env only', workflow.includes('GITHUB_TOKEN: ${{ github.token }}'));
check('workflow: no other secret is referenced', !/secrets\./.test(workflow));
check('script: releases listing uses the 50-per-page constant (per_page=100 answers [] in this repo)',
  script.includes('export const RELEASES_PAGE_SIZE = 50;') && script.includes('per_page=${RELEASES_PAGE_SIZE}'));

console.log(`\n${passed}/${passed} passed`);
