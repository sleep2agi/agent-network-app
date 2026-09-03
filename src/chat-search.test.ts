// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/chat-search.test.ts
import { chatSearchState, isHighlighted, isStaleSearch, makeSnippet, matchCountLabel, normalizeQuery, searchItems, shouldLoadOlderForSearch, stepHit } from './chat-search';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const items = [
  { key: 'n3', text: '今晚 发布 v0.2.44 吗', sender: '通信龙', createdAt: '2026-09-03 21:00' },
  { key: 'n2', text: 'Release notes ready, PUBLISH tomorrow', sender: 'Vincent', createdAt: '2026-09-03 20:00' },
  { key: 'n1', text: '收到', sender: '通信龙', createdAt: '2026-09-03 19:00' },
  { key: 'n0', text: '把 0.2.44 的 draft publish 掉', sender: 'Vincent', createdAt: '2026-09-03 18:00' },
];

// app#166 —— 搜索
ck('normalizeQuery 压空白+小写', normalizeQuery('  Publish   Now ') === 'publish now');
ck('空查询 → 0 命中', searchItems(items, '   ').length === 0);
const hits = searchItems(items, 'publish');
ck('大小写不敏感命中 2 条(PUBLISH / publish)', hits.length === 2 && hits[0]!.key === 'n2' && hits[1]!.key === 'n0');
ck('命中保持列表顺序(新→旧)且带 index', hits[0]!.index === 1 && hits[1]!.index === 3);
ck('多词全部命中才算', searchItems(items, '0.2.44 draft').length === 1 && searchItems(items, '0.2.44 draft')[0]!.key === 'n0');
ck('中文子串命中', searchItems(items, '发布')[0]?.key === 'n3');
ck('结果带 sender/createdAt', hits[0]!.sender === 'Vincent' && hits[0]!.createdAt === '2026-09-03 20:00');

// 片段
const long = 'a'.repeat(50) + ' 目标词 ' + 'b'.repeat(50);
const sn = makeSnippet(long, '目标词', 10);
ck('片段以命中为中心并两端省略', sn.startsWith('…') && sn.endsWith('…') && sn.includes('目标词') && sn.length < 40);
ck('没命中时取开头', makeSnippet('hello world', 'zzz', 3) === 'hello …');
ck('短文本原样', makeSnippet('hi', 'zzz') === 'hi');

// 上一条/下一条(循环)
ck('stepHit 从 -1 起始到 0', stepHit(-1, 3, 'older') === 0);
ck('stepHit older 递增且循环', stepHit(2, 3, 'older') === 0 && stepHit(0, 3, 'older') === 1);
ck('stepHit newer 递减且循环', stepHit(0, 3, 'newer') === 2);
ck('stepHit 空集 -1', stepHit(0, 0, 'older') === -1);

// 五种状态
ck('idle:空查询', chatSearchState({ query: ' ', loading: true, hits: 0, failed: false }) === 'idle');
ck('failed 优先于 loading', chatSearchState({ query: 'x', loading: true, hits: 0, failed: true }) === 'failed');
ck('loading', chatSearchState({ query: 'x', loading: true, hits: 0, failed: false }) === 'loading');
ck('results', chatSearchState({ query: 'x', loading: false, hits: 2, failed: false }) === 'results');
ck('empty', chatSearchState({ query: 'x', loading: false, hits: 0, failed: false }) === 'empty');
ck('计数标签', matchCountLabel(0, 3) === '1/3' && matchCountLabel(0, 0) === '0 条');

// 往更早翻的判据
ck('无命中且有更早且未到上限 → 翻', shouldLoadOlderForSearch({ hits: 0, hasOlder: true, pagesLoaded: 2, maxPages: 5 }));
ck('有命中 → 不翻', !shouldLoadOlderForSearch({ hits: 1, hasOlder: true, pagesLoaded: 0, maxPages: 5 }));
ck('没有更早 → 不翻', !shouldLoadOlderForSearch({ hits: 0, hasOlder: false, pagesLoaded: 0, maxPages: 5 }));
ck('到上限 → 不翻', !shouldLoadOlderForSearch({ hits: 0, hasOlder: true, pagesLoaded: 5, maxPages: 5 }));

// 会话隔离 / stale 拒收
ck('会话切换后旧搜索 stale', isStaleSearch('p1|hub|net|甲', 'p1|hub|net|乙'));
ck('同会话不 stale', !isStaleSearch('k', 'k'));

// 临时高亮
ck('2s 内同 key 高亮', isHighlighted('n2', { key: 'n2', at: 1000 }, 2500));
ck('超过 ttl 不高亮', !isHighlighted('n2', { key: 'n2', at: 1000 }, 3100));
ck('别的 key 不高亮', !isHighlighted('n1', { key: 'n2', at: 1000 }, 1500));

console.log(`\n${p}/${t} passed`); if (p !== t) process.exit(1);
