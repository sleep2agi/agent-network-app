// 任务详情的「开始」字段(甘特图的条从这里画)。只有带 start 字段的 Hub(capability start_date)才显示、才提交。
// ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import { editDraftOf, editPatch, patchApplied, startError } from './task-board-model';
import { moreSummary } from './task-detail-more';
import { t, setLanguagePreference } from './i18n';
import './i18n-tasks';
import type { Requirement } from './requirements-model';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const R = (o: Partial<Requirement> = {}): Requirement => ({ id: 'a', name: '任务', priority: 'normal', assignee: '', due: '2026-10-10', column: 'pool', createdAt: '2026-09-01T00:00:00Z', owner: null, participants: [], description: '描述', ...o });

console.log('\n草稿 / 提交');
const newHub = R({ start: '' });
const oldHub = R();
ck('草稿带上开始(没设 = 空)', editDraftOf(R({ start: '2026-09-20' })).start === '2026-09-20' && editDraftOf(oldHub).start === '');
ck('设开始:只提交 start', JSON.stringify(editPatch(newHub, { ...editDraftOf(newHub), start: '2026-09-20' })) === '{"start":"2026-09-20"}');
ck('清空开始:提交 ""', JSON.stringify(editPatch(R({ start: '2026-09-20' }), { ...editDraftOf(R({ start: '2026-09-20' })), start: '' })) === '{"start":""}');
ck('没改开始:不提交', editPatch(R({ start: '2026-09-20' }), editDraftOf(R({ start: '2026-09-20' }))) === null);
ck('旧 Hub(行里没有 start):永远不提交', editPatch(oldHub, { ...editDraftOf(oldHub), start: '2026-09-20' }) === null);
ck('Hub 回来的行没带上开始 = 没生效(报「还不能改」,不说成功)', !patchApplied(R({ start: '' }), { start: '2026-09-20' }) && patchApplied(R({ start: '2026-09-20' }), { start: '2026-09-20' }));
ck('开始日期校验:空和 YYYY-MM-DD 合法,乱写不合法', startError('') === null && startError('2026-09-20') === null && startError('2026-02-30') !== null && startError('明天') !== null);

console.log('\n「更多」');
const sum = moreSummary(R({ start: '2026-09-20' }), { priority: 'high', parentId: null, start: '2026-09-20' }, []);
ck('收起时一句话说出开始,排在最前', sum[0]?.key === 'detail.sumStart' && sum[0].values?.m === 9 && sum[0].values?.d === 20 && sum.length === 1); // 优先级已常显(owner 10-01),不进摘要
ck('没设开始不说', !moreSummary(R(), { priority: 'normal', parentId: null, start: '' }, []).length);
ck('旧调用方不传 start 也行', !moreSummary(R(), { priority: 'normal', parentId: null }, []).length);
setLanguagePreference('en');
const en = t('detail.sumStart', { m: 9, d: 20 });
setLanguagePreference('zh');
ck('中英文案', t('detail.sumStart', { m: 9, d: 20 }) === '9月20日开始' && en === 'Starts 9/20' && t('detail.start') === '开始');

console.log('\n接线');
const panel = src('./TaskDetailPanel.tsx');
ck('只有带 start 字段的 Hub 才显示「开始」', /\{item\.start !== undefined \? \(\s*<Field label=\{tr\('detail\.start'\)\}>/.test(panel));
ck('开始只到日(不传 allowTime)', /idBase="req-edit-start"/.test(panel) && !/allowTime=\{[^}]*\}[^\n]*idBase="req-edit-start"|idBase="req-edit-start"[^\n]*allowTime/.test(panel));
ck('开始不合法:错误显示在开始下面,「更多」自动展开', /error\?\.field === 'start' \? error\.message/.test(panel) && /moreShown = [^\n]*error\?\.field === 'start'/.test(panel));
ck('Hub 刷新时没改过的开始跟着刷新', /start: d\.start === base\.start \? next\.start : d\.start/.test(panel));

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
