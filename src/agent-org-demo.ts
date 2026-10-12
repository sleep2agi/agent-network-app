// 调整 Agent 所在部门:Hub 没有这个写接口。只在内存里模拟,不发请求,不写配置。
// 不要 import ./api、./app-fetch、./org-api。

export type DemoMoveResult =
  | { ok: true; network: false; persisted: false; nodeId: string; departmentId: string | null }
  | { ok: false; reason: 'node' | 'department'; network: false; persisted: false };

function blockDemoNet(net?: (url: string, init?: RequestInit) => unknown): void {
  void net;
}

/** departmentId null = 移到未归属,这是合法目标。net 即使传了也不会被调用。 */
export function simulateStructureMove(
  input: { nodeId?: string | null; departmentId?: string | null },
  net?: (url: string, init?: RequestInit) => unknown,
): DemoMoveResult {
  blockDemoNet(net);
  const nodeId = typeof input.nodeId === 'string' ? input.nodeId.trim() : '';
  if (!nodeId) return { ok: false, reason: 'node', network: false, persisted: false };
  if (input.departmentId === null) return { ok: true, network: false, persisted: false, nodeId, departmentId: null };
  if (typeof input.departmentId !== 'string' || !input.departmentId.trim()) return { ok: false, reason: 'department', network: false, persisted: false };
  return { ok: true, network: false, persisted: false, nodeId, departmentId: input.departmentId.trim() };
}
