// 只读:部门树 + 需求通讯录(人、部门、名下 Agent)。没有写接口。
// 两个源都 404/405 才当「这个 Hub 没有组织架构」;一边没有就用另一边能给出的部分。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import type { AgentOrgData, OrgAgent, OrgOwner } from './agent-org-model';
import { fetchOrg } from './org-api';
import type { Department } from './org-model';

const TIMEOUT_MS = 12_000;
export const DIRECTORY_PAGE_LIMIT = 200;
export const DIRECTORY_MAX_PAGES = 20;

export type DirectoryPerson = OrgOwner & { departmentName: string | null };
export type DirectoryPage = {
  people: DirectoryPerson[];
  unowned: OrgAgent[];
  hasMore: boolean;
  nextOffset: number | null;
};

function agentOf(value: unknown): OrgAgent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.node_id !== 'string' || !row.node_id.trim()) return null;
  const alias = typeof row.alias === 'string' && row.alias.trim() ? row.alias : row.node_id;
  return { nodeId: row.node_id, alias };
}

function agentsOf(value: unknown): OrgAgent[] {
  if (!Array.isArray(value)) return [];
  const out: OrgAgent[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const agent = agentOf(item);
    if (!agent || seen.has(agent.nodeId)) continue;
    seen.add(agent.nodeId);
    out.push(agent);
  }
  return out;
}

function personOf(value: unknown): DirectoryPerson | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.user_id !== 'string' || !row.user_id.trim()) return null;
  if (typeof row.username !== 'string' || !row.username.trim()) return null;
  let departmentId: string | null = null;
  let departmentName: string | null = null;
  if (row.department && typeof row.department === 'object') {
    const dept = row.department as Record<string, unknown>;
    if (typeof dept.id === 'string' && dept.id.trim() && typeof dept.name === 'string' && dept.name.trim()) {
      departmentId = dept.id;
      departmentName = dept.name;
    }
  }
  return {
    userId: row.user_id,
    username: row.username,
    displayName: typeof row.display_name === 'string' ? row.display_name : '',
    departmentId,
    departmentName,
    agents: agentsOf(row.agents),
  };
}

/** 缺字段、垃圾项丢掉,不把整页判死。 */
export function parseDirectoryPage(json: unknown): DirectoryPage {
  if (!json || typeof json !== 'object') return { people: [], unowned: [], hasMore: false, nextOffset: null };
  const row = json as Record<string, unknown>;
  const people = Array.isArray(row.people) ? row.people.flatMap(item => { const person = personOf(item); return person ? [person] : []; }) : [];
  return {
    people,
    unowned: agentsOf(row.agents_without_owner),
    hasMore: row.has_more === true,
    nextOffset: typeof row.next_offset === 'number' && Number.isFinite(row.next_offset) ? row.next_offset : null,
  };
}

async function getJson(cfg: HubConfig, path: string): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await appFetch(`${cfg.serverUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!text) return { status: res.status, body: null };
    try { return { status: res.status, body: JSON.parse(text) as unknown }; }
    catch {
      if (res.status === 404 || res.status === 405) return { status: res.status, body: null };
      throw new Error('directory response was not json');
    }
  } finally {
    clearTimeout(timer);
  }
}

type DirectoryRead = { missing: true } | { missing: false; owners: OrgOwner[]; unowned: OrgAgent[]; deptNames: Map<string, string> };

async function readDirectory(cfg: HubConfig, networkId: string): Promise<DirectoryRead> {
  const owners = new Map<string, OrgOwner>();
  const deptNames = new Map<string, string>();
  let unowned: OrgAgent[] = [];
  let offset = 0;
  for (let page = 0; page < DIRECTORY_MAX_PAGES; page++) {
    const path = `/api/requirements/people/directory?network_id=${encodeURIComponent(networkId)}&limit=${DIRECTORY_PAGE_LIMIT}&offset=${offset}`;
    const res = await getJson(cfg, path);
    if ((res.status === 404 || res.status === 405) && offset === 0) return { missing: true };
    if (res.status === 404 || res.status === 405) throw new Error(`directory HTTP ${res.status}`);
    if (res.status < 200 || res.status >= 300) throw new Error(`directory HTTP ${res.status}`);
    if (res.body && typeof res.body === 'object' && (res.body as { ok?: unknown }).ok === false) throw new Error('directory not ok');
    const parsed = parseDirectoryPage(res.body);
    if (offset === 0) unowned = parsed.unowned;
    for (const person of parsed.people) {
      if (person.departmentId && person.departmentName && !deptNames.has(person.departmentId)) deptNames.set(person.departmentId, person.departmentName);
      if (owners.has(person.userId)) continue;
      owners.set(person.userId, { userId: person.userId, username: person.username, displayName: person.displayName, departmentId: person.departmentId, agents: person.agents });
    }
    if (!parsed.hasMore || parsed.nextOffset === null || parsed.nextOffset <= offset) break;
    offset = parsed.nextOffset;
  }
  return { missing: false, owners: [...owners.values()], unowned, deptNames };
}

function flatDepartments(names: Map<string, string>, owners: readonly OrgOwner[]): Department[] {
  return [...names.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'zh') || a[0].localeCompare(b[0]))
    .map(([id, name], sort) => ({
      id,
      name,
      parent_id: null,
      leader_user_id: null,
      sort,
      member_count: owners.filter(o => o.departmentId === id).length,
    }));
}

/** null = 部门接口和通讯录都没有(旧 Hub)。其它 HTTP 错误抛出去,让页面重试。 */
export async function loadAgentOrg(cfg: HubConfig, networkId: string): Promise<AgentOrgData | null> {
  const [org, directory] = await Promise.all([
    fetchOrg(cfg, networkId).then(data => (data ? { missing: false as const, data } : { missing: true as const })),
    readDirectory(cfg, networkId),
  ]);
  if (org.missing && directory.missing) return null;
  const owners = directory.missing ? [] : directory.owners;
  const departments = org.missing ? flatDepartments(directory.missing ? new Map() : directory.deptNames, owners) : org.data.departments;
  return {
    departments,
    owners,
    unowned: directory.missing ? [] : directory.unowned,
    directory: !directory.missing,
    departmentsApi: !org.missing,
  };
}
