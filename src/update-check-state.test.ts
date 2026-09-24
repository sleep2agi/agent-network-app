import { atLeast, describeUpdateRow, formatCheckedAt, updateErrorReason } from './update-check-state';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };

const now = Date.UTC(2026, 8, 24, 3, 40);
const cur = '0.2.86';

// no update → the row names the current version and when it was checked (not the same bare text as before)
const latest = describeUpdateRow({ kind: 'up-to-date' }, { currentVersion: cur, lastCheckedAt: now - 5_000, now });
ck('up-to-date names the installed version', latest.label === '已是最新版本 v0.2.86');
ck('up-to-date says it was just checked', latest.detail === '刚刚检查');
ck('up-to-date is clickable again', latest.actionable && !latest.busy);

// update available → new-version state with the new version
const avail = describeUpdateRow({ kind: 'available', version: '0.2.87', notes: '' }, { currentVersion: cur, now });
ck('available names the new version', avail.label === '发现新版本 v0.2.87' && avail.tone === 'accent');

// error → failed state with a readable reason and retry
const failed = describeUpdateRow({ kind: 'error', message: 'error sending request: network unreachable' }, { currentVersion: cur, now });
ck('error shows a readable reason', failed.label === '检查更新失败：网络不通' && failed.tone === 'danger');
ck('error offers retry', failed.detail === '点击重试' && failed.actionable);

// checking → busy + not clickable (no double-click races)
const checking = describeUpdateRow({ kind: 'checking' }, { currentVersion: cur, now });
ck('checking is busy and not clickable', checking.busy && !checking.actionable && checking.label === '检查中…');

// unsupported → explains instead of pretending to be a button
const unsupported = describeUpdateRow({ kind: 'unsupported' }, { currentVersion: cur, now });
ck('unsupported explains and is not clickable', unsupported.label === '当前环境不支持自动更新' && !unsupported.actionable);

// reasons
ck('reason: 404', updateErrorReason('Could not fetch a valid release JSON from the remote: status 404 Not Found') === '更新地址不可用（404）');
ck('reason: signature', updateErrorReason('The signature verification failed') === '更新包签名校验失败');
ck('reason: timeout', updateErrorReason('operation timed out') === '连接超时');
ck('reason: parse', updateErrorReason('failed to deserialize update response: expected value') === '更新清单格式错误');
ck('reason: empty', updateErrorReason('') === '未知错误');
ck('reason: long unknown is truncated', updateErrorReason('x'.repeat(200)).length === 58);

// checked-at formatting
ck('checked 5 min ago', formatCheckedAt(now - 5 * 60_000, now) === '5 分钟前检查');
ck('never checked → no detail', formatCheckedAt(undefined, now) === undefined);

// atLeast keeps the busy state visible for minMs when the result is instant
{
  let clock = 0; const slept: number[] = [];
  const deps = { now: () => clock, sleep: async (ms: number) => { slept.push(ms); clock += ms; } };
  const v = await atLeast(Promise.resolve('ok'), 700, deps);
  ck('atLeast waits the remaining time on an instant result', v === 'ok' && slept.length === 1 && slept[0] === 700);
  clock = 0; slept.length = 0;
  const slow = { now: () => clock, sleep: deps.sleep };
  const w = await atLeast(Promise.resolve().then(() => { clock += 900; return 'late'; }), 700, slow);
  ck('atLeast does not add delay to a slow result', w === 'late' && slept.length === 0);
  clock = 0; slept.length = 0;
  let threw = false;
  try { await atLeast(Promise.reject(new Error('boom')), 700, deps); } catch (e: any) { threw = e?.message === 'boom'; }
  ck('atLeast still rethrows after the minimum', threw && slept[0] === 700);
}

// integration: concurrent manual clicks share one check; manual check records lastCheckedAt
{
  (globalThis as any).__TAURI_INTERNALS__ = {};
  const { checkDesktopUpdate, desktopUpdateLastCheckedAt, desktopUpdateSnapshot } = await import('./desktop-updater');
  let calls = 0;
  const check = async () => { calls++; return null; };
  const fast = async (ms: number) => { await new Promise(r => setTimeout(r, Math.min(ms, 5))); };
  const a = checkDesktopUpdate(check, { manual: true, minVisibleMs: 50, sleep: fast });
  const b = checkDesktopUpdate(check, { manual: true, minVisibleMs: 50, sleep: fast });
  ck('second click while checking shows checking', desktopUpdateSnapshot().kind === 'checking');
  const [ra, rb] = await Promise.all([a, b]);
  ck('concurrent clicks run the plugin check once', calls === 1);
  ck('both clicks resolve to up-to-date', ra.kind === 'up-to-date' && rb.kind === 'up-to-date');
  ck('manual check records when it finished', typeof desktopUpdateLastCheckedAt() === 'number');
  const e = await checkDesktopUpdate(async () => { throw new Error('status 404 Not Found'); }, { manual: true, minVisibleMs: 1, sleep: fast });
  ck('thrown error ends in the failed state (raw message kept for logs)', e.kind === 'error' && (e as any).message === 'status 404 Not Found');
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
