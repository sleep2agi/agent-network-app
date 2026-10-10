import { readFileSync } from 'node:fs';
import { buildCreateNodeSpec } from './create-node-request';
import { createRequestVerdict } from './create-request-status';
import { setLanguagePreference, t } from './i18n';
import './i18n-provider';
import {
  API_KEY_MAX_LENGTH,
  NODE_SPEC_PROVIDER_CONTRACT,
  PROVIDER_ISSUE_ZH,
  buildNodeSpecProvider,
  codexSubmitGate,
  describeProviderCreateError,
  formAfterChoice,
  hubTransportAllowsSecrets,
  presetsFor,
  providerCreateError,
  providerLocalIssues,
  providerStateSnapshot,
  providerSummary,
  providerSurface,
  reconcileProviderForm,
  scrubSecret,
  suggestedProviderModels,
  validateApiKey,
  validateBaseUrl,
  withProviderField,
  type ProviderFormValue,
} from './provider-create-options';

const KEY = 'sk-FAKE-provider-key-9f3a';
const deepseek = {
  runtimeId: 'codex-sdk',
  choice: 'deepseek' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: KEY,
  secretRef: null,
};

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else console.error('❌', name);
};

check('contract is provider metadata plus the vault, not a key field',
  NODE_SPEC_PROVIDER_CONTRACT.nodeSpecField === 'provider'
  && NODE_SPEC_PROVIDER_CONTRACT.fields.includes('secret_ref')
  && !(NODE_SPEC_PROVIDER_CONTRACT.fields as readonly string[]).includes('api_key'));

check('each runtime looks up its own catalog',
  JSON.stringify(presetsFor('codex-app-server')) === JSON.stringify(presetsFor('codex-sdk'))
  && presetsFor('codex-sdk').length === 3
  && presetsFor('opencode-cli').length === 0
  && presetsFor('claude-agent-sdk').length === 0
  && presetsFor('grok-build-acp').length === 0);

check('surfaces differ: codex form, opencode v2 native, everyone else hidden',
  providerSurface('codex-app-server').kind === 'codex'
  && providerSurface('codex-sdk').kind === 'codex'
  && providerSurface('opencode-cli', 'v2').kind === 'opencode-native'
  && providerSurface('opencode-cli', 'v1').kind === 'hidden'
  && providerSurface('opencode-cli').kind === 'hidden'
  && providerSurface('claude-agent-sdk').kind === 'hidden'
  && providerSurface('claude-agent-sdk', 'v2').kind === 'hidden');

check('opencode does not receive the codex model list',
  suggestedProviderModels('opencode-cli', 'deepseek').length === 0
  && suggestedProviderModels('claude-agent-sdk', 'minimax').length === 0
  && suggestedProviderModels('codex-app-server', 'deepseek')[0] === 'deepseek-v4-pro');

check('https and loopback http allow a key; plain http does not',
  hubTransportAllowsSecrets('https://hub.example.com')
  && hubTransportAllowsSecrets('http://127.0.0.1:9999')
  && hubTransportAllowsSecrets('http://localhost:9999/')
  && hubTransportAllowsSecrets('http://[::1]:9999')
  && !hubTransportAllowsSecrets('http://192.168.1.8:9999')
  && !hubTransportAllowsSecrets('http://hub.example.com'));

check('base_url accepts https and loopback http only',
  validateBaseUrl('https://api.deepseek.com/v1').ok
  && validateBaseUrl('http://127.0.0.1:8080/v1').ok
  && !validateBaseUrl('http://10.0.0.2/v1').ok
  && !validateBaseUrl('').ok
  && !validateBaseUrl('https://user:secret@api.deepseek.com/v1').ok);

for (const bad of ['', 'line\nbreak', 'has\rreturn', 'nul\0here', 'x'.repeat(API_KEY_MAX_LENGTH + 1)]) {
  check(`api key rejected (${JSON.stringify(bad).slice(0, 24)})`, validateApiKey(bad) !== 'ok');
}
check('api key of the max length is accepted', validateApiKey('k'.repeat(API_KEY_MAX_LENGTH)) === 'ok');
check('rejected key text is not echoed', !providerCreateError({ ...deepseek, apiKey: `${KEY}\n` })!.includes(KEY));

