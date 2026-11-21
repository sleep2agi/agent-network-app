// Hub #3711 —— 机器别名的两处 UI 接线（列表行显示 / 详情页编辑）。
//   run: bun src/machine-alias-wiring.test.ts
import { readFileSync } from 'node:fs';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };
const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('./MachineAliasCard.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

ck('列表按 hostname 去重后只查一次', agents.includes('uniqueHostnames(sessions.map(row => row.hostname))'));
ck('列表行有机器名 testID（桌面 + 手机都挂）', (agents.match(/agent-machine-\$\{item\.alias\}/g) ?? []).length === 2);
ck('同名（机器名 = 节点别名）时不画', agents.includes("label && label !== row.alias ? label : ''"));
ck('详情页只在可编辑视图出现编辑卡', detail.includes("{!readOnly && node?.hostname ? <MachineAliasCard"));

ck('卡片调 PUT 并同步缓存', card.includes('putMachineAlias(cfg, host, checked.value)') && card.includes('setMachineAliasCache(cfg, host, res.alias)'));
ck('卡片提交前本地校验（与 Hub 同口径）', card.includes('normalizeMachineAlias(draft)'));
ck('卡片把错误码翻成人话', card.includes('machineAliasErrorText(res.error)'));
ck('没有 hostname 时不渲染输入框', card.includes("'这个节点没有上报 hostname，暂时无法设置机器别名。'"));
ck('api 的 GET/PUT 路径就是 /api/machines/:hostname', api.includes('/api/machines/${encodeURIComponent(host)}'));
ck('api PUT 只发 { alias }', api.includes('body: JSON.stringify({ alias })'));

ck('详情页概览事实里有「机器」一行，且跟着缓存刷新', detail.includes("label: '机器', value: machineName") && detail.includes('subscribeMachineAliases'));
console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
