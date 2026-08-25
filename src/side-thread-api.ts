import { appFetch } from './app-fetch';
import { fetchNetworkId, type HubConfig } from './api';

// Keep every provisional PR2 route in one table. The UI and its state model do
// not know HTTP paths, runtime names, or Codex-specific details.
export const SIDE_THREAD_ENDPOINTS = {
  collection: '/api/side-threads',
  capability: '/api/side-threads/capability',
  member: (sideChatId: string) => `/api/side-threads/${encodeURIComponent(sideChatId)}`,
  action: (sideChatId: string, action: 'cancel' | 'retry' | 'archive' | 'purge' | 'bring-back') =>
    `/api/side-threads/${encodeURIComponent(sideChatId)}/${action}`,
} as const;

export type SideThreadBoundary =
  | { kind: 'through'; turnId: string }
  | { kind: 'before'; turnId: string };

export type SideThreadRecordState =
  | 'creating'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived'
  | 'purged';

export type SideThreadAttemptState = 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SideThreadAttemptRecord {
  attemptId: string;
  parentAttemptId?: string;
  threadId?: string;
  turnId?: string;
  state: SideThreadAttemptState;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Owner-authorized projection. `prompt` is deliberately required: returning
 * only a prompt hash makes close/reopen and detached-window hydration lie. */
export interface SideThreadRecord {
  sideChatId: string;
  networkId: string;
  nodeId: string;
  ownerUserId: string;
  sourceThreadId: string;
  boundary: SideThreadBoundary;
  prompt: string;
  threadId?: string;
  state: SideThreadRecordState;
  activeAttemptId?: string;
  runtime?: string;
  runtimeVersion?: string;
  topology?: string;
  evidenceRevision?: string;
  attempts: SideThreadAttemptRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface SideThreadCreationContext {
  networkId: string;
  nodeId: string;
  sourceThreadId: string;
  boundary: SideThreadBoundary;
}

export interface SideThreadCapability {
  supported: boolean;
  enabled: boolean;
  reason?: string;
  runtime?: string;
  runtimeVersion?: string;
  exactBoundary?: { through: boolean; before: boolean };
  context?: SideThreadCreationContext;
}

export type SideThreadErrorCode =
  | 'SIDE_THREAD_DISABLED'
  | 'SIDE_THREAD_UNSUPPORTED'
  | 'SIDE_THREAD_NOT_FOUND'
  | 'SIDE_THREAD_CONFLICT'
  | 'SIDE_THREAD_RUNTIME_ERROR'
  | 'SIDE_THREAD_PROTOCOL_ERROR'
  | 'SIDE_THREAD_NETWORK_ERROR';

export class SideThreadApiError extends Error {
  constructor(
    readonly code: SideThreadErrorCode,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'SideThreadApiError';
  }

  get unsupported(): boolean {
    return this.code === 'SIDE_THREAD_DISABLED' || this.code === 'SIDE_THREAD_UNSUPPORTED';
  }
}

export interface CreateSideThreadInput extends SideThreadCreationContext {
  requestKey: string;
  prompt: string;
  attachments?: Array<{ fileId: string }>;
}

export interface SideThreadClient {
  capability(alias: string): Promise<SideThreadCapability>;
  list(alias: string): Promise<SideThreadRecord[]>;
  create(input: CreateSideThreadInput): Promise<SideThreadRecord>;
  get(sideChatId: string): Promise<SideThreadRecord>;
  cancel(sideChatId: string): Promise<SideThreadRecord>;
  retry(sideChatId: string, input: { requestKey: string; prompt: string; attachments?: Array<{ fileId: string }> }): Promise<SideThreadRecord>;
  archive(sideChatId: string): Promise<SideThreadRecord>;
  bringBack(sideChatId: string, input: { requestKey: string; destinationThreadId: string; attemptId?: string }): Promise<{ bringBackId: string; destinationTurnId: string }>;
}

/** Transport-neutral update seam. PR2 can replace the bounded polling body
 * with SSE without changing the drawer or card ownership model. */
export const subscribeSideThreadUpdates = (
  client: Pick<SideThreadClient, 'list'>,
  alias: string,
  listener: (records: SideThreadRecord[]) => void,
  onError: (error: unknown) => void,
  intervalMs = 2500,
): (() => void) => {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const records = await client.list(alias);
      if (active) listener(records);
    } catch (error) {
      if (active) onError(error);
    } finally {
      if (active) timer = setTimeout(tick, intervalMs);
    }
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
  };
};

