import { readFileSync } from 'node:fs';
import { DESCRIPTION_MAX, DESCRIPTION_TEMPLATE, descriptionDraftError, normalizeDraft, saveErrorKey } from './node-description';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

ck('length counts code points (emoji = 1)', descriptionDraftError('😀'.repeat(DESCRIPTION_MAX)) === null && descriptionDraftError('😀'.repeat(DESCRIPTION_MAX + 1)) === 'tooLong');
ck('blank → null (clear)', normalizeDraft('  \n ') === null);
ck('untouched template → null (not a real description)', normalizeDraft(DESCRIPTION_TEMPLATE) === null);
ck('template with one answer → kept as typed', normalizeDraft('负责：App 发版\n能干什么：\n什么事找我：\n不做：') === '负责：App 发版\n能干什么：\n什么事找我：\n不做：');
ck('free text kept, CRLF normalised, trimmed', normalizeDraft('  负责发版\r\n找我签名  ') === '负责发版\n找我签名');
ck('errors map to readable keys', saveErrorKey('attrs_revision_conflict', 409) === 'nodeDesc.conflict' && saveErrorKey('unsupported') === 'nodeDesc.unsupported'
  && saveErrorKey('permission_denied', 403) === 'nodeDesc.forbidden' && saveErrorKey('x', 404) === 'nodeDesc.notFound' && saveErrorKey('HTTP 500', 500) === 'nodeDesc.failed' && saveErrorKey('invalid_description', 400) === 'nodeDesc.invalid');

const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('card is editable in both 节点详情 and 节点信息 (Hub enforces permission)', /<NodeDescriptionCard[^>]*\bcanEdit\s*\n/.test(screen) && !screen.includes('canEdit={!readOnly}'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