check('codex rejects an OpenCode-style provider/model',
  providerLocalIssues({ ...deepseek, model: 'deepseek/deepseek-chat' })[0] === 'model_invalid_plain'
  && providerLocalIssues({ ...deepseek, runtimeId: 'codex-app-server', model: 'gpt-5.5' }).length === 0);

check('deepseek on opencode or claude is rejected',
  providerLocalIssues({ ...deepseek, runtimeId: 'opencode-cli' })[0] === 'preset_not_for_runtime'
  && providerLocalIssues({ ...deepseek, runtimeId: 'claude-agent-sdk', choice: 'minimax' })[0] === 'preset_not_for_runtime');

check('plain http blocks before the key is required',
  providerLocalIssues({ ...deepseek, apiKey: '' }, false)[0] === 'insecure_transport');

const built = buildNodeSpecProvider(deepseek);
check('builder emits the contract shape and never the key',
  !!built && built!.preset === 'deepseek' && built!.model === 'deepseek-chat' && !JSON.stringify(built).includes(KEY) && !('apiKey' in (built as object)));

let thrown = '';
try { buildNodeSpecProvider({ ...deepseek, runtimeId: 'opencode-cli' }); } catch (e) { thrown = e instanceof Error ? e.message : String(e); }
check('builder refuses a codex preset on opencode without the key', /不能使用/.test(thrown) && !thrown.includes(KEY));
check('none builds no payload', buildNodeSpecProvider({ ...deepseek, choice: 'none' }) === null);

check('a filled codex preset is not submitted and does not drop the key',
  (() => {
    const gate = codexSubmitGate(deepseek, 'https://hub.example.com');
    return gate.action === 'block' && gate.issue === 'hub_not_ready' && !PROVIDER_ISSUE_ZH.hub_not_ready.includes(KEY);
  })());
check('plain http is blocked as insecure transport',
  codexSubmitGate(deepseek, 'http://hub.example.com').action === 'block'
  && (codexSubmitGate(deepseek, 'http://hub.example.com') as { issue: string }).issue === 'insecure_transport');
check('no provider choice is an omit, including on an old hub over http',
  codexSubmitGate({ ...deepseek, choice: 'none' }, 'http://10.0.0.8').action === 'omit'
  && codexSubmitGate({ ...deepseek, runtimeId: 'claude-agent-sdk', choice: 'none' }).action === 'omit');

const base = { name: 'demo', model: '', permissionMode: 'default', maxTurns: '', budget: '', workdirField: {} as { workdir?: string } };
for (const runtimeId of ['codex-app-server', 'codex-sdk', 'claude-agent-sdk', 'opencode-cli', 'grok-build-acp', 'claude-code-cli', 'grok-build-cli']) {
  const spec = buildCreateNodeSpec({
    ...base,
    runtimeId,
    runtimeModels: runtimeId === 'opencode-cli' ? ['opencode/mimo-v2.6-flash-free'] : runtimeId === 'claude-agent-sdk' ? ['deepseek-v4-pro'] : ['m'],
    ...(runtimeId === 'opencode-cli' ? { opencodeGeneration: 'v2' as const, opencodeUnsafeTools: true } : {}),
  });
  const request = { daemon_node_id: 'daemon-1', node_spec: withProviderField(spec, null) };
  const today = { daemon_node_id: 'daemon-1', node_spec: spec };
  check(`${runtimeId} without a provider is byte-identical`, request.node_spec === spec && JSON.stringify(request) === JSON.stringify(today));
}

check('upgrade copy refuses a silent downgrade',
  describeProviderCreateError({ error: 'flag_key_unknown', field: 'provider' }) === PROVIDER_ISSUE_ZH.unsupported_hub
  && describeProviderCreateError({ error: 'validate: flag_key_unknown:base_url' })!.includes('不会丢弃')
  && describeProviderCreateError({ error: 'unknown field: secret_ref' }) === PROVIDER_ISSUE_ZH.unsupported_hub
  && describeProviderCreateError({ error: 'flag_key_unknown', field: 'copresence' }) === null);

