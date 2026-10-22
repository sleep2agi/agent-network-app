// #906 —— daemon 上报的供应商 / 模型:缺字段就升级,Codex 走 model_providers,OpenCode V2 走自己的 provider/model。密钥不进结果。
import { readFileSync } from 'node:fs';
import { catalogIsVisible, displayDaemonProviders, interpretListProvidersHttp, looksLikeSecret, taggedFromPayload } from './daemon-runtime-providers';
import { setLanguagePreference, t } from './i18n';
import './i18n-provider';

const KEY = 'sk-FAKE-provider-key-9f3a';
let passed = 0, total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else console.error('❌', name);
};

const codexDaemon = {
  runtime_readiness: {
    'codex-sdk': {
      state: 'ready',
      reason: '可以创建',
      model_providers: {
        deepseek: {
          name: 'DeepSeek',
          base_url: 'https://api.deepseek.com/v1',
          models: ['deepseek-chat', 'opencode/mimo-v2.6-flash-free', KEY],
          api_key: KEY,
          env_key: 'DEEPSEEK_API_KEY',
          secret_key_ref: 'DEEPSEEK_API_KEY',
        },
      },
    },
    'claude-agent-sdk': { state: 'ready', reason: '可以创建' },
  },
};

const codex = displayDaemonProviders({ daemon: codexDaemon, read: 'ok', runtimeId: 'codex-sdk' });
check('codex readiness model_providers is the codex path', codex.kind === 'codex'
  && codex.kind === 'codex'
  && codex.providers.length === 1
  && codex.providers[0].id === 'deepseek'
  && codex.providers[0].models.join() === 'deepseek-chat'
  && (codex.providers[0].baseUrl ?? '').includes('api.deepseek.com'));
check('slash models and the planted key are not codex model ids', codex.kind === 'codex' && !codex.providers.some(provider => provider.models.some(model => model.includes('/'))) && !JSON.stringify(codex).includes(KEY) && !JSON.stringify(codex).includes('DEEPSEEK_API_KEY'));

const claude = displayDaemonProviders({ daemon: codexDaemon, read: 'ok', runtimeId: 'claude-agent-sdk' });
check('a runtime without a provider field is unlisted once the daemon reported others', claude.kind === 'unlisted');

const bare = displayDaemonProviders({
  daemon: { runtime_readiness: { 'codex-app-server': { state: 'ready', reason: '可以创建' } } },
  read: 'unsupported',
  runtimeId: 'codex-app-server',
});
check('readiness without provider fields is an upgrade, not an invented catalog', bare.kind === 'upgrade' && bare.tone === 'codex');

const pending = displayDaemonProviders({ daemon: { runtime_readiness: { 'codex-sdk': { state: 'ready' } } }, read: 'pending', runtimeId: 'codex-sdk' });
check('pending read does not flash the upgrade before list_providers returns', pending.kind === 'pending');

const empty = displayDaemonProviders({
  daemon: { runtime_readiness: { 'codex-sdk': { state: 'ready', model_providers: {} } } },
  read: 'ok',
  runtimeId: 'codex-sdk',
});
check('an empty model_providers object means the field exists and nothing is available', empty.kind === 'empty' && empty.tone === 'codex');

const opencodeDaemon = {
  runtime_readiness: {
    'opencode-cli': {
      state: 'ready',
      providers: [{
        id: 'deepseek',
        base_url: 'https://user:sk-FAKE-provider-key-9f3a@api.deepseek.com/v1',
        models: ['deepseek-chat'],
        api_key: KEY,
      }],
    },
  },
};
const v2 = displayDaemonProviders({ daemon: opencodeDaemon, read: 'ok', runtimeId: 'opencode-cli', opencodeGeneration: 'v2' });
check('opencode v2 shows OpenCode provider/model and drops the credentialed base_url',
  v2.kind === 'opencode' && v2.models.join() === 'deepseek/deepseek-chat' && !JSON.stringify(v2).includes(KEY) && !JSON.stringify(v2).includes('baseUrl') && !JSON.stringify(v2).includes('api.deepseek.com'));

