// #886 第一片 —— / 命令与节点技能候选的纯函数契约。
//   run: bun src/composer-slash.test.ts
import { applySlash, groupSlashItems, mergeSlashSources, slashCandidates, slashQuery } from './composer-slash';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };

// 触发条件：行首或空白后的 /，且 token 里没空白
ck('行首 / 触发', JSON.stringify(slashQuery('/btw')) === JSON.stringify({ query: 'btw', start: 0, end: 4 }));
ck('空格后的 / 触发', slashQuery('hi /in')?.query === 'in');
ck('参数里的 / 不触发（已有空白）', slashQuery('/cmd a/b') === null);
ck('URL 里的 / 不触发', slashQuery('see https://x') === null);
ck('路径不触发（/usr/bin 里还有 /，不弹候选）', slashQuery('/usr/bin') === null);
ck('有参数后不再触发', slashQuery('/btw 解释一下') === null);
ck('caret 在中间时按中间算', slashQuery('/bt', 3)?.query === 'bt');

// 候选合并：命令先、技能后、同 id 去重
const merged = mergeSlashSources({
  commands: [{ id: 'btw', description: '顺带一提，不进上下文' }],
  skills: [
    { id: 'skill_repo_gates', name: 'repo-gates', description: '跑三道仓库门' },
    { id: 'btw' },
  ],
});
ck('命令与技能合并且去重', merged.length === 2 && merged[0].kind === 'command' && merged[1].kind === 'skill');
ck('没有名字时退回 id', merged[1].name === 'repo-gates');

// 过滤：名字前缀 > 名字包含 > 描述包含
const items = [
  { id: 'review', name: 'review', description: '代码审查', kind: 'command' as const },
  { id: 'repo', name: 'repo', description: 'review 相关的仓库门', kind: 'command' as const },
  { id: 'skill_x', name: 'x', description: 'review everything', kind: 'skill' as const },
];
const hit = slashCandidates(items, 'rev');
ck('名字前缀排最前', hit[0].id === 'review');
ck('描述命中也保留', hit.some(i => i.id === 'skill_x'));
ck('空查询给全部（受 limit）', slashCandidates(items, '', 2).length === 2);
ck('limit 生效', slashCandidates(items, '', 1).length === 1);

// 分组：命令在前
const groups = groupSlashItems(items);
ck('分组顺序：命令 → 技能', groups[0].kind === 'command' && groups[groups.length - 1].kind === 'skill');
ck('空组不出现', groupSlashItems([items[0]]).length === 1);

// 选择只改草稿，绝不发送
const applied = applySlash('帮我 /bt', 6, { id: 'btw', name: 'btw', kind: 'command' });
ck('替换 /token 为 /id + 空格', applied.text === '帮我 /btw ');
ck('光标落在插入之后', applied.caret === applied.text.length);
ck('显式契约：选择不发送', applied.send === false);
const noToken = applySlash('hello', undefined, { id: 'btw', name: 'btw', kind: 'command' });
ck('没有 token 时追加而不吞原文', noToken.text === 'hello/btw ' && noToken.send === false);

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
