import { registerTranslations } from './i18n';

/** 节点页「权限 → 管理权限」(节点管理授权,admin 11-11)。 */
export const nodeGrantsTranslations = {
  'nodeGrants.title': ['管理权限', 'Management access'],
  'nodeGrants.hint': ['让这个节点管理别人的定时任务（看板以后支持）。可以管整个网络、某个部门（含子部门），或指定节点。只有网络 owner / 管理员能授全网；部门负责人只能授自己负责的部门。', 'Let this node manage other people\'s schedules (task board coming later): the whole network, a department (with its sub-departments) or specific nodes. Only network owners/admins can grant network-wide; department heads can grant within the departments they lead.'],
  'nodeGrants.none': ['还没有任何管理权限：这个节点只能管自己建的、和发给自己的定时任务。', 'No management access yet: this node can only manage schedules it created or that target it.'],
  'nodeGrants.add': ['添加授权', 'Add access'],
  'nodeGrants.save': ['添加', 'Add'],
  'nodeGrants.cancel': ['取消', 'Cancel'],
  'nodeGrants.revoke': ['撤销', 'Revoke'],
  'nodeGrants.capability': ['能力', 'Capability'],
  'nodeGrants.scope': ['范围', 'Scope'],
  'nodeGrants.level': ['级别', 'Level'],
  'nodeGrants.cap.schedules': ['定时任务', 'Schedules'],
  'nodeGrants.cap.board': ['任务看板', 'Task board'],
  'nodeGrants.comingSoon': ['即将支持', 'Coming soon'],
  'nodeGrants.scope.network': ['整个网络', 'Whole network'],
  'nodeGrants.scope.department': ['部门 {name}', 'Department {name}'],
  'nodeGrants.scope.node': ['节点 {name}', 'Node {name}'],
  'nodeGrants.scope.pickNetwork': ['整个网络', 'Whole network'],
  'nodeGrants.scope.pickDepartment': ['某个部门', 'A department'],
  'nodeGrants.scope.pickNode': ['指定节点', 'A node'],
  'nodeGrants.level.read': ['只读', 'Read only'],
  'nodeGrants.level.edit': ['可编辑', 'Can edit'],
  'nodeGrants.saved': ['已保存，马上生效', 'Saved — in effect now'],
  'nodeGrants.err.forbidden': ['没有权限：只有网络 owner / 管理员能授全网；部门负责人只能授自己负责的部门；节点主人不能给自己的节点授权。', 'Not allowed: only network owners/admins can grant network-wide; department heads only within their departments; a node\'s owner cannot grant their own node.'],
  'nodeGrants.err.notSupported': ['这个 Hub 还不支持这种能力。', 'This Hub does not support that capability yet.'],
  'nodeGrants.err.scopeGone': ['选的部门或节点已经不存在了，请重新选。', 'The chosen department or node no longer exists; pick again.'],
  'nodeGrants.err.generic': ['保存失败：{error}', 'Could not save: {error}'],
} as const;

registerTranslations(nodeGrantsTranslations);
