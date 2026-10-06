// #649 Hub 地址打码 —— run: bun src/mask-hub-address.test.ts
//
// 判据纪律:
//   - 每条断言都比完整期望串,不是「不含原主机名」—— 后者对 `****` 一个字都不留的错误实现也成立。
//   - 打码结果必须**不含**原主机名里被隐藏的那段(防止「前缀 + **** + 原文」这类拼错)。
//   - 接线用源码契约:复制拿 cfg.serverUrl(完整值),显示走 displayHubAddress;两个文件里不再有裸 host。
//   - 夹具只用 example.com / 文档保留段地址,不放真实生产主机。

import fs from 'node:fs';
import path from 'node:path';
import { displayHubAddress, maskedHubHost, maskHubAddress, maskUrlsInText } from './mask-hub-address';
import { describeFailure } from './server-stats';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};
const eq = (name: string, got: string, want: string) => ck(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

// ── 1. 规格里的两个例子(原样) ──
// 规格原例是一个三段域名 + 端口;这里换成同形状的占位域名。
eq('三段域名带端口:y.example.top:9300 → y.e****.top:9300', maskHubAddress('y.example.top:9300'), 'y.e****.top:9300');
eq('带协议四段域名:https://a.b.example.com → https://a.b****.com', maskHubAddress('https://a.b.example.com'), 'https://a.b****.com');

// ── 2. 域名形状 ──
eq('hub.example.com → h.e****.com', maskHubAddress('hub.example.com'), 'h.e****.com');
eq('两段域名 example.com → e****.com', maskHubAddress('example.com'), 'e****.com');
eq('单段主机 localhost:9200 → l****:9200', maskHubAddress('localhost:9200'), 'l****:9200');
eq('http 协议保留', maskHubAddress('http://hub.example.com:3000'), 'http://h.e****.com:3000');
eq('末尾斜杠不当路径', maskHubAddress('https://hub.example.com/'), 'https://h.e****.com');
eq('路径整段打码', maskHubAddress('https://hub.example.com/hub/v1?x=1'), 'https://h.e****.com/****');
eq('userinfo 整段丢掉', maskHubAddress('https://user:secret@hub.example.com:9300'), 'https://h.e****.com:9300');
ck('userinfo 里的口令不出现在结果里', !maskHubAddress('https://user:secret@hub.example.com').includes('secret'));

// ── 3. IP ──
eq('IPv4 保留首尾段,端口保留', maskHubAddress('203.0.113.177:9300'), '203.***.***.177:9300');
eq('IPv4 带协议', maskHubAddress('http://198.51.100.7'), 'http://198.***.***.7');
eq('IPv6 字面量保留第一组', maskHubAddress('[2001:db8::1]:9300'), '[2001:****]:9300');

// ── 4. 边界 ──
eq('空串原样', maskHubAddress(''), '');
eq('前后空白先去掉', maskHubAddress('  hub.example.com:9300 '), 'h.e****.com:9300');

// ── 4b. 边界(独立审查 #729 B2 / N3 逐条) ──
eq('裸单段主机 hub → h****', maskHubAddress('hub'), 'h****');
eq('IPv6 不带端口', maskHubAddress('[2001:db8::1]'), '[2001:****]');
eq('IPv6 带协议、首组为空 → 整组打码', maskHubAddress('http://[::1]:9200'), 'http://[****]:9200');
eq('无协议 userinfo 整段丢掉', maskHubAddress('user:secret@hub.example.com'), 'h.e****.com');
eq('非数字端口 → 整段打码(不猜)', maskHubAddress('hub.example.com:abc'), '****');
eq('只有协议', maskHubAddress('https://'), 'https://****');
eq('大写协议与主机:原样大小写,照样打码', maskHubAddress('HTTPS://HUB.EXAMPLE.COM'), 'HTTPS://H.E****.COM');
eq('畸形 IPv4 999.999.999.999 仍按 IPv4 形状', maskHubAddress('999.999.999.999'), '999.***.***.999');
eq('五段数字不是 IPv4 → 按域名', maskHubAddress('1.2.3.4.5'), '1.2****.5');
eq('B2:以 [ 开头没有 ] → 整段打码', maskHubAddress('[hub.example.com'), '****');
ck('B2:结果里没有原主机名', !maskHubAddress('https://[hub.example.com:9300').includes('example'), maskHubAddress('https://[hub.example.com:9300'));
eq('空主机 + 端口', maskHubAddress(':9300'), '****:9300');
eq('控制字符去掉', maskHubAddress('\u0000hub.example.com'), 'h.e****.com');

// ── 5. 被隐藏的部分真的不在结果里 ──
{
  const out = maskHubAddress('https://hub.secretname.example.com:9300');
  ck('中间段名不在结果里', !out.includes('secretname') && !out.includes('example'), out);
  ck('端口仍在', out.endsWith(':9300'), out);
}

// ── 6. displayHubAddress:屏幕文案 ──
eq('默认(未展开)= 去协议 + 打码', displayHubAddress('https://hub.example.com:9300/', false), 'h.e****.com:9300');
eq('展开 = 去协议去尾斜杠的完整值', displayHubAddress('https://hub.example.com:9300/', true), 'hub.example.com:9300');

// ── 6b. 类级:其他上屏入口用的两个助手 ──
eq('maskedHubHost = 去协议 + 打码', maskedHubHost('https://hub.example.com:9300/'), 'h.e****.com:9300');
eq('错误文案里的 URL 打码,其余字不动', maskUrlsInText('error sending request for url (https://hub.example.com:9300/api/status)'), 'error sending request for url (https://h.e****.com:9300/****)');
eq('句末标点留在原位', maskUrlsInText('无法连接 http://hub.example.com。'), '无法连接 http://h.e****.com。');
eq('没有 URL 的文案原样', maskUrlsInText('请求超时'), '请求超时');
eq('N4:ENOTFOUND 后的裸主机打码', maskUrlsInText('getaddrinfo ENOTFOUND hub.example.com'), 'getaddrinfo ENOTFOUND h.e****.com');
eq('N4:ECONNREFUSED host:port 打码', maskUrlsInText('connect ECONNREFUSED 203.0.113.9:9300'), 'connect ECONNREFUSED 203.***.***.9:9300');
eq('N4:错误文本里的畸形括号 URL 不漏', maskUrlsInText('failed https://[hub.example.com done'), 'failed https://**** done');
{
  const d = describeFailure(new Error('fetch failed: https://hub.example.com:9300/api/status'));
  ck('服务器页断开原因不带完整主机', !d.includes('hub.example.com') && d.includes('h.e****.com:9300'), d);
}

// ── 7. 接线(源码契约) ──
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const screen = read('src/ServerScreen.tsx');
const sidebar = read('src/ServerSidebar.tsx');
ck('ServerScreen: 展开状态默认 false', /const \[revealHost, setRevealHost\] = useState\(false\)/.test(screen));
ck('ServerScreen: 切服务器时收回打码', /setRevealHost\(false\); \}, \[cfg\.serverUrl\]/.test(screen));
ck('ServerScreen: 显示走 displayHubAddress(cfg.serverUrl, revealHost)', /const host = displayHubAddress\(cfg\.serverUrl, revealHost\)/.test(screen));
const addrRow = screen.match(/<InfoRow\s+icon="globe-outline"[\s\S]*?\/>/)?.[0] ?? '';
ck('ServerScreen: 地址行找到', addrRow.length > 0);
ck('ServerScreen: 地址行复制的是完整 cfg.serverUrl', /onCopy=\{\(\) => copy\('host', cfg\.serverUrl\)\}/.test(addrRow));
ck('ServerScreen: 地址行有眼睛开关', /onToggleReveal=\{\(\) => setRevealHost\(v => !v\)\}/.test(addrRow) && /revealed=\{revealHost\}/.test(addrRow));
ck('ServerScreen: 切换服务器列表也打码', /maskHubAddress\(p\.serverUrl/.test(screen));
ck('ServerScreen: 不再有裸 serverUrl 去协议当显示值', !/=\s*cfg\.serverUrl\.replace\(/.test(screen) && !/\|\|\s*p\.serverUrl\.replace\([^)]*\)\}/.test(screen));
ck('ServerScreen: 眼睛图标用主题强调色', /eye-off-outline' : 'eye-outline'\} size=\{15\} color=\{colors\.accent\}/.test(screen));
ck('ServerSidebar: 侧栏一律打码', /const host = displayHubAddress\(cfg\.serverUrl, false\)/.test(sidebar) && !/cfg\.serverUrl\.replace\(/.test(sidebar));

console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
