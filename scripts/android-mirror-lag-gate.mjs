#!/usr/bin/env node
// 安卓镜像落后闸门(CI 版):「发布 desktop-v<ver>」和「把 APK 推到 Android 镜像」是两步人工操作,
// 中间没有任何东西比对过。2026-11-09 实测:desktop-v0.2.497 已发布,而
// android/latest/VERSION 还停在 0.2.494 —— 应用内更新器读的就是这个指针,于是用户拿到的
// 是三个版本之前的包,而 CI 全绿。
//
// 这个脚本就是那道闸:
//   1. 取本仓最新**已发布** release(non-draft / non-prerelease)desktop-vX.Y.Z 的提交;
//   2. 从镜像**文件本身**读 android/latest/VERSION(匿名 GET,不用任何缓存副本);
//   3. 一致 → 一行结论,退出 0;
//   4. 不一致 → 找「head_sha == 该 release 提交」的**成功** android-build run(main 上);
//      没有就直接红,绝不从没验证过的构建里publish;
//   5. dispatch modelscope-android-publish.yml,**并证明真的出现了一个 run**
//      —— HTTP 204 只代表请求被接受,不代表 run 存在(见下方 🔴);
//   6. 确认之后再看镜像是否跟上(默认 20 分钟),跟不上就红,并且区分
//      「run 跑完了但镜像没动」与「run 还在跑,只是慢」。
//
// 🔴 为什么要「证明 run 出现」:2026-11-09 有人把 dispatch 发到了 fork
//    (tianma-ai/agent-network-app),HTTP 204、命令成功、**上游一个 run 都没有**,
//    大家以为已经发布了。204 不是证据,新的 run id 才是。所以先记下最新 run id,
//    dispatch 之后只认「id 更大的 run」。
//
// 用法:node scripts/android-mirror-lag-gate.mjs [--self-test]
//   GITHUB_TOKEN   必须有(workflow 里显式声明 actions: write + contents: read)
//   可选环境变量:
//     REPO / GITHUB_API_URL / MIRROR_BASE                           默认本仓 + api.github.com + ModelScope 匿名地址
//     DRY_RUN=1                                                     只报告、不 dispatch(人工核对时用)
//     DISPATCH_WAIT_SECONDS / MIRROR_WAIT_SECONDS / *_POLL_SECONDS  轮询预算(默认 300s / 1200s)
//
// 退出码:0 = 镜像已一致(或 dry-run 报告完)/ 1 = 上面 (a)~(d) 任一种 / 其它读取失败。
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDesktopVersions, parseDesktopTag } from './modelscope-mirror.mjs';

export const DEFAULT_REPOSITORY = 'sleep2agi/agent-network-app';
export const DEFAULT_MIRROR_BASE = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master';
export const BUILD_WORKFLOW = 'android-build.yml';
export const PUBLISH_WORKFLOW = 'modelscope-android-publish.yml';

// 🔴 per_page=100 在本仓 releases 列表上实测返回 `[]`(80 / 99 / 100 都是空,50 正常),
//    一个「空列表」会让下面的「最新 release」判定直接崩;50 是实测稳定的上限。
export const RELEASES_PAGE_SIZE = 50;
// 这个仓 release 数量上千,但**已发布**的 desktop 版本只会出现在最近几页里
// (草稿和已废弃的同版本号挤在前面)。3 页 = 150 条,足够覆盖。
export const RELEASES_MAX_PAGES = 3;

// ── 纯函数:版本 / release / run 的选择规则(单测直接打这些)────────────────────────

// 镜像里的 VERSION 是纯文本(可能带换行 / CRLF);任何不是 X.Y.Z 的内容都算读不到,
// 不能默认当成「匹配」。
export const parseMirrorVersion = (text) => {
  const value = String(text ?? '').trim();
  return /^\d+\.\d+\.\d+$/.test(value) ? value : null;
};

