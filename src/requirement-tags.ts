export function normalizeTags(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return null;
    const tag = raw.trim();
    if (!tag || [...tag].length > 20 || /[\u0000-\u001f\u007f]/u.test(tag)) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