const v2Missing = displayDaemonProviders({
  daemon: { runtime_readiness: { 'opencode-cli': { state: 'unknown' } } },
  read: 'unsupported',
  runtimeId: 'opencode-cli',
  opencodeGeneration: 'v2',
});
check('opencode v2 without a reported list asks to upgrade', v2Missing.kind === 'upgrade' && v2Missing.tone === 'opencode');

const native = displayDaemonProviders({
  daemon: { runtime_readiness: { 'opencode-cli': { models: ['opencode/mimo-v2.6-flash-free', KEY] } } },
  read: 'ok',
  runtimeId: 'opencode-cli',
  opencodeGeneration: 'v2',
});
check('a reported opencode/model string is kept as OpenCode wrote it', native.kind === 'opencode' && native.models.join() === 'opencode/mimo-v2.6-flash-free');

const networkOnly = taggedFromPayload({
  ok: true,
  providers: [{
    provider_id: 'p1',
    name: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
    secret_key_ref: 'DEEPSEEK_API_KEY',
    api_key: KEY,
    models: [{ model_name: 'deepseek-chat' }],
  }],
});
check('list_providers rows with no runtime are not a daemon runtime catalog', networkOnly.length === 0);
const untagged = displayDaemonProviders({
  daemon: { runtime_readiness: { 'codex-sdk': { state: 'ready' } } },
  rows: networkOnly,
  read: 'ok',
  runtimeId: 'codex-sdk',
});
check('an untagged list_providers payload still upgrades', untagged.kind === 'upgrade');

const tagged = taggedFromPayload({
  providers: [{
    name: 'minimax',
    runtime: 'codex-app-server',
    base_url: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M3'],
    api_key: KEY,
  }],
});
const fromTool = displayDaemonProviders({
  daemon: { runtime_readiness: { 'codex-app-server': { state: 'ready' } } },
  rows: tagged,
  read: 'ok',
  runtimeId: 'codex-app-server',
});
check('a runtime tag on a network provider is not daemon availability', fromTool.kind === 'upgrade');

const isolated = displayDaemonProviders({ daemon: codexDaemon, rows: tagged, read: 'ok', runtimeId: 'codex-app-server' });
check('network rows cannot add a runtime to a daemon catalog', isolated.kind === 'unlisted');
const localBefore = displayDaemonProviders({ daemon: codexDaemon, read: 'ok', runtimeId: 'codex-sdk' });
const localAfter = displayDaemonProviders({ daemon: codexDaemon, rows: taggedFromPayload({ providers: [
  { id: 'foreign', runtime: 'codex-sdk', models: ['foreign-model'] },
] }), read: 'ok', runtimeId: 'codex-sdk' });
check('network rows cannot extend a locally reported runtime', JSON.stringify(localBefore) === JSON.stringify(localAfter));
check('switching to an unreported daemon never reuses the network catalog',
  displayDaemonProviders({ daemon: {}, rows: tagged, read: 'ok', runtimeId: 'codex-app-server' }).kind === 'upgrade');
check('no selected daemon never shows a network provider as available',
  displayDaemonProviders({ daemon: null, rows: tagged, read: 'ok', runtimeId: 'codex-app-server' }).kind === 'upgrade');
check('network rows do not conceal an explicitly empty local catalog',
  displayDaemonProviders({ daemon: { runtime_readiness: { 'codex-app-server': { providers: [] } } },
    rows: tagged, read: 'ok', runtimeId: 'codex-app-server' }).kind === 'empty');
const networkOpenCode = taggedFromPayload({ providers: [
  { id: 'foreign', runtime: 'opencode-cli', models: ['foreign-model'] },
] });
check('OpenCode V2 does not inherit network providers either',
  displayDaemonProviders({ daemon: {}, rows: networkOpenCode, read: 'ok', runtimeId: 'opencode-cli', opencodeGeneration: 'v2' }).kind === 'upgrade');
check('OpenCode V2 native catalog remains authoritative', JSON.stringify(v2) === JSON.stringify(
  displayDaemonProviders({ daemon: opencodeDaemon, rows: networkOpenCode, read: 'ok', runtimeId: 'opencode-cli', opencodeGeneration: 'v2' })));