// 最新**已发布**的 desktop release。draft / prerelease 都不算,标签必须是 desktop-vX.Y.Z。
export const selectNewestPublishedRelease = (releases) => (Array.isArray(releases) ? releases : [])
  .filter((release) => release && !release.draft && !release.prerelease)
  .map((release) => ({ release, version: parseDesktopTag(release.tag_name) }))
  .filter((candidate) => candidate.version !== null)
  .sort((left, right) => compareDesktopVersions(right.version, left.version))[0]?.release ?? null;

// app#1430（0.2.530，2026-11-13）：release workflow 里的 trigger-android-mirror-gate 在**草稿阶段**就派发本闸，
// 那时「最新已发布」还是上一版。若安卓镜像已经领先（例如上一版桌面失败、APK 先发），旧逻辑会派发
// 上一版 APK，publish 侧的「只前进」保护拒绝回退，20 分钟后本闸判 [c] 红 —— 一次注定失败的派发 + 一个假红灯。
// 镜像比最新已发布 release 更新时：不派发、不判红，写明原因（真正的追平等 publish 之后的下一次比对）。
export const mirrorAheadOfRelease = (mirrorVersion, releaseVersion) => {
  const mirror = parseDesktopTag(`desktop-v${mirrorVersion}`);
  const release = parseDesktopTag(`desktop-v${releaseVersion}`);
  return !!mirror && !!release && compareDesktopVersions(mirror, release) > 0;
};

export const isSha = (value) => /^[0-9a-f]{40}$/.test(String(value ?? ''));

// tag 解引用:轻量 tag 直接是 commit,annotated tag 要再取一层。
export const tagCommitSha = (ref) => {
  if (!ref || !ref.object) return null;
  if (ref.object.type === 'commit') return ref.object.sha ?? null;
  return null; // annotated:调用方会用 object.sha 再查一次 /git/tags/<sha>
};

// release 指向的提交。target_commitish 是 40 位 sha 时以它为准并与 tag 互校;
// 否则(填的是分支名)只能用 tag 解引用的结果。
export const releaseCommit = (release, refSha) => {
  const target = String(release?.target_commitish ?? '');
  const sha = isSha(target) ? target : refSha;
  if (!isSha(sha)) return { sha: null, conflict: null };
  const conflict = isSha(target) && isSha(refSha) && target !== refSha
    ? { target, refSha }
    : null;
  return { sha, conflict };
};

