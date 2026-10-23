// #2014: fixed semantic operation, never keys, commands or an OpenCode URL.
import type { HubConfig, Session } from './api';
import { appFetch } from './app-fetch';
import { withDeadline } from './deadline';

export interface SessionControlTarget { node_id: string; network_id: string; session_id?: string }
export interface SessionControlState {
  session_id: string; binding_id: string; supported: boolean; active: boolean;
  can_request_background: boolean; observed_at: number;
}
export interface SessionControlReceipt { outcome: 'request_processed' | 'already_idle'; state: SessionControlState }
export type SessionControlResult = { ok: true; state: SessionControlState; outcome?: SessionControlReceipt['outcome'] }
  | { ok: false; error: 'unavailable' | 'unsupported' | 'access' | 'changed' | 'unknown' | 'expired' };
const ROOT = '/api/node-session-control';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function sessionControlTarget(cfg: HubConfig, session: Session | null, alias: string): SessionControlTarget | null {
  if (!cfg.networkId || !session || session.alias !== alias || !session.node_id
    || (session.network_id && session.network_id !== cfg.networkId)
    || !/opencode/i.test(session.runtime || session.agent || '')) return null;
  return { node_id: session.node_id, network_id: cfg.networkId, ...(session.session_id ? { session_id: session.session_id } : {}) };
}
export function readSessionControlState(v: unknown): SessionControlState | null {
  if (!record(v) || typeof v.session_id !== 'string' || !/^ses_[A-Za-z0-9]+$/.test(v.session_id)
    || typeof v.binding_id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(v.binding_id)
    || typeof v.supported !== 'boolean' || typeof v.active !== 'boolean' || typeof v.can_request_background !== 'boolean'
    || typeof v.observed_at !== 'number' || !Number.isFinite(v.observed_at)
    || v.can_request_background !== (v.supported && v.active)) return null;
  return { session_id: v.session_id, binding_id: v.binding_id, supported: v.supported,
    active: v.active, can_request_background: v.can_request_background, observed_at: v.observed_at };
}
export function canBackgroundSession(state: SessionControlState | null, readAt: number, now: number): boolean {
  return !!state?.can_request_background && readAt > 0 && now >= readAt && now - readAt < 30_000;
}
function errorCode(error: unknown, mutation: boolean): SessionControlResult {
  if (typeof error !== 'string') return { ok: false, error: mutation ? 'unknown' : 'unavailable' };
  if (/outcome_unknown|unknown/.test(error)) return { ok: false, error: 'unknown' };
  if (/denied|forbidden|auth|permission|role/.test(error)) return { ok: false, error: 'access' };
  if (/changed|binding|generation|mismatch/.test(error)) return { ok: false, error: 'changed' };
  if (/unsupported|bridge_unavailable|not_registered/.test(error)) return { ok: false, error: 'unsupported' };
  if (/expired/.test(error)) return { ok: false, error: mutation ? 'unknown' : 'expired' };
  return { ok: false, error: mutation ? 'unknown' : 'unavailable' };
}

/** Exactly one enqueue. Polling only reads the receipt; it never resubmits. */
export async function runSessionControl(cfg: HubConfig, target: SessionControlTarget,
  expected?: SessionControlState, options: { cancelled?: () => boolean; waitMs?: number } = {}): Promise<SessionControlResult> {
  const mutation = !!expected;
  if (!cfg.networkId || cfg.networkId !== target.network_id || !target.node_id
    || (expected && (!readSessionControlState(expected) || !expected.can_request_background
      || (target.session_id && expected.session_id !== target.session_id)))) return { ok: false, error: 'changed' };
  const deadline = Date.now() + (options.waitMs ?? 20_000);
  const cancelled = () => options.cancelled?.() || Date.now() >= deadline;
  const request = async (path: string, body?: unknown) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1, Math.min(5_000, deadline - Date.now())));
    try {
      return await withDeadline((async () => {
        const response = await appFetch(`${cfg.serverUrl.replace(/\/+$/, '')}${path}`, {
          method: body === undefined ? 'GET' : 'POST', signal: ctrl.signal,
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.status === 401 || response.status === 403) return { ok: false, error: body === undefined && mutation ? 'unknown' : 'access_denied' };
        if (response.status === 404 || response.status === 405) return { ok: false, error: body === undefined ? (mutation ? 'unknown' : 'unavailable') : 'unsupported' };
        // 旧 Hub 对未实现的 /api 路径返回 200 + 纯文本帮助页（实测 commhub-server 0.9.0-preview.144 就是这样），
        // 这是「能力不存在」，不是「暂时读不到」：重试永远不会成功，不能显示「请稍后刷新状态」。
        const mediaType = (response.headers.get('content-type') || '').toLowerCase();
        if (response.ok && !mediaType.includes('json')) return { ok: false, error: 'unsupported' };
        const data: unknown = await response.json();
        if (!response.ok) return { ok: false, error: record(data) && typeof data.error === 'string' ? data.error : 'unavailable' };
        return data;
      })(), Math.max(1, Math.min(5_000, deadline - Date.now())), () => ({ ok: false, error: mutation ? 'unknown' : 'unavailable' }));
    } finally { clearTimeout(timer); }
  };
  try {
    if (cancelled()) return errorCode('expired', mutation);
    const queued = await request(ROOT, { network_id: target.network_id, node_id: target.node_id,
      operation: mutation ? 'background' : 'state', ...(expected ? { expected: { session_id: expected.session_id, binding_id: expected.binding_id } } : {}) });
    if (!record(queued) || queued.ok !== true) return errorCode(record(queued) ? queued.error : null, mutation);
    if (typeof queued.request_id !== 'string' || !/^(?:bg|sc)_[0-9]{13}_[A-Za-z0-9_-]{8,64}$/.test(queued.request_id)) return errorCode(null, mutation);
    const id = queued.request_id;
    while (!cancelled()) {
      const result = await request(`${ROOT}/${encodeURIComponent(id)}?network_id=${encodeURIComponent(target.network_id)}`);
      if (!record(result) || result.ok !== true) return errorCode(record(result) ? result.error : null, mutation);
      if (result.request_id !== id) return errorCode(null, mutation);
      if (['failed', 'unknown', 'expired'].includes(String(result.status))) return errorCode(result.error || result.status, mutation);
      if (result.status === 'done') {
        const receipt = result.result;
        const state = readSessionControlState(mutation && record(receipt) ? receipt.state : receipt);
        if (!state || (target.session_id && state.session_id !== target.session_id)
          || (expected && (state.session_id !== expected.session_id || state.binding_id !== expected.binding_id))) return { ok: false, error: mutation ? 'unknown' : 'changed' };
        if (mutation && (!record(receipt) || !['request_processed', 'already_idle'].includes(String(receipt.outcome)))) return { ok: false, error: 'unknown' };
        return { ok: true, state, ...(mutation ? { outcome: (receipt as unknown as SessionControlReceipt).outcome } : {}) };
      }
      if (result.status !== 'pending' && result.status !== 'in_progress') return errorCode(null, mutation);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch { /* Transport details can contain secrets; never render them. */ }
  return { ok: false, error: mutation ? 'unknown' : 'unavailable' };
}
