import { parseProviderRpc, type ProviderScope } from './daemon-provider-management';
import { validProviderApplicationReceipt, validProviderApplicationSelection, type ProviderApplicationSelection } from './provider-application-contract';
export type ProviderApplicationWrite = { revision: number; provider: ProviderApplicationSelection };
export type ProviderApplicationResult = { kind: 'applied'; requestId: string; model: string; providerId: string; nodeId: string }
  | { kind: 'unconfirmed'; requestId?: string };
type Rpc = (action: 'apply' | 'read', id: string, signal: AbortSignal) => Promise<ReturnType<typeof parseProviderRpc>>;
/** One submission only. Timeout/cancel stops observation, not a remote transaction. */
export async function runProviderApplication(scope: ProviderScope, write: ProviderApplicationWrite, rpc: Rpc,
  signal: AbortSignal, options: { timeoutMs?: number; pollMs?: number } = {}): Promise<ProviderApplicationResult> {
  if (signal.aborted || !scope.networkId || !scope.daemonId || !validProviderApplicationSelection(write.provider)
    || !Number.isSafeInteger(write.revision) || write.revision < 0) return { kind: 'unconfirmed' };
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort(); signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, options.timeoutMs ?? 120_000);
  const aborted = new Promise<ReturnType<typeof parseProviderRpc>>(resolve => ctrl.signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), { once: true }));
  let requestId: string | undefined;
  const call = (action: 'apply' | 'read', id: string) => Promise.race([rpc(action, id, ctrl.signal), aborted]);
  try {
    const submitted = await call('apply', scope.daemonId);
    if (submitted.kind !== 'payload' || submitted.value.status !== 'pending'
      || typeof submitted.value.request_id !== 'string' || !/^dpa_[a-f0-9-]{36}$/.test(submitted.value.request_id)) return { kind: 'unconfirmed' };
    requestId = submitted.value.request_id;
    while (!ctrl.signal.aborted) {
      const read = await call('read', requestId!);
      if (read.kind !== 'payload') break;
      const result = read.value;
      if (result.request_id !== requestId || result.daemon_node_id !== scope.daemonId) break;
      if (result.status === 'succeeded') {
        if (!validProviderApplicationReceipt(result.application, requestId!, write.revision, write.provider)) break;
        return { kind: 'applied', requestId: requestId!, model: result.application.model,
          providerId: result.application.provider_id, nodeId: result.application.node_id };
      }
      if (result.status !== 'pending') break;
      await Promise.race([new Promise(resolve => setTimeout(resolve, options.pollMs ?? 1000)), aborted]);
    }
  } catch { /* never expose raw remote errors or retry a mutation */ }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); ctrl.abort(); }
  return { kind: 'unconfirmed', requestId };
}
