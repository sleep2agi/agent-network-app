// 节点「权限」分区(#489)的纯逻辑。ck 风格自执行脚本(不是 bun:test)。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 node/bun 提供。
import { readFileSync } from 'node:fs';
import {
  canShowPermissionSection, NODE_PERMISSION_OPTIONS, normalizeMode, optionFor, permissionLayout, reasonLabel, reportFootnote,
  reportHeadline, routeLabel, saveErrorText, shouldSubmit, summarizeReport, type NodePermissionReport,
} from './node-permission-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log(`  ✗ ${n}`); };

// ── 三个选项:顺序、名字、说明说人话 ──
ck('三个选项,顺序 正常/只读/受限', NODE_PERMISSION_OPTIONS.map(o => o.label).join('/') === '正常/只读/受限');
ck('每条说明都说了能做什么和不能做什么(一句,不超过 60 字)', NODE_PERMISSION_OPTIONS.every(o => o.summary.length > 10 && o.summary.length <= 60));
ck('说明里不出现 RFC 术语', NODE_PERMISSION_OPTIONS.every(o => !/RFC|owner|visibility|enforce|log|permission|mode/i.test(o.summary)));
ck('只读说明提到「不能改任务」和「派活」', /不能改任务/.test(optionFor('readonly').summary) && /派活/.test(optionFor('readonly').summary));
ck('受限说明提到「派给它的任务」', /派给它的任务/.test(optionFor('restricted').summary));
ck('不认识 / 空的模式按正常', normalizeMode(undefined) === 'normal' && normalizeMode('admin') === 'normal' && normalizeMode('restricted') === 'restricted');

// ── 显示条件:只听 Hub 的 viewer_can ──
ck('viewer_can.permission_mode=true → 显示', canShowPermissionSection({ viewer_can: { permission_mode: true } }));
ck('viewer_can.permission_mode=false → 不显示', !canShowPermissionSection({ viewer_can: { permission_mode: false } }));
ck('旧 Hub(没有 viewer_can)→ 不显示', !canShowPermissionSection({}) && !canShowPermissionSection({ viewer_can: null }));
ck('节点还没加载 → 不显示', !canShowPermissionSection(null) && !canShowPermissionSection(undefined));

// ── 报表 ──
const report: NodePermissionReport = {
  ok: true, network_id: 'net-a', since: '2026-09-26T00:00:00.000Z', mode: 'log', total: 9,
  nodes: [
    { node_id: 'n_a', alias: 'node-a', permission_mode: 'normal', total: 7, by_reason: { human_only: 2, beyond_owner_visibility: 5 },
      routes: [
        { route: 'PUT /api/nodes/:id/attrs', reason: 'human_only', hits: 2 },
        { route: 'PATCH /api/requirements/:id', reason: 'beyond_owner_visibility', hits: 4 },
        { route: 'GET /api/requirements', reason: 'beyond_owner_visibility', hits: 1 },
      ] },
    { node_id: 'n_b', total: 2, by_reason: { mode_readonly: 2 }, routes: [{ route: 'mcp:send_task', reason: 'mode_readonly', hits: 2 }] },
  ],
};
const a = summarizeReport(report, 'n_a')!;
ck('只取这个节点的那一份', a.total === 7);
ck('按原因从多到少', a.byReason.map(r => r.reason).join(',') === 'beyond_owner_visibility,human_only');
ck('按操作从多到少,带人话', a.byRoute[0].label === '改任务' && a.byRoute[0].hits === 4 && a.byRoute.some(r => r.label === '读任务') && a.byRoute.some(r => r.label === '改节点设置'));
ck('报表里没有这个节点 = 0 次', summarizeReport(report, 'n_zz')!.total === 0);
ck('读不到报表(非 owner/admin / 旧 Hub)→ null,不显示那一行', summarizeReport(null, 'n_a') === null);
ck('标题:log 下说「本来会拦下 N 次」', reportHeadline(a) === '过去 7 天本来会拦下 7 次');
ck('标题:enforce 下说「拦下了」', reportHeadline({ ...a, hubMode: 'enforce' }) === '过去 7 天拦下了 7 次');
ck('标题:0 次', reportHeadline({ ...a, total: 0 }) === '过去 7 天没有本来会被拦下的操作');
ck('注脚说清楚只记录、不拦截', /只记录、不拦截/.test(reportFootnote(a)));
ck('原因人话;不认识的原样', reasonLabel('human_only').includes('只有人才能做') && reasonLabel('new_reason') === 'new_reason');
ck('路由人话', routeLabel('mcp:send_task') === '派活 / 发消息' && routeLabel('mcp:broadcast') === '群发' && routeLabel('SSE /events/network/:id') === '订阅消息推送' && routeLabel('POST /api/task') === '派活 / 发消息' && routeLabel('weird') === 'weird');

// ── 提交 / 错误 / 布局 ──
ck('选同一个不提交;提交中不提交;选别的提交', !shouldSubmit('normal', 'normal', false) && !shouldSubmit('normal', 'readonly', true) && shouldSubmit('normal', 'readonly', false));
ck('403 / 404 / 其它错误各有人话', saveErrorText({ status: 403 }).includes('没有权限') && saveErrorText({ status: 404 }).includes('找不到') && saveErrorText({ error: 'boom' }).includes('boom'));
ck('桌面一行分段,手机竖排卡片', permissionLayout(false) === 'segmented' && permissionLayout(true) === 'cards');

// ── 组件:失败回滚、报表只在读得到时出现(源码断言) ──
const comp = readFileSync(new URL('./NodePermissionSection.tsx', import.meta.url), 'utf8');
ck('PUT 失败回到原来的选项', /if \(!res\.ok\) \{\s*setMode\(previous\);/.test(comp));
ck('报表行只在读到报表时渲染', /\{report \? \(/.test(comp));
ck('选项是 radio,带 checked 状态', (comp.match(/accessibilityRole="radio"/g) ?? []).length === 2 && /accessibilityState=\{\{ checked: active/.test(comp));
ck('手机卡片高度 ≥ 64(手指大小)', /minHeight: 64/.test(comp));
const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('节点页按 Hub 的 viewer_can 决定显示权限分区', /permissionsAllowed: canShowPermissionSection\(node\)/.test(screen));
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
ck('报表读失败(403 等)返回 null 而不是抛', /fetchNodePermissionReport[\s\S]{0,600}catch \{\s*return null;/.test(api));

console.log(`node permission model: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
