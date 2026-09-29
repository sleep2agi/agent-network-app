// 节点页「运行日志」的纯逻辑 — run: bun src/node-logs.test.ts
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样处理);运行时由 bun 提供。
import { readFileSync } from 'node:fs';
import {
  LOG_LEVEL_CHIPS, LOGS_GREP_MAX, LOGS_KEEP_MAX, LOGS_LINES, LOGS_OLD_HUB_MESSAGE, LOGS_OLD_NODE_MESSAGE,
  lineTone, logFileBase, logsEmptyMessage, logsEnqueueError, logsExportName, logsQuery, logsStatusMessage, logsSupport, logsTarget,
  logsText, mergeFollow, nextSinceTs, normalizeLogKey, parseLogsTail, type LogLine,
} from './node-logs';
import { FIXED_SHORTCUTS } from './shortcuts-model';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};
const L = (key: string, text: string, ts: number | null = 1, level: LogLine['level'] = 'info'): LogLine => ({ key, text, ts, level });

// ── 能力门:只认 logs_capable;不发请求就说清楚 ──
{
  ck('logs_capable=true → capable', logsSupport({ alias: 'a', agent: 'agent-node:codex', logs_capable: true } as any).kind === 'capable');
  const hub = logsSupport({ alias: 'a', agent: 'agent-node:codex' } as any);
  ck('/api/status 没有 logs_capable 键 → 服务器旧', hub.kind === 'unsupported' && hub.component === 'hub' && hub.message === LOGS_OLD_HUB_MESSAGE);
  const old = logsSupport({ alias: 'a', agent: 'agent-node:codex', logs_capable: false } as any);
  ck('老节点(键在、值 false)→「节点版本过旧，升级后可查看日志」', old.kind === 'unsupported' && old.message === '节点版本过旧，升级后可查看日志' && old.message === LOGS_OLD_NODE_MESSAGE);
  const cc = logsSupport({ alias: 'a', agent: 'claude-code', logs_capable: false } as any);
  ck('Claude Code 会话 → 说没有 agent-node 日志,不叫它升级', cc.kind === 'unsupported' && /Claude Code/.test(cc.message));
  ck('没有会话 → 服务器旧(不猜)', logsSupport(null).kind === 'unsupported');
  ck('不 capable → 没有目标(不发请求)', logsTarget({ node: { node_id: 'n1', alias: 'a' }, session: { alias: 'a', logs_capable: false } as any }) === null);
  ck('capable + nodes 行 → 按 node_id', logsTarget({ node: { node_id: 'n1', alias: 'a', runtime: 'codex' }, session: { alias: 'a', logs_capable: true } as any })?.node_id === 'n1');
  ck('capable 无 nodes 行 → 按 alias', JSON.stringify(logsTarget({ node: null, session: { alias: 'a', logs_capable: true } as any })) === JSON.stringify({ alias: 'a' }));
}

// ── 请求参数 ──
{
  ck('默认:500 行,不带 level / grep / since', JSON.stringify(logsQuery({ level: 'all', search: '' })) === JSON.stringify({ lines: LOGS_LINES }));
  ck('级别 + 搜索(去首尾空白)+ since', JSON.stringify(logsQuery({ level: 'error', search: '  boom ', sinceTs: 5 })) === JSON.stringify({ lines: 500, level: 'error', grep: 'boom', since_ts: 5 }));
  ck('搜索词截到 200', logsQuery({ level: 'all', search: 'x'.repeat(500) }).grep!.length === LOGS_GREP_MAX);
  ck('since 为 null / 0 不带', !('since_ts' in logsQuery({ level: 'all', search: '', sinceTs: null })) && !('since_ts' in logsQuery({ level: 'all', search: '', sinceTs: 0 })));
  ck('请求参数里没有任何路径字段', !/path|file|dir/i.test(Object.keys(logsQuery({ level: 'warn', search: 'a', sinceTs: 1 })).join(',')));
  ck('筛选标签:全部 / 信息 / 警告 / 错误', LOG_LEVEL_CHIPS.map(c => c.label).join('/') === '全部/信息/警告/错误' && LOG_LEVEL_CHIPS.map(c => c.key).join() === 'all,info,warn,error');
}

