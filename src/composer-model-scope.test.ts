// Executes the actual render expression with synthetic scopes, not a React mount.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as labels from './composer-model-label';
import { t, setLanguagePreference } from './i18n';
setLanguagePreference('zh');

const source = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const effExpr = source.match(/const effectiveValue = (.+);/)?.[1];
const repExpr = source.match(/const reportedValue = (.+);/)?.[1];
const footerExpr = source.match(/const footerModel = (.+);/)?.[1];
assert(effExpr && repExpr && footerExpr, 'actual composer model render expressions exist');
const renderFooter = new Function('effectiveModel', 'effectiveScope', 'reportedModel', 'composerModelScope', 'activeComposerModelValue', `const effectiveValue = ${effExpr}; const reportedValue = ${repExpr}; return ${footerExpr};`);
const scopeA = {}, scopeB = {}, scopeASecondVisit = {};
const key = JSON.stringify(['https://fixture.invalid', 'net_fixture', 'fixture']);
const snapshot = { key, scope: scopeA, expiresAt: Date.now() + 35_000, value: { model: 'provider/model-a' } };
const show = (scope: object, record: any = snapshot, effective: any = null) =>
  labels.readEffectiveComposerModel(effective, scope, record, scope) ?? labels.readComposerModelSnapshot(record, scope);
const showFooter = (scope: object, record: unknown = snapshot, effective: unknown = null) =>
  renderFooter(effective, scope, record, scope, labels.activeComposerModelValue);
let checks = 0;
function ck(name: string, ok: boolean) { assert(ok, name); checks++; }
ck('same scope can display its own reported model', show(scopeA) === 'provider/model-a · 档位 未知' && showFooter(scopeA) === 'provider/model-a');
ck('account switch hides old model before effects run', show(scopeB) === null && showFooter(scopeB) === '');
ck('A-B-A return cannot revive a first-visit model', show(scopeASecondVisit) === null && showFooter(scopeASecondVisit) === '');
ck('fresh account read is visible', show(scopeB, { ...snapshot, scope: scopeB }) === 'provider/model-a · 档位 未知' && showFooter(scopeB, { ...snapshot, scope: scopeB }) === 'provider/model-a');
ck('expired snapshot cannot paint even if timer was suspended', show(scopeA, { ...snapshot, expiresAt: Date.now() - 1 }) === null && showFooter(scopeA, { ...snapshot, expiresAt: Date.now() - 1 }) === '');
ck('missing snapshot is unknown', show(scopeA, null) === null && showFooter(scopeA, null) === '');
const effective = { ...snapshot, value: { model: 'provider/effective', modelVariant: 'high' } };
ck('config model and variant override status together', show(scopeA, snapshot, effective) === 'provider/effective · 档位 high' && showFooter(scopeA, snapshot, effective) === 'provider/effective');
ck('effective snapshot cannot cross scope', show(scopeB, null, effective) === null && showFooter(scopeB, null, effective) === '');
ck('effective expiry cannot revive variant', show(scopeA, snapshot, { ...effective, expiresAt: Date.now() - 1 }) === 'provider/model-a · 档位 未知' && showFooter(scopeA, snapshot, { ...effective, expiresAt: Date.now() - 1 }) === 'provider/model-a');
ck('offline semantics survive effective config priority', show(scopeA, { ...snapshot, value: { model: 'old', status: 'offline' } }, effective) === 'provider/effective · 档位 high · 离线');
ck('render scope is recreated on config and alias changes', /const composerModelScope = useMemo\(\(\) => \(\{\}\), \[cfg, alias\]\);/.test(source));
ck('request captures the same scope used by render', source.includes('scope: composerModelScope'));
ck('scope does not serialize credentials into keys', !source.includes('const modelScopeKey ='));
// #573：未知/过期不再用「模型未知或已过期」的报错样子，而是可点的「选择模型」/「模型由节点决定」。
ck('unknown and stale states are visible rather than silently disappearing', source.includes("modelFixedByNode ? t('chat.modelFixed') : t('chat.modelSelect')"));
setLanguagePreference('en');
ck('effective variant English copy', labels.composerModelLabel({ model: 'p/m', modelVariant: 'high' }) === 'p/m · variant high');
ck('explicit default English copy', labels.composerModelLabel({ model: 'p/m', modelVariant: null }) === 'p/m · variant default');
ck('unknown variant English copy', labels.composerModelLabel({ model: 'p/m' }) === 'p/m · variant unknown');
ck('reported provenance has English copy', t('chat.reportedModel', { model: 'provider/model-a' }) === 'Node-reported: provider/model-a');
ck('unknown has English copy', t('chat.modelUnknown') === 'Model unknown or stale');
setLanguagePreference('zh');
ck('reported provenance has Chinese copy', t('chat.reportedModel', { model: 'provider/model-a' }) === '节点上报：provider/model-a');
ck('unknown has Chinese copy', t('chat.modelUnknown') === '模型未知或已过期');
console.log(`${checks} composer model render-scope checks passed`);
