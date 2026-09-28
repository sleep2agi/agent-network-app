import { columnsOf, createRequirement, nextColumn, parseRequirements } from './requirements-model';
let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('PASS: '+n); } else console.log('FAIL: '+n); };
ck('needs a name', createRequirement({ name: '  ' }) === null);
ck('bad date', createRequirement({ name: '甲', due: '2026-02-31' }) === null);
const a = createRequirement({ name: '登录', priority: 'high', assignee: '通信龙', due: '2026-10-01', id: 'a', now: '2' })!;
ck('lands in the pool', a.column === 'pool' && a.assignee === '通信龙');
ck('next column', nextColumn('pool') === 'doing' && nextColumn('doing') === 'done' && nextColumn('done') === 'pool');
const cols = columnsOf([
  a,
  { ...a, id: 'b', name: '低', priority: 'low', due: '2026-09-01', column: 'pool', createdAt: '1' },
  { ...a, id: 'c', name: '在做', column: 'doing' },
]);
ck('three columns always', cols.map(c => c.column).join() === 'pool,doing,done');
ck('pool sorts high first', cols[0].items.map(i => i.id).join() === 'a,b');
ck('doing has the moved one', cols[1].items.map(i => i.id).join() === 'c');
ck('parse keeps column', parseRequirements(JSON.stringify([a]))[0].column === 'pool');
ck('parse junk', parseRequirements('{').length === 0);
console.log(p+'/'+t);
process.exit(p === t ? 0 : 1);
