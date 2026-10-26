// 左栏右键菜单项的唯一数据源:由 src/task-side-menu.ts 生成,
// 单测(task-side-menu.test.ts)和浏览器 drive(tests/test-side-rename/drive.mjs)都读这份 JSON。
// 为什么:加一个菜单项要同时改两处断言,0.315 / 0.319 两次 CI 都因为 drive 里写死的旧列表而红。
//   npx tsx scripts/emit-side-menu-items.mjs   （改了菜单项后跑一遍）
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// tsx 会把 .ts 编译进来,所以这里用的就是单测同一个函数(不重复实现一遍规则)。
const { sideItemActions } = await import('../src/task-side-menu.ts');

const ops = { createTag: async () => null, updateProject: async () => null, archiveProject: async () => null, deleteTag: async () => null };
const items = {
  project: sideItemActions('project', true, ops, false),
  projectWithChild: sideItemActions('project', true, ops, true),
  tag: sideItemActions('tag', true, ops),
};
const out = join(here, '../tests/test-side-rename/menu-items.json');
writeFileSync(out, `${JSON.stringify(items, null, 2)}\n`);
console.log('wrote', out, JSON.stringify(items));
