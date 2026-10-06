import type { HubNode, NodeLifecycleRequest } from './api';
import { registerTranslations, t } from './i18n';
registerTranslations({
  'adopt.title': ['daemon 管理', 'Daemon management'],
  'adopt.entry': ['交给 daemon 管理', 'Manage with a daemon'],
  'adopt.explain': ['进程不会重启。确认收编后，可以在这里停止和启动节点。请选择已知的 daemon，并填写该节点在其机器上的工作目录。', 'The process will not restart. After adoption, you can stop and start it here. Select the known daemon and enter the node workspace on that machine.'],
  'adopt.path': ['节点工作目录（绝对路径）', 'Node workspace (absolute path)'],
  'adopt.confirm': ['确认收编', 'Confirm adoption'],
  'adopt.cancel': ['取消', 'Cancel'],
  'adopt.start': ['启动', 'Start'], 'adopt.stop': ['停止', 'Stop'],
  'adopt.restart': ['重启', 'Restart'],
  'adopt.restartHint': ['收编节点请先停止再启动。', 'Stop then start an adopted node.'],
  'adopt.confirmStop': ['停止会中断节点进程，但保留配置。确认停止？', 'Stopping interrupts the node process but preserves configuration. Stop now?'],
  'adopt.confirmStart': ['按已验证的原启动方式启动此节点？', 'Start this node using its verified original launch method?'],
  'adopt.pending': ['请求已提交，等待 daemon 确认…', 'Request submitted. Waiting for daemon confirmation…'],
  'adopt.success': ['操作已完成', 'Operation completed'],
  'adopt.uncertain': ['暂时无法确认结果。请刷新节点状态，勿重复提交。', 'Result is not confirmed. Refresh node status before retrying.'],
  'adopt.empty': ['没有报告支持收编的 daemon。', 'No daemon reports adoption support.'],
  'adopt.failed': ['操作未完成，请检查 daemon 状态或联系管理员。', 'Operation did not complete. Check the daemon or contact an administrator.'],
  'adopt.socket': ['需要验证过的私有 tmux socket；默认 socket 不允许远程启动。', 'A verified private tmux socket is required; the default socket cannot be started remotely.'],
  'adopt.evidence': ['缺少可靠的进程或启动证据，已拒绝操作。请在节点机器上检查。', 'Process or launch evidence is missing. Operation refused; check the node machine.'],
  'adopt.binding': ['收编绑定缺失或已撤销，请重新收编。', 'Adoption binding is missing or revoked. Adopt the node again.'],
  'adopt.denied': ['没有操作权限，或目标不在当前网络。', 'Permission denied or target is outside this network.'],
  'adopt.pathError': ['请填写 daemon 允许收编范围内的绝对工作目录。', 'Enter an absolute workspace within the daemon adoption roots.'],
});
export const adoptionSupported = (node: HubNode) =>
  (node.managed === 'none' || node.managed === 'adopted' || node.managed === 'created') && node.adoption !== undefined;
export const isAdopted = (node: HubNode) => adoptionSupported(node) && (node.managed === 'adopted' || node.adoption?.status === 'active');
export function adoptionOutcome(kind: NodeLifecycleRequest['kind'], status: string): 'pending' | 'success' | 'failed' {
  if (status === 'pending' || status === 'delivered') return 'pending';
  return status === ({ adopt: 'active', start: 'started', stop: 'stopped' }[kind]) ? 'success' : 'failed';
}
export function adoptionError(error: unknown): string {
  const key = error === 'adopt_explicit_private_socket_required' ? 'socket'
    : ['adopt_start_evidence_missing', 'adopt_stop_evidence_missing', 'adopt_process_generation_changed'].includes(String(error)) ? 'evidence'
    : ['adopt_active_binding_required', 'adopt_binding_revoked_during_start', 'adopt_binding_unavailable'].includes(String(error)) ? 'binding'
    : ['adopt_forbidden', 'user_token_required'].includes(String(error)) ? 'denied'
    : ['invalid_workdir', 'adopt_workdir_outside_roots', 'adopt_roots_not_configured'].includes(String(error)) ? 'pathError'
    : error === 'adopted_restart_requires_daemon' ? 'restartHint' : 'failed';
  return t(`adopt.${key}`);
}
