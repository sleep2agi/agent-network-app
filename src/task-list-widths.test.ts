import { clampWidth, DEFAULT_WIDTHS, defaultFields, fieldWidth, FIELDS_KEY, loadFields, minWidth, moveField, parseFields, resetFieldWidth, resetWidths, saveFields, setFieldWidth, toggleField } from './task-list-fields';
import { readFileSync } from 'node:fs';
let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const width = (fields: ReturnType<typeof defaultFields>, id: string) => fieldWidth(fields.find(f => f.id === id)!);

ck('title min 160, others min 64', minWidth('title') === 160 && minWidth('owner') === 64 && minWidth('issues') === 64);
ck('clamp below min', clampWidth('title', 40) === 160 && clampWidth('status', 10) === 64);
ck('clamp rounds and keeps in-range value', clampWidth('owner', 200.6) === 201);
ck('clamp has an upper bound', clampWidth('title', 1e9) <= 1600);
ck('defaults carry no stored width', defaultFields().every(f => f.width === undefined));
ck('default width per column', width(defaultFields(), 'title') === DEFAULT_WIDTHS.title && width(defaultFields(), 'owner') === 150);

const wide = setFieldWidth(defaultFields(), 'title', 620);
ck('set width', width(wide, 'title') === 620 && width(wide, 'owner') === 150);
ck('set width clamps to min', width(setFieldWidth(defaultFields(), 'owner', 3), 'owner') === 64);
ck('set width does not touch other columns', wide.filter(f => f.id !== 'title').every(f => f.width === undefined));

const hidden = toggleField(setFieldWidth(wide, 'owner', 240), 'owner');
ck('hidden column keeps width', !hidden.find(f => f.id === 'owner')!.visible && width(hidden, 'owner') === 240);
const shown = toggleField(hidden, 'owner');
ck('re-shown column restores width', shown.find(f => f.id === 'owner')!.visible && width(shown, 'owner') === 240);
const moved = moveField(shown, 'owner', 'title');
ck('reordered column keeps width', moved[0].id === 'owner' && width(moved, 'owner') === 240 && width(moved, 'title') === 620);

ck('round trip keeps widths', JSON.stringify(parseFields(JSON.stringify(moved))) === JSON.stringify(moved));
const tampered = parseFields('[{"id":"title","visible":true,"width":20},{"id":"owner","visible":false,"width":"wide"},{"id":"due","visible":true,"width":null}]');
ck('stored width clamped on load', width(tampered, 'title') === 160);
ck('non-numeric stored width ignored', tampered.find(f => f.id === 'owner')!.width === undefined && tampered.find(f => f.id === 'due')!.width === undefined);
ck('saved pref without widths (#513 shape) still loads', parseFields('[{"id":"title","visible":true},{"id":"owner","visible":false}]').every(f => f.width === undefined));

const one = resetFieldWidth(moved, 'owner');
ck('reset one column', one.find(f => f.id === 'owner')!.width === undefined && width(one, 'title') === 620);
ck('reset one keeps order and visibility', one.map(f => f.id + f.visible).join() === moved.map(f => f.id + f.visible).join());
const all = resetWidths(moved);
ck('reset all widths', all.every(f => f.width === undefined));
ck('reset all widths keeps order and visibility', all.map(f => f.id + f.visible).join() === moved.map(f => f.id + f.visible).join());
ck('reset serialises without width keys', !JSON.stringify(all).includes('width'));

let stored = '';
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: (key: string, raw: string) => { if (key === FIELDS_KEY) stored = raw; } } });
saveFields(moved);
ck('widths persist in the #513 preference key', JSON.parse(stored).find((f: { id: string }) => f.id === 'owner').width === 240);
ck('restore from session', width(loadFields(), 'title') === 620);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('denied'); } });
saveFields(setFieldWidth(moved, 'title', 300));
ck('denied storage keeps session width', width(loadFields(), 'title') === 300);

const table = readFileSync(new URL('./TaskListTable.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
ck('table renders from the width model', table.includes('fieldWidth(') && !/const widths: Record<FieldId, number>/.test(table));
ck('title stretches only while it has no dragged width', /id === 'title' && f\.width === undefined/.test(table));
ck('resize handle labelled via t()', table.includes("t('fields.resize'"));
ck('handles only for pointer UI', /!touch \? <View testID=\{`task-col-resize-/.test(table));
console.log(`${p}/${t} passed`); if (p !== t) process.exit(1);