// 「这个 release 提交有没有一个成功的 android-build run」。
// 只认 main 上、completed、conclusion=success 的;选 id 最大的那个。
export const selectBuildRun = (runs, sha) => {
  const all = (Array.isArray(runs) ? runs : []).filter((run) => run && run.head_sha === sha);
  const usable = all.filter((run) => run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success');
  usable.sort((left, right) => right.id - left.id);
  return { run: usable[0] ?? null, seen: all.length, newestConclusion: all.length ? (all.slice().sort((a, b) => b.id - a.id)[0].conclusion ?? 'unknown') : null };
};

// dispatch 之后「真的出现了一个 run」的唯一证据:出现 id 严格大于 dispatch 前最大 id 的 run。
export const selectNewerRun = (runs, baselineId) => (Array.isArray(runs) ? runs : [])
  .filter((run) => run && Number(run.id) > Number(baselineId))
  .sort((left, right) => right.id - left.id)[0] ?? null;

export const maxRunId = (runs) => (Array.isArray(runs) ? runs : [])
  .reduce((max, run) => (Number(run?.id) > max ? Number(run.id) : max), 0);

// ── 失败文案:人看到红灯就要知道是哪一种,所以每条都带 [a]/[b]/[c]/[d] 前缀 ────────
export const failureMessages = {
  // (a) release 提交上没有成功的 android-build —— 什么都不 dispatch。
  noBuildRun: ({ tag, sha, seen, newestConclusion }) => `MIRROR-GATE[a] NO-ANDROID-BUILD-RUN — release ${tag} (commit ${sha}) has no successful android-build run on main`
    + (seen === 0
      ? ': no run exists for that commit at all. Nothing was dispatched — the mirror must never be fed from a build nobody verified.'
      : `: ${seen} run(s) exist for that commit, newest concluded '${newestConclusion}'. Nothing was dispatched — the mirror must never be fed from a build nobody verified.`)
    + ` Fix: gh workflow run ${BUILD_WORKFLOW} --ref main -f commit=${sha} (or re-run the cancelled run); the hourly gate picks it up.`,
  // (b) dispatch 被接受了(204),但没有 run 出现 —— 最可能是发到了 fork。
  dispatchNoRun: ({ runId, sha, workflow, httpStatus, baselineId, newestId, waitedSeconds }) => `MIRROR-GATE[b] DISPATCH-PRODUCED-NO-RUN — dispatched ${workflow} with run_id=${runId}, commit=${sha}: the request was accepted (HTTP ${httpStatus}) but no new run appeared within ${waitedSeconds}s`
    + ` (newest run id before dispatch ${baselineId}, after ${newestId}). HTTP 204 only means the request was accepted — it is NOT evidence that a run exists.`
    + ' Check that the dispatch went to the repo whose Actions page shows the run (a fork answers 204 and creates nothing upstream) and that the token has actions:write.',
  // (c) run 出现了、也跑完了,但镜像没动 —— 发布本身失败。
  mirrorNotAdvanced: ({ runId, conclusion, mirrorVersion, version, url, waitedSeconds }) => `MIRROR-GATE[c] PUBLISH-RUN-DONE-MIRROR-NOT-ADVANCED — publish run ${runId} finished with conclusion '${conclusion}' but android/latest/VERSION is still ${mirrorVersion} after ${waitedSeconds}s (expected ${version}).`
    + ` The run exists and is not a dispatch problem — read its log: ${url}`,
  // (d) run 还在跑,只是比 20 分钟慢 —— 机制没坏,是还在地上跑。
  mirrorLagStillPublishing: ({ runId, status, mirrorVersion, version, url, waitedSeconds }) => `MIRROR-GATE[d] MIRROR-LAG-STILL-PUBLISHING — publish run ${runId} is still '${status}' after ${waitedSeconds}s, so the mirror is legitimately behind: android/latest/VERSION is ${mirrorVersion}, expected ${version}.`
    + ` Nothing is stuck in the gate (dispatch + run both confirmed) — the publish job is just slower than the wait budget. Watch it: ${url}`,
};

// ── 运行期 ─────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export const createClient = ({ apiBase, token, fetchImpl = fetch, userAgent = 'anet-android-mirror-gate' }) => {
  const call = async (method, path, body, timeoutMs = 30000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'x-github-api-version': '2022-11-28',
          'user-agent': userAgent,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, ok: response.ok, text };
    } finally {
      clearTimeout(timer);
    }
  };
  const json = async (method, path, body, timeoutMs) => {
    const result = await call(method, path, body, timeoutMs);
    if (!result.ok) throw new Error(`${method} ${path} → HTTP ${result.status} ${result.text.slice(0, 300)}`);
    return result.text ? JSON.parse(result.text) : {};
  };
  return { call, json };
};

