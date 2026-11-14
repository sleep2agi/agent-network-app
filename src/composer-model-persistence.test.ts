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
ck('切换写节点配置：带 nodeId / baseRevision / patch（model 由 helper 产出）',
  /updateNodeConfig\(cfgRef\.current,\s*\{[\s\S]{0,200}nodeId:\s*node\.node_id[\s\S]{0,140}baseRevision:\s*config\.config_revision[\s\S]{0,120}patch:\s*buildConfigPatch\(\{\s*model:\s*row\.key\s*\}\)/.test(palette));
// 档位与模型同一个补丁里写，且**形状来自契约 helper**（null=清除 / 省略=不改 只在一处定义）。
ck('档位的 patch 形状来自 buildConfigPatch（不再就地拼字段）',
  /patch:\s*buildConfigPatch\(\{\s*modelVariant:\s*next\s*\}\)/.test(palette));
// #4823 —— 换档位不换模型时，补丁里**不得**出现 model key。
//   daemon 侧 writeStock 判的是 `patch.model !== undefined`（key 在不在，不是值变没变），
//   固定带当前 model 会让「单改档位」在旧 agent-node 上被拒 unsupported ⇒ 发最小补丁。
ck('换档位的补丁不带 model key（最小补丁，跨 agent-node 版本安全）',
  !/patch:\s*buildConfigPatch\(\{[^}]*\bmodel:\s*effectiveModel[^}]*modelVariant:/.test(palette));
ck('不再有「就地拼 {model, modelVariant}」的第二份实现',
  !/patch:\s*\{\s*model:\s*effectiveModel,\s*modelVariant:/.test(palette));
// helper 语义锚点：显式 null 必须落 key（清除），省略必须不落 key（不动）。这两条一旦变，
// 走 helper 的调用点会跟着变，而就地拼的调用点不会 —— 这正是收口的原因。
{
  const { buildConfigPatch } = await import('./node-variant-patch');
  const cleared = buildConfigPatch({ model: 'p/m', modelVariant: null });
  const omitted = buildConfigPatch({ model: 'p/m' });
  const picked = buildConfigPatch({ model: 'p/m', modelVariant: 'high' });
  ck('helper：null 落 key（清除）、省略不落 key（不改）、string 落值',
    Object.prototype.hasOwnProperty.call(cleared, 'modelVariant') && cleared.modelVariant === null
    && !Object.prototype.hasOwnProperty.call(omitted, 'modelVariant')
    && picked.modelVariant === 'high');
}
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

// 5) #4822：档位是独立字段。换模型**不自动清除**档位（省略=不改），也不把“未知”当默认；
//    原档位在新模型上不成立时，如实提示重选并**留在面板里**（不静默写 modelVariant:null）。
ck('换模型后档位需要重选 → 提示并留在面板（不自动清除）',
  /variantAfterModelSwitch\(\{[\s\S]{0,220}nextModelVariants: row\.choices\.kind === 'unknown' \? undefined/.test(palette)
  && palette.includes('variantNeedsReselect')
  && /carry\.action === 'must-reselect'[\s\S]{0,320}return;/.test(palette));
// #4823 review（ANet负责人 2026-11-15）：
//   a) 用户提示里不能塞 helper 的 reason 原文 —— 那是开发判据，英文界面会插进中文；按判别码给 i18n key。
//   b) ackOnly（只收到 ACK、没读回到新模型）必须先判 —— 否则「模型已切换」这句说过头了。
ck('档位重选提示按判别码取文案，不展示 reason 原文',
  /variantNeedsReselect\.\$\{carry\.code\}/.test(palette)
  && !/variantNeedsReselect[\s\S]{0,80}reason:/.test(palette));
ck('ackOnly 判断在 must-reselect 之前（ACK-only 时不说「模型已切换」）',
  palette.indexOf("verdict.ackOnly") > -1
  && palette.indexOf("verdict.ackOnly") < palette.indexOf("carry.action === 'must-reselect'"));
ck('换模型的补丁里不带 modelVariant（省略=不改档）',
  /patch:\s*buildConfigPatch\(\{\s*model:\s*row\.key\s*\}\)/.test(palette));
{
  const { variantAfterModelSwitch } = await import('./node-variant-patch');
  const keep = variantAfterModelSwitch({ previousModel: 'a/b', nextModel: 'a/c', currentVariant: 'high', nextModelVariants: ['high', 'low'] });
  const none = variantAfterModelSwitch({ previousModel: 'a/b', nextModel: 'a/c', currentVariant: 'high', nextModelVariants: [] });
  const unknown = variantAfterModelSwitch({ previousModel: 'a/b', nextModel: 'a/c', currentVariant: 'high', nextModelVariants: undefined });
  ck('契约：列表含档位→keep；明确没有/未知→must-reselect（不猜、不清除）',
    keep.action === 'keep' && none.action === 'must-reselect' && unknown.action === 'must-reselect');
}

// 4) 不写死模型表：列表只来自节点自报/服务器目录。
ck('列表只从节点自报或服务器目录来，不含内置模型常量',
  !/const\s+(BUILTIN|DEFAULT)_?MODELS?\b/.test(palette) && /opencode_catalog/.test(palette));

console.log(`\n${p}/${t} 通过`);
if (p !== t) process.exit(1);
