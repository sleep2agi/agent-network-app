// 节点页「技能」区的挂载点(2026-09-24 节点页重做)。
// 技能列表由另一个分支(feat/node-skills-section)实现并替换本文件;这里只保证:
//   - 导出名与 props 形状固定,节点页可以先挂上;
//   - 节点没上报 skills_capable === true 时什么都不渲染(节点页也不会显示「技能」分区)。
import type { HubConfig, Session } from './api';

export default function NodeSkillsSection(_props: { cfg: HubConfig; alias: string; session: Session & { skills_capable?: boolean } }) {
  return null;
}
