// 「在新窗口打开」任务:事件载荷、谁该刷新(task-window-model.ts)。
import { changeConcernsMe, parseTaskChanged, parseTaskWindowPayload, readTaskWindowRoute, taskWindowLabel, taskWindowTitle } from './task-window-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };

ck('路由只认 ?taskWindow=1', readTaskWindowRoute('?taskWindow=1') && !readTaskWindowRoute('?taskWindow=0') && !readTaskWindowRoute('?chat=a'));
ck('标签:同账号同任务相同,换任务 / 换账号不同', taskWindowLabel('p', 'r1') === taskWindowLabel('p', 'r1') && taskWindowLabel('p', 'r1') !== taskWindowLabel('p', 'r2') && taskWindowLabel('p', 'r1') !== taskWindowLabel('q', 'r1'));
const ok = parseTaskWindowPayload({ taskId: 'r1', profileId: 'p', serverUrl: 'http://127.0.0.1:1', networkId: 'n', title: '登录页', at: 5, token: 'utok_should_be_dropped' });
ck('载荷:认得的字段收下,凭据一类的字段丢掉', !!ok && ok.taskId === 'r1' && ok.networkId === 'n' && !('token' in (ok as object)));
ck('载荷:没有任务 id / 地址不是 http(s) = 不认', parseTaskWindowPayload({ serverUrl: 'http://x' }) === null && parseTaskWindowPayload({ taskId: 'r', serverUrl: 'file:///etc' }) === null && parseTaskWindowPayload(null) === null);
ck('标题', taskWindowTitle('登录页') === '登录页 · Agent Network' && taskWindowTitle('  ') === '任务 · Agent Network');
const me = { label: 'main', profileId: 'p', serverUrl: 'http://hub:1/', networkId: 'n' };
const change = (x: object) => parseTaskChanged({ serverUrl: 'http://hub:1', from: 'task-1', profileId: 'p', networkId: 'n', ...x })!;
ck('别的窗口改了同一块看板 → 刷新(地址末尾斜杠不算不同)', changeConcernsMe(change({}), me));
ck('自己发的不刷新', !changeConcernsMe(change({ from: 'main' }), me));
ck('别的账号 / 别的网络 / 别的 Hub 不刷新', !changeConcernsMe(change({ profileId: 'q' }), me) && !changeConcernsMe(change({ networkId: 'm' }), me) && !changeConcernsMe(change({ serverUrl: 'http://other:1' }), me));
ck('形状不对 = 不认', parseTaskChanged({ from: 'x' }) === null && parseTaskChanged('x') === null);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
