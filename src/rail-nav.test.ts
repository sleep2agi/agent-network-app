import { railBadgeText, railIconFor, railSurface, railTooltipVisible } from './rail-nav';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const tab = { key: 'agents', icon: 'people-outline', iconActive: 'people' };
ck('active tab uses filled icon', railIconFor(tab, 'agents') === 'people');
ck('inactive tab uses outline icon', railIconFor(tab, 'tasks') === 'people-outline');

ck('active beats hover', railSurface({ active: true, hovered: true }) === 'active');
ck('hover alone is hover', railSurface({ active: false, hovered: true }) === 'hover');
ck('keyboard focus is hover surface', railSurface({ active: false, focused: true }) === 'hover');
ck('pressed is hover surface', railSurface({ active: false, pressed: true }) === 'hover');
ck('nothing is idle', railSurface({ active: false }) === 'idle');

ck('badge hides on 0', railBadgeText(0) === null);
ck('badge hides on null', railBadgeText(null) === null);
ck('badge hides on NaN', railBadgeText(Number.NaN) === null);
ck('badge shows small counts', railBadgeText(7) === '7');
ck('badge floors fractions', railBadgeText(12.9) === '12');
ck('badge caps at 99+', railBadgeText(140) === '99+');
ck('badge shows 99 exactly', railBadgeText(99) === '99');

ck('tooltip only for hovered key on desktop', railTooltipVisible('tasks', 'tasks', true) === true);
ck('tooltip not for other key', railTooltipVisible('tasks', 'agents', true) === false);
ck('tooltip never on touch', railTooltipVisible('tasks', 'tasks', false) === false);
ck('tooltip not when nothing hovered', railTooltipVisible(null, 'tasks', true) === false);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
