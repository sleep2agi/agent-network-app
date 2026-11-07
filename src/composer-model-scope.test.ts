// Executes the actual render expression with synthetic scopes, not a React mount.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as labels from './composer-model-label';
import { t, setLanguagePreference } from './i18n';

const source = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const expression = source.match(/const composerModelLine = (.+);/)?.[1];
assert(expression, 'actual composer render expression exists');
const render = new Function('reportedModel', 'modelScopeKey', 'composerModelScope', 'composerModelLabel', 'readComposerModelSnapshot', `return ${expression}`);
const scopeA = {}, scopeB = {}, scopeASecondVisit = {};
const key = JSON.stringify(['https://fixture.invalid', 'net_fixture', 'fixture']);
const snapshot = { key, scope: scopeA, expiresAt: Date.now() + 35_000, value: { model: 'provider/model-a' } };
const show = (scope: object, record: unknown = snapshot) => render(record, key, scope, labels.composerModelLabel, (labels as any).readComposerModelSnapshot);
let checks = 0;
function ck(name: string, ok: boolean) { assert(ok, name); checks++; }
ck('same scope can display its own reported model', show(scopeA) === 'provider/model-a');
ck('account switch hides old model before effects run', show(scopeB) === null);
ck('A-B-A return cannot revive a first-visit model', show(scopeASecondVisit) === null);
ck('fresh account read is visible', show(scopeB, { ...snapshot, scope: scopeB }) === 'provider/model-a');
ck('expired snapshot cannot paint even if timer was suspended', show(scopeA, { ...snapshot, expiresAt: Date.now() - 1 }) === null);
ck('missing snapshot is unknown', show(scopeA, null) === null);
ck('render scope is recreated on config and alias changes', /const composerModelScope = useMemo\(\(\) => \(\{\}\), \[cfg, alias\]\);/.test(source));
ck('request captures the same scope used by render', source.includes('scope: composerModelScope'));
ck('scope does not serialize credentials into keys', !source.includes('const modelScopeKey ='));
ck('unknown and stale states are visible rather than silently disappearing', source.includes(": t('chat.modelUnknown')"));
setLanguagePreference('en');
ck('reported provenance has English copy', t('chat.reportedModel', { model: 'provider/model-a' }) === 'Node-reported: provider/model-a');
ck('unknown has English copy', t('chat.modelUnknown') === 'Model unknown or stale');
setLanguagePreference('zh');
ck('reported provenance has Chinese copy', t('chat.reportedModel', { model: 'provider/model-a' }) === '节点上报：provider/model-a');
ck('unknown has Chinese copy', t('chat.modelUnknown') === '模型未知或已过期');
console.log(`${checks} composer model render-scope checks passed`);
