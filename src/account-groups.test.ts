// 设置 → 账号:其他账号按 Hub 分组(管理员 2026-11-15)。
import { accountRowDetail, groupProfilesByHub, shortNetworkId } from './account-groups';
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import type { HubProfile } from './storage';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const prof = (profileId: string, serverUrl: string, username: string, networkId?: string, displayName?: string): HubProfile =>
  ({ profileId, serverUrl, username, networkId, displayName, createdAt: 0, updatedAt: 0 });

const list = [
  prof('a', 'https://hub.example.top:9300', 'chuqi', 'net_399bdf86f528'),
  prof('b', 'https://hub.example.top:9300', 'admin', 'net_399bdf86f528'),
  prof(LOCAL_HUB_PROFILE_ID, 'http://127.0.0.1:9201', 'local-admin', 'net_ee6c4e65b2be', 'Local workspace'),
  prof('c', 'https://hub.example.top', 'tang', 'net_ac567b4ab74e'),
  prof('d', 'https://hub.example.top:9300', 'sun', 'net_f70127d0662a'),
];
const groups = groupProfilesByHub(list);
ck('same host+port share one group, first-seen order, local first', eq(groups.map(g => [g.local, g.profiles.map(x => x.profileId)]), [[true, [LOCAL_HUB_PROFILE_ID]], [false, ['a', 'b', 'd']], [false, ['c']]]));
ck('different port = different Hub group', groups.filter(g => !g.local).length === 2);
ck('empty list → no groups', groupProfilesByHub([]).length === 0);
ck('short network id 已废弃：恒返回空串（内部 id 不再外露）', shortNetworkId('net_399bdf86f528') === '' && shortNetworkId(undefined) === '');
ck('row detail: no host, no network id', accountRowDetail(list[0], '网络') === '');
ck('row detail: username shown only when display name differs', accountRowDetail(list[2], '网络') === 'local-admin' && accountRowDetail(prof('x', 'h', 'u', undefined, 'u'), 'net') === '');

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
