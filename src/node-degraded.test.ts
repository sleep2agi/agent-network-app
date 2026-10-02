// 节点「降级」徽标(board #460) — run: bun src/node-degraded.test.ts
// 钉住:两种数据来源同一判据(Hub 的 `degraded` 字段优先;没有时按 health + 新鲜度自己算)、
// 不知道就不画(null / 过期 / 某层没报 / 坏数据)、文案与 Hub 的 node_degraded 一致、修法不教人拷别人的凭据,
// 以及列表行 / 节点详情里的接线(屏幕 import react-native,按源码文本查)。
import { readFileSync } from 'node:fs';
import { degradedDetailLines, HEALTH_FRESH_MS, layersFromHealth, nodeDegraded } from './node-degraded';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── 不知道 = 不画 ──
ck('老 Hub / 老节点:没有 degraded 也没有 health → null', nodeDegraded({ alias: 'a', status: 'idle' }) === null);
ck('health 为 null → null', nodeDegraded({ health: null, health_observed_ms_ago: null }) === null);
ck('各层都 ok → null', nodeDegraded({ health: { bridge: 'ok', app_server: { ok: true }, tui: { ok: true, reason: 'running' }, model_auth: 'ok' }, health_observed_ms_ago: 1000 }) === null);
ck('model_auth unknown 不算降级', nodeDegraded({ health: { model_auth: 'unknown' }, health_observed_ms_ago: 1000 }) === null);
ck('报告过期(> 10 分钟)→ null', nodeDegraded({ health: { app_server: { ok: false } }, health_observed_ms_ago: HEALTH_FRESH_MS + 1 }) === null);
ck('没有观测年龄 → 不当新鲜', nodeDegraded({ health: { app_server: { ok: false } } }) === null);
ck('Hub 明说 degraded: [] → null', nodeDegraded({ degraded: [], health: { app_server: { ok: false } }, health_observed_ms_ago: 1 }) === null);
ck('坏数据不炸', nodeDegraded(null) === null && nodeDegraded('x') === null && nodeDegraded({ degraded: 'x' }) === null && nodeDegraded({ degraded: [null, 1, { label: '' }] }) === null);

// ── 从 health 算(Hub .84/.85 的完整投影)──
const fromHealth = nodeDegraded({ health: { bridge: 'ok', app_server: { ok: false, last_error: 'ECONNREFUSED' }, tui: { ok: false, reason: 'sleep-placeholder' }, model_auth: 'revoked' }, health_observed_ms_ago: 30_000 });
ck('三层都坏 → 三层,顺序 app_server / tui / model_auth', fromHealth?.layers.map(l => l.layer).join() === 'app_server,tui,model_auth');
ck('短原因 = 第一层', fromHealth?.short === 'App Server 断开');
ck('完整一句', fromHealth?.summary === '降级:App Server 断开、TUI 被占位(sleep)、需要重新登录');
ck('expired 的文案', layersFromHealth({ model_auth: 'expired' })[0]?.label === '登录已过期');
ck('未知 tui reason 的兜底文案', layersFromHealth({ tui: { ok: false, reason: 'weird' } })[0]?.label === 'TUI 不可用');

// ── Hub 的 degraded 字段优先(列表用的 ?light=1 只有它)──
const fromHub = nodeDegraded({ degraded: [{ layer: 'model_auth', label: '需要重新登录', reason: 'revoked' }], health: { app_server: { ok: false } }, health_observed_ms_ago: 1 });
ck('有 degraded 字段时以它为准(不再自己从 health 算)', fromHub?.layers.length === 1 && fromHub.short === '需要重新登录');
ck('light 行只有 degraded 也能画', nodeDegraded({ alias: 'a', status: 'idle', degraded: [{ layer: 'app_server', label: 'App Server 断开', reason: 'x' }] })?.short === 'App Server 断开');

// ── 提示条 ──
const lines = degradedDetailLines(fromHealth!);
ck('每层一行,带修法', lines.length === 3 && lines[0].startsWith('App Server 断开 — ') && lines[2].includes('CODEX_HOME'));
ck('修法只指向本节点重新登录,不教人拷凭据 / 换号', !lines.join('\n').match(/auth\.json|拷|复制|切换账号/));

// ── 接线(源码文本)──
const agents = read('./AgentsScreen.tsx');
const detail = read('./NodeDetailScreen.tsx');
const badge = read('./DegradedBadge.tsx');
ck('列表:手机 / 双栏行与桌面侧栏行都画徽标(2 处),数据来自行本身', (agents.match(/<DegradedBadge info=\{nodeDegraded\(item\)\} testID=\{`agent-degraded-\$\{item\.alias\}`\} \/>/g) ?? []).length === 2);
ck('节点详情头部画徽标', detail.includes('<DegradedBadge info={nodeDegraded(s)} testID="node-degraded" size="header" />'));
ck('不降级时组件什么都不画', badge.includes('if (!info) return null;'));
ck('完整原因在 accessibilityLabel(读屏不用点开)', badge.includes('accessibilityLabel={info.summary}'));
ck('悬停 / 点按出提示条', badge.includes('onHoverIn={() => setHovered(true)}') && badge.includes('onPress={onPress}') && badge.includes('hovered || tapped'));

console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
