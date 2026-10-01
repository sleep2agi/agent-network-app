// 任务归档 / 恢复(任务页审计 2026-10-02 H2):Agent 一直能通过 MCP requirements_update 归档,人在 app 里没有入口,
// 归档的卡打开是一张能改的普通表单,没法恢复。这里钉住请求体、错误、和看板 / 详情 / 卡片菜单的接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import { setRequirementArchivedOnHub } from './requirements-hub';
import { t } from './i18n';
import './i18n-tasks';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_sample', networkId: 'net_sample' } as never;

console.log('# setRequirementArchivedOnHub');
{
  const sent: { url: string; method: string; body: unknown }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const row = (archived: unknown) => ({ requirement: { id: 'r1', name: '示例任务', column: 'done', ...(archived === undefined ? {} : { archived }) } });
  try {
    reply = { status: 200, body: row(true) };
    const a = await setRequirementArchivedOnHub(cfg, 'r1', true);
    ck('归档:PATCH 体只有 { archived: true }', sent[0]?.method === 'PATCH' && JSON.stringify(sent[0]?.body) === '{"archived":true}' && sent[0]?.url.includes('/api/requirements/r1'), JSON.stringify(sent[0]));
    ck('归档:回来的行标 archived', a.archived === true && a.id === 'r1');
    reply = { status: 200, body: row(false) };
    const r = await setRequirementArchivedOnHub(cfg, 'r1', false);
    ck('恢复:PATCH 体只有 { archived: false },回来的行不带 archived', JSON.stringify(sent[1]?.body) === '{"archived":false}' && !r.archived);
    const fails = async (status: number, body: unknown) => { reply = { status, body }; try { await setRequirementArchivedOnHub(cfg, 'r1', true); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };
    ck('403 照 Hub 的话说', (await fails(403, { message: '参与人只能修改状态和检查项' })) === '参与人只能修改状态和检查项');
    ck('404 说不存在', (await fails(404, {})).includes('不存在'));
    ck('Hub 没认 archived(回来的行没变):不假装成功', (await fails(200, row(false))).length > 0 && (await fails(200, row(undefined))).length > 0);
  } finally {
    (globalThis as any).fetch = realFetch;
  }
}

console.log('# 接线');
{
  const board = src('RequirementBoard.tsx'), panel = src('TaskDetailPanel.tsx'), menu = src('TaskCardMenu.tsx');
  ck('卡片菜单:旧 Hub / 只读 / 已归档 不给「归档」', /archivedCapable && !item\.readOnly && !item\.archived \? 'archive' : 'hidden'/.test(board));
  ck('卡片菜单:开菜单的共用 menuTarget 带 archive(右键 / 长按都走它)', /priorities: priorityChoices\(lowestPriority, item\.priority\), archive: archiveAccess\(item\)/.test(board) && (board.match(/setMenu\(menuTarget\(item, x, y\)\)/g) || []).length === 2);
  ck('卡片菜单里画「归档」并接到 onArchive', /item\('archive', tr\('archive\.action'\)/.test(menu) && /onArchive=\{id => \{ void setArchived\(id, true\); \}\}/.test(board));
  ck('归档 / 恢复后底部提示带「撤销」,撤销 = 反方向再发一次', /testID="archive-undo-button"/.test(board) && /setArchived\(u\.id, !u\.archived, true\)/.test(board));
  ck('详情:单卡窗口 / 只读 / 旧 Hub 不给入口', /onArchive=\{archivedCapable && !selected\.readOnly && !single \?/.test(board));
  ck('详情:归档的卡有横幅 +「恢复」', /testID="req-archived-banner"/.test(panel) && /onPress=\{\(\) => onArchive\(false\)\}/.test(panel) && /testID="req-restore"/.test(panel));
  ck('详情:「归档这个任务」先存没存的文字再归档', /void save\(\)\.then\(ok => \{ if \(ok\) onArchive\(true\); \}\)/.test(panel) && /testID="req-archive"/.test(panel));
  ck('文案', t('archive.action') === '归档' || t('archive.action') === 'Archive');
}

console.log(`${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
