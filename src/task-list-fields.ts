export const FIELD_IDS = ['seq', 'title', 'owner', 'priority', 'due', 'participants', 'project', 'status', 'created', 'updated', 'issues'] as const;
export type FieldId = typeof FIELD_IDS[number];
// width is the user's dragged width in px; absent means the default (title then
// also stretches to fill the card). It rides on the same pref entry so hiding
// or reordering a column never loses it.
export type FieldPref = { id: FieldId; visible: boolean; width?: number };
export const FIELDS_KEY = 'task_list_fields_v1';
export const DEFAULT_WIDTHS: Record<FieldId, number> = { seq: 72, title: 220, owner: 150, priority: 90, due: 110, participants: 115, project: 116, status: 110, created: 150, updated: 150, issues: 108 };
export const minWidth = (id: FieldId) => id === 'title' ? 160 : 64;
const MAX_WIDTH = 1600;
export const clampWidth = (id: FieldId, px: number) => Math.round(Math.min(MAX_WIDTH, Math.max(minWidth(id), px)));
export const fieldWidth = (f: FieldPref) => f.width ?? DEFAULT_WIDTHS[f.id];
export const defaultFields = (): FieldPref[] => FIELD_IDS.map(id => ({ id, visible: id !== 'participants' && id !== 'issues' }));
export function parseFields(raw: string | null): FieldPref[] {
  let data: unknown;
  try { data = JSON.parse(raw ?? 'null'); } catch { return defaultFields(); }
  if (!Array.isArray(data)) return defaultFields();
  const out: FieldPref[] = [];
  for (const item of data) {
    if (!item || !FIELD_IDS.includes(item.id) || out.some(f => f.id === item.id)) continue;
    const pref: FieldPref = { id: item.id, visible: item.id === 'title' || typeof item.visible !== 'boolean' ? true : item.visible };
    if (typeof item.width === 'number' && Number.isFinite(item.width)) pref.width = clampWidth(item.id, item.width);
    out.push(pref);
  }
  // 存下来的配置里没有的列(后来新加的,比如 ID):放回它在默认顺序里的位置 —— 插在第一个默认顺序比它靠后的已存列前面。
  for (const f of defaultFields()) {
    if (out.some(saved => saved.id === f.id)) continue;
    const rank = FIELD_IDS.indexOf(f.id);
    const at = out.findIndex(saved => FIELD_IDS.indexOf(saved.id) > rank);
    if (at < 0) out.push(f); else out.splice(at, 0, f);
  }
  return out;
}
export function toggleField(fields: FieldPref[], id: FieldId): FieldPref[] {
  return fields.map(f => f.id === id && id !== 'title' ? { ...f, visible: !f.visible } : f);
}
export function moveField(fields: FieldPref[], from: FieldId, to: FieldId): FieldPref[] {
  const start = fields.findIndex(f => f.id === from), end = fields.findIndex(f => f.id === to);
  if (start < 0 || end < 0 || start === end) return fields;
  const next = [...fields]; next.splice(end, 0, next.splice(start, 1)[0]); return next;
}
export function setFieldWidth(fields: FieldPref[], id: FieldId, px: number): FieldPref[] {
  return fields.map(f => f.id === id ? { ...f, width: clampWidth(id, px) } : f);
}
const withoutWidth = ({ width: _drop, ...f }: FieldPref): FieldPref => f;
export function resetFieldWidth(fields: FieldPref[], id: FieldId): FieldPref[] {
  return fields.map(f => f.id === id ? withoutWidth(f) : f);
}
export function resetWidths(fields: FieldPref[]): FieldPref[] {
  return fields.map(withoutWidth);
}
// Same per-device, best-effort localStorage preference path as shortcuts-store:
// never writes Hub; unavailable storage keeps the session preference functional.
let memory: FieldPref[] | undefined;
export function loadFields(): FieldPref[] {
  if (memory) return memory;
  try { return memory = parseFields(globalThis.localStorage?.getItem(FIELDS_KEY) ?? null); }
  catch { return memory = defaultFields(); }
}
export function saveFields(fields: FieldPref[]): void {
  memory = parseFields(JSON.stringify(fields));
  try { globalThis.localStorage?.setItem(FIELDS_KEY, JSON.stringify(memory)); } catch { /* session only */ }
}