const verdict = createRequestVerdict({ status: 'rejected', error: 'validate: flag_key_unknown:provider', runtime: 'codex-sdk' });
check('create poll maps provider rejection to the upgrade copy',
  verdict.kind === 'failed' && verdict.text.includes('需升级 Hub') && verdict.text.includes('flag_key_unknown:provider') && !verdict.text.includes(KEY));

const form: ProviderFormValue = { choice: 'deepseek', baseUrl: deepseek.baseUrl, model: deepseek.model, apiKey: KEY, secretRef: null };
const cleared = reconcileProviderForm('codex-sdk', 'claude-agent-sdk', form);
const kept = reconcileProviderForm('codex-sdk', 'codex-app-server', form);
const snapshot = providerStateSnapshot(form);
const logged = JSON.stringify({
  snapshot,
  summary: providerSummary(form),
  payload: built,
  error: providerCreateError({ ...deepseek, apiKey: `${KEY}\nbad` }),
  scrubbed: scrubSecret(`vault said ${KEY}`, KEY),
  cleared: cleared.form,
  gate: codexSubmitGate(deepseek, 'https://hub.example.com'),
});
check('switching to Claude clears the codex key; switching between Codex runtimes keeps the form',
  cleared.cleared === true && cleared.form.apiKey === '' && cleared.form.choice === 'none'
  && kept.cleared === false && kept.form === form);
check('key never appears in snapshot, summary, payload, error, scrubbed log, or cleared form',
  !logged.includes(KEY) && snapshot.apiKeyEntered === true && !('apiKey' in snapshot) && providerSummary(form).credential === 'entered');
check('an untouched none choice does not announce a clear',
  reconcileProviderForm('codex-sdk', 'opencode-cli', { ...form, choice: 'none', baseUrl: '', model: '', apiKey: '', secretRef: null }).cleared === false);

const next = formAfterChoice(form, 'minimax', 'codex-app-server');
check('switching preset clears the key and prefills the codex base_url',
  next.apiKey === '' && next.baseUrl === 'https://api.minimaxi.com/v1' && next.model === 'MiniMax-M3' && !JSON.stringify(next).includes(KEY));
check('a codex preset chosen on opencode collapses back to none',
  formAfterChoice(form, 'deepseek', 'opencode-cli').choice === 'none' && formAfterChoice(form, 'deepseek', 'opencode-cli').apiKey === '');

setLanguagePreference('zh');
check('zh hub copy says to upgrade the Hub', t('provider.err.hub_not_ready').includes('需升级 Hub') && !t('provider.err.hub_not_ready').includes(KEY));
setLanguagePreference('en');
check('en hub copy also says Hub and does not echo a key', /hub/i.test(t('provider.err.hub_not_ready')) && !t('provider.err.hub_not_ready').includes(KEY));
setLanguagePreference('system');

const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const submit = wiz.slice(wiz.indexOf('const handleSubmit'), wiz.indexOf('// ── render'));
const fields = readFileSync(new URL('./CodexProviderFields.tsx', import.meta.url), 'utf8');
const note = readFileSync(new URL('./OpenCodeProviderNote.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
check('wizard shows the codex form and the opencode note on different surfaces',
  wiz.includes("surface.kind === 'codex'") && wiz.includes('<CodexProviderFields')
  && wiz.includes("surface.kind === 'opencode-native'") && wiz.includes('<OpenCodeProviderNote'));
check('submit blocks a provider choice before createNode and still builds today\'s spec',
  submit.indexOf('codexSubmitGate') !== -1
  && submit.indexOf('codexSubmitGate') < submit.indexOf('createNode(')
  && submit.includes('scrubSecret(')
  && /node_spec[^=]*=\s*buildCreateNodeSpec\(/.test(submit)
  && !/flags:\s*\{/.test(submit));
check('codex key field is a password input', fields.includes('secureTextEntry'));
check('opencode note does not hardcode the codex preset table or a key field',
  !note.includes('deepseek') && !note.includes('minimax') && !note.includes('secureTextEntry') && !note.includes('apiKey'));
check('detail page mounts the codex provider section only for codex runtimes',
  detail.includes('isCodexRuntime(node.runtime)') && detail.includes('<NodeCodexProviderSection'));

console.log(`provider create options: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