type JsonTransport = (path: string, init?: RequestInit) => Promise<unknown>;

const REQUEST_TIMEOUT_MS = 12_000;
const ID = /^[A-Za-z0-9._:-]{1,512}$/;
const STATES = new Set<SideThreadRecordState>(['creating', 'running', 'completed', 'failed', 'cancelled', 'archived', 'purged']);
const ATTEMPT_STATES = new Set<SideThreadAttemptState>(['starting', 'running', 'completed', 'failed', 'cancelled']);

let requestSequence = 0;
export const createSideThreadRequestKey = (purpose: 'create' | 'retry' | 'bring-back' = 'create'): string => {
  requestSequence = (requestSequence + 1) >>> 0;
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
  return `app:${purpose}:${time}:${random}:${requestSequence.toString(36)}`;
};

const errorFromResponse = (status: number, data: any): SideThreadApiError => {
  const rawCode = data?.code ?? data?.error?.code ?? data?.error;
  const code = typeof rawCode === 'string' && rawCode.startsWith('SIDE_THREAD_')
    ? rawCode as SideThreadErrorCode
    : status === 501
      ? 'SIDE_THREAD_UNSUPPORTED'
      : status === 404
        ? 'SIDE_THREAD_DISABLED'
        : status === 409
          ? 'SIDE_THREAD_CONFLICT'
          : status >= 500
            ? 'SIDE_THREAD_RUNTIME_ERROR'
            : 'SIDE_THREAD_PROTOCOL_ERROR';
  const message = data?.message ?? data?.error?.message ?? (typeof data?.error === 'string' ? data.error : undefined);
  return new SideThreadApiError(code, message || `SideThread request failed (HTTP ${status})`, status);
};

const protocolError = (message: string): never => {
  throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', message);
};

const stringField = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || !ID.test(value)) {
    throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', `SideThread response has invalid ${label}`);
  }
  return value;
};

const numberField = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', `SideThread response has invalid ${label}`);
  }
  return value;
};

const decodeBoundary = (value: any): SideThreadBoundary => {
  if (!value || (value.kind !== 'through' && value.kind !== 'before')) protocolError('SideThread response has invalid boundary');
  return { kind: value.kind, turnId: stringField(value.turnId, 'boundary.turnId') };
};

