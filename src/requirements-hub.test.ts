import { readFileSync } from 'node:fs';
import { migrateLocalRequirements, requirementFromHub, RequirementsHubError } from './requirements-hub';
import type { Requirement } from './requirements-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const row = requirementFromHub({ id: 'req_1', name: '多端', priority: 'high', assignee: 'node-a', due: '2026-10-01', column: 'doing', createdAt: '2026-09-28T00:00:00.000Z' });
ck('Hub 行能变成卡片', !!row && row.column === 'doing' && row.name === '多端' && row.due === '2026-10-01');
ck('坏日期丢掉，缺名字丢掉', requirementFromHub({ id: 'x', name: 'a', due: 'nope' })?.due === '' && requirementFromHub({ id: 'x' }) === null);

function card(id: string, name: string, column: Requirement['column'] = 'pool'): Requirement {
  return { id, name, priority: 'normal', assignee: '', due: '', column, createdAt: '2026-09-28T00:00:00.000Z' };
}
const cfg = { serverUrl: 'http://hub.local', token: 't', username: 'u', networkId: 'net', profileId: 'p' };

{
  const store = [card('a', '甲', 'doing'), card('b', '乙')];
  const posted: string[] = [];
  const result = await migrateLocalRequirements(cfg, () => store.slice(), (items) => { store.length = 0; store.push(...items); }, async (_c, input) => {
    posted.push(`${input.clientId}:${input.column}`);
    return card('hub_' + input.clientId, input.name, input.column || 'pool');
  });
  ck('Hub 已有卡片也迁本机剩下的', result.migrated === 2 && store.length === 0, posted.join(','));
  ck('迁过去时带着原来的列和本机 id', posted.join(',') === 'a:doing,b:pool');
}

{
  const store = [card('a', '甲'), card('b', '乙'), card('c', '丙')];
  let calls = 0;
  let threw = false;
  try {
    await migrateLocalRequirements(cfg, () => store.slice(), (items) => { store.length = 0; store.push(...items); }, async (_c, input) => {
      calls += 1;
      if (input.clientId === 'b') throw new RequirementsHubError('HTTP 500', 500);
      return card('hub_' + input.clientId, input.name);
    });
  } catch { threw = true; }
  ck('中途失败只留下没迁成的', threw && calls === 2 && store.map(s => s.id).join(',') === 'b,c');
  const posted: string[] = [];
  await migrateLocalRequirements(cfg, () => store.slice(), (items) => { store.length = 0; store.push(...items); }, async (_c, input) => {
    posted.push(input.clientId || '');
    return card('hub_' + input.clientId, input.name);
  });
  ck('重试把剩下的迁完', posted.join(',') === 'b,c' && store.length === 0);
}

const board = norm('./RequirementBoard.tsx');

ck('说明改成存在 Hub 上', board.includes('存在 Hub 上，手机和电脑是同一份。'));
ck('不再说不进 Hub', !board.includes('不进 Hub'));
ck('读写走 Hub 接口', board.includes('migrateLocalRequirements(') && board.includes('createRequirementOnHub(') && board.includes('moveRequirementOnHub('));
ck('不再只在 Hub 为空时才迁', !board.includes('list.length === 0'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
