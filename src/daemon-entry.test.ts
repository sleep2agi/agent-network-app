// Hub 域集成里的 Daemon：一台直接进管理页，多台先列出来，点下去仍是 openDaemonFromHub。
import { readFileSync } from 'node:fs';
import { setLanguagePreference, t } from './i18n';
import './i18n-daemon';
import { daemonEntryTarget } from './daemon-entry';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  if (ok) passed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

const row = (alias: string, extra: { hostname?: string | null; online?: boolean | null } = {}) => ({ alias, ...extra });

ck('one daemon opens that alias', daemonEntryTarget({ ok: true, daemons: [row('daemon-alpha', { hostname: 'host-a', online: true })] }).kind === 'open'
  && (daemonEntryTarget({ ok: true, daemons: [row('daemon-alpha')] }) as { alias: string }).alias === 'daemon-alpha');
ck('blank alias is skipped, the remaining one still opens', (daemonEntryTarget({ ok: true, daemons: [row('  '), row('only')] }) as { kind: string; alias?: string }).kind === 'open'
  && (daemonEntryTarget({ ok: true, daemons: [row('  '), row('only')] }) as { alias: string }).alias === 'only');
ck('duplicate alias collapses to one open', (daemonEntryTarget({ ok: true, daemons: [row('same', { hostname: 'a' }), row('same', { hostname: 'b' })] }) as { kind: string; alias?: string }).alias === 'same');
const many = daemonEntryTarget({
  ok: true,
  daemons: [row('daemon-a', { hostname: ' host-a ', online: true }), row('daemon-b', { online: false }), row('daemon-a'), row('', { hostname: 'x' })],
});
ck('several daemons stay a list in hub order', many.kind === 'choose'
  && many.kind === 'choose'
  && many.daemons.map(d => d.alias).join(',') === 'daemon-a,daemon-b'
  && many.daemons[0].hostname === 'host-a'
  && many.daemons[0].online === true
  && many.daemons[1].hostname === null
  && many.daemons[1].online === false);
ck('online omitted stays unknown', (daemonEntryTarget({ ok: true, daemons: [row('a', { online: null }), row('b')] }) as { daemons: { online: boolean | null }[] }).daemons[0].online === null);
ck('no daemon is missing, not an empty shell to invent', daemonEntryTarget({ ok: true, daemons: [] }).kind === 'missing'
  && daemonEntryTarget({ ok: true }).kind === 'missing');
ck('old hub is unsupported; other failures stay errors', daemonEntryTarget({ ok: false, unconfirmed: true }).kind === 'unsupported'
  && daemonEntryTarget({ ok: false }).kind === 'error');

setLanguagePreference('zh');
ck('zh entry copy names the management page', t('daemon.entry.choose').includes('管理页') && t('server.integrations.daemon') === 'Daemon' && t('daemon.entry.loading').includes('守护进程'));
setLanguagePreference('en');
ck('en entry copy names the management page', t('daemon.entry.choose').includes('management page') && t('daemon.entry.missing').includes('has not reported'));
setLanguagePreference('system');

const root = new URL('../', import.meta.url);
const sidebar = readFileSync(new URL('./ServerSidebar.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('./App.tsx', root), 'utf8');
const screen = readFileSync(new URL('./HubDaemonEntryScreen.tsx', import.meta.url), 'utf8');
const pending = sidebar.slice(sidebar.indexOf('testID="server-pending-tabs"'), sidebar.indexOf('testID="server-nav-hub"'));
ck('sidebar lists Daemon after the runtime tab and before Hub', pending.includes('server-pending-tabs')
  && pending.includes('server-nav-daemon')
  && pending.indexOf('server-nav-daemon') > pending.indexOf('server-pending-tabs')
  && sidebar.includes("t('server.integrations.daemon')"));
ck('Daemon is not a pending demo tab', !/PENDING_TABS[^\]]*'daemon'/.test(sidebar) && !sidebar.includes("tab: 'daemon'"));
ck('desktop and phone both render the entry inside the server workspace', app.includes("'serverDaemon'")
  && app.includes('<HubDaemonEntryScreen')
  && (app.match(/<HubDaemonEntryScreen\b/g) ?? []).length >= 2
  && app.includes("section === 'daemon'")
  && app.includes("setScreen({ name: 'serverDaemon' })"));
ck('opening a daemon reuses openDaemonFromHub', (app.match(/onOpenDaemon=\{alias => setScreen\(openDaemonFromHub\(alias\)\)\}/g) ?? []).length >= 3
  && screen.includes('daemonEntryTarget')
  && screen.includes('fetchHostSupervisors')
  && screen.includes('onOpenDaemon(row.alias)')
  && screen.includes('openRef.current(target.alias)'));
ck('entry is the real route, not a pending shell', !screen.includes('BackendPendingIntegration') && !screen.includes('HubPendingScreen') && !screen.includes('backend-pending-demo'));

console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
