// 服务器页「机器」水位(看板 #618)—— run: bun src/host-levels.test.ts
//
// 判据纪律:
//   - 「最新者胜」必须用**新旧两行数字不同**的输入,并断言取到的是新的那组 —— 两行相同的话取错也是绿。
//   - 「缺字段 = —」要同时断言 pct 是 null、文字是「—」、颜色不是 ok —— 只断言文字守不住条画成 0%。
//   - 过期:边界两侧各一条(恰好 5 分钟不算过期,5 分 1 秒算),并断言过期机器不参与红色排前。
//   - 源码契约只管接线(谁把 host 筛选传给谁),行为由纯函数断言钉住。

import fs from 'node:fs';
import path from 'node:path';
import type { Session } from './api';
import {
  ageLabel,
  compareHosts,
  cpuMeter,
  heartbeatMs,
  HOST_STALE_MS,
  hostLevels,
  isStale,
  levelTone,
  sizeMeter,
  telemetryOf,
} from './host-levels';
import { applyAgentFilter, filterLabel, isFilterActive } from './server-stats';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

const NOW = Date.parse('2026-10-06T12:00:00Z');
/** hub 的时间格式:UTC、无时区、空格分隔。 */
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString().replace('T', ' ').slice(0, 19);

type H = Partial<Record<'hostname' | 'ip' | 'cpu_load_1min' | 'cpu_cores' | 'mem_total_gb' | 'mem_used_gb' | 'mem_avail_gb' | 'disk_total_gb' | 'disk_used_gb' | 'disk_avail_gb', unknown>>;
/** 一行全量 /api/status:host 对象 + 平铺字段(与 Hub 同形)。 */
const row = (alias: string, status: string, minAgo: number, host: H): Session => ({ alias, status, updated_at: ago(minAgo), ...host, host: { ...host } } as unknown as Session);
const full = (hostname: string, o: H = {}): H => ({
  hostname, ip: '192.0.2.10', cpu_load_1min: 2, cpu_cores: 16, mem_total_gb: 64, mem_used_gb: 16, mem_avail_gb: 48, disk_total_gb: 500, disk_used_gb: 100, disk_avail_gb: 400, ...o,
});

// ── 1. 分组 ──
{
  const r = hostLevels([
    row('a-1', 'idle', 1, full('host-a')),
    row('a-2', 'working', 1, full('host-a')),
    row('a-3', 'offline', 30, full('host-a')),
    row('b-1', 'idle', 1, full('host-b')),
    row('x-1', 'idle', 1, {}), // 没上报 hostname
    row('x-2', 'idle', 1, { hostname: '   ' }), // 空白 hostname
  ], NOW);
  ck('按 hostname 分成两台', r.hosts.length === 2, JSON.stringify(r.hosts.map(h => h.hostname)));
  const a = r.hosts.find(h => h.hostname === 'host-a');
  ck('host-a 在线 2 / 共 3', a?.online === 2 && a?.total === 3, JSON.stringify(a && { o: a.online, t: a.total }));
  ck('host-a 的别名全收(含离线的)', a?.aliases.join() === 'a-1,a-2,a-3', a?.aliases.join());
  ck('没有 hostname 的行只计数,不成一台「未知」机器', r.unreported === 2 && !r.hosts.some(h => !h.hostname.trim()), String(r.unreported));
  ck('hostname 去首尾空白后同一台', hostLevels([row('p', 'idle', 1, full(' host-c ')), row('q', 'idle', 1, full('host-c'))], NOW).hosts.length === 1);
  ck('空列表 → 0 台', hostLevels([], NOW).hosts.length === 0);
}

