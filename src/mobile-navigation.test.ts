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
// Vincent 2026-09-29 (Android phone): 「底部 tab 的 服务器 换成 任务」. This reverses #159, which
// had hidden Tasks from mobile primary navigation. 任务 is second (used daily, same order as the rail);
// 设置 stays last; 服务器 is reachable from 设置 (see the settings-entry checks in nav-chrome.test.ts).
check(JSON.stringify(keys) === JSON.stringify(['agents', 'tasks', 'scheduled', 'settings']), 'phone bottom bar is Agent / 任务 / 定时任务 / 设置');
check(JSON.stringify(labels) === JSON.stringify(['nav.agents', 'nav.tasks', 'nav.scheduled', 'nav.settings']), 'phone bottom bar translates the requested labels');
check(!block.includes("key: 'server'"), '服务器 is off the phone bottom bar (it is a row in 设置)');
check(!block.includes("key: 'messages'"), 'Messages stays off the phone bottom bar');
const railBlock = app.match(/const MOBILE_RAIL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
check(railBlock.length > 0, 'the left rail tab definition exists');
// The rail is unchanged by the phone swap: Agent / 任务 / 定时任务 / 服务器 / 设置 (#489).
check(railBlock.includes('...MOBILE_TABS.slice(0, 3)') && railBlock.includes('MOBILE_TABS[3]'), 'left rail reuses Agent / 任务 / 定时任务 and 设置 from the phone tabs');
check(railBlock.indexOf('...MOBILE_TABS.slice(0, 3)') < railBlock.indexOf("key: 'server'") && railBlock.indexOf("key: 'server'") < railBlock.indexOf('MOBILE_TABS[3]'), 'left rail keeps 服务器 between 定时任务 and 设置');
check(/key: 'server', label: 'nav.server', icon: 'server-outline', iconActive: 'server'/.test(railBlock), 'left rail 服务器 keeps its translated label and icon');
const phoneTasks = block.match(/\{ key: 'tasks'[^}]*\}/)?.[0] ?? '';
check(/icon: 'list-outline', iconActive: 'list'/.test(phoneTasks), 'phone 任务 uses the same list icon as the rail 任务 and the desktop Tasks tab');
check(app.includes("{ key: 'tasks', label: 'nav.tasks', icon: 'list-outline', iconActive: 'list' }"), 'desktop Tasks tab keeps the list icon the phone tab mirrors');
check(app.includes('tabs={MOBILE_RAIL_TABS}'), 'the left rail renders the rail destinations');
check(app.includes('{MOBILE_TABS.map(tab => ('), 'the phone tab bar renders the compact navigation');
check(!app.includes('tabs={MOBILE_TABS}'), 'the left rail does not drop back to the four phone tabs');
check(app.includes('DESKTOP_MAIN_TABS.map(tab => ('), 'desktop keeps its existing navigation model');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log('mobile navigation checks passed');