// ── 解析:POSIX 化、CRLF → LF、坏行丢掉 ──
{
  const content = JSON.stringify({
    files: ['C:\\Users\\someone\\.anet\\nodes\\x\\logs\\2026-09-29.log', 'logs/2026-09-28.log'],
    lines: [
      { ts: 10, level: 'info', text: 'a\r\n', key: '2026-09-29.log:0' },
      { ts: 11, level: 'error', text: 'b\r', key: 'C:\\x\\2026-09-29.log:12' },
      { ts: null, level: 'weird', text: 'c', key: '2026-09-29.log:20' },
      { level: 'info', text: 7, key: 'bad' },
      null,
    ],
    truncated: true, matched: 9, now_ts: 99,
  });
  const t = parseLogsTail(content)!;
  ck('文件名去目录(反斜杠也当分隔符)', JSON.stringify(t.files) === JSON.stringify(['2026-09-29.log', '2026-09-28.log']), JSON.stringify(t.files));
  ck('行尾 CRLF / CR 去掉', t.lines[0].text === 'a' && t.lines[1].text === 'b');
  ck('key 里的路径也 POSIX 化只留文件名', t.lines[1].key === '2026-09-29.log:12', t.lines[1].key);
  ck('认不出的级别 → null,坏行丢掉', t.lines.length === 3 && t.lines[2].level === null && t.lines[2].ts === null);
  ck('truncated / matched / now_ts 带回来', t.truncated && t.matched === 9 && t.now_ts === 99);
  ck('非 JSON / 没有 lines → null', parseLogsTail('nope') === null && parseLogsTail('{}') === null && parseLogsTail(undefined) === null);
  ck('logFileBase / normalizeLogKey', logFileBase('a/b\\c.log') === 'c.log' && normalizeLogKey('x/y.log:5') === 'y.log:5' && normalizeLogKey('plain') === 'plain');
}

// ── 实时跟随:按 key 去重、保序、封顶;since 取最后一行 ──
{
  const a = [L('f:0', 'a', 1), L('f:10', 'b', 2)];
  const same = mergeFollow(a, [L('f:10', 'b', 2)]);
  ck('全是旧行 → 原数组(不重渲染)', same === a);
  const m = mergeFollow(a, [L('f:10', 'b', 2), L('f:20', 'c', 2), L('f:20', 'c', 2)]);
  ck('同一秒的旧行去掉,新行接在后面且不重复', m.map(l => l.text).join('') === 'abc');
  const many = Array.from({ length: LOGS_KEEP_MAX + 5 }, (_, i) => L(`f:${i}`, String(i)));
  const capped = mergeFollow([], many);
  ck('超过上限丢最早的', capped.length === LOGS_KEEP_MAX && capped[0].text === '5' && capped[capped.length - 1].text === String(LOGS_KEEP_MAX + 4));
  ck('nextSinceTs:最后一行有时间用它', nextSinceTs(a, 50) === 2);
  ck('nextSinceTs:最后几行没有时间就往前找', nextSinceTs([L('f:0', 'x', 7), L('f:1', 'y', null)], 50) === 7);
  ck('nextSinceTs:没有行用节点时钟', nextSinceTs([], 50) === 50 && nextSinceTs([], null) === null);
}

