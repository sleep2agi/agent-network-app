// Collapsible group headers (0.2.106) — run: bun src/agents-list-collapse.test.ts

import {
  applyCollapsed, buildSections, countShown, isCollapsible, NEW_MESSAGES_TITLE, parseCollapsed, PINNED_TITLE, toggleCollapsed,
} from './agents-list';
import type { Session } from './api';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

const S = (alias: string, status = 'idle'): Session => ({ alias, status } as Session);
// Placeholder aliases: three teams (团队A / 团队B / 示例) + one pinned + one with unread.
const fleet = [S('团队A甲'), S('团队A乙', 'working'), S('团队A丙', 'offline'), S('团队B甲'), S('团队B乙', 'offline'), S('示例一'), S('示例二', 'offline')];
const secs = buildSections(fleet, '', {
  sort: { pinned: a => a === '示例一' },
  unread: { count: a => (a === '团队B甲' ? 2 : 0) },
});
const titles = secs.map(s => s.title);
ck('fixture has 新消息, 置顶 and team groups', titles[0] === NEW_MESSAGES_TITLE && titles[1] === PINNED_TITLE && titles.includes('团队'), titles.join(','));

const none = applyCollapsed(secs, [], '');
ck('nothing folded → identical rows', countShown(none) === countShown(secs) && none.every((s, i) => s.data === secs[i].data));
ck('every group but 新消息 is collapsible', none.every(s => s.collapsible === isCollapsible(s.title)) && !none[0].collapsible && none[1].collapsible);

const folded = applyCollapsed(secs, ['团队', PINNED_TITLE], '');
const team = folded.find(s => s.title === '团队')!;
ck('folded group keeps its header but no rows', team.collapsed && team.data.length === 0);
ck('folded group still reports its counts (header shows online/total)', team.total === secs.find(s => s.title === '团队')!.total && team.online > 0);
ck('置顶 can fold', folded[1].collapsed && folded[1].data.length === 0);
ck('other groups untouched', folded.filter(s => !['团队', PINNED_TITLE].includes(s.title)).every(s => !s.collapsed && s.data.length > 0));
ck('the section list is not reordered or shortened', folded.map(s => s.title).join() === titles.join());

const newMsg = applyCollapsed(secs, [NEW_MESSAGES_TITLE], '');
ck('新消息 never folds (would hide the rows that want attention)', !newMsg[0].collapsed && newMsg[0].data.length === 1);

const searching = buildSections(fleet, '团队', {});
const sFolded = applyCollapsed(searching, ['团队'], '团队');
ck('while searching nothing folds and nothing is collapsible', sFolded.every(s => !s.collapsed && !s.collapsible) && countShown(sFolded) === countShown(searching));
ck('whitespace-only query is not a search', applyCollapsed(secs, ['团队'], '   ').find(s => s.title === '团队')!.collapsed);

ck('toggle adds then removes', JSON.stringify(toggleCollapsed([], 'a')) === '["a"]' && JSON.stringify(toggleCollapsed(['a', 'b'], 'a')) === '["b"]');
const before = ['x'];
toggleCollapsed(before, 'y');
ck('toggle does not mutate its input', before.length === 1);

ck('parse: JSON string', JSON.stringify(parseCollapsed('["团队","置顶"]')) === '["团队","置顶"]');
ck('parse: array passes through, deduped, non-strings and empties dropped', JSON.stringify(parseCollapsed(['a', 'a', 3, '', null, 'b'])) === '["a","b"]');
ck('parse: garbage → nothing folded', [null, undefined, '', '{', '{"a":1}', 42, 'null'].every(v => parseCollapsed(v).length === 0));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