const listReleases = async (json, repo) => {
  const collected = [];
  for (let page = 1; page <= RELEASES_MAX_PAGES; page += 1) {
    const batch = await json('GET', `/repos/${repo}/releases?per_page=${RELEASES_PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`releases page ${page} is not a list`);
    collected.push(...batch);
    if (batch.length < RELEASES_PAGE_SIZE) break;
  }
  return collected;
};

const resolveTagSha = async (json, repo, tag) => {
  const ref = await json('GET', `/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
  const direct = tagCommitSha(ref);
  if (direct) return direct;
  if (ref?.object?.type === 'tag') {
    const annotated = await json('GET', `/repos/${repo}/git/tags/${ref.object.sha}`);
    return annotated?.object?.sha ?? null;
  }
  return null;
};

const readMirrorVersion = async ({ mirrorBase, fetchImpl = fetch, attempts = 3, timeoutMs = 25000, wait = sleep }) => {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${mirrorBase}/android/latest/VERSION`, {
        headers: { 'user-agent': 'anet-android-mirror-gate', accept: 'text/plain' },
        signal: controller.signal,
      });
      const text = await response.text();
      const version = response.ok ? parseMirrorVersion(text) : null;
      if (version) return { version, httpStatus: response.status };
      last = `HTTP ${response.status} ${JSON.stringify(text.slice(0, 120))}`;
    } catch (error) {
      last = error?.message ?? String(error);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await wait(2000);
  }
  return { version: null, httpStatus: null, error: last };
};

// 整个闸门的流程。返回 { code, lines[] };CI 里 main() 负责打印 + 退出码,
// 单测里直接拿返回值断言(不需要联网)。
export const gate = async ({
  repo = DEFAULT_REPOSITORY,
  apiBase = 'https://api.github.com',
  mirrorBase = DEFAULT_MIRROR_BASE,
  token = '',
  dryRun = false,
  dispatchWaitSeconds = 300,
  dispatchPollSeconds = 15,
  mirrorWaitSeconds = 1200,
  mirrorPollSeconds = 20,
  fetchImpl = fetch,
  now = () => Date.now(),
  wait = sleep,
} = {}) => {
  const lines = [];
  const say = (line) => { lines.push(line); };
  if (!token) return { code: 1, lines: ['MIRROR-GATE: GITHUB_TOKEN is not set — this gate needs actions:write to dispatch the publish workflow.'] };
  const client = createClient({ apiBase, token, fetchImpl });
  const { json } = client;

  // 1. 最新已发布 release
  const release = selectNewestPublishedRelease(await listReleases(json, repo));
  if (!release) return { code: 1, lines: [`MIRROR-GATE: no published (non-draft, non-prerelease) desktop-vX.Y.Z release found in ${repo} — refusing to guess what "latest" means.`] };
  const tag = release.tag_name;
  const version = String(tag).slice('desktop-v'.length);
  const refSha = await resolveTagSha(json, repo, tag);
  const { sha, conflict } = releaseCommit(release, refSha);
  if (!sha) return { code: 1, lines: [`MIRROR-GATE: cannot resolve the commit of ${tag} (target_commitish='${release.target_commitish}', tag ref='${refSha ?? 'missing'}').`] };
  if (conflict) return { code: 1, lines: [`MIRROR-GATE: ${tag} points at ${conflict.refSha} but target_commitish is ${conflict.target} — the release moved; fix the release before trusting any APK.`] };
  say(`release  ${tag}  commit ${sha}  published ${release.published_at ?? 'unknown'}`);

  // 2. 镜像文件本身(匿名)
  const mirror = await readMirrorVersion({ mirrorBase, fetchImpl, wait });
  if (!mirror.version) return { code: 1, lines: [...lines, `MIRROR-GATE: android/latest/VERSION is unreadable anonymously from ${mirrorBase} (${mirror.error ?? 'not X.Y.Z'}) — cannot compare, so this is not a green.`] };
  say(`mirror   android/latest/VERSION ${mirror.version}`);

  // 3. 一致 → 一行结论
  if (mirror.version === version) {
    say(`OK  android mirror is in sync: ${version}`);
    return { code: 0, lines };
  }
  if (mirrorAheadOfRelease(mirror.version, version)) {
    say(`AHEAD  android mirror ${mirror.version} is newer than the newest published release ${version} — nothing to publish (the mirror only moves forward). `
      + `Usually the newer desktop release is still a draft; run this gate again after publishing it (app#1430).`);
    return { code: 0, lines };
  }
  say(`LAG  android mirror is ${mirror.version}, release is ${version}`);

  // 4. release 提交上成功的 android-build
  const runs = await json('GET', `/repos/${repo}/actions/workflows/${BUILD_WORKFLOW}/runs?head_sha=${sha}&per_page=50`);
  const { run: build, seen, newestConclusion } = selectBuildRun(runs?.workflow_runs, sha);
  if (!build) return { code: 1, lines: [...lines, failureMessages.noBuildRun({ tag, sha, seen, newestConclusion })] };
  say(`build    ${BUILD_WORKFLOW} run ${build.id} (success on main @ ${sha.slice(0, 8)})`);

  if (dryRun) {
    say(`DRY-RUN  would dispatch ${PUBLISH_WORKFLOW} with run_id=${build.id}, commit=${sha} — nothing was sent.`);
    return { code: 0, lines };
  }

  // 5. dispatch 之前先记下最新 run id:204 不算证据,只认「id 更大的新 run」
  const before = await json('GET', `/repos/${repo}/actions/workflows/${PUBLISH_WORKFLOW}/runs?per_page=20`);
  const baselineId = maxRunId(before?.workflow_runs);
  const dispatch = await client.call('POST', `/repos/${repo}/actions/workflows/${PUBLISH_WORKFLOW}/dispatches`, {
    ref: 'main',
    inputs: { run_id: String(build.id), commit: sha },
  });
  if (!dispatch.ok) {
    return { code: 1, lines: [...lines, `MIRROR-GATE: dispatch of ${PUBLISH_WORKFLOW} was rejected: HTTP ${dispatch.status} ${dispatch.text.slice(0, 300)} (nothing was published; check that the token has actions:write and the inputs are valid).`] };
  }
  say(`dispatch ${PUBLISH_WORKFLOW} run_id=${build.id} commit=${sha} → HTTP ${dispatch.status} (accepted, not yet proof)`);

  // 证明:轮询直到出现 id > baselineId 的 run
  const dispatchDeadline = now() + dispatchWaitSeconds * 1000;
  let confirmed = null;
  let newestId = baselineId;
  for (;;) {
    const after = await json('GET', `/repos/${repo}/actions/workflows/${PUBLISH_WORKFLOW}/runs?per_page=20`);
    confirmed = selectNewerRun(after?.workflow_runs, baselineId);
    newestId = maxRunId(after?.workflow_runs);
    if (confirmed) break;
    if (now() >= dispatchDeadline) break;
    await wait(dispatchPollSeconds * 1000);
  }
  if (!confirmed) {
    return {
      code: 1,
      lines: [...lines, failureMessages.dispatchNoRun({ runId: build.id, sha, workflow: PUBLISH_WORKFLOW, httpStatus: dispatch.status, baselineId, newestId, waitedSeconds: dispatchWaitSeconds })],
    };
  }
  say(`run      ${PUBLISH_WORKFLOW} run ${confirmed.id} appeared (${confirmed.status}) — dispatch proven`);

  // 6. 镜像是否跟上
  const mirrorDeadline = now() + mirrorWaitSeconds * 1000;
  let current = mirror.version;
  for (;;) {
    const after = await readMirrorVersion({ mirrorBase, fetchImpl, wait, attempts: 1 });
    if (after.version) current = after.version;
    if (after.version === version) {
      say(`OK  android mirror advanced to ${version} (was ${mirror.version}) — ${PUBLISH_WORKFLOW} run ${confirmed.id}`);
      return { code: 0, lines };
    }
    if (now() >= mirrorDeadline) break;
    await wait(mirrorPollSeconds * 1000);
  }
  const state = await json('GET', `/repos/${repo}/actions/runs/${confirmed.id}`);
  const url = state?.html_url ?? `https://github.com/${repo}/actions/runs/${confirmed.id}`;
  const stillRunning = state?.status === 'queued' || state?.status === 'in_progress' || state?.status === 'waiting' || state?.status === 'pending';
  const message = stillRunning
    ? failureMessages.mirrorLagStillPublishing({ runId: confirmed.id, status: state?.status ?? 'unknown', mirrorVersion: current, version, url, waitedSeconds: mirrorWaitSeconds })
    : failureMessages.mirrorNotAdvanced({ runId: confirmed.id, conclusion: state?.conclusion ?? 'unknown', mirrorVersion: current, version, url, waitedSeconds: mirrorWaitSeconds });
  return { code: 1, lines: [...lines, message] };
};

// ── self-test:不联网,只验选择规则(CI 里先跑这一步,再跑真闸)──────────────────────
const selfTest = () => {
  const fails = [];
  let total = 0;
  const expect = (name, condition) => { total += 1; if (!condition) fails.push(name); };
  const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, target_commitish: 'a'.repeat(40), ...extra });

  expect('mirror version accepts X.Y.Z with newline', parseMirrorVersion('0.2.497\n') === '0.2.497');
  expect('mirror version rejects HTML', parseMirrorVersion('<html>404</html>') === null);
  expect('mirror version rejects empty', parseMirrorVersion('  \n') === null);
  // app#1430：镜像领先 → 不派发；落后 / 相等 → 不算领先；数字按段比较，不按字符串。
  expect('mirror ahead: 0.2.529 vs release 0.2.528', mirrorAheadOfRelease('0.2.529', '0.2.528') === true);
  expect('mirror behind is not ahead', mirrorAheadOfRelease('0.2.528', '0.2.530') === false);
  expect('equal is not ahead', mirrorAheadOfRelease('0.2.530', '0.2.530') === false);
  expect('segment-wise compare: 0.2.10 is ahead of 0.2.9', mirrorAheadOfRelease('0.2.10', '0.2.9') === true);
  expect('unparsable never counts as ahead', mirrorAheadOfRelease('x', '0.2.9') === false);

  const newest = selectNewestPublishedRelease([
    release('desktop-v0.2.494'),
    release('desktop-v0.2.497'),
    release('desktop-v0.2.500', { draft: true }),
    release('desktop-v0.2.499', { prerelease: true }),
    { tag_name: 'mobile-v0.2.47', draft: false, prerelease: false },
    release('desktop-v0.2.490'),
  ]);
  expect('newest published = 0.2.497 (draft, prerelease and mobile-v ignored)', newest?.tag_name === 'desktop-v0.2.497');
  expect('no published release → null', selectNewestPublishedRelease([release('desktop-v1.0.0', { draft: true })]) === null);

  const tagSha = 'b'.repeat(40);
  expect('release commit from 40-hex target_commitish', releaseCommit({ target_commitish: tagSha }, tagSha).sha === tagSha);
  expect('release commit falls back to the tag when target_commitish is a branch', releaseCommit({ target_commitish: 'main' }, tagSha).sha === tagSha);
  expect('moved tag is a conflict, not a silent pick', releaseCommit({ target_commitish: tagSha }, 'c'.repeat(40)).conflict !== null);

  const run = (id, extra = {}) => ({ id, head_sha: tagSha, head_branch: 'main', status: 'completed', conclusion: 'success', ...extra });
  expect('build run: picks newest successful run on main',
    selectBuildRun([run(10), run(12), run(11, { conclusion: 'cancelled' })], tagSha).run?.id === 12);
  expect('build run: a failed newest run does not hide an older success',
    selectBuildRun([run(10), run(12, { conclusion: 'failure' })], tagSha).run?.id === 10);
  expect('build run: run from another branch is not usable',
    selectBuildRun([run(10, { head_branch: 'feature' })], tagSha).run === null);
  expect('build run: in-progress run is not usable',
    selectBuildRun([run(10, { status: 'in_progress', conclusion: null })], tagSha).run === null);
  expect('build run: reports how many runs existed and the newest conclusion',
    (() => { const r = selectBuildRun([run(10, { conclusion: 'cancelled' })], tagSha); return r.seen === 1 && r.newestConclusion === 'cancelled'; })());
  expect('build run: nothing at all → seen 0', selectBuildRun([], tagSha).seen === 0);

  expect('dispatch proof: only a strictly newer run id counts', selectNewerRun([run(100), run(101)], 100)?.id === 101);
  expect('dispatch proof: same newest id → no proof (204 alone is not evidence)', selectNewerRun([run(100)], 100) === null);
  expect('dispatch proof: empty list → no proof', selectNewerRun([], 100) === null);

  const a = failureMessages.noBuildRun({ tag: 'desktop-v0.2.497', sha: tagSha, seen: 0, newestConclusion: null });
  const a2 = failureMessages.noBuildRun({ tag: 'desktop-v0.2.497', sha: tagSha, seen: 2, newestConclusion: 'cancelled' });
  const b = failureMessages.dispatchNoRun({ runId: 1, sha: tagSha, workflow: PUBLISH_WORKFLOW, httpStatus: 204, baselineId: 9, newestId: 9, waitedSeconds: 300 });
  const c = failureMessages.mirrorNotAdvanced({ runId: 2, conclusion: 'failure', mirrorVersion: '0.2.494', version: '0.2.497', url: 'u', waitedSeconds: 1200 });
  const d = failureMessages.mirrorLagStillPublishing({ runId: 2, status: 'in_progress', mirrorVersion: '0.2.494', version: '0.2.497', url: 'u', waitedSeconds: 1200 });
  expect('(a) message names the release, the commit, the fix', a.includes('[a]') && a.includes('desktop-v0.2.497') && a.includes(tagSha) && a.includes('gh workflow run android-build.yml'));
  expect('(a) message distinguishes zero runs from failed runs', a.includes('no run exists') && a2.includes("concluded 'cancelled'"));
  expect('(b) message says 204 is not evidence and to check for a fork', b.includes('[b]') && b.includes('NOT evidence') && b.includes('HTTP 204'));
  expect('(b) message shows the ids that were compared', b.includes('before dispatch 9') && b.includes('after 9'));
  expect('(c) message carries the run conclusion and link', c.includes('[c]') && c.includes("conclusion 'failure'") && c.includes('still 0.2.494'));
  expect('(d) message says the run is still running, not stuck', d.includes('[d]') && d.includes("still 'in_progress'") && d.includes('legitimately behind'));
  expect('(c) and (d) are distinguishable by a reader', c !== d && !c.includes('[d]') && !d.includes('[c]'));

  if (fails.length) {
    for (const name of fails) console.log(`FAIL ${name}`);
    process.exit(1);
  }
  console.log(`android-mirror-lag gate self-test: ${total}/${total} passed`);
  process.exit(0);
};

const main = async () => {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const result = await gate({
    repo: process.env.REPO || DEFAULT_REPOSITORY,
    apiBase: (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    mirrorBase: (process.env.MIRROR_BASE || DEFAULT_MIRROR_BASE).replace(/\/+$/, ''),
    token: process.env.GITHUB_TOKEN || '',
    dryRun: process.env.DRY_RUN === '1',
    dispatchWaitSeconds: Number(process.env.DISPATCH_WAIT_SECONDS ?? 300),
    dispatchPollSeconds: Number(process.env.DISPATCH_POLL_SECONDS ?? 15),
    mirrorWaitSeconds: Number(process.env.MIRROR_WAIT_SECONDS ?? 1200),
    mirrorPollSeconds: Number(process.env.MIRROR_POLL_SECONDS ?? 20),
  });
  for (const line of result.lines) console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(summary, ['### android mirror gate', '```', ...result.lines, '```', ''].join('\n'));
  }
  const failure = result.lines.find((line) => line.includes('MIRROR-GATE'));
  if (result.code !== 0 && failure) console.log(`::error::${failure.replace(/\r?\n/g, ' ')}`);
  process.exit(result.code);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.log(`::error::${error.message}`);
    process.exit(1);
  });
}
