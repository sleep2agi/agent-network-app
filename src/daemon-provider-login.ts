import type { ProviderScope, parseProviderRpc } from './daemon-provider-management';
import { validLoginIntent, validLoginReceipt, type LoginIntent } from './daemon-provider-login-contract';
export type SavedLoginAccount = { account_id: string; label: string; created_at: number; auth_state: 'not_checked' };
export type LoginView = { request_id: string; status: 'idle' | 'starting' | 'awaiting_user' | 'verifying' | 'authenticated' | 'cancelled' | 'failed';
  error?: string; account_id?: string; challenge?: { verificationUrl: string; userCode: string; loginId: string } };
export type LoginResult = { kind: 'ready'; value: LoginView | { accounts: SavedLoginAccount[] } }
  | { kind: 'unconfirmed' | 'forbidden' | 'unsupported' };
type Rpc = (action: 'login' | 'read', id: string, signal: AbortSignal) => Promise<ReturnType<typeof parseProviderRpc>>;
/** Submit once; only poll the request receipt. Abort stops observation, not OAuth. */
export async function runProviderLogin(scope: ProviderScope, intent: LoginIntent, rpc: Rpc, signal: AbortSignal,
  options: { timeoutMs?: number; pollMs?: number } = {}): Promise<LoginResult> {
  if (signal.aborted || !scope.networkId || !scope.daemonId || !validLoginIntent(intent)) return { kind: 'unconfirmed' };
  const ctrl = new AbortController(), cancel = () => ctrl.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, options.timeoutMs ?? 45_000);
  const aborted = new Promise<ReturnType<typeof parseProviderRpc>>(resolve => ctrl.signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), { once: true }));
  const call = (action: 'login' | 'read', id: string) => Promise.race([rpc(action, id, ctrl.signal), aborted]);
  try {
    const submit = await call('login', scope.daemonId);
    if (submit.kind === 'forbidden' || submit.kind === 'unsupported') return { kind: submit.kind };
    if (submit.kind !== 'payload' || submit.value.status !== 'pending' || typeof submit.value.request_id !== 'string'
      || !/^dpl_[a-f0-9-]{36}$/.test(submit.value.request_id)) return { kind: 'unconfirmed' };
    const requestId = submit.value.request_id;
    while (!ctrl.signal.aborted) {
      const read = await call('read', requestId);
      if (read.kind !== 'payload') return { kind: read.kind === 'forbidden' || read.kind === 'unsupported' ? read.kind : 'unconfirmed' };
      const result = read.value;
      if (result.request_id !== requestId || result.daemon_node_id !== scope.daemonId) break;
      if (result.status === 'succeeded') {
        if (!validLoginReceipt(result.login, intent, scope.networkId, scope.daemonId)) break;
        return { kind: 'ready', value: result.login as LoginView | { accounts: SavedLoginAccount[] } };
      }
      if (result.status !== 'pending') break;
      await Promise.race([new Promise(resolve => setTimeout(resolve, options.pollMs ?? 700)), aborted]);
    }
  } catch { /* never expose raw OAuth/Hub/transport errors */ }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); ctrl.abort(); }
  return { kind: 'unconfirmed' };
}