// ── 呈现 ──
{
  ck('错误红 / 警告琥珀 / 其它普通', lineTone('error') === 'error' && lineTone('warn') === 'warn' && lineTone('info') === 'normal' && lineTone(null) === 'normal');
  ck('复制 / 导出正文:LF 连接 + 结尾换行;空 → 空串', logsText([L('1', 'a'), L('2', 'b')]) === 'a\nb\n' && logsText([]) === '');
  const name = logsExportName('节点/a b:c', new Date(2026, 8, 29, 7, 5, 3));
  ck('导出文件名:别名消毒 + 本机时间 + .log', name === '节点_a_b_c-20260929-070503.log', name);
  ck('导出文件名:不以点开头、空别名有兜底', !logsExportName('..x').startsWith('.') && logsExportName('').startsWith('node-'));
  ck('空状态分得清「没写过」和「没匹配」', logsEmptyMessage({ files: 0, level: 'all', search: '' }) === '节点还没有写运行日志'
    && logsEmptyMessage({ files: 1, level: 'error', search: '' }) === '没有匹配的日志行'
    && logsEmptyMessage({ files: 1, level: 'all', search: ' q ' }) === '没有匹配的日志行');
  ck('权限不足给人话', /所有者|管理员/.test(logsEnqueueError('logs_permission_denied')));
  ck('老节点按别名找不到 → 同一句升级提示', logsEnqueueError('logs_target_not_found') === LOGS_OLD_NODE_MESSAGE);
  ck('超时 / 失败有文案', /没有响应/.test(logsStatusMessage('timeout', null)) && /失败/.test(logsStatusMessage('failed', 'x')));
}

// ── 接线(读源码):三种节点页形态都由 NODE_SECTIONS 驱动;平台分流 ──
{
  const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
  const section = readFileSync(new URL('./NodeLogsSection.tsx', import.meta.url), 'utf8');
  const nav = screen.slice(screen.indexOf('const nav = ('), screen.indexOf('const card ='));
  ck('分区导航(左栏 / 安卓宽标签行 / 手机标签行)同一段代码、按 sectionMeta(NODE_SECTIONS)渲染', /sectionMeta\.map/.test(nav) && /compact \? localStyles\.tab : localStyles\.railItem/.test(nav) && /touch && \(compact \? localStyles\.tabTouch : localStyles\.railItemTouch\)/.test(nav));
  ck('sectionMeta 来自 NODE_SECTIONS', /const sectionMeta = NODE_SECTIONS\.filter/.test(screen));
  ck('logs 分区接了 NodeLogsSection,并按 pointerUi(desktop) 分流', /section === 'logs'/.test(screen) && /<NodeLogsSection[^>]*pointer=\{pointerUi\(desktop\)\}/.test(screen));
  ck('Ctrl/⌘+F 只在 pointer 时挂', /if \(!pointer \|\| !WEB\) return;/.test(section) && /isFindShortcut\(e, mac\)/.test(section));
  ck('悬停样式都带 pointer 前提(手机没有只靠悬停的 UI)', (section.match(/st\.hovered/g) ?? []).length === (section.match(/pointer && st\.hovered/g) ?? []).length && (section.match(/pointer && st\.hovered/g) ?? []).length >= 3);
  ck('手机筛选标签 ≥ 36 高', /const chipH = pointer \? 28 : 36;/.test(section));
  ck('日志文字桌面 / web 可选', /selectable=\{pointer \|\| WEB\}/.test(section));
  ck('导出:Tauri 另存为、web 下载、原生分享', /isTauriDesktop\(\)/.test(section) && /a\.download = name/.test(section) && /Sharing\.shareAsync/.test(section));
  ck('跟随定时器在关掉 / 后台 / 卸载时停', /if \(!follow \|\| !foreground \|\| phase !== 'ready'\) return;/.test(section) && /return \(\) => \{ stop = true; if \(timer\) clearTimeout\(timer\); \};/.test(section));
  ck('target / cfg 按内容固定(父组件 10 秒轮询不触发整页重读)', /useMemo\(\(\) => targetProp, \[targetKey\]\)/.test(section) && /useMemo\(\(\) => cfgProp, \[cfgKey\]\)/.test(section));
  ck('Ctrl/⌘+F 登记在 设置 → 快捷键', FIXED_SHORTCUTS.some(f => f.key === 'logsFind' && f.combos.includes('Mod+F')));
}

console.log(`\nnode logs: ${pass}/${total} checks passed`);
if (pass !== total) (globalThis as any).process.exit(1);
