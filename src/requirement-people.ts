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

// ── 参与人选择器分组(owner 10-07「是不是少了参与Agent 的选型」)────────────────────────
// 人类一组、Agent 一组;Agent 再按团队(和节点列表同一个 teamOf)分小组。纯逻辑,界面层只管画。

/** 选择器里的一行:组标题(level 1 = 人类 / Agent,level 2 = Agent 的团队)或一个人。 */
export type PeopleEntry =
  | { type: 'header'; key: string; level: 1 | 2; group: 'user' | 'node'; label: string; count: number }
  | { type: 'person'; key: string; person: RequirementPerson };

/**
 * 把(已筛、已排好的)候选分成「人类 / Agent」两组,Agent 再按团队分小组(组名按首次出现排序,
 * 组内保持传入顺序)。两种都没有的组不出标题;只有一种时(负责人 / 负责 Agent 选择器)不分组。
 * 返回的 person 行顺序 = 键盘 ↑↓ 走的顺序。
 */
export function groupPeople(rows: readonly RequirementPerson[], teamOfName: (name: string) => string): PeopleEntry[] {
  const humans = rows.filter(row => row.kind === 'user');
  const agents = rows.filter(row => row.kind === 'node');
  const person = (p: RequirementPerson): PeopleEntry => ({ type: 'person', key: personKey(p), person: p });
  if (!humans.length || !agents.length) return rows.map(person);
  const teams = new Map<string, RequirementPerson[]>();
  for (const agent of agents) {
    const team = teamOfName(agent.name || agent.id);
    teams.set(team, [...(teams.get(team) ?? []), agent]);
  }
  return [
    { type: 'header', key: 'h:user', level: 1, group: 'user', label: 'user', count: humans.length },
    ...humans.map(person),
    { type: 'header', key: 'h:node', level: 1, group: 'node', label: 'node', count: agents.length },
    ...[...teams].flatMap(([team, members]) => [
      // 只有一个团队时不再画小标题(和 Agent 大标题重复)。
      ...(teams.size > 1 ? [{ type: 'header' as const, key: `h:node:${team}`, level: 2 as const, group: 'node' as const, label: team, count: members.length }] : []),
      ...members.map(person),
    ]),
  ];
}

/** 分组后的 person 行(键盘导航、回车选中按这个顺序)。 */
export const peopleOf = (entries: readonly PeopleEntry[]): RequirementPerson[] =>
  entries.flatMap(entry => entry.type === 'person' ? [entry.person] : []);

/**
 * 保存参与人(Hub 的 participants 整表替换):读-改-写。
 * 拿打开选择器时的那份(opened)和选完的(picked)算出加了谁、去了谁,再套到**保存时最新的**列表(current)上
 * —— 选择器开着时别人加的人不会被这次保存冲掉;人类和 Agent 一起按 {kind,id} 存。
 */
export function mergeParticipants(current: readonly RequirementPersonRef[], opened: readonly RequirementPersonRef[], picked: readonly RequirementPersonRef[]): RequirementPersonRef[] {
  const before = new Set(uniquePeople(opened).map(personKey));
  const after = uniquePeople(picked);
  const afterKeys = new Set(after.map(personKey));
  const removed = new Set([...before].filter(key => !afterKeys.has(key)));
  const added = after.filter(person => !before.has(personKey(person)));
  return uniquePeople([...current.filter(person => !removed.has(personKey(person))), ...added]);
}
