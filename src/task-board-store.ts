// 任务页的共享状态:桌面左栏(TaskFilterSidebar)和右侧看板(RequirementBoard)是两棵树,
// 筛选、当前视图、看板读到的卡片要是同一份。按账号 + 网络分开:换网络就回到「全部」。
import { useSyncExternalStore } from 'react';
import type { Requirement, RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';
import { EMPTY_FILTER, type BoardFilter } from './task-board-model';

/** 列表 / 看板是需求池的两种看法;派发记录是 Hub 上派给节点的任务(原来的「列表」)。 */
export type TaskSection = 'list' | 'board' | 'dispatch';

export interface TaskBoardState {
  scope: string;
  section: TaskSection;
  filter: BoardFilter;
  items: Requirement[];
  people: RequirementPerson[];
  meId: string | null;
  /** Hub 分不分「负责人(人类)/ 负责 Agent」。null = 还不知道(按旧的单一负责人画)。 */
  twoRoles: boolean | null;
  /** 项目列表(含归档);null = 这个 Hub 没有项目(或还没读到),界面把项目整个藏起来。 */
  projects: RequirementProject[] | null;
  /** 管理项目的对话框开着没有(左栏的「管理项目」和看板共用)。 */
  managingProjects: boolean;
  loaded: boolean;
}

const fresh = (scope: string, section: TaskSection = 'board'): TaskBoardState => ({
  scope, section, filter: EMPTY_FILTER, items: [], people: [], meId: null, twoRoles: null, projects: null, managingProjects: false, loaded: false,
});

let state: TaskBoardState = fresh('');
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());

export const taskBoardState = (): TaskBoardState => state;

export function subscribeTaskBoard(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** 进入某个账号 / 网络。换了就清空卡片和筛选,视图保留(用户刚选的看法不该因为换网络跳走)。 */
export function enterTaskScope(scope: string): void {
  if (state.scope === scope) return;
  state = fresh(scope, state.section);
  emit();
}

/** 只接受当前 scope 的写入:旧网络晚到的响应不会写进新网络的看板。 */
export function patchTaskBoard(scope: string, patch: Partial<Omit<TaskBoardState, 'scope'>>): void {
  if (state.scope !== scope) return;
  state = { ...state, ...patch };
  emit();
}

export function updateTaskItems(scope: string, fn: (items: Requirement[]) => Requirement[]): void {
  if (state.scope !== scope) return;
  state = { ...state, items: fn(state.items) };
  emit();
}

export const setTaskSection = (section: TaskSection) => { if (state.section !== section) { state = { ...state, section }; emit(); } };
export const setManagingProjects = (on: boolean) => { if (state.managingProjects !== on) { state = { ...state, managingProjects: on }; emit(); } };
export const setTaskFilter = (filter: BoardFilter) => { state = { ...state, filter }; emit(); };

export function useTaskBoard<T>(pick: (s: TaskBoardState) => T): T {
  return useSyncExternalStore(subscribeTaskBoard, () => pick(state), () => pick(state));
}

export const taskScopeKey = (cfg: { serverUrl: string; token: string; networkId?: string; profileId?: string; username?: string }) =>
  JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId, cfg.profileId, cfg.username]);
