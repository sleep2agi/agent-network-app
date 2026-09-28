import { groupTasksByBucket, statusBucket } from './tasks-filter';
import type { HubTask } from './api';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('PASS: '+n); } else console.log('FAIL: '+n); };

const task = (status: string, id: string): HubTask => ({ task_id: id, status } as HubTask);
const groups = groupTasksByBucket([
  task('running', 'a'),
  task('delivered', 'b'),
  task('replied', 'c'),
  task('failed', 'd'),
  task('', 'e'),
  task('weird', 'f'),
]);
const by = Object.fromEntries(groups.map(g => [g.bucket, g.tasks.map(x => x.task_id)]));
ck('pending holds empty status', by.pending.join() === 'e');
ck('running includes delivered', by.running.join() === 'a,b');
ck('replied', by.replied.join() === 'c');
ck('failed', by.failed.join() === 'd');
ck('unknown only when present', by.unknown.join() === 'f');
ck('empty unknown is omitted', !groupTasksByBucket([task('running','a')]).some(g => g.bucket === 'unknown'));
ck('empty columns stay', groupTasksByBucket([]).map(g => g.bucket).join() === 'pending,running,replied,failed');
ck('statusBucket still maps completed', statusBucket('completed') === 'replied');
console.log(p+'/'+t);
process.exit(p === t ? 0 : 1);
