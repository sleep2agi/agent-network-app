// 未接通入口的演示：假数据、看得见的结果，并且不触网、不回显密钥。
import { readFileSync } from 'node:fs';
import { setLanguagePreference, t } from './i18n';
import './i18n-backend-pending';
import './i18n-provider';
import {
  BACKEND_PENDING_ENTRIES,
  demoProviderSeed,
  simulateEnvSave,
  simulateProviderProbe,
  simulateProviderSave,
  simulateProviderUpsert,
  simulateSecretSave,
  simulateSkillOpen,
} from './backend-pending-demo';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  if (ok) passed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

const SECRET = 'sk-FAKE-demo-key-9f3a';
const quiet = (value: unknown) => !JSON.stringify(value).includes(SECRET);

setLanguagePreference('zh');
ck('zh banner is the agreed sentence', t('backendPending.banner') === '演示数据 · 后端开发中');
setLanguagePreference('en');
ck('en banner is the agreed sentence', t('backendPending.banner') === 'Demo data · Backend in development');
setLanguagePreference('system');

let netCalls = 0;
const net = () => { netCalls++; };
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => { netCalls++; throw new Error('demo must not use the network'); }) as typeof fetch;

const saved = simulateProviderSave({
  runtimeId: 'codex-sdk',
  choice: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: SECRET,
}, true, net);
ck('provider save is a local success', saved.ok === true && saved.network === false && saved.persisted === false && saved.ok && saved.credential === 'entered' && saved.model === 'deepseek-chat');
ck('provider save does not echo the key', quiet(saved) && !('apiKey' in saved));

const blocked = simulateProviderSave({
  runtimeId: 'codex-sdk',
  choice: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: `line1\n${SECRET}`,
}, true, net);
ck('invalid key stays local and is not echoed', !blocked.ok && blocked.issue === 'api_key_invalid' && quiet(blocked));

const none = simulateProviderSave({ runtimeId: 'codex-sdk', choice: 'none', baseUrl: '', model: '', apiKey: SECRET }, true, net);
ck('no preset does not save or echo', !none.ok && none.issue === 'none' && quiet(none));

const insecure = simulateProviderSave({
  runtimeId: 'codex-sdk',
  choice: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: SECRET,
}, false, net);
ck('insecure transport is refused locally', !insecure.ok && insecure.issue === 'insecure_transport' && quiet(insecure));

const probed = simulateProviderProbe({ providerId: 'demo-deepseek', model: 'deepseek-chat' }, net);
ck('probe returns a visible local result', probed.ok === true && probed.network === false && probed.persisted === false && probed.ok && probed.reachable === true && probed.latencyMs === 128);
const probedSecret = simulateProviderProbe({ providerId: SECRET, model: 'deepseek-chat' }, net);
ck('probe refuses a secret-shaped id without echoing it', !probedSecret.ok && probedSecret.reason === 'secret' && quiet(probedSecret));
const TOKEN = 'abcdef0123456789abcdef01';
const probedToken = simulateProviderProbe({ providerId: TOKEN, model: 'deepseek-chat' }, net);
ck('probe refuses a long undifferentiated token without echoing it', TOKEN.length >= 24 && !probedToken.ok && probedToken.reason === 'secret' && !JSON.stringify(probedToken).includes(TOKEN));

const seeded = demoProviderSeed();
const added = simulateProviderUpsert(seeded, {
  id: 'demo-custom',
  baseUrl: 'https://api.example.com/v1',
  model: 'demo-model',
  apiKey: SECRET,
}, net);
ck('provider catalog grows only in memory', added.ok === true && added.network === false && added.persisted === false && added.ok && added.rows.some(row => row.id === 'demo-custom' && row.model === 'demo-model'));
ck('provider catalog drops the key', added.ok && quiet(added) && added.rows.every(row => !('apiKey' in row)) && !JSON.stringify(seeded).includes('demo-custom'));
const keyedUrl = simulateProviderUpsert(seeded, { id: 'demo-custom', baseUrl: `https://api.example.com/${SECRET}`, model: 'demo-model', apiKey: '' }, net);
ck('a key hiding in base_url is not copied into the catalog', !keyedUrl.ok && keyedUrl.reason === 'secret' && quiet(keyedUrl));

const skill = simulateSkillOpen('demo-summarize', net);
ck('skill open stays on the bundled demo note', skill.ok === true && skill.network === false && skill.ok && skill.bodyKey === 'backendPending.skill.summarize.body');
const missingSkill = simulateSkillOpen(SECRET, net);
ck('unknown skill does not echo the lookup string', !missingSkill.ok && missingSkill.reason === 'missing' && quiet(missingSkill));

const secretSaved = simulateSecretSave({ name: 'demo-key', value: SECRET }, net);
ck('secret save keeps the name only', secretSaved.ok === true && secretSaved.network === false && secretSaved.persisted === false && secretSaved.ok && secretSaved.echoed === false && secretSaved.name === 'demo-key' && !('value' in secretSaved) && quiet(secretSaved));
const secretEmpty = simulateSecretSave({ name: 'demo-key', value: '' }, net);
ck('empty secret is refused locally', !secretEmpty.ok && secretEmpty.reason === 'value');

