// #4863 —— 「聊天信息」里的「所属部门」行（通信欧 11-15 定）：
//   1) 未归属**必须有这一行**（admin 就是因为这行不存在才找不到入口）；
//   2) testID 走既有 chat-info 命名族（`chat-info-row-department`），别另起一套；
//   3) 点开复用同一个 picker（NodeDepartmentPicker），保存仍走 moveAgentDepartment。

import { readFileSync } from 'node:fs';
import { chatInfoGroups } from './chat-info-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };

const base = {
  alias: 'a1',
  canOpenNode: true,
  hasRulesTarget: false,
  skillsCapable: false,
  secretsCapable: false,
};

// 1) 未归属也出现
{
  const groups = chatInfoGroups({ ...base, department: { label: '未归属' } });
  const first = groups[0] ?? [];
  const row = first.find(r => r.key === 'department');
  ck('未归属时「所属部门」行存在', !!row);
  ck('该行显示「未归属」', row?.detail === '未归属');
  ck('该行紧跟在头像行之后', first[0]?.key === 'node' && first[1]?.key === 'department');
}

// 2) 已归属显示完整路径
{
  const groups = chatInfoGroups({ ...base, department: { label: '天马 / 研发 / 客户端' } });
  const row = (groups[0] ?? []).find(r => r.key === 'department');
  ck('已归属显示完整路径', row?.detail === '天马 / 研发 / 客户端');
}

// 3) 不传 department 时不出这一行（旧调用方兼容），但节点页那条是常显的（另测）
{
  const groups = chatInfoGroups({ ...base });
  ck('未提供 department ⇒ 不强行造行', !(groups[0] ?? []).some(r => r.key === 'department'));
}

// 3b) 只读态：行上要标「（只读）」，且不可编辑时不弹选择器（里面只有「未归属」，点了只会 403）
{
  const g = chatInfoGroups({ ...base, department: { label: '天马 / 研发', editable: false } });
  const row = (g[0] ?? []).find(r => r.key === 'department');
  ck('只读时行上标「（只读）」', row?.detail === '天马 / 研发（只读）');
  const g2 = chatInfoGroups({ ...base, department: { label: '未归属', editable: false } });
  ck('只读 + 未归属 也显示这一行', (g2[0] ?? []).some(r => r.key === 'department'));
}

// 4) 源码级接线
{
  const screen = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  ck('ChatScreen 汇总里带上 department', /department:\s*deptInfo\s*\?/.test(screen));
  ck('可编辑时点击该行打开同一个 picker', /case 'department':[\s\S]{0,220}if \(deptInfo\?\.editable\) setDeptPickerOpen\(true\)/.test(screen));
  ck('不可编辑时不弹选择器（避免点一个只会 403 的项）',
    /case 'department':[\s\S]{0,220}if \(deptInfo\?\.editable\)/.test(screen) && /不可编辑时\*\*不弹选择器/.test(screen));
  ck('渲染 NodeDepartmentPicker（复用同一组件）', /<NodeDepartmentPicker/.test(screen));
  ck('保存成功后重新取归属（不靠本地猜）', /void fetchHubNodes\(cfg\)\.then\(r =>/.test(screen));
  ck('失败时带出 Hub 原文', /Hub：\$\{detail\}/.test(screen));

  const panel = readFileSync(new URL('./ChatInfoPanel.tsx', import.meta.url), 'utf8');
  ck('link 行渲染 detail（右侧附注）', /row\.detail \?/.test(panel));
  ck('detail 的 testID 在 chat-info 族里', /testID=\{`\$\{testID\}-detail`\}/.test(panel));
  ck('行 testID 仍是 chat-info-row-* 族', /chat-info-row-\$\{key\.replace/.test(panel));
}

console.log(`${p}/${t} checks passed`);
