// Daemon 域 SKILLS 显示判定 — run: bun src/daemon-skills-pane.test.ts
import { readFileSync } from 'node:fs';
import { DAEMON_SKILLS_EMPTY_KEY, daemonSkillsView, type DaemonSkillsEmptyReason } from './daemon-skills-pane';
import { setLanguagePreference, t } from './i18n';
import './i18n-daemon';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); } else console.log('❌', name, extra);
};
const node = { node_id: 'node_d1', alias: 'daemon' };
const base = { node, statusLoaded: true, statusFailed: false };
const reason = (v: ReturnType<typeof daemonSkillsView>) => (v.kind === 'empty' ? v.reason : 'ready');

ck('在线 + skills_capable → ready', daemonSkillsView({ ...base, session: { status: 'idle', skills_capable: true } }).kind === 'ready');
ck('working 也算在线', daemonSkillsView({ ...base, session: { status: 'working', skills_capable: true } }).kind === 'ready');
ck('offline → 不发请求,说离线(即使 skills_capable 是旧值 true)', reason(daemonSkillsView({ ...base, session: { status: 'offline', skills_capable: true } })) === 'offline');
ck('状态大小写 / 空白不影响离线判断', reason(daemonSkillsView({ ...base, session: { status: ' Offline ', skills_capable: true } })) === 'offline');
ck('心跳过期(host-supervisors online=false)即使会话还是 idle → 离线,不发请求', reason(daemonSkillsView({ ...base, supervisorOnline: false, session: { status: 'idle', skills_capable: true } })) === 'offline');
ck('host-supervisors 没列出(undefined)或 online=true 都不影响', daemonSkillsView({ ...base, supervisorOnline: undefined, session: { status: 'idle', skills_capable: true } }).kind === 'ready' && daemonSkillsView({ ...base, supervisorOnline: true, session: { status: 'idle', skills_capable: true } }).kind === 'ready');
ck('skills_capable 缺省 → unsupported,不当 false 也不当 true', reason(daemonSkillsView({ ...base, session: { status: 'idle' } })) === 'unsupported');
ck('skills_capable=false → unsupported', reason(daemonSkillsView({ ...base, session: { status: 'idle', skills_capable: false } })) === 'unsupported');
ck('没有节点行 → no-node(优先于其它)', reason(daemonSkillsView({ ...base, node: null, session: { status: 'idle', skills_capable: true } })) === 'no-node');
ck('node_id 为空 → no-node', reason(daemonSkillsView({ ...base, node: { node_id: '', alias: 'd' }, session: null })) === 'no-node');
ck('全量 status 没读过 → loading', reason(daemonSkillsView({ ...base, statusLoaded: false, session: null })) === 'loading');
ck('全量 status 读失败 → status-unread,不退回猜测', reason(daemonSkillsView({ ...base, statusFailed: true, session: null })) === 'status-unread');
ck('读到了但没有这个 alias 的会话 → no-session', reason(daemonSkillsView({ ...base, session: null })) === 'no-session');

const reasons: DaemonSkillsEmptyReason[] = ['loading', 'no-node', 'status-unread', 'no-session', 'offline', 'unsupported'];
for (const lang of ['zh', 'en'] as const) {
  setLanguagePreference(lang);
  ck(`每个空态都有 ${lang} 文案(不是 key 原样)`, reasons.every(r => { const text = t(DAEMON_SKILLS_EMPTY_KEY[r]); return text && text !== DAEMON_SKILLS_EMPTY_KEY[r]; }));
}

// 接线:Daemon 页 SKILLS 走真组件,不再给 skills 放 demo;令牌 / Provider 仍是演示壳。
const screen = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
ck('SKILLS 页渲染 DaemonSkillsPane 并传 daemon 节点行', /pendingSection === 'skills'[\s\S]*?<DaemonSkillsPane cfg=\{cfg\} alias=\{alias\} node=\{daemon\} supervisorOnline=\{/.test(screen));
ck('令牌 / Provider 仍走演示壳(带「演示数据」横幅)', screen.includes('<BackendPendingIntegration layer="daemon" tab={pendingSection}'));
const pane = readFileSync(new URL('./DaemonSkillsPane.tsx', import.meta.url), 'utf8');
ck('Pane 读全量 status(带 alias),不用 ?light=1', pane.includes('fetchNodeStatus(cfg, alias)') && !pane.includes('fetchStatus('));
ck('Pane 复用 NodeSkillsSection', pane.includes("from './NodeSkillsSection'") && pane.includes('<NodeSkillsSection'));

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