// ── 2. 最新者胜(整行取,不跨行拼) ──
{
  const r = hostLevels([
    row('old', 'idle', 4, full('host-a', { mem_used_gb: 10, disk_used_gb: 450 })),
    row('new', 'idle', 1, full('host-a', { mem_used_gb: 60, disk_total_gb: null, disk_used_gb: null })),
    row('mid', 'idle', 2, full('host-a', { mem_used_gb: 30 })),
  ], NOW);
  const a = r.hosts[0];
  ck('取 updated_at 最新那行的内存(60/64)', a.mem.detail === '60 / 64 GB', a.mem.detail);
  ck('最新行没报磁盘 ⇒ 磁盘「—」,不从旧行拼 450/500', a.disk.pct === null && a.disk.value === '—', JSON.stringify(a.disk));
  ck('心跳时间 = 最新那行', a.heartbeatMs === heartbeatMs(ago(1)) && a.ageMs === 60_000, String(a.ageMs));
  // 输入顺序不影响结果
  const rev = hostLevels([
    row('new', 'idle', 1, full('host-a', { mem_used_gb: 60 })),
    row('old', 'idle', 4, full('host-a', { mem_used_gb: 10 })),
  ], NOW);
  ck('新行排在前面也取新行', rev.hosts[0].mem.detail === '60 / 64 GB', rev.hosts[0].mem.detail);
  ck('host 对象优先于平铺字段', telemetryOf({ alias: 'z', status: 'idle', hostname: 'flat', host: { hostname: 'obj' } } as unknown as Session)?.hostname === 'obj');
  ck('只有平铺字段(没有 host 对象)也读得出', telemetryOf({ alias: 'z', status: 'idle', hostname: 'flat', cpu_cores: 8 } as unknown as Session)?.cpu_cores === 8);
  ck('heartbeatMs 把 SQLite 无时区时间当 UTC', heartbeatMs('2026-10-06 12:00:00') === NOW);
  ck('heartbeatMs 读不出 = 0', heartbeatMs('') === 0 && heartbeatMs(undefined) === 0 && heartbeatMs('nope') === 0);
}

// ── 3. 缺字段 = 「—」,不是 0% ──
{
  const m = sizeMeter(null, 64);
  ck('used 缺失 → pct null', m.pct === null);
  ck('used 缺失 → 「—」', m.value === '—' && m.detail === '—', JSON.stringify(m));
  ck('used 缺失 → 颜色 none(不是 ok 绿)', m.tone === 'none');
  ck('total 缺失 → 「—」', sizeMeter(10, null).value === '—');
  ck('total 为 0 → 「—」(不除以 0)', sizeMeter(0, 0).value === '—' && sizeMeter(0, 0).pct === null);
  ck('used 为 0 是真 0%,不是缺失', sizeMeter(0, 64).value === '0%' && sizeMeter(0, 64).tone === 'ok');
  const c = cpuMeter({ cpu_load_1min: null, cpu_cores: 16 });
  ck('CPU load 缺失 → 「—」', c.pct === null && c.value === '—' && c.detail === '—', JSON.stringify(c));
  const c2 = cpuMeter({ cpu_load_1min: 3, cpu_cores: null });
  ck('CPU 核数缺失 → 百分比「—」但仍显示原始 load', c2.pct === null && c2.value === '—' && c2.detail === 'load 3', JSON.stringify(c2));
  ck('字符串数字不当数字(Hub 给 null 时也一样)', telemetryOf(row('s', 'idle', 1, full('h', { mem_used_gb: '12' as unknown as number })))?.mem_used_gb === null);
  const r = hostLevels([row('d', 'idle', 1, full('host-d', { disk_total_gb: null, disk_used_gb: null, disk_avail_gb: null }))], NOW).hosts[0];
  ck('整台机器缺磁盘:磁盘「—」,CPU/内存照常', r.disk.value === '—' && r.cpu.value !== '—' && r.mem.value !== '—', JSON.stringify([r.cpu.value, r.mem.value, r.disk.value]));
  ck('缺字段不拉低/抬高整机档位', r.worst === 'ok', r.worst);
}

