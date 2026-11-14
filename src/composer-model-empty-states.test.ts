// #4823 (b) 空态覆盖：三种「拿不到模型清单」必须说三句不同的话，且各自指向自己的原因。
//
// 为什么要单独钉：这三种在面板里长得一样（都是一个错误框），若文案退化成一句
// 「读取失败」，用户无法判断该修 daemon、换节点，还是等 agent-node 上报。
// 判据：两两不同 + 每句含自己的关键因由 + 不把内部枚举原样丢给用户。

import { catalogErrorText } from './opencode-v2-model-list';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const notV2 = catalogErrorText('not_opencode_v2');
const unavailable = catalogErrorText('unavailable');
const unmanaged = catalogErrorText('catalog_unmanaged_unreported');

ck('三种空态两两不同（不是同一句话）',
  new Set([notV2, unavailable, unmanaged]).size === 3);
ck('非 V2：说明不能从该节点服务器拉清单', notV2.includes('不是 OpenCode V2'));
ck('服务器没返回：指向「服务器没返回」而不是节点类型',
  unavailable.includes('没有返回') && !unavailable.includes('不是 OpenCode V2'));
ck('手动启动/未上报：给出可执行的出路，并说明当前模型不受影响',
  unmanaged.includes('交给守护进程管理') && unmanaged.includes('不受影响'));

// 同类但不同因的三条，也不能共用一句。
const noDaemon = catalogErrorText('daemon_not_found');
const unauthorized = catalogErrorText('unauthorized');
ck('daemon 缺失与服务器拒绝各说各的',
  noDaemon !== unauthorized && noDaemon.includes('daemon') && unauthorized.includes('拒绝'));
ck('五条错误文案两两不同',
  new Set([notV2, unavailable, unmanaged, noDaemon, unauthorized]).size === 5);

// 内部枚举不许原样当文案（用户在界面上看到 `ununavailable` 之类等于没说）。
ck('不把内部枚举原样丢给用户',
  [notV2, unavailable, unmanaged, noDaemon, unauthorized].every(s => !/^[a-z_]+$/.test(s.trim())));
ck('未识别的错误保留原文并有前缀（便于排障，但不是空白）',
  catalogErrorText('weird_live_error').includes('weird_live_error') && catalogErrorText('weird_live_error').includes('失败'));

console.log(`\n${p}/${t} 通过`);
if (p !== t) process.exit(1);
