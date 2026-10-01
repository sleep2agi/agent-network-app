// #431(Vincent iPad「连接较慢 · 数据可能稍有延迟」):读的耗时是墙钟时间,跨过挂起(后台 / 多任务切换器)的读
// 把整段后台时间算进去 —— 不该计入判慢;以及「连接较慢」时提示条写出最近几次读(接口 · 耗时 · 大小)。
// ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  __resetConnectivityForTest, connectivityState, noteAppSuspended, readEpoch, recentReadSamples, reportReadSuccess,
  shortReadPath, slowReadDetail, SLOW_AFTER_READS, SLOW_READ_MS,
} from './connectivity';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const slow = SLOW_READ_MS + 2_000;

console.log('# 跨过挂起的读不计入判慢');
{
  __resetConnectivityForTest();
  // 三个读在切到后台前发出,回到前台才读完:墙钟耗时都是几分钟。
  const epochs = [readEpoch(), readEpoch(), readEpoch()];
  noteAppSuspended();
  for (const e of epochs) reportReadSuccess(Date.now(), 180_000, { path: '/api/nodes', epoch: e });
  ck('挂起前发出的 3 个读:不报「连接较慢」', connectivityState().level === 'online' && !connectivityState().slowReads);
  ck('成功照常记(lastSuccessAt 动了)', connectivityState().lastSuccessAt !== null);
  ck('样本里没有它们', recentReadSamples().length === 0);

  // 回到前台后真的慢:照旧报。
  for (let i = 0; i < SLOW_AFTER_READS; i++) reportReadSuccess(Date.now(), slow, { path: '/api/requirements/stats?network_id=n', bytes: 1215, epoch: readEpoch() });
  ck('前台里连续 3 次慢读:照旧「连接较慢」', connectivityState().level === 'slow');

  __resetConnectivityForTest();
  for (let i = 0; i < SLOW_AFTER_READS; i++) reportReadSuccess(Date.now(), slow);
  ck('不带 epoch 的旧调用方:行为与从前逐字相同', connectivityState().level === 'slow');
}

console.log('# 诊断行');
{
  __resetConnectivityForTest();
  reportReadSuccess(Date.now(), 7_100, { path: '/api/nodes?network_id=net_x', bytes: 12079, epoch: readEpoch() });
  reportReadSuccess(Date.now(), 6_400, { path: '/api/requirements/stats?network_id=net_x&from=2026', bytes: 1215, epoch: readEpoch() });
  reportReadSuccess(Date.now(), 9_000, { path: '/api/requirements?network_id=net_x&view=summary&changes=1', bytes: 312, epoch: readEpoch() });
  const s = connectivityState();
  const d = slowReadDetail(s);
  ck('连接较慢时给出最近 3 次读', d === 'nodes 7.1s 12KB · requirements/stats 6.4s 1KB · requirements 9.0s 312B', d ?? 'null');
  ck('不带查询串(不泄网络 id / token)', !!d && !d.includes('net_x') && !d.includes('?'));
  reportReadSuccess(Date.now(), 200, { path: '/api/nodes', epoch: readEpoch() });
  ck('一次快读就回到在线,不给诊断行', connectivityState().level === 'online' && slowReadDetail(connectivityState()) === null);
  ck('shortReadPath', shortReadPath('/api/status?light=1') === 'status' && shortReadPath('/health') === '/health');
}

console.log('# 接线');
{
  const api = src('api.ts'), hub = src('requirements-hub.ts'), poll = src('usePoll.ts'), life = src('connectivity-lifecycle.ts'), ind = src('ConnectivityIndicator.tsx');
  ck('api.ts get():读开始取 epoch、成功时带 path / bytes / epoch', /const epoch = readEpoch\(\);/.test(api) && /reportReadSuccess\(Date\.now\(\), Date\.now\(\) - started, \{ path, bytes: bodyBytes\(got\.res\), epoch \}\)/.test(api));
  ck('requirements-hub call():同上', /const epoch = readEpoch\(\);/.test(hub) && /reportReadSuccess\(Date\.now\(\), Date\.now\(\) - started, \{ path, bytes, epoch \}\)/.test(hub));
  ck('AppState 离开 active 就记一次挂起', /if \(s !== 'active'\) noteAppSuspended\(\)/.test(life));
  ck('usePoll 引入时就装上(任何轮询页面都生效)', /installConnectivityLifecycle\(\);/.test(poll));
  ck('提示条里画诊断行', /slowReadDetail\(s\)/.test(ind) && /testID="connectivity-indicator-detail"/.test(ind));
}

console.log(`${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