const envSaved = simulateEnvSave({ key: 'DEMO_REGION', value: SECRET }, net);
ck('env save keeps the name only', envSaved.ok === true && envSaved.echoed === false && envSaved.key === 'DEMO_REGION' && !('value' in envSaved) && quiet(envSaved) && envSaved.network === false && envSaved.persisted === false);

globalThis.fetch = originalFetch;
ck('demo functions never called fetch or the injected net', netCalls === 0);

const ids = BACKEND_PENDING_ENTRIES.map(entry => entry.id);
ck('every mock entry names its swap point', BACKEND_PENDING_ENTRIES.every(entry => entry.surface.length > 0 && entry.replaceWith.includes('simulate')));
ck('mock entry ids are the unconnected surfaces', ids.join(',') === 'provider-save,provider-probe,daemon-providers,daemon-skills,daemon-secrets,daemon-env');

const logic = readFileSync(new URL('./backend-pending-demo.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./BackendPendingDemo.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('./ServerSidebar.tsx', import.meta.url), 'utf8');
const hub = readFileSync(new URL('./HubPendingScreen.tsx', import.meta.url), 'utf8');
const nodeDetail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const pendingUi = readFileSync(new URL('./backend-pending-ui.tsx', import.meta.url), 'utf8');
const fields = readFileSync(new URL('./CodexProviderFields.tsx', import.meta.url), 'utf8');
const wizard = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const reported = readFileSync(new URL('./DaemonRuntimeProviders.tsx', import.meta.url), 'utf8');
const adopt = readFileSync(new URL('./NodeAdoptionControls.tsx', import.meta.url), 'utf8');
const forbidden = /from '\.\/api'|from '\.\/app-fetch'|appFetch|createNode\(|fetch\(|XMLHttpRequest|WebSocket|readListProviders|runNodeLifecycleAction|localStorage|SecureStore/;
ck('demo logic does not touch the hub client', !forbidden.test(logic) && !logic.includes('set_network_secret(') && !logic.includes('probe_provider_model('));
ck('demo view does not touch the hub client', !forbidden.test(ui) && !ui.includes('console.'));
ck('daemon management uses a settings sidebar and full pending content pane', page.includes('testID="daemon-section-tabs"') && page.includes('<BackendPendingIntegration layer="daemon"') && page.includes('showTabs={false}'));
ck('daemon node action notes are deduplicated and hidden until selection', page.includes('new Set(actions.map(action => actionReason(action)).filter(Boolean))') && page.includes('{selected ? ('));
ck('hub sidebar exposes SKILLS / 令牌 / Provider tabs', sidebar.includes('testID="server-pending-tabs"') && sidebar.includes('PendingSegmentedTabs'));
ck('hub pending screen renders tab panels', hub.includes('HubPendingScreen') && hub.includes('BackendPendingIntegration'));
ck('node keeps its section IA and adds only the key demo', nodeDetail.includes("section === 'secrets'") && nodeDetail.includes('<NodeSecretPendingSection') && !nodeDetail.includes('NodeIntegrationsSection'));
ck('pending chrome reuses theme tokens (buttons + settings-style segments)', pendingUi.includes('buttonStyle') === false && pendingUi.includes('segmentSelected') && ui.includes('buttonStyle('));
ck('pending forms use responsive field grids and compact catalog rows', ui.includes('demoStyles.fieldGrid') && ui.includes('<ProviderCatalogRow') && ui.includes('flexBasis: 220'));
ck('probe panel sizes to its content instead of stretching', ui.includes("alignSelf: 'flex-start'"));
ck('management probe stays the disabled shell; the demo probe stays local', page.includes('testID="daemon-mgmt-probe"') && page.includes('action={probe}') && page.includes('onPress={() => {}}') && !page.includes('simulateProviderProbe') && ui.includes('simulateProviderProbe('));
ck('provider form keeps the shell and adds the demo save', fields.includes('<ProviderConfigDemo') && fields.includes("onClearKey={() => onChange({ ...value, apiKey: '' })}"));
ck('secret inputs stay masked', ui.includes('testID={`${testIDPrefix}-secret-value`}') && ui.includes('secureTextEntry') && ui.includes('testID={`${testIDPrefix}-provider-key`}'));
const submit = wizard.slice(wizard.indexOf('const handleSubmit'), wizard.indexOf('// ── render'));
ck('create wizard still gates a real provider before createNode', submit.indexOf('codexSubmitGate') !== -1 && submit.indexOf('codexSubmitGate') < submit.indexOf('createNode(') && wizard.includes('<ProviderConfigDemo'));
ck('reported providers stay the real catalog', !reported.includes('backend-pending-demo') && !reported.includes('simulateProvider'));
ck('adopted restart stays the hub refusal, not a demo', adopt.includes("button('adopt-restart'") && adopt.includes('() => {}') && !adopt.includes('simulate'));

console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