// ── 4. 阈值 70 / 90 ──
ck('69.9 → ok', levelTone(69.9) === 'ok');
ck('70 → warn(70 含在 warn)', levelTone(70) === 'warn');
ck('90 → warn(90 含在 warn)', levelTone(90) === 'warn');
ck('90.1 → danger', levelTone(90.1) === 'danger');
ck('null / NaN → none', levelTone(null) === 'none' && levelTone(NaN) === 'none');
{
  ck('内存 44.8/64 = 70% → warn', sizeMeter(44.8, 64).tone === 'warn', sizeMeter(44.8, 64).value);
  ck('内存 58/62.6 = 92.7% → danger', sizeMeter(58, 62.6).tone === 'danger' && sizeMeter(58, 62.6).value === '93%');
  ck('磁盘 450/500 = 90% → warn', sizeMeter(450, 500).tone === 'warn');
  const hot = cpuMeter({ cpu_load_1min: 24, cpu_cores: 16 });
  ck('CPU load 24 / 16 核:条封顶 100%', hot.pct === 100 && hot.value === '100%', JSON.stringify(hot));
  ck('CPU 超 100% 仍是 danger,原始 load 照写', hot.tone === 'danger' && hot.detail === 'load 24 / 16 核', hot.detail);
  ck('CPU load 8 / 16 核 = 50% ok', cpuMeter({ cpu_load_1min: 8, cpu_cores: 16 }).value === '50%' && cpuMeter({ cpu_load_1min: 8, cpu_cores: 16 }).tone === 'ok');
  ck('CPU load 两位小数', cpuMeter({ cpu_load_1min: 1.23456, cpu_cores: 4 }).detail === 'load 1.23 / 4 核');
  ck('GB:≥100 取整,其余一位小数', sizeMeter(123.4, 500.2).detail === '123 / 500 GB' && sizeMeter(7.25, 62.6).detail === '7.3 / 62.6 GB', sizeMeter(7.25, 62.6).detail);
}

// ── 5. 过期 > 5 分钟 ──
{
  ck('isStale: 恰好 5 分钟不算过期', !isStale(HOST_STALE_MS, 1));
  ck('isStale: 5 分 1 秒算过期', isStale(HOST_STALE_MS + 1000, 1));
  ck('isStale: 心跳时间读不出算过期', isStale(null, 3));
  ck('isStale: 新心跳但节点全部离线也算过期', isStale(60_000, 0));
  const fresh = hostLevels([row('f', 'idle', 4, full('host-f', { mem_used_gb: 62 }))], NOW).hosts[0];
  ck('4 分钟前的心跳:不过期、按真实档位上色', !fresh.stale && fresh.staleLabel === null && fresh.mem.tone === 'danger' && fresh.worst === 'danger');
  const old = hostLevels([row('s', 'idle', 12, full('host-s', { mem_used_gb: 62 }))], NOW).hosts[0];
  ck('12 分钟前的心跳:stale', old.stale);
  ck('过期文案「数据 12 分钟前」', old.staleLabel === '数据 12 分钟前', String(old.staleLabel));
  ck('过期机器不算红(worst = none),数字不当作「现在」', old.worst === 'none');
  const off = hostLevels([row('o1', 'offline', 2, full('host-o')), row('o2', 'offline', 3, full('host-o'))], NOW).hosts[0];
  ck('节点全离线的机器仍然出现', !!off && off.total === 2 && off.online === 0);
  ck('节点全离线 ⇒ 标记过期「节点均离线」', off.stale && off.staleLabel === '节点均离线', String(off.staleLabel));
  const offOld = hostLevels([row('o3', 'offline', 300, full('host-p'))], NOW).hosts[0];
  ck('全离线且心跳很旧 ⇒「数据 5 小时前」', offOld.stale && offOld.staleLabel === '数据 5 小时前', String(offOld.staleLabel));
  ck('ageLabel 分钟 / 小时 / 天', ageLabel(6 * 60_000) === '数据 6 分钟前' && ageLabel(3 * 3600_000) === '数据 3 小时前' && ageLabel(72 * 3600_000) === '数据 3 天前');
  const noTime = hostLevels([{ alias: 'n', status: 'idle', hostname: 'host-n' } as unknown as Session], NOW).hosts[0];
  ck('没有 updated_at ⇒ 过期、「数据时间未知」', noTime.stale && noTime.ageMs === null && noTime.staleLabel === '数据时间未知', String(noTime.staleLabel));
}

