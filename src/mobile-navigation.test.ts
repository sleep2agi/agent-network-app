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
check(JSON.stringify(keys) === JSON.stringify(['agents', 'scheduled', 'server', 'settings']), 'mobile navigation has exactly four destinations in the requested order');
check(JSON.stringify(labels) === JSON.stringify(['Agent', '定时任务', '服务器', '设置']), 'mobile navigation uses the requested labels');
check(!block.includes("key: 'tasks'"), 'Tasks is hidden from mobile primary navigation');
check(!block.includes("key: 'messages'"), 'Messages is hidden from mobile primary navigation');
check(app.includes('{MOBILE_TABS.map(tab => ('), 'the phone tab bar renders the compact navigation');
check(app.includes('DESKTOP_MAIN_TABS.map(tab => ('), 'desktop keeps its existing navigation model');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log('mobile navigation: 7 checks passed');
