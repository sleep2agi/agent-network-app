export const FIELD_IDS = ['title', 'owner', 'priority', 'due', 'participants', 'project', 'status', 'created', 'updated', 'issues'] as const;
export type FieldId = typeof FIELD_IDS[number];
export type FieldPref = { id: FieldId; visible: boolean };
export const FIELDS_KEY = 'task_list_fields_v1';
export const defaultFields = (): FieldPref[] => FIELD_IDS.map(id => ({ id, visible: id !== 'participants' && id !== 'issues' }));
export function parseFields(raw: string | null): FieldPref[] {
  let data: unknown;
  try { data = JSON.parse(raw ?? 'null'); } catch { return defaultFields(); }
  if (!Array.isArray(data)) return defaultFields();
  const out: FieldPref[] = [];
  for (const item of data) {
    if (!item || !FIELD_IDS.includes(item.id) || out.some(f => f.id === item.id)) continue;
    out.push({ id: item.id, visible: item.id === 'title' || typeof item.visible !== 'boolean' ? true : item.visible });
  }
  return [...out, ...defaultFields().filter(f => !out.some(saved => saved.id === f.id))];
}
export function toggleField(fields: FieldPref[], id: FieldId): FieldPref[] {
  return fields.map(f => f.id === id && id !== 'title' ? { ...f, visible: !f.visible } : f);
}
export function moveField(fields: FieldPref[], from: FieldId, to: FieldId): FieldPref[] {
  const start = fields.findIndex(f => f.id === from), end = fields.findIndex(f => f.id === to);
  if (start < 0 || end < 0 || start === end) return fields;
  const next = [...fields]; next.splice(end, 0, next.splice(start, 1)[0]); return next;
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
