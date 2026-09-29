import fs from 'node:fs';
import path from 'node:path';

const app = fs.readFileSync(path.join(import.meta.dir, '..', 'App.tsx'), 'utf8').replace(/\r\n?/g, '\n');
const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};

const block = app.match(/const MOBILE_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
const keys = [...block.matchAll(/key: '([^']+)'/g)].map(match => match[1]);
const labels = [...block.matchAll(/label: '([^']+)'/g)].map(match => match[1]);

check(block.length > 0, 'the mobile tab definition exists');
check(JSON.stringify(keys) === JSON.stringify(['agents', 'scheduled', 'server', 'settings']), 'phone bottom bar stays four destinations in the requested order');
check(JSON.stringify(labels) === JSON.stringify(['Agent', '定时任务', '服务器', '设置']), 'phone bottom bar uses the requested labels');
check(!block.includes("key: 'tasks'"), 'Tasks stays off the phone bottom bar');
check(!block.includes("key: 'messages'"), 'Messages stays off the phone bottom bar');
const railBlock = app.match(/const MOBILE_RAIL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
const railKeys = [...railBlock.matchAll(/key: '([^']+)'/g)].map(match => match[1]);
check(railBlock.length > 0, 'the left rail tab definition exists');
check(JSON.stringify(railKeys) === JSON.stringify(['tasks']), 'left rail adds 任务 and otherwise reuses the phone tabs');
check(railBlock.includes("label: '任务'"), 'left rail labels the added destination 任务');
check(railBlock.includes('MOBILE_TABS[0]') && railBlock.includes('...MOBILE_TABS.slice(1)'), 'left rail keeps Agent first and the other phone tabs after 任务');
check(app.includes('tabs={MOBILE_RAIL_TABS}'), 'the left rail renders the rail destinations');
check(app.includes('{MOBILE_TABS.map(tab => ('), 'the phone tab bar renders the compact navigation');
check(!app.includes('tabs={MOBILE_TABS}'), 'the left rail does not drop back to the four phone tabs');
check(app.includes('DESKTOP_MAIN_TABS.map(tab => ('), 'desktop keeps its existing navigation model');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log('mobile navigation checks passed');
