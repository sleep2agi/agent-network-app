import {
  createProject,
  cycleStatus,
  dueOk,
  parseProjects,
  sortProjects,
  type ProjectItem,
} from './projects-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

ck('empty name rejected', createProject({ name: '   ' }) === null);
ck('bad date rejected', createProject({ name: '甲', due: '2026-13-01' }) === null);
ck('blank date ok', dueOk('') && createProject({ name: '甲', due: '' })?.due === '');
ck('real date ok', dueOk('2026-09-30'));
const item = createProject({ name: ' 修图钉 ', priority: 'high', assignee: ' 通信龙 ', due: '2026-10-01', now: '2026-09-28T00:00:00Z', id: 'p1' });
ck('trims name and assignee', item?.name === '修图钉' && item.assignee === '通信龙' && item.status === 'todo');
ck('cycle todo → doing → done → todo', cycleStatus('todo') === 'doing' && cycleStatus('doing') === 'done' && cycleStatus('done') === 'todo');

const items: ProjectItem[] = [
  { id: 'a', name: '低', priority: 'low', assignee: '', due: '2026-09-01', status: 'todo', createdAt: '1' },
  { id: 'b', name: '高无日期', priority: 'high', assignee: '甲', due: '', status: 'todo', createdAt: '2' },
  { id: 'c', name: '高有日期', priority: 'high', assignee: '乙', due: '2026-10-02', status: 'todo', createdAt: '3' },
  { id: 'd', name: '做完', priority: 'high', assignee: '', due: '2026-09-01', status: 'done', createdAt: '4' },
];
ck('unfinished high-with-date first, done last', sortProjects(items).map(i => i.id).join(',') === 'c,b,a,d');

const parsed = parseProjects(JSON.stringify([
  item,
  { id: 'x' },
  { id: 'y', name: '坏日期', due: 'nope', priority: 'nope', status: 'nope' },
]));
ck('parse drops junk and bad fields', parsed.length === 2 && parsed[1].due === '' && parsed[1].priority === 'normal' && parsed[1].status === 'todo');
ck('parse garbage', parseProjects('not json').length === 0 && parseProjects(null).length === 0);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
