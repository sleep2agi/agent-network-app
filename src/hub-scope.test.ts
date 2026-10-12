// Hub 侧栏页：演示数据、不回显密钥、侧栏和桌面路由都接上，原有概览/节点还在。
import { readFileSync } from 'node:fs';
import { setLanguagePreference, t } from './i18n';
import './i18n-hub-scope';
import './i18n-backend-pending';
import { navActiveKey } from './nav-chrome';
import {
  HUB_NAV,
  hubEnvSeed,
  hubProviderSeed,
  hubSectionForScreen,
  hubSkillSeed,
  hubTokenSeed,
  isHubSection,
  openHubSkill,
  probeHubProvider,
  saveHubEnv,
  saveHubProvider,
  parseHubScopeFixture,
  saveHubToken,
  screenForHubSection,
  toggleHubSkill,
} from './hub-scope-demo';

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
ck('zh banner stays the agreed sentence', t('backendPending.banner') === '演示数据 · 后端开发中');
ck('zh sidebar labels', t('server.hub.skills') === 'SKILLS' && t('server.hub.tokens') === '令牌' && t('server.hub.env') === '环境变量' && t('server.hub.providers') === 'Provider');
ck('zh scope lines name the layer', t('hubScope.skills.scope').includes('节点页') && t('hubScope.providers.scope').includes('daemon') && t('hubScope.env.scope').includes('三层') && t('hubScope.env.scope').includes('Hub 这一层'));
setLanguagePreference('en');
ck('en sidebar labels', t('server.hub.skills') === 'SKILLS' && t('server.hub.tokens') === 'Tokens' && t('server.hub.providers') === 'Provider');
ck('en env scope says this layer only', t('hubScope.env.scope').includes('Hub layer') && t('hubScope.providers.scope').includes('not the per-runtime'));
setLanguagePreference('system');

let netCalls = 0;
const net = () => { netCalls++; };
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => { netCalls++; throw new Error('demo must not use the network'); }) as typeof fetch;

const skills = hubSkillSeed();
ck('skill seed is a hub catalog', skills.length === 4 && skills.filter(row => row.enabled).length === 3);
const opened = openHubSkill(skills, 'hub-summarize', net);
ck('skill open stays local', opened.ok === true && opened.network === false && opened.persisted === false && opened.ok && opened.bodyKey === 'hubScope.skill.summarize.body');
const missing = openHubSkill(skills, SECRET, net);
ck('unknown skill does not echo the lookup', !missing.ok && missing.reason === 'missing' && quiet(missing));
const toggled = toggleHubSkill(skills, 'hub-release', net);
ck('skill toggle flips only that row in memory', toggled.ok === true && toggled.network === false && toggled.ok && toggled.enabled === true && toggled.rows.find(row => row.id === 'hub-summarize')?.enabled === true && skills.find(row => row.id === 'hub-release')?.enabled === false);

const tokens = hubTokenSeed();
ck('token seed has names only', tokens.length === 3 && tokens.every(row => !('value' in row)) && quiet(tokens));
const tokenSaved = saveHubToken(tokens, { name: 'demo-extra', value: SECRET }, net);
ck('token save keeps the name only', tokenSaved.ok === true && tokenSaved.network === false && tokenSaved.persisted === false && tokenSaved.ok && tokenSaved.echoed === false && tokenSaved.name === 'demo-extra' && tokenSaved.rows.some(row => row.name === 'demo-extra' && row.hintKey === 'hubScope.token.hint.custom') && !('value' in tokenSaved) && quiet(tokenSaved) && !JSON.stringify(tokens).includes('demo-extra'));
const tokenDup = saveHubToken(tokens, { name: 'hub-outbound', value: SECRET }, net);
ck('duplicate token name is refused without the value', !tokenDup.ok && tokenDup.reason === 'duplicate' && quiet(tokenDup));
const tokenHidden = saveHubToken(tokens, { name: 'demo-extra', value: 'demo-extra' }, net);
ck('a value that matches the visible name is not stored', !tokenHidden.ok && tokenHidden.reason === 'value' && !JSON.stringify(tokenHidden).includes('demo-extra'));

const envs = hubEnvSeed();
const envSaved = saveHubEnv(envs, { key: 'ANET_DEMO', value: SECRET }, net);
ck('env save keeps the name only', envSaved.ok === true && envSaved.echoed === false && envSaved.ok && envSaved.key === 'ANET_DEMO' && envSaved.rows.some(row => row.key === 'ANET_DEMO') && quiet(envSaved) && envSaved.network === false && envSaved.persisted === false);
const envDup = saveHubEnv(envs, { key: 'ANET_REGION', value: 'us-east-1' }, net);
ck('duplicate env name is refused', !envDup.ok && envDup.reason === 'duplicate' && !JSON.stringify(envDup).includes('us-east-1'));

