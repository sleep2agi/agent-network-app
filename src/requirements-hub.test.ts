import { readFileSync } from 'node:fs';
import { requirementFromHub } from './requirements-hub';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const row = requirementFromHub({ id: 'req_1', name: '多端', priority: 'high', assignee: 'node-a', due: '2026-10-01', column: 'doing', createdAt: '2026-09-28T00:00:00.000Z' });
ck('Hub 行能变成卡片', !!row && row.column === 'doing' && row.name === '多端' && row.due === '2026-10-01');
ck('坏日期丢掉，缺名字丢掉', requirementFromHub({ id: 'x', name: 'a', due: 'nope' })?.due === '' && requirementFromHub({ id: 'x' }) === null);

const board = norm('./RequirementBoard.tsx');
ck('说明改成存在 Hub 上', board.includes('存在 Hub 上，手机和电脑是同一份。'));
ck('不再说不进 Hub', !board.includes('不进 Hub'));
ck('读写走 Hub 接口', board.includes('listRequirements(') && board.includes('createRequirementOnHub(') && board.includes('moveRequirementOnHub('));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
