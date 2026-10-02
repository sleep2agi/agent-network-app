// ck-style self-executing test (run by scripts/run-tests.mjs under bun). NOT bun:test.
// 定时任务执行记录:状态 / 用时 / 失败原因 / 回复附件的映射,以及屏幕接线。
import { readFileSync as readRaw } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';
import { fetchTaskDetail, type HubConfig, type HubScheduledRun } from './api';
import {
  formatRunDuration,
  runDisplay,
  runDurationMs,
  runDurationText,
  runFailureText,
  runIsOpen,
  runReplyAttachments,
} from './schedule-run-result';

let passed = 0;
const ck = (label: string, ok: boolean, extra: unknown = '') => {
  if (!ok) { console.error(`FAIL: ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); process.exit(1); }
  passed++;
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ck(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

const run = (over: Partial<HubScheduledRun>): HubScheduledRun => ({
  run_id: 'srun_1', schedule_id: 'sched_1', scheduled_for: '2026-09-27T02:53:00.000Z', task_id: 'task_1',
  status: 'delivered', error_code: null, error_message: null, created_at: '2026-09-27 02:53:00', completed_at: null, ...over,
});

// ── 状态:run 行是权威终态;task 只把「已送达」细分出「执行中」 ─────────────
eq('delivered, no task read yet → 已送达', runDisplay(run({})).label, '已送达');
eq('delivered + task delivered → 已送达', runDisplay(run({}), { status: 'delivered' }).kind, 'delivered');
eq('delivered + task acked → 执行中', runDisplay(run({}), { status: 'acked' }).label, '执行中');
eq('delivered + task running → 执行中', runDisplay(run({}), { status: 'running' }).label, '执行中');
eq('replied → 已完成', runDisplay(run({ status: 'replied' })).label, '已完成');
eq('replied tone is the green one', runDisplay(run({ status: 'replied' })).tone, 'running');
for (const s of ['failed', 'cancelled', 'expired']) eq(`${s} → 失败`, runDisplay(run({ status: s })).label, '失败');
eq('skipped → 已跳过', runDisplay(run({ status: 'skipped', task_id: null })).label, '已跳过');
eq('queued keeps saying why', runDisplay(run({ status: 'queued' })).label, '排队中 · 节点离线');
eq('claiming → 处理中', runDisplay(run({ status: 'claiming', task_id: null })).label, '处理中');
eq('run row not yet mirrored but task replied (older hub) → 已完成', runDisplay(run({}), { status: 'replied' }).label, '已完成');
eq('run row not yet mirrored but task expired → 失败', runDisplay(run({}), { status: 'expired' }).label, '失败');
eq('terminal run row wins over a stale running task', runDisplay(run({ status: 'replied' }), { status: 'running' }).label, '已完成');
eq('unknown status shown raw, neutral', runDisplay(run({ status: 'weird' })), { kind: 'unknown', label: 'weird', tone: 'rest' });
ck('delivered is NOT painted with the success tone', runDisplay(run({})).tone !== 'running');

ck('open: delivered with task', runIsOpen(run({})));
ck('open: queued with task', runIsOpen(run({ status: 'queued' })));
ck('not open: replied', !runIsOpen(run({ status: 'replied' })));
ck('not open: skipped without task', !runIsOpen(run({ status: 'skipped', task_id: null })));
ck('not open: no task id', !runIsOpen(run({ task_id: null })));

// ── 用时 ─────────────────────────────────────────────────────────────────
eq('sqlite UTC created_at → ISO completed_at', runDurationMs(run({ status: 'replied', completed_at: '2026-09-27T02:56:12.000Z' })), 192_000);
eq('both sqlite format', runDurationMs(run({ status: 'replied', completed_at: '2026-09-27 02:54:00' })), 60_000);
eq('open run has no duration', runDurationMs(run({})), null);
eq('task completed_at used when run row not mirrored yet', runDurationMs(run({}), { completed_at: '2026-09-27 02:53:30' }), 30_000);
eq('falls back to scheduled_for when created_at missing', runDurationMs(run({ created_at: '', completed_at: '2026-09-27T02:54:00.000Z' })), 60_000);
eq('catch-up run: counted from dispatch (created_at), not the missed slot',
  runDurationMs(run({ scheduled_for: '2026-09-26T20:00:00.000Z', created_at: '2026-09-27 02:53:00', completed_at: '2026-09-27 02:53:05' })), 5_000);
eq('clock skew (end before start) → null, never negative', runDurationMs(run({ completed_at: '2026-09-27 02:52:00' })), null);
eq('fmt null', formatRunDuration(null), '');
eq('fmt 0', formatRunDuration(400), '不到 1 秒');
eq('fmt 45s', formatRunDuration(45_000), '45 秒');
eq('fmt 3m12s', formatRunDuration(192_000), '3 分 12 秒');
eq('fmt 5m even', formatRunDuration(300_000), '5 分钟');
eq('fmt 1h5m', formatRunDuration(3_900_000), '1 小时 5 分');
eq('fmt 2h even', formatRunDuration(7_200_000), '2 小时');
eq('fmt 1d3h', formatRunDuration(27 * 3_600_000), '1 天 3 小时');
eq('row text prefixes 用时', runDurationText(run({ status: 'replied', completed_at: '2026-09-27 02:54:00' })), '用时 1 分钟');
eq('skipped run (no task) has no 用时 even with completed_at', runDurationText(run({ status: 'skipped', task_id: null, completed_at: '2026-09-27 02:53:00' })), '');

// ── 失败原因 ───────────────────────────────────────────────────────────────
eq('task_expired explained + code kept', runFailureText(run({ status: 'expired', error_code: 'task_expired' })), '任务过期,节点 24 小时内没有回复(task_expired)');
eq('dispatch failure carries message', runFailureText(run({ status: 'failed', error_code: 'target_not_active', error_message: 'node stopped' })), '节点不可用(target_not_active) · node stopped');
eq('skip reason', runFailureText(run({ status: 'skipped', error_code: 'previous_run_active' })), '上一次还没结束,这次跳过(previous_run_active)');
eq('unknown code raw', runFailureText(run({ error_code: 'x_y' })), 'x_y');
eq('no code, no message → empty', runFailureText(run({ status: 'replied' })), '');
eq('derived from task when the run row lags', runFailureText(run({}), { status: 'failed' }), '节点执行出错(task_failed)');
eq('replied task derives nothing', runFailureText(run({}), { status: 'replied' }), '');

// ── 回复附件:与聊天回复气泡同源 ─────────────────────────────────────────
const S = 'https://hub.example.test';
const atts = runReplyAttachments({
  result: '图在这 [chart.png](https://hub.example.test/api/files/f_image01) 以及 [report.pdf](https://hub.example.test/api/files/f_report1)',
  meta_json: JSON.stringify({ reply_attachments: [{ type: 'file', file_id: 'f_image01', name: 'chart.png', mime: 'image/png', size: 10 }] }),
}, S);
eq('meta + text refs, deduped by file id', atts.map(a => a.key), ['f_image01', 'f_report1']);
ck('image detected', atts[0].isImage && !atts[0].isVideo);
ck('pdf is a file', !atts[1].isImage);
eq('authed hub uri', atts[1].uri, `${S}/api/files/f_report1`);
eq('no task → no attachments', runReplyAttachments(null, S), []);
eq('attachments on the ASK (meta.attachments) are not the reply', runReplyAttachments({ result: 'ok', meta_json: JSON.stringify({ attachments: [{ type: 'file', file_id: 'f_askimg1', name: 'a.png' }] }) }, S), []);

// ── 读任务的请求:按 network 作用域,与执行记录一致 ──────────────────────
const calls: string[] = [];
(globalThis as any).fetch = async (url: string) => {
  calls.push(url);
  return new Response(JSON.stringify({ tasks: [{ task_id: 'task_1', status: 'replied', result: 'done' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const cfg: HubConfig = { serverUrl: S, token: 'utok_test', networkId: 'net_alpha' };
const t = await fetchTaskDetail(cfg, 'task_1');
eq('task detail read', t?.result, 'done');
ck('task detail is network scoped', calls[0]?.includes('task_id=task_1') && calls[0]?.includes('network_id=net_alpha'), calls);

// ── 屏幕接线(读源码;CRLF 规整,路径统一成 POSIX)──────────────────────
const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readRaw(join(here, name), 'utf8').replace(/\r\n?/g, '\n');
const posix = (p: string) => p.split(sep).join('/');
ck('collect: scans the src directory', posix(here).endsWith('/src'), posix(here));
const screen = read('ScheduledTasksScreen.tsx');
const result = read('ScheduleRunResult.tsx');
const app = read('../App.tsx');
const chat = read('ChatScreen.tsx');
const has = (label: string, src: string, needle: string) => ck(`wiring: ${label}`, src.includes(needle), needle);
has('rows use runDisplay with the task', screen, 'runDisplay(run, task)');
has('rows show 用时', screen, 'runDurationText(run, task)');
has('rows are tappable toggles', screen, 'onPress={() => onToggleRun(run)}');
has('expanded row renders the result', screen, '<ScheduleRunResult');
has('open runs read their task', screen, 'if (runIsOpen(run)) void loadRunTask(run.task_id!)');
has('task read goes through fetchTaskDetail', screen, 'await fetchTaskDetail(cfg, taskId)');
has('open runs poll', screen, 'setInterval(() => void loadRuns(id), 15_000)');
ck('wiring: old run-status helper no longer drives the rows', !screen.includes('runStatusMeta(run.status)'));
has('reply rendered through MarkdownMessage', result, '<MarkdownMessage>{reply}</MarkdownMessage>');
has('reply attachments from the shared parser', result, 'runReplyAttachments(task, cfg.serverUrl)');
has('image preview uses the chat viewer', result, '<ImageViewer state={viewer}');
has('去会话 button', result, 'accessibilityLabel="去会话"');
has('loading state', result, '正在读取执行结果');
has('read failure offers retry', result, 'onPress={onRetry}');
ck('ui-text: result view takes Text from the wrapper, not react-native',
  result.includes("import { Text } from './ui-text'") && !/import \{[^}]*\bText\b[^}]*\} from 'react-native'/.test(result));
ck('ui-text: screen takes Text from the wrapper',
  screen.includes("from './ui-text'") && !/import \{[^}]*\bText\b[^}]*\} from 'react-native'/.test(screen));
ck('app: both schedule mounts wire 去会话 into a focused chat',
  app.split("cfg={cfg} open={screen.open} onOpenChat={(alias, focusTaskId) => setScreen({ name: 'chat', alias, focusTaskId })} />").length - 1 === 2);
ck('app: every workspace chat mount forwards focusTaskId', app.split('focusTaskId={screen.focusTaskId}').length - 1 === 3);
has('chat hands the focused task to the shared go-to-message (pages back until found, #463)', chat, 'setFocusTarget(focusTaskId)');

console.log(`schedule run result: ${passed} checks passed`);