// ── 6. 排序:红色在前,再按节点数 ──
{
  const r = hostLevels([
    ...Array.from({ length: 6 }, (_, i) => row(`big-${i}`, 'idle', 1, full('host-big'))), // 6 在线,全绿
    row('red-1', 'idle', 1, full('host-red', { mem_used_gb: 61 })), // 1 在线,内存红
    ...Array.from({ length: 3 }, (_, i) => row(`mid-${i}`, 'idle', 1, full('host-mid', { disk_used_gb: 400 }))), // 3 在线,磁盘 80% 黄
    ...Array.from({ length: 9 }, (_, i) => row(`stale-${i}`, 'offline', 30, full('host-stale', { mem_used_gb: 63 }))), // 9 个离线,过期且红(总数最多)
    row('cpu-red', 'working', 1, full('host-cpu', { cpu_load_1min: 40 })), // CPU 红
  ], NOW);
  const order = r.hosts.map(h => h.hostname);
  ck('两台红色机器排最前', order.slice(0, 2).sort().join() === 'host-cpu,host-red', order.join());
  ck('红色内部按节点数、再按名字', order[0] === 'host-cpu' && order[1] === 'host-red', order.join());
  ck('其余按在线节点数降序(6 > 3 > 0)', order.slice(2).join() === 'host-big,host-mid,host-stale', order.join());
  ck('过期的红机器不排到红色区', order.indexOf('host-stale') > order.indexOf('host-big'), order.join());
  const base = r.hosts.find(h => h.hostname === 'host-big')!;
  ck('compareHosts 在线数相同按总数', compareHosts({ ...base, hostname: 'x', online: 2, total: 5 }, { ...base, hostname: 'y', online: 2, total: 3 }) < 0);
}

// ── 7. 点一台机器 → 节点列表按机器筛 ──
{
  const light = [
    { alias: 'a-1', status: 'idle' }, { alias: 'a-2', status: 'offline' }, { alias: 'b-1', status: 'idle' },
  ] as Session[];
  const f = { host: 'host-a', aliases: ['a-1', 'a-2'] };
  ck('host 筛选按别名命中(light 行没有 hostname)', applyAgentFilter(light, f).map(s => s.alias).join() === 'a-1,a-2');
  ck('host + 状态 组合', applyAgentFilter(light, { ...f, status: 'online' }).map(s => s.alias).join() === 'a-1');
  ck('行上带 hostname 时也按 hostname 命中', applyAgentFilter([{ alias: 'z', status: 'idle', hostname: 'host-a' } as Session], { host: 'host-a', aliases: [] }).length === 1);
  ck('isFilterActive 认 host', isFilterActive({ host: 'host-a' }));
  ck('filterLabel 写机器名', filterLabel({ host: 'host-a', status: 'offline' }) === '机器 host-a · 离线', filterLabel({ host: 'host-a', status: 'offline' }));
}

// ── 8. 接线(源码契约) ──
{
  const root = path.join(import.meta.dir ?? path.dirname(new URL(import.meta.url).pathname), '..');
  const server = fs.readFileSync(path.join(root, 'src/ServerScreen.tsx'), 'utf8');
  const agents = fs.readFileSync(path.join(root, 'src/AgentsScreen.tsx'), 'utf8');
  ck('服务器页用 hostLevels 算机器分区', server.includes('hostLevels(hostRows'));
  ck('服务器页读全量投影(light 没有 host 字段)', server.includes('fetchNodeStatus(cfg)'));
  ck('点机器行 → onOpenAgents 带 host + aliases', server.includes('onOpenAgents?.({ host: h.hostname, aliases: h.aliases })'));
  ck('机器分区默认最多 HOSTS_COLLAPSED 台', server.includes('hosts.slice(0, HOSTS_COLLAPSED)'));
  ck('节点列表筛选条显示机器名', agents.includes('`机器 ${activeFilter.host}`'));
}

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
