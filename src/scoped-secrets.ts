export type SecretScope = { networkId: string; daemonId: string | null; nodeId: string | null };
export const SECRET_ACTIVATION_STATES = ['next_start', 'hot_applied', 'hot_pending_idle', 'shadowed'] as const;
export type SecretActivation = (typeof SECRET_ACTIVATION_STATES)[number];
/** #4827 —— agent 举手的待填密钥（hub 的 list 响应里 `pending`；30 分钟 TTL）。 */
export type PendingSecretRequest = { key: string; label?: string; requested_at?: string; by_node_id?: string };
export type SecretSnapshot = { network_id: string; daemon_node_id: string | null; node_id: string | null;
  revision: number; activation: SecretActivation; keys: { key: string; source: 'daemon' | 'node' }[];
  /** 只来自 list 调用；写操作后可能仍是上一拍的值（下一次刷新会更新）。 */
  pending?: PendingSecretRequest[] };
export type MergedSecretKey = { key: string; source: 'daemon' | 'node'; independentOnly?: boolean };

/** #5505 —— Daemon 托管节点在运行时会合并读取 daemon scoped-secrets.json 与独立 node-secrets.json
 * （后者优先）。密钥页把两边键名合在一起展示，避免聊天卡片或 CLI 写进 node-secrets.json 的键在页面「失踪」。 */
export function mergeNodeSecretKeys(
  primary: readonly { key: string; source: 'daemon' | 'node' }[],
  independent: readonly { key: string; source: 'daemon' | 'node' }[] = [],
): MergedSecretKey[] {
  const byKey = new Map<string, MergedSecretKey>();
  for (const item of primary) byKey.set(item.key, { key: item.key, source: item.source });
  for (const item of independent) {
    const existing = byKey.get(item.key);
    if (!existing || existing.source === 'daemon') {
      byKey.set(item.key, { key: item.key, source: 'node', independentOnly: true });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** 只收形状对的行，最多 8 条；坏行丢弃而不是整份拒绝。 */
export function normalizePendingSecretRequests(v: unknown): PendingSecretRequest[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PendingSecretRequest[] = [];
  for (const row of v) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key.trim() : '';
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key)) continue;
    out.push({ key, ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}),
      ...(typeof r.requested_at === 'string' ? { requested_at: r.requested_at } : {}),
      ...(typeof r.by_node_id === 'string' ? { by_node_id: r.by_node_id } : {}) });
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
}
export type SecretResult = { kind: 'ready'; snapshot: SecretSnapshot } | { kind: 'unconfirmed' | 'cancelled' | 'forbidden' | 'unsupported' | 'invalid' };
export type SecretWrite =
  | { action: 'put' | 'delete'; key: string; value?: string; revision: number }
  | { action: 'reload'; key?: string };
