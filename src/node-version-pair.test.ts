// ck-style (self-executing; run by scripts/run-tests.mjs). #4463 节点版本对：
// 只显示节点自报的两个版本 + 指向 anet pair；缺一个就说未知，绝不拼安装命令。
import { strict as assert } from 'node:assert';
import { PAIR_GUIDANCE, MISSING_GUIDANCE, versionPairHint } from './node-version-pair';

let n = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  n += 1;
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`PASS: ${name}`);
};

// 两个版本都在：原样显示，并指向 anet pair
const both = versionPairHint({ cliVersion: '2.3.0-preview.231', nodeVersion: '2.5.0-preview.199' });
ck('both versions → ready', both.kind === 'ready');
ck('both versions kept verbatim', both.kind === 'ready' && both.cliVersion === '2.3.0-preview.231' && both.nodeVersion === '2.5.0-preview.199');
ck('ready points at anet pair', both.kind === 'ready' && both.guidance === PAIR_GUIDANCE && both.guidance.includes('anet pair'));

// 🔴 关键不变量：这个模块**不许**吐出安装命令（仓库护栏：拼出来的配对不成立）
ck('never renders an npm install line', !JSON.stringify(both).includes('npm'));
ck('never renders a package spec', !JSON.stringify(both).includes('@sleep2agi/agent-'));

// 只有一个版本：未知，并且不泄露半截信息
const onlyCli = versionPairHint({ cliVersion: '2.3.0-preview.231', nodeVersion: null });
ck('missing node → unknown', onlyCli.kind === 'unknown');
ck('missing node names the gap', onlyCli.kind === 'unknown' && onlyCli.missing.join(',') === 'node');
ck('unknown carries the honest guidance', onlyCli.kind === 'unknown' && onlyCli.guidance === MISSING_GUIDANCE);
ck('unknown still shows no package spec', !JSON.stringify(onlyCli).includes('@sleep2agi/'));

const onlyNode = versionPairHint({ cliVersion: undefined, nodeVersion: '2.5.0-preview.199' });
ck('missing cli → unknown', onlyNode.kind === 'unknown' && onlyNode.missing.join(',') === 'cli');

// 空串与纯空白当缺失（不是当版本）
const blank = versionPairHint({ cliVersion: '   ', nodeVersion: '' });
ck('blank counts as missing, not as a version', blank.kind === 'unknown' && blank.missing.join(',') === 'cli,node');

// 不合法版本串：不当版本显示
const injected = versionPairHint({ cliVersion: '2.3.0; rm -rf /', nodeVersion: '2.5.0-preview.199' });
ck('junk cli version → unknown', injected.kind === 'unknown' && injected.missing.join(',') === 'cli');
ck('junk cli version is reported as invalid', injected.kind === 'unknown' && injected.invalid.includes('2.3.0; rm -rf /'));
const spacey = versionPairHint({ cliVersion: '2.3.0 preview', nodeVersion: '2.5.0-preview.199' });
ck('internal space → invalid', spacey.kind === 'unknown' && spacey.invalid.includes('2.3.0 preview'));

// 首尾空白被裁掉，语义不变
const padded = versionPairHint({ cliVersion: ' 2.3.0-preview.231 ', nodeVersion: '\t2.5.0-preview.199 ' });
ck('trims surrounding whitespace', padded.kind === 'ready' && padded.cliVersion === '2.3.0-preview.231');

// 两个都缺：不 crash、不说「最新版」之类的猜测
const none = versionPairHint({});
ck('both missing stays honest', none.kind === 'unknown' && !JSON.stringify(none).includes('latest'));

console.log(`${n}/${n} passed`);
process.exit(0);