const decodeAttempt = (value: any): SideThreadAttemptRecord => {
  if (!value || !ATTEMPT_STATES.has(value.state)) protocolError('SideThread response has invalid attempt state');
  return {
    attemptId: stringField(value.attemptId, 'attemptId'),
    ...(value.parentAttemptId === undefined ? {} : { parentAttemptId: stringField(value.parentAttemptId, 'parentAttemptId') }),
    ...(value.threadId === undefined ? {} : { threadId: stringField(value.threadId, 'attempt.threadId') }),
    ...(value.turnId === undefined ? {} : { turnId: stringField(value.turnId, 'attempt.turnId') }),
    state: value.state,
    ...(typeof value.result === 'string' ? { result: value.result } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    createdAt: numberField(value.createdAt, 'attempt.createdAt'),
    updatedAt: numberField(value.updatedAt, 'attempt.updatedAt'),
  };
};

export const decodeSideThreadRecord = (value: any): SideThreadRecord => {
  if (!value || !STATES.has(value.state)) protocolError('SideThread response has invalid state');
  if (typeof value.prompt !== 'string' || !value.prompt.trim()) {
    protocolError('SideThread owner projection omitted prompt');
  }
  if (!Array.isArray(value.attempts)) protocolError('SideThread response omitted attempts');
  return {
    sideChatId: stringField(value.sideChatId, 'sideChatId'),
    networkId: stringField(value.networkId, 'networkId'),
    nodeId: stringField(value.nodeId, 'nodeId'),
    ownerUserId: stringField(value.ownerUserId, 'ownerUserId'),
    sourceThreadId: stringField(value.sourceThreadId, 'sourceThreadId'),
    boundary: decodeBoundary(value.boundary),
    prompt: value.prompt,
    ...(value.threadId === undefined ? {} : { threadId: stringField(value.threadId, 'threadId') }),
    state: value.state,
    ...(value.activeAttemptId === undefined ? {} : { activeAttemptId: stringField(value.activeAttemptId, 'activeAttemptId') }),
    ...(typeof value.runtime === 'string' ? { runtime: value.runtime } : {}),
    ...(typeof value.runtimeVersion === 'string' ? { runtimeVersion: value.runtimeVersion } : {}),
    ...(typeof value.topology === 'string' ? { topology: value.topology } : {}),
    ...(typeof value.evidenceRevision === 'string' ? { evidenceRevision: value.evidenceRevision } : {}),
    attempts: value.attempts.map(decodeAttempt),
    createdAt: numberField(value.createdAt, 'createdAt'),
    updatedAt: numberField(value.updatedAt, 'updatedAt'),
  };
};

const decodeCapability = (value: any): SideThreadCapability => {
  if (!value || typeof value.supported !== 'boolean' || typeof value.enabled !== 'boolean') {
    protocolError('Hub did not return an explicit SideThread capability');
  }
  const context = value.context;
  const decodedContext = context === undefined ? undefined : {
    networkId: stringField(context.networkId, 'context.networkId'),
    nodeId: stringField(context.nodeId, 'context.nodeId'),
    sourceThreadId: stringField(context.sourceThreadId, 'context.sourceThreadId'),
    boundary: decodeBoundary(context.boundary),
  };
  if (value.supported && value.enabled && !decodedContext) {
    protocolError('SideThread capability omitted exact creation context');
  }
  return {
    supported: value.supported,
    enabled: value.enabled,
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(typeof value.runtime === 'string' ? { runtime: value.runtime } : {}),
    ...(typeof value.runtimeVersion === 'string' ? { runtimeVersion: value.runtimeVersion } : {}),
    ...(value.exactBoundary && typeof value.exactBoundary.through === 'boolean' && typeof value.exactBoundary.before === 'boolean'
      ? { exactBoundary: { through: value.exactBoundary.through, before: value.exactBoundary.before } }
      : {}),
    ...(decodedContext ? { context: decodedContext } : {}),
  };
};

export const createSideThreadClient = (cfg: HubConfig, customTransport?: JsonTransport): SideThreadClient => {
  const transport: JsonTransport = customTransport ?? (async (path, init = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await appFetch(`${cfg.serverUrl}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok === false) throw errorFromResponse(response.status, data);
      if (!data || data.ok !== true) protocolError('Hub returned a non-SideThread response');
      return data;
    } catch (error) {
      if (error instanceof SideThreadApiError) throw error;
      throw new SideThreadApiError(
        'SIDE_THREAD_NETWORK_ERROR',
        error instanceof Error && error.name === 'AbortError' ? 'SideThread request timed out' : error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
    }
  });

  const write = (path: string, body?: unknown) => transport(path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });

  return {
    async capability(alias) {
      const networkId = cfg.networkId ?? await fetchNetworkId(cfg);
      const query = new URLSearchParams({ alias });
      if (networkId) query.set('network_id', networkId);
      const data = await transport(`${SIDE_THREAD_ENDPOINTS.capability}?${query}`) as any;
      return decodeCapability(data.capability);
    },
    async list(alias) {
      const networkId = cfg.networkId ?? await fetchNetworkId(cfg);
      const query = new URLSearchParams({ alias });
      if (networkId) query.set('network_id', networkId);
      const data = await transport(`${SIDE_THREAD_ENDPOINTS.collection}?${query}`) as any;
      if (!Array.isArray(data.sideThreads)) protocolError('SideThread list response omitted sideThreads');
      return data.sideThreads.map(decodeSideThreadRecord).filter((record: SideThreadRecord) => record.state !== 'purged');
    },
    async create(input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.collection, input) as any;
      return decodeSideThreadRecord(data.sideThread);
    },
    async get(sideChatId) {
      const data = await transport(SIDE_THREAD_ENDPOINTS.member(sideChatId)) as any;
      return decodeSideThreadRecord(data.sideThread);
    },
    async cancel(sideChatId) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideChatId, 'cancel')) as any;
      return decodeSideThreadRecord(data.sideThread);
    },
    async retry(sideChatId, input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideChatId, 'retry'), input) as any;
      return decodeSideThreadRecord(data.sideThread);
    },
    async archive(sideChatId) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideChatId, 'archive')) as any;
      return decodeSideThreadRecord(data.sideThread);
    },
    async bringBack(sideChatId, input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideChatId, 'bring-back'), input) as any;
      if (!data.bringBack || typeof data.bringBack.bringBackId !== 'string' || typeof data.bringBack.destinationTurnId !== 'string') {
        protocolError('SideThread bring-back response is malformed');
      }
      return data.bringBack;
    },
  };
};