const onDaemon = displayDaemonProviders({
  daemon: {
    list_providers: [{ id: 'custom', runtimes: ['codex-sdk', 'codex-app-server'], models: ['my-model'] }],
  },
  read: 'unsupported',
  runtimeId: 'codex-sdk',
});
check('daemon.list_providers with runtimes shows on that runtime without the tool', onDaemon.kind === 'codex' && onDaemon.providers[0].models[0] === 'my-model');

check('malformed readiness does not throw', displayDaemonProviders({ daemon: { runtime_readiness: [] }, read: 'unsupported', runtimeId: 'codex-sdk' }).kind === 'upgrade'
  && displayDaemonProviders({ daemon: null, read: 'error', runtimeId: 'opencode-cli', opencodeGeneration: 'v2' }).kind === 'read-error');

const echoed = interpretListProvidersHttp(200, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: `boom ${KEY}` } }));
check('a tool error does not keep the response text', echoed.kind === 'error' && !JSON.stringify(echoed).includes(KEY));
const missingTool = interpretListProvidersHttp(200, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'Tool list_providers not found' } }));
check('unknown tool is unsupported', missingTool.kind === 'unsupported');
const sseBody = [
  'event: message',
  'data: ' + JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, providers: [{ name: 'deepseek', runtime: 'codex-sdk', models: ['deepseek-chat'], api_key: KEY }] }) }] },
  }),
].join('\n');
const sse = interpretListProvidersHttp(200, sseBody);
check('sse list_providers keeps the runtime row and drops the key', sse.kind === 'ok' && sse.rows[0].runtimeIds[0] === 'codex-sdk' && sse.rows[0].models[0] === 'deepseek-chat' && !JSON.stringify(sse).includes(KEY));
check('http 404 is unsupported and does not echo a body', interpretListProvidersHttp(404, KEY).kind === 'unsupported' && !JSON.stringify(interpretListProvidersHttp(404, KEY)).includes(KEY));
check('the planted key matches the secret prefix', looksLikeSecret(KEY));

const readSrc = readFileSync(new URL('./daemon-provider-read.ts', import.meta.url), 'utf8');
const viewSrc = readFileSync(new URL('./DaemonRuntimeProviders.tsx', import.meta.url), 'utf8');
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
check('the reader does not log and does not return the response body', !/console\./.test(readSrc) && !readSrc.includes('error.message') && readSrc.includes('interpretListProvidersHttp'));
check('the catalog view has no key field', !viewSrc.includes('secureTextEntry') && !viewSrc.includes('apiKey') && !viewSrc.includes('api_key'));
check('the wizard mounts the catalog on the runtime step and does not pass the form key',
  wiz.includes('<DaemonRuntimeProviders') && wiz.includes('readListProviders(') && !wiz.includes('apiKey={'));

setLanguagePreference('zh');
const claudeUpgrade = displayDaemonProviders({ daemon: { runtime_readiness: { 'claude-agent-sdk': { state: 'ready' } } }, read: 'unsupported', runtimeId: 'claude-agent-sdk' });
check('claude does not get the upgrade banner when the hub has no provider fields', claudeUpgrade.kind === 'upgrade' && !catalogIsVisible(claudeUpgrade, 'claude-agent-sdk'));
check('codex and opencode v2 keep the upgrade banner', catalogIsVisible(bare, 'codex-app-server') && catalogIsVisible(v2Missing, 'opencode-cli', 'v2'));
check('a reported model list is visible on a non-codex runtime', catalogIsVisible(
  displayDaemonProviders({ daemon: { runtime_readiness: { 'claude-agent-sdk': { models: ['claude-sonnet-4-6'] } } }, read: 'ok', runtimeId: 'claude-agent-sdk' }),
  'claude-agent-sdk',
));

check('zh codex upgrade names the Hub', t('daemonProviders.upgradeCodex').includes('升级') && t('daemonProviders.upgradeCodex').includes('model_providers') && !t('daemonProviders.upgradeCodex').includes(KEY));
check('zh opencode upgrade stays on OpenCode provider/model', t('daemonProviders.upgradeOpencode').includes('provider/model') && t('daemonProviders.upgradeOpencode').includes('不收集密钥'));
setLanguagePreference('system');

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
