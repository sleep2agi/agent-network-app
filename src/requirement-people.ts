/** Display names are not identity: a user and node may have the same name. */
export type RequirementPersonRef = { kind: 'user' | 'node'; id: string };
/** name:界面用的名字(Hub 已按 display_name → 用户名 / alias 回落)。displayName:Hub 单独给的显示名(#2183 起),
 *  没设 = ""(只有用户名);undefined = 旧 Hub 没这个字段,不知道。 */
export type RequirementPerson = RequirementPersonRef & { networkId: string; name: string; displayName?: string; unavailable?: boolean;
  /** 成员在网络里的角色(Hub 给了才有;owner 也算管理员)。节点没有。 */
  role?: 'admin' | 'member';
  /** 在线状态(Hub 给了才有)。undefined = 不知道,不显示。 */
  online?: boolean };

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

/** 选择器里的顺序:我排第一(标「（我）」),其余保持 Hub 的顺序。 */
export function meFirst<T extends RequirementPersonRef>(rows: readonly T[], meId: string | null | undefined): T[] {
  if (!meId) return [...rows];
  const isMe = (row: T) => row.kind === 'user' && row.id === meId;
  return [...rows.filter(isMe), ...rows.filter(row => !isMe(row))];
}

/** 内部 id 只在搜索词命中它时才显示(说明这行为什么出现);平时副标题只写角色 / 在线。 */
export function idMatchesQuery(person: RequirementPersonRef, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !!needle && person.id.toLocaleLowerCase().includes(needle);
}

/** 副标题的组成(文案在界面层翻译):角色(成员 / 管理员 / Agent)、在线(知道才给)、命中搜索时的 id。 */
export function personSubtitle(person: RequirementPerson, query: string): { role: 'member' | 'admin' | 'agent'; online?: boolean; id?: string } {
  return {
    role: person.kind === 'node' ? 'agent' : person.role === 'admin' ? 'admin' : 'member',
    ...(person.online !== undefined ? { online: person.online } : {}),
    ...(idMatchesQuery(person, query) ? { id: person.id } : {}),
  };
}
