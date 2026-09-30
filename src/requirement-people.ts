/** Display names are not identity: a user and node may have the same name. */
export type RequirementPersonRef = { kind: 'user' | 'node'; id: string };
/** name:界面用的名字(Hub 已按 display_name → 用户名 / alias 回落)。displayName:Hub 单独给的显示名(#2183 起),
 *  没设 = ""(只有用户名);undefined = 旧 Hub 没这个字段,不知道。 */
export type RequirementPerson = RequirementPersonRef & { networkId: string; name: string; displayName?: string; unavailable?: boolean };

export const personKey = (person: RequirementPersonRef) => `${person.kind}:${person.id}`;

export function uniquePeople(selected: readonly RequirementPersonRef[]): RequirementPersonRef[] {
  return [...new Map(selected.map(person => [personKey(person), { kind: person.kind, id: person.id }])).values()];
}

export function peopleInNetwork(people: readonly RequirementPerson[], networkId: string, query = ''): RequirementPerson[] {
  const seen = new Set<string>();
  const needle = query.trim().toLocaleLowerCase();
  return people.filter(person => {
    if (!networkId || person.networkId !== networkId || !person.id || !['user', 'node'].includes(person.kind)) return false;
    const key = personKey(person);
    if (seen.has(key)) return false;
    seen.add(key);
    return !needle || `${person.name} ${person.id}`.toLocaleLowerCase().includes(needle);
  });
}

export function togglePerson(selected: readonly RequirementPersonRef[], person: RequirementPersonRef, mode: 'owner' | 'participants'): RequirementPersonRef[] {
  const current = uniquePeople(selected);
  const key = personKey(person);
  const exists = current.some(row => personKey(row) === key);
  if (mode === 'owner') return exists ? [] : [{ kind: person.kind, id: person.id }];
  return exists ? current.filter(row => personKey(row) !== key) : [...current, { kind: person.kind, id: person.id }];
}
