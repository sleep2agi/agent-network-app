// 桌面一级栏显示开关(管理员 2026-11-15)。
import { parseRailHidden, RAIL_HIDEABLE, visibleRailTabs } from './rail-prefs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const tabs = ['agents', 'tasks', 'scheduled', 'messages', 'server', 'org', 'settings'].map(key => ({ key }));
ck('nothing hidden by default', eq(visibleRailTabs(tabs, []).map(x => x.key), tabs.map(x => x.key)));
ck('hidden keys drop out, order kept', eq(visibleRailTabs(tabs, ['messages', 'org']).map(x => x.key), ['agents', 'tasks', 'scheduled', 'server', 'settings']));
ck('agents and settings can never be hidden', eq(visibleRailTabs(tabs, ['agents', 'settings']).map(x => x.key), tabs.map(x => x.key)) && !(RAIL_HIDEABLE as readonly string[]).includes('agents') && !(RAIL_HIDEABLE as readonly string[]).includes('settings'));
ck('parse: junk / unknown keys ignored', eq(parseRailHidden('not json'), []) && eq(parseRailHidden('{"a":1}'), []) && eq(parseRailHidden('["org","agents","zzz"]'), ['org']) && eq(parseRailHidden(null), []));
ck('org is hideable (new rail entry)', (RAIL_HIDEABLE as readonly string[]).includes('org'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
