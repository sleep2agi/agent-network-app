// #4863 —— 节点「所属部门」选择器：**复用** AgentOrgScreen 里的 StructureSelector，
// 保存一律走 agent-org-api.moveAgentDepartment（不新增写路径）。
//
// 只做一件事：把一个部门 id（或 null=未归属）交给 moveAgentDepartment，并把结果交回调用方，
// 由调用方决定显示什么（节点页/聊天信息各自有自己的提示位）。
import { useMemo, useState } from 'react';
import { StructureSelector } from './AgentOrgScreen';
import { useTranslation } from './i18n-react';
import './i18n-agent-org';
import { moveAgentDepartment } from './agent-org-api';
import { moveFailureKey, departmentOptions, type OrgLike } from './node-department-edit';
import type { HubConfig } from './api';

export default function NodeDepartmentPicker({
  cfg,
  networkId,
  nodeId,
  org,
  departmentId,
  onClose,
  onResult,
}: {
  cfg: HubConfig;
  networkId: string | null | undefined;
  nodeId: string | null | undefined;
  org: OrgLike;
  departmentId: string | null | undefined;
  onClose: () => void;
  /** null = 成功；否则是 i18n key。`detail` = Hub 原文（403 原因），调用方要原样显示。 */
  onResult: (errorKey: string | null, detail?: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // 选项层用逐部门事实（通信欧 11-15 定）：不可管的部门灰掉并给原因，别让人白点。
  const options = useMemo(() => departmentOptions(org), [org]);

  const pick = async (id: string | null) => {
    if (busy) return;
    if (!networkId || !nodeId) { onResult('agentOrg.saveNoNode'); return; }
    setBusy(true);
    const r = await moveAgentDepartment(cfg, networkId, nodeId, id).catch(() => ({ ok: false as const, reason: 'error' as const }));
    setBusy(false);
    if (r.ok) { onResult(null); return; }
    onResult(moveFailureKey(r.reason), 'detail' in r ? r.detail : undefined);
  };

  return (
    <StructureSelector
      title={busy ? t('agentOrg.saving') : t('nodeDepartment.title')}
      options={options.map(o => ({ id: o.id, label: o.label, subtitle: o.subtitle, testID: o.testID }))}
      selected={departmentId ?? null}
      onPick={id => void pick(id)}
      onClose={onClose}
    />
  );
}
