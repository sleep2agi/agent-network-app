// 左栏(和手机筛选行)上项目 / 标签的菜单(#760,owner:「项目和标签都不能改名吗？」)。
// 改名原来只在「管理项目 / 管理标签」对话框里;这里只是另一个入口 —— 写 Hub 走对话框同一对处理函数
// (task-board-store ManagerOps,看板登记),校验用对话框同一套(checkProjectName / tagName)。
// 纯逻辑、不 import react-native:测试可以直接引。
import type { RequirementProject } from './requirements-model';
import { checkProjectName, nextProjectColor } from './task-board-model';
import { tagName } from './task-tag-catalog';
import type { ManagerOps } from './task-board-store';

export type SideAction = 'rename' | 'color' | 'archive' | 'delete';

/** 菜单里有哪几项。没有写 Hub 的路(看板没挂)或没权限(项目 viewer_can.edit=false、标签 can_manage=false)→ 空,菜单不开。 */
export function sideItemActions(kind: 'project' | 'tag', can: boolean, ops: ManagerOps | null): SideAction[] {
  if (!can || !ops) return [];
  return kind === 'project' ? ['rename', 'color', 'archive'] : ['rename', 'color', 'delete'];
}

/** 项目:canEdit === false 就是 Hub 的 viewer_can.edit=false(对话框列出来的也是这份)。 */
export const canEditProject = (p: RequirementProject | undefined): boolean => !!p && !p.archived && p.canEdit !== false;

/** 行内改名框的按键:回车存、Esc 取消,其余不管。 */
export function renameKey(key: string | undefined): 'save' | 'cancel' | null {
  return key === 'Enter' ? 'save' : key === 'Escape' || key === 'Esc' ? 'cancel' : null;
}

/** 存改名。返回 null = 成功(或没变),否则是要显示的错误:项目 = 已翻好的文案(同对话框),标签 = i18n key。 */
export async function commitSideRename(
  kind: 'project' | 'tag', key: string, draft: string, ops: ManagerOps, projects: readonly RequirementProject[],
): Promise<{ error: string; i18n: boolean } | null> {
  if (kind === 'project') {
    const c = checkProjectName(draft, projects, key);
    if (!c.ok) return { error: c.message, i18n: false };
    if (projects.find(p => p.id === key)?.name === c.name) return null;
    const failed = await ops.updateProject(key, { name: c.name });
    return failed ? { error: failed, i18n: false } : null;
  }
  const to = tagName(draft);
  if (!to) return { error: 'tags.invalidName', i18n: true };
  if (to === key) return null;
  const failed = await ops.tagOp({ op: 'rename', from: key, to });
  return failed ? { error: failed, i18n: true } : null;
}

/** 菜单里的「颜色 / 归档 / 删除」:同对话框的同一个调用(项目颜色 = 对话框色点的「下一个颜色」)。 */
export function runSideAction(kind: 'project' | 'tag', key: string, action: 'color' | 'archive' | 'delete', ops: ManagerOps, opts: { projectColor?: string; tagColor?: string | null }): Promise<string | null> {
  if (kind === 'project') return ops.updateProject(key, action === 'archive' ? { archived: true } : { color: nextProjectColor(opts.projectColor ?? '') });
  return action === 'delete' ? ops.tagOp({ op: 'delete', tag: key }) : ops.tagOp({ op: 'color', tag: key, color: opts.tagColor ?? null });
}