const providers = hubProviderSeed();
ck('provider seed is hub-scoped catalog data', providers.length === 3 && providers.some(row => row.id === 'demo-compat' && row.credential === 'none') && providers.every(row => !('apiKey' in row)));
const added = saveHubProvider(providers, { id: 'demo-custom', baseUrl: 'https://api.example.com/v1', model: 'demo-model', apiKey: SECRET }, net);
ck('provider catalog grows only in memory', added.ok === true && added.network === false && added.persisted === false && added.ok && added.credential === 'entered' && added.echoed === false && added.rows.some(row => row.id === 'demo-custom' && row.credential === 'entered') && quiet(added) && !JSON.stringify(providers).includes('demo-custom'));
const probed = probeHubProvider({ providerId: 'demo-deepseek', model: 'deepseek-chat' }, net);
ck('provider probe is a local result', probed.ok === true && probed.network === false && probed.persisted === false && probed.ok && probed.latencyMs === 128);
const probedSecret = probeHubProvider({ providerId: SECRET, model: 'deepseek-chat' }, net);
ck('provider probe refuses a secret-shaped id', !probedSecret.ok && probedSecret.reason === 'secret' && quiet(probedSecret));

globalThis.fetch = originalFetch;
ck('hub demo never called fetch or the injected net', netCalls === 0);

ck('nav order is skills, tokens, env, providers', HUB_NAV.map(item => item.section).join(',') === 'skills,tokens,env,providers');
ck('each hub section has a screen', HUB_NAV.every(item => screenForHubSection(item.section) === item.screen && hubSectionForScreen(item.screen) === item.section));
ck('isHubSection accepts only the four', isHubSection('skills') && isHubSection('providers') && !isHubSection('overview') && !isHubSection('logs'));
for (const name of ['hubSkills', 'hubTokens', 'hubEnv', 'hubProviders']) ck(`${name} lights 服务器`, navActiveKey(name) === 'server');
ck('overview still lights 服务器', navActiveKey('server') === 'server' && navActiveKey('logs') === 'server');

const parsed = parseHubScopeFixture('?fixture=hub-scope&section=tokens&theme=light');
ck('fixture parses section and theme', parsed?.section === 'tokens' && parsed?.theme === 'light');
ck('fixture ignores other pages', parseHubScopeFixture('?fixture=unread-badge') === null);
ck('unknown fixture section falls back to skills', parseHubScopeFixture('?fixture=hub-scope&section=daemon')?.section === 'skills');

const root = new URL('../', import.meta.url);
const app = readFileSync(new URL('./App.tsx', root), 'utf8');
const sidebar = readFileSync(new URL('./ServerSidebar.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('./HubScopeScreen.tsx', import.meta.url), 'utf8');
const logic = readFileSync(new URL('./hub-scope-demo.ts', import.meta.url), 'utf8');
ck('sidebar keeps overview, nodes, create, logs', ['server.overview', 'server.nodes', 'server.create', 'server.logs'].every(key => sidebar.includes(key)));
ck('sidebar adds the hub items from one list', sidebar.includes('HUB_NAV.map') && sidebar.includes('testID="server-nav-hub"') && sidebar.includes('testID={`server-nav-${item.key}`}'));
ck('desktop still routes the existing server sections', app.includes("section === 'overview'") && app.includes("setScreen({ name: 'server' })") && app.includes("section === 'nodes'") && app.includes("setScreen({ name: 'serverNodes' })") && app.includes("section === 'create'") && app.includes("setScreen({ name: 'picker' })") && app.includes("section === 'logs'") && app.includes("setScreen({ name: 'logs' })"));
ck('desktop routes each hub section and keeps the sidebar', HUB_NAV.every(item => app.includes(`'${item.screen}'`)) && app.includes('screenForHubSection(section)') && app.includes('hubSectionForScreen(screen.name)') && app.includes('<HubScopeScreen'));
ck('hub pages stay inside the server workspace', app.includes("'hubSkills', 'hubTokens', 'hubEnv', 'hubProviders'"));
ck('page uses the demo banner and not the daemon demo stack', page.includes("t('backendPending.banner')") && page.includes('testID="hub-scope-banner"') && !page.includes('DaemonPendingDemos') && !page.includes('backendPending.daemonHint'));
ck('page does not call the hub client', !/from '\.\/api'|from '\.\/app-fetch'|fetch\(/.test(page));
ck('demo logic does not call the hub client', !/from '\.\/api'|from '\.\/app-fetch'|fetch\(|XMLHttpRequest|WebSocket/.test(logic));

console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
