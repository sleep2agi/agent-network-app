// admin 2026-11-11「体验非常不好」：收编来的节点在模型面板只显示原始错误 node_not_found。
// 守护：daemon 代读失败（排队 / 轮询 / 超时）一律先退回节点自报清单，没有才显示翻译过的原因。
//   run: bun src/composer-model-palette-fallback.test.ts
import { readFileSync } from 'node:fs';
import { catalogErrorText, peerCatalogWithVariants, reportedCatalogWithVariants } from './opencode-v2-model-list';
import { paletteVariantChoices } from './composer-model-palette';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => { total++; if (condition) passed++; else console.log('❌', name); };
const src = readFileSync(new URL('./ComposerModelPalette.tsx', import.meta.url), 'utf8');

ck('queue failure goes through the fallback', src.includes('if (!queued.ok) { failWith(queued.error); return; }'));
ck('poll failure goes through the fallback', src.includes('if (!polled.ok) { failWith(polled.error); return; }'));
ck('timeout goes through the fallback', src.includes("if (live) failWith('unavailable');"));
ck('fallback prefers the node-reported catalogue', /const failWith = [^;]*reportedSnapshot\s*\?\s*\{ snapshot: reportedSnapshot/.test(src));
ck('raw queue error is never shown', !src.includes('error: queued.error'));
ck('node_not_found is translated', catalogErrorText('node_not_found') !== 'node_not_found' && catalogErrorText('node_not_found').includes('读不到模型列表'));

// admin 2026-11-11「有没有让他正常上报」：自报档位 → 面板可点的 none/low/high/max。
{
  const models = reportedCatalogWithVariants(
    ['deepseek/deepseek-flash', 'opencode/plain', 'deepseek/deepseek-flash'],
    ['deepseek/deepseek-flash=none,low,high,max', 'junk', 'opencode/plain=', 'x/y=bad value'],
  );
  ck('reported variants attach to their model', JSON.stringify(models) === JSON.stringify([
    { providerId: 'deepseek', id: 'deepseek-flash', variants: ['none', 'low', 'high', 'max'] },
    { providerId: 'opencode', id: 'plain' },
  ]));
  const choices = paletteVariantChoices({ models } as never, 'deepseek/deepseek-flash');
  ck('palette offers the reported levels', choices.kind !== 'unknown' && choices.kind !== 'none' && JSON.stringify((choices as { options: string[] }).options).includes('high'));
  ck('a model without reported levels stays unknown (not invented)', paletteVariantChoices({ models } as never, 'opencode/plain').kind === 'unknown');
  ck('old Hub without the field still yields the plain list', reportedCatalogWithVariants(['a/b'], undefined).length === 1);
  ck('palette uses the variants-aware reported list', src.includes('reportedCatalogWithVariants(node.opencode_catalog, node.opencode_catalog_variants)'));
}

// admin 2026-11-11（天马总运维）：自己没清单 ⇒ 同 runtime 其他节点的清单兜底，并写明来源。
{
  const peers = peerCatalogWithVariants([
    { node_id: 'self', runtime: 'opencode-cli', opencode_catalog: null },
    { node_id: 'a', runtime: 'opencode-cli', opencode_catalog: ['deepseek/deepseek-flash', 'opencode/x'] },
    { node_id: 'b', runtime: 'opencode-cli', opencode_catalog: ['deepseek/deepseek-flash'], opencode_catalog_variants: ['deepseek/deepseek-flash=none,high'] },
    { node_id: 'c', runtime: 'claude-code-cli', opencode_catalog: ['anthropic/x'] },
  ], { runtime: 'opencode-cli', excludeNodeId: 'self' });
  ck('peer fallback merges same-runtime nodes only', peers.nodes === 2 && peers.models.map(m => `${m.providerId}/${m.id}`).join() === 'deepseek/deepseek-flash,opencode/x');
  ck('peer fallback keeps a peer-reported variant list', JSON.stringify(peers.models[0].variants) === '["none","high"]');
  ck('peer fallback excludes the node itself', peerCatalogWithVariants([{ node_id: 'self', runtime: 'opencode-cli', opencode_catalog: ['a/b'] }], { runtime: 'opencode-cli', excludeNodeId: 'self' }).nodes === 0);
  ck('palette says the list came from peers', src.includes("t('chat.modelPicker.peerCatalogSource', { count: peers.nodes })") && src.includes("{catalogNote ?? t('chat.modelPicker.catalogSource')}"));
}

console.log(`composer-model-palette-fallback: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
