// #4823 ①③ —— 「选择按节点记住」到底靠什么成立：靠**节点配置**，不是本地存储。
//
// 这份测试不测 UI 长相，只钉三件会被后人改坏的接线：
//   1) 切换写的是节点配置（nodeId + baseRevision + patch.model），因此重开客户端天然还在；
//   2) 写成功后必须**读回**才敢说生效（ACK-only 时不关面板、不冒充 model_effective）；
//   3) 面板按 账号|网络|别名|节点 重挂，换节点不会把上一个节点的值带过来。
// 纯源码断言（该项目既有测试同一风格），不 import react-native。

import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const palette = src('./ComposerModelPalette.tsx');
const chat = src('./ChatScreen.tsx');

// 1) 写节点配置：这是「按节点记忆」的承载物。
ck('切换写节点配置：带 nodeId / baseRevision / patch.model',
  /updateNodeConfig\(cfgRef\.current,\s*\{[\s\S]{0,160}nodeId:\s*node\.node_id[\s\S]{0,120}baseRevision:\s*config\.config_revision[\s\S]{0,80}patch:\s*\{\s*model:\s*row\.key\s*\}/.test(palette));
// 档位与模型同一个补丁里写；`next` 为 null 表示显式清除（省略=不动），与 node-variant-patch 契约一致。
ck('档位也写节点配置（model + modelVariant 同一次补丁）',
  /patch:\s*\{\s*model:\s*effectiveModel,\s*modelVariant:\s*next\s*\}/.test(palette));
ck('冲突时重新拉配置（revision 已抬高，不能拿旧值硬写）',
  palette.includes('res.conflict') && palette.includes('reloadConfig()'));

// 2) 生效判定：ACK + 读回双条件；只 ACK 不许冒充生效。
ck('写成功后读回节点配置（fetchNodeConfig）', /fetchNodeConfig\(/.test(palette));
ck('用 confirmComposerModelSwitch 判定（本次 updateId + 读回）',
  /confirmComposerModelSwitch\(\{\s*after,\s*updateId:\s*res\.update_id,\s*requested:\s*row\.key/.test(palette.replace(/\s+/g, ' ').replace(/\( /g, '(')));
ck('只 ACK 未读回时给回执提示且不关面板',
  palette.includes('appliedNoReadback') && !/verdict\.ackOnly[\s\S]{0,120}closeRef\.current\(\)/.test(palette));

// 3) 面板按节点重挂 + 渲染态带作用域身份（换节点/换账号不串）。
ck('面板 key 含 账号|网络|别名|节点',
  /key=\{`\$\{cfg\.profileId \?\? cfg\.serverUrl\}\|\$\{cfg\.networkId \?\? ''\}\|\$\{alias\}\|\$\{targetNode\?\.node_id \?\? 'none'\}`\}/.test(chat));
ck('渲染态用 scope 对象身份比较（A→B→A 也换新 scope）',
  /useMemo\(\(\) => \(\{\}\), \[cfg, alias\]\)/.test(chat) && /useMemo\(\(\) => \(\{\}\), \[composerModelScope, scopeToken\]\)/.test(chat));
ck('scopeToken 含 profileId / serverUrl / networkId / alias / 节点',
  /\[cfg\.profileId, cfg\.serverUrl, cfg\.networkId, alias, wantedNodeId\]/.test(chat));
ck('快照带 TTL，过期不显示（不拿旧节点值冒充当前）',
  /expiresAt: Date\.now\(\) \+ 35_000/.test(chat) && /activeComposerModelValue\(/.test(chat));

// 4) 不写死模型表：列表只来自节点自报/服务器目录。
ck('列表只从节点自报或服务器目录来，不含内置模型常量',
  !/const\s+(BUILTIN|DEFAULT)_?MODELS?\b/.test(palette) && /opencode_catalog/.test(palette));

console.log(`\n${p}/${t} 通过`);
if (p !== t) process.exit(1);
