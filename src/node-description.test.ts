import { readFileSync } from 'node:fs';
import { DESCRIPTION_MAX, DESCRIPTION_TEMPLATE, descriptionByAlias, descriptionDraftError, descriptionForNode, descriptionSummary, normalizeDraft, saveErrorKey } from './node-description';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

ck('length counts code points (emoji = 1)', descriptionDraftError('😀'.repeat(DESCRIPTION_MAX)) === null && descriptionDraftError('😀'.repeat(DESCRIPTION_MAX + 1)) === 'tooLong');
ck('blank → null (clear)', normalizeDraft('  \n ') === null);
ck('untouched template → null (not a real description)', normalizeDraft(DESCRIPTION_TEMPLATE) === null);
ck('template with one answer → kept as typed', normalizeDraft('负责：App 发版\n能干什么：\n什么事找我：\n不做：') === '负责：App 发版\n能干什么：\n什么事找我：\n不做：');
ck('free text kept, CRLF normalised, trimmed', normalizeDraft('  负责发版\r\n找我签名  ') === '负责发版\n找我签名');
ck('errors map to readable keys', saveErrorKey('attrs_revision_conflict', 409) === 'nodeDesc.conflict' && saveErrorKey('unsupported') === 'nodeDesc.unsupported'
  && saveErrorKey('permission_denied', 403) === 'nodeDesc.forbidden' && saveErrorKey('x', 404) === 'nodeDesc.notFound' && saveErrorKey('HTTP 500', 500) === 'nodeDesc.failed' && saveErrorKey('invalid_description', 400) === 'nodeDesc.invalid');

ck('summary: empty / untouched template → empty', descriptionSummary(null) === '' && descriptionSummary('') === '' && descriptionSummary(DESCRIPTION_TEMPLATE) === '');
ck('summary: strips leading template label', descriptionSummary('负责：ANet 全端发版与排错\n能干什么：修 bug') === 'ANet 全端发版与排错');
ck('summary: skips empty first template line', descriptionSummary('负责：\n能干什么：   写代码  与  巡检\n不做：') === '写代码 与 巡检');
ck('summary: free text keeps first line & truncates by code points', descriptionSummary('😀'.repeat(12), 10) === '😀'.repeat(9) + '…');

const map = descriptionByAlias([
  { node_id: 'n1', alias: '通信鸽', description: '旧职责', updated_at: '2026-11-20 00:00:00' },
  { node_id: 'n2', alias: '通信鸽', description: '负责：新职责', updated_at: '2026-11-25 00:00:00' },
  { node_id: 'n3', alias: '空白节点', description: DESCRIPTION_TEMPLATE, updated_at: '2026-11-25 00:00:00' },
]);
ck('descriptionByAlias picks latest updated_at and drops empty', map.get('通信鸽') === '新职责' && !map.has('空白节点'));
ck('descriptionForNode prefers authoritative node_id over alias', descriptionForNode([
  { node_id: 'n1', alias: '通信鸽', description: '负责：一号机', updated_at: '2026-11-20 00:00:00' },
  { node_id: 'n2', alias: '通信鸽', description: '负责：二号机', updated_at: '2026-11-25 00:00:00' },
], { nodeId: 'n1', alias: '通信鸽' }) === '一号机');

const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('card is editable in both 节点详情 and 节点信息 (Hub enforces permission)', /<NodeDescriptionCard[^>]*\bcanEdit\s*\n/.test(screen) && !screen.includes('canEdit={!readOnly}'));
const agentsScreen = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
ck('AgentsScreen wires descriptionByAlias and renders agent-desc', agentsScreen.includes('descriptionByAlias') && agentsScreen.includes('agent-desc-${item.alias}'));
const chatScreen = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
ck('ChatScreen wires descriptionForNode and renders chat-header-desc', chatScreen.includes('descriptionForNode') && chatScreen.includes('chat-header-desc'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