// Only known release versions preflight here; custom/unknown builds still use Hub capability readback.
export function nodeSecretsNeedsUpgrade(version?: string | null): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(version ?? '');
  if (!match) return false;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major !== 2) return major < 2;
  if (minor !== 5) return minor < 5;
  if (patch !== 0) return false;
  return match[4] !== undefined && Number(match[4]) < 137;
}
export function validSecretInput(key: string, value: string): boolean {
  return /^[A-Z_][A-Z0-9_]{0,127}$/.test(key) && !!value && new TextEncoder().encode(value).length <= 8192 && !value.includes('\0');
}
export function parseSecretSnapshot(v: any, scope: SecretScope): SecretSnapshot | null {
  if (!v || Object.keys(v).some(k=>!['network_id','daemon_node_id','node_id','revision','activation','keys'].includes(k))
    || v.network_id !== scope.networkId || v.daemon_node_id !== scope.daemonId || v.node_id !== scope.nodeId
    || !Number.isSafeInteger(v.revision) || v.revision < 0 || !(SECRET_ACTIVATION_STATES as readonly string[]).includes(v.activation) || !Array.isArray(v.keys) || v.keys.length > 256
    || new Set(v.keys.map((x:any)=>x?.key)).size !== v.keys.length || v.keys.some((x:any)=>!x
      || Object.keys(x).some(k=>!['key','source'].includes(k)) || typeof x.key !== 'string' || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(x.key)
      || !['node','daemon'].includes(x.source) || (!scope.nodeId && x.source !== 'daemon') || (!scope.daemonId && x.source !== 'node'))) return null;
  return v;
}
type Rpc = (args: Record<string,unknown>, signal: AbortSignal, containsKey: boolean) => Promise<any>;
export async function manageSecrets(scope: SecretScope, rpc: Rpc, signal: AbortSignal, write?: SecretWrite,
  options: { timeoutMs?: number; pollMs?: number } = {}): Promise<SecretResult> {
  if (!scope.networkId || (!scope.daemonId && !scope.nodeId)) return { kind: 'unsupported' };
  if (signal.aborted) return { kind: 'cancelled' };
  if (write?.action === 'put' && !validSecretInput(write.key,write.value ?? '')) return { kind: 'invalid' };
  const ctrl = new AbortController(), cancel = ()=>ctrl.abort(); signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,options.timeoutMs ?? 20000);
  const aborted=new Promise<any>(resolve=>ctrl.signal.addEventListener('abort',()=>resolve({ok:false,error:'cancelled'}),{once:true}));
  const call = (args:Record<string,unknown>, containsKey=false)=>Promise.race([rpc(args,ctrl.signal,containsKey),aborted]);
  const errorResult = (r:any): SecretResult => ({kind: signal.aborted ? 'cancelled'
    : r?.error === 'invalid_secret_input' ? 'invalid'
    : ['user_token_required','secret_admin_required','forbidden'].includes(r?.error) ? 'forbidden'
    : ['unsupported','scoped_secrets_upgrade_required','node_secrets_upgrade_required'].includes(r?.error) ? 'unsupported' : 'unconfirmed'});
  try {
    const request=await call({action:write?.action ?? 'list',id:scope.daemonId ?? scope.nodeId,network_id:scope.networkId,node_id:scope.nodeId,
      ...(write
        ? write.action === 'reload'
          ? (write.key ? { key: write.key } : {})
          : { key: write.key, revision: write.revision, ...(write.action === 'put' ? { value: write.value } : {}) }
        : {})},write?.action==='put');
    const requestIdPattern=scope.daemonId ? /^dsk_[a-f0-9-]{36}$/ : /^nsk_[a-f0-9-]{36}$/;
    if (!request?.ok || request.status !== 'pending' || !requestIdPattern.test(request.request_id)) return errorResult(request);
    while (!ctrl.signal.aborted) {
      const r=await call({action:'read',id:request.request_id,network_id:scope.networkId});
      if (!r?.ok) return errorResult(r);
      if (r.request_id !== request.request_id || r.daemon_node_id !== scope.daemonId || r.node_id !== scope.nodeId) return {kind:'unconfirmed'};
      if (r.status==='succeeded') {
        const snapshot=parseSecretSnapshot(r.snapshot,scope);
        const owns=(source:string)=>source === (scope.nodeId?'node':'daemon');
        const mutating = write && write.action !== 'reload';
        if (!snapshot || (mutating && (snapshot.revision !== write.revision+1
          || (write.action==='put' && !snapshot.keys.some(k=>k.key===write.key&&owns(k.source)))
          || (write.action==='delete' && snapshot.keys.some(k=>k.key===write.key&&owns(k.source)))))) return {kind:'unconfirmed'};
        const pending = normalizePendingSecretRequests((request as any)?.pending);
        return {kind:'ready',snapshot: pending ? { ...snapshot, pending } : snapshot};
      }
      if (r.status!=='pending') return {kind:'unconfirmed'};
      await new Promise<void>(resolve=>{
        const finish=()=>{clearTimeout(wait);ctrl.signal.removeEventListener('abort',finish);resolve();};
        const wait=setTimeout(finish,options.pollMs ?? 500);ctrl.signal.addEventListener('abort',finish,{once:true});
      });
    }
    return errorResult(null);
  } catch { return errorResult(null); }
  finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}
