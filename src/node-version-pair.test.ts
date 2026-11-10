// ck-style (self-executing; run by scripts/run-tests.mjs). #4463 节点版本：
// 只显示节点自报的版本 + 指向 anet pair；缺一个就说「未上报」，绝不拼安装命令。
import { strict as assert } from 'node:assert';
import { MISSING_GUIDANCE, PAIR_GUIDANCE, versionPairHint } from './node-version-pair';

let n = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  n += 1;
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`PASS: ${name}`);
};

// 两个都有
const both = versionPairHint({ cliVersion: '2.3.0-preview.231', nodeVersion: '2.5.0-preview.198' });
ck('both → ready', both.kind === 'ready');
ck('both kept verbatim', both.kind === 'ready' && both.cliVersion === '2.3.0-preview.231' && both.nodeVersion === '2.5.0-preview.198');
ck('ready points at anet pair', both.kind === 'ready' && both.guidance === PAIR_GUIDANCE && both.guidance.includes('anet pair'));

// 🔴 生产实测：343 个节点里只有 2 个上报了 launched_by_cli_version，
// 但 agent-node 版本几乎都有 ⇒ 只剩一个时必须**照样显示**，不能整块变「未知」。
const nodeOnly = versionPairHint({ nodeVersion: '2.5.0-preview.198' });
ck('node version alone still renders', nodeOnly.kind === 'ready');
ck('node version alone keeps the known value', nodeOnly.kind === 'ready' && nodeOnly.nodeVersion === '2.5.0-preview.198');
ck('node version alone says CLI is not reported', nodeOnly.kind === 'ready' && nodeOnly.cliVersion === null);

const cliOnly = versionPairHint({ cliVersion: '2.3.0-preview.231' });
ck('cli version alone still renders', cliOnly.kind === 'ready' && cliOnly.cliVersion === '2.3.0-preview.231' && cliOnly.nodeVersion === null);

// 两个都没有 → 未知，且不猜
const none = versionPairHint({});
ck('neither → unknown', none.kind === 'unknown');
ck('unknown names both gaps', none.kind === 'unknown' && none.missing.join(',') === 'cli,node');
ck('unknown carries honest guidance', none.kind === 'unknown' && none.guidance === MISSING_GUIDANCE);
ck('never says "latest"', !JSON.stringify(none).includes('latest'));

// 🔴 这个模块永远不许吐出安装命令或包名（仓库护栏）
ck('never renders an npm install line', !JSON.stringify(both).includes('npm'));
ck('never renders a package spec', !JSON.stringify(both).includes('@sleep2agi/'));

// 空白当缺失；不合法串不当版本显示
const blank = versionPairHint({ cliVersion: '   ', nodeVersion: '' });
ck('blank counts as missing', blank.kind === 'unknown' && blank.missing.join(',') === 'cli,node');
const injected = versionPairHint({ cliVersion: '2.3.0; rm -rf /', nodeVersion: '2.5.0-preview.198' });
ck('junk cli is reported invalid, node still renders', injected.kind === 'ready' && injected.cliVersion === null);
ck('junk cli is kept as evidence', JSON.stringify(injected).includes('2.3.0; rm -rf /'));
const spacey = versionPairHint({ cliVersion: '2.3.0 preview' });
ck('internal space → invalid, not a version', spacey.kind === 'unknown' && spacey.invalid.includes('2.3.0 preview'));

// 首尾空白裁剪
const padded = versionPairHint({ nodeVersion: '\t2.5.0-preview.198 ' });
ck('trims surrounding whitespace', padded.kind === 'ready' && padded.nodeVersion === '2.5.0-preview.198');

console.log(`${n}/${n} passed`);
process.exit(0);
