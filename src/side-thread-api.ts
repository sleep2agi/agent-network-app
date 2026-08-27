import { appFetch } from './app-fetch';
import { fetchNetworkId, type HubConfig } from './api';

// Keep every provisional PR2 route in one table. The UI and its state model do
// not know HTTP paths, runtime names, or Codex-specific details.
export const SIDE_THREAD_ENDPOINTS = {
  collection: '/api/side-threads',
  capability: '/api/side-threads/capability',
  member: (sideThreadId: string) => `/api/side-threads/${encodeURIComponent(sideThreadId)}`,
  action: (sideThreadId: string, action: 'cancel' | 'retry' | 'archive' | 'purge' | 'bring-back') =>
    `/api/side-threads/${encodeURIComponent(sideThreadId)}/${action}`,
} as const;

export type SideThreadBoundary =
  | { kind: 'through'; turnId: string }
  | { kind: 'before'; turnId: string };

export type SideThreadRecordState =
  | 'creating'
  | 'running'
  | 'ambiguous'
  | 'reconciling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived'
  | 'purged';

export type SideThreadAttemptState = 'starting' | 'running' | 'ambiguous' | 'reconciling' | 'completed' | 'failed' | 'cancelled';

export interface SideThreadAttemptRecord {
  attemptId: string;
  requestKey: string;
  parentAttemptId?: string;
  threadId?: string;
  turnId?: string;
  state: SideThreadAttemptState;
  result?: string;
  error?: string;
  attachments: Array<{ fileId: string }>;
  broughtBack: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SideThreadBringBackRecord {
  bringBackId: string;
  attemptId: string;
  requestKey: string;
  destinationThreadId: string;
  destinationTurnId?: string;
  state: 'starting' | 'completed' | 'failed';
  broughtBack: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface SideThreadBringBackAck {
  bringBackId: string;
  destinationTurnId: string;
}

export interface SideThreadOperationRecord {
  operationId: string;
  attemptId?: string;
  kind: 'fork' | 'start' | 'cancel' | 'archive' | 'purge' | 'bring-back';
  requestKey: string;
  state: 'pending' | 'ambiguous' | 'reconciling' | 'completed' | 'failed';
  threadId?: string;
  turnId?: string;
  errorCode?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SideThreadRecordCapability {
  runtime?: string;
  runtimeVersion?: string;
  topology?: string;
  evidenceRevision?: string;
}

/** Owner-authorized projection. `question` is deliberately required: returning
 * only a prompt hash makes close/reopen and detached-window hydration lie. */
export interface SideThreadRecord {
  sideThreadId: string;
  requestKey: string;
  networkId: string;
  nodeId: string;
  sourceThreadId: string;
  boundary: SideThreadBoundary;
  question: string;
  title: string;
  threadId?: string;
  state: SideThreadRecordState;
  activeAttemptId?: string;
  capability: SideThreadRecordCapability;
  attachments: Array<{ fileId: string }>;
  attempts: SideThreadAttemptRecord[];
  bringBacks: SideThreadBringBackRecord[];
  operations: SideThreadOperationRecord[];
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
  mode?: 'native-exact-fork';
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
  | 'SIDE_THREAD_AMBIGUOUS'
  | 'SIDE_THREAD_PROTOCOL_ERROR'
  | 'SIDE_THREAD_NETWORK_ERROR';

export class SideThreadApiError extends Error {
  constructor(
    readonly code: SideThreadErrorCode,
    message: string,
    readonly status = 0,
    readonly operationId?: string,
    readonly sideThreadId?: string,
    readonly attemptId?: string,
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
  question: string;
  attachments?: Array<{ fileId: string }>;
}

export interface SideThreadClient {
  capability(alias: string, context: Pick<SideThreadCreationContext, 'sourceThreadId' | 'boundary'>): Promise<SideThreadCapability>;
  list(alias: string, nodeId?: string): Promise<SideThreadRecord[]>;
  create(input: CreateSideThreadInput): Promise<SideThreadRecord>;
  get(sideThreadId: string): Promise<SideThreadRecord>;
  cancel(sideThreadId: string, input: { requestKey: string }): Promise<SideThreadRecord>;
  retry(sideThreadId: string, input: { requestKey: string; question: string; attachments?: Array<{ fileId: string }> }): Promise<SideThreadRecord>;
  archive(sideThreadId: string, input: { requestKey: string }): Promise<SideThreadRecord>;
  purge(sideThreadId: string, input: { requestKey: string }): Promise<SideThreadRecord>;
  bringBack(sideThreadId: string, input: { requestKey: string; destinationThreadId: string; attemptId?: string }): Promise<SideThreadBringBackAck>;
}

/** Transport-neutral update seam. PR2 can replace the bounded polling body
 * with SSE without changing the drawer or card ownership model. */
export const subscribeSideThreadUpdates = (
  client: Pick<SideThreadClient, 'list'>,
  alias: string,
  listener: (records: SideThreadRecord[]) => void,
  onError: (error: unknown) => void,
  intervalMs = 2500,
  nodeId?: string,
): (() => void) => {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const records = await client.list(alias, nodeId);
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
const INVALID_ID_CHARACTER = /[^A-Za-z0-9._:-]/;
const STATES = new Set<SideThreadRecordState>(['creating', 'running', 'ambiguous', 'reconciling', 'completed', 'failed', 'cancelled', 'archived', 'purged']);
const ATTEMPT_STATES = new Set<SideThreadAttemptState>(['starting', 'running', 'ambiguous', 'reconciling', 'completed', 'failed', 'cancelled']);
const BRING_BACK_STATES = new Set<SideThreadBringBackRecord['state']>(['starting', 'completed', 'failed']);
const OPERATION_STATES = new Set<SideThreadOperationRecord['state']>(['pending', 'ambiguous', 'reconciling', 'completed', 'failed']);
const OPERATION_KINDS = new Set<SideThreadOperationRecord['kind']>(['fork', 'start', 'cancel', 'archive', 'purge', 'bring-back']);

let requestSequence = 0;
export const createSideThreadRequestKey = (
  purpose: 'create' | 'cancel' | 'retry' | 'archive' | 'purge' | 'bring-back' = 'create',
): string => {
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
  return new SideThreadApiError(
    code,
    message || `SideThread request failed (HTTP ${status})`,
    status,
    typeof data?.operationId === 'string' ? data.operationId : undefined,
    typeof data?.sideThreadId === 'string' ? data.sideThreadId : undefined,
    typeof data?.attemptId === 'string' ? data.attemptId : undefined,
  );
};

const protocolError = (message: string): never => {
  throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', message);
};

const stringField = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value || value.length > 512 || INVALID_ID_CHARACTER.test(value)) {
    throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', `SideThread response has invalid ${label}: ${JSON.stringify(value)}`);
  }
  return value;
};

const numberField = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', `SideThread response has invalid ${label}`);
  }
  return value;
};

const optionalStringField = (value: unknown, label: string): string | undefined =>
  value == null ? undefined : stringField(value, label);

const optionalTextField = (value: unknown, label: string): string | undefined => {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', `SideThread response has invalid ${label}`);
  return value;
};

const optionalNumberField = (value: unknown, label: string): number | undefined =>
  value == null ? undefined : numberField(value, label);

const decodeAttachments = (value: unknown, label: string): Array<{ fileId: string }> => {
  if (!Array.isArray(value)) throw new SideThreadApiError('SIDE_THREAD_PROTOCOL_ERROR', `SideThread response omitted ${label}`);
  return value.map((attachment, index) => ({
    fileId: stringField(attachment?.fileId, `${label}[${index}].fileId`),
  }));
};

const decodeBoundary = (value: any): SideThreadBoundary => {
  if (!value || (value.kind !== 'through' && value.kind !== 'before')) protocolError('SideThread response has invalid boundary');
  return { kind: value.kind, turnId: stringField(value.turnId, 'boundary.turnId') };
};

const decodeAttempt = (value: any): SideThreadAttemptRecord => {
  if (!value || !ATTEMPT_STATES.has(value.state)) protocolError('SideThread response has invalid attempt state');
  if (typeof value.broughtBack !== 'boolean') protocolError('SideThread response has invalid attempt.broughtBack');
  return {
    attemptId: stringField(value.attemptId, 'attemptId'),
    requestKey: stringField(value.requestKey, 'attempt.requestKey'),
    ...(optionalStringField(value.parentAttemptId, 'parentAttemptId') ? { parentAttemptId: optionalStringField(value.parentAttemptId, 'parentAttemptId') } : {}),
    ...(optionalStringField(value.threadId, 'attempt.threadId') ? { threadId: optionalStringField(value.threadId, 'attempt.threadId') } : {}),
    ...(optionalStringField(value.turnId, 'attempt.turnId') ? { turnId: optionalStringField(value.turnId, 'attempt.turnId') } : {}),
    state: value.state,
    ...(optionalTextField(value.result, 'attempt.result') !== undefined ? { result: optionalTextField(value.result, 'attempt.result') } : {}),
    ...(optionalTextField(value.error, 'attempt.error') !== undefined ? { error: optionalTextField(value.error, 'attempt.error') } : {}),
    attachments: decodeAttachments(value.attachments, 'attempt.attachments'),
    broughtBack: value.broughtBack === true,
    createdAt: numberField(value.createdAt, 'attempt.createdAt'),
    updatedAt: numberField(value.updatedAt, 'attempt.updatedAt'),
  };
};

const decodeBringBack = (value: any): SideThreadBringBackRecord => {
  if (!value || !BRING_BACK_STATES.has(value.state)) protocolError('SideThread response has invalid bring-back state');
  if (typeof value.broughtBack !== 'boolean') protocolError('SideThread response has invalid bringBack.broughtBack');
  return {
    bringBackId: stringField(value.bringBackId, 'bringBackId'),
    attemptId: stringField(value.attemptId, 'bringBack.attemptId'),
    requestKey: stringField(value.requestKey, 'bringBack.requestKey'),
    destinationThreadId: stringField(value.destinationThreadId, 'bringBack.destinationThreadId'),
    ...(optionalStringField(value.destinationTurnId, 'destinationTurnId') ? { destinationTurnId: optionalStringField(value.destinationTurnId, 'destinationTurnId') } : {}),
    state: value.state,
    broughtBack: value.broughtBack === true,
    createdAt: numberField(value.createdAt, 'bringBack.createdAt'),
    updatedAt: numberField(value.updatedAt, 'bringBack.updatedAt'),
    ...(optionalNumberField(value.completedAt, 'bringBack.completedAt') !== undefined ? { completedAt: optionalNumberField(value.completedAt, 'bringBack.completedAt') } : {}),
  };
};

const decodeOperation = (value: any): SideThreadOperationRecord => {
  if (!value || !OPERATION_STATES.has(value.state) || !OPERATION_KINDS.has(value.kind)) {
    protocolError('SideThread response has invalid operation');
  }
  return {
    operationId: stringField(value.operationId, 'operation.operationId'),
    ...(optionalStringField(value.attemptId, 'operation.attemptId') ? { attemptId: optionalStringField(value.attemptId, 'operation.attemptId') } : {}),
    kind: value.kind,
    requestKey: stringField(value.requestKey, 'operation.requestKey'),
    state: value.state,
    ...(optionalStringField(value.threadId, 'operation.threadId') ? { threadId: optionalStringField(value.threadId, 'operation.threadId') } : {}),
    ...(optionalStringField(value.turnId, 'operation.turnId') ? { turnId: optionalStringField(value.turnId, 'operation.turnId') } : {}),
    ...(optionalStringField(value.errorCode, 'operation.errorCode') ? { errorCode: optionalStringField(value.errorCode, 'operation.errorCode') } : {}),
    createdAt: numberField(value.createdAt, 'operation.createdAt'),
    updatedAt: numberField(value.updatedAt, 'operation.updatedAt'),
  };
};

export const decodeSideThreadRecord = (value: any): SideThreadRecord => {
  if (!value || !STATES.has(value.state)) protocolError('SideThread response has invalid state');
  const purged = value.state === 'purged';
  if (!purged && (typeof value.question !== 'string' || !value.question.trim())) {
    protocolError('SideThread owner projection omitted question');
  }
  if (!Array.isArray(value.attempts)) protocolError('SideThread response omitted attempts');
  if (!Array.isArray(value.bringBacks)) protocolError('SideThread owner projection omitted bringBacks');
  if (!Array.isArray(value.operations)) protocolError('SideThread owner projection omitted operations');
  if (!value.capability || typeof value.capability !== 'object') protocolError('SideThread response omitted capability');
  return {
    sideThreadId: stringField(value.sideThreadId, 'sideThreadId'),
    requestKey: stringField(value.requestKey, 'requestKey'),
    networkId: stringField(value.networkId, 'networkId'),
    nodeId: stringField(value.nodeId, 'nodeId'),
    sourceThreadId: stringField(value.sourceThreadId, 'sourceThreadId'),
    boundary: decodeBoundary(value.boundary),
    question: typeof value.question === 'string' ? value.question : '',
    title: typeof value.title === 'string' ? value.title : '',
    ...(optionalStringField(value.threadId, 'threadId') ? { threadId: optionalStringField(value.threadId, 'threadId') } : {}),
    state: value.state,
    ...(optionalStringField(value.activeAttemptId, 'activeAttemptId') ? { activeAttemptId: optionalStringField(value.activeAttemptId, 'activeAttemptId') } : {}),
    capability: {
      ...(optionalStringField(value.capability.runtime, 'capability.runtime') ? { runtime: optionalStringField(value.capability.runtime, 'capability.runtime') } : {}),
      ...(optionalStringField(value.capability.runtimeVersion, 'capability.runtimeVersion') ? { runtimeVersion: optionalStringField(value.capability.runtimeVersion, 'capability.runtimeVersion') } : {}),
      ...(optionalStringField(value.capability.topology, 'capability.topology') ? { topology: optionalStringField(value.capability.topology, 'capability.topology') } : {}),
      ...(optionalStringField(value.capability.evidenceRevision, 'capability.evidenceRevision') ? { evidenceRevision: optionalStringField(value.capability.evidenceRevision, 'capability.evidenceRevision') } : {}),
    },
    attachments: decodeAttachments(value.attachments, 'attachments'),
    attempts: value.attempts.map(decodeAttempt),
    bringBacks: value.bringBacks.map(decodeBringBack),
    operations: value.operations.map(decodeOperation),
    createdAt: numberField(value.createdAt, 'createdAt'),
    updatedAt: numberField(value.updatedAt, 'updatedAt'),
  };
};

const decodeCapability = (value: any): SideThreadCapability => {
  if (!value || typeof value.supported !== 'boolean' || typeof value.enabled !== 'boolean') {
    protocolError('Hub did not return an explicit SideThread capability');
  }
  const context = value.context;
  const decodedContext = context == null ? undefined : {
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
    ...(value.mode === 'native-exact-fork' ? { mode: value.mode } : {}),
    ...(optionalTextField(value.reason, 'capability.reason') !== undefined ? { reason: optionalTextField(value.reason, 'capability.reason') } : {}),
    ...(optionalStringField(value.runtime, 'capability.runtime') ? { runtime: optionalStringField(value.runtime, 'capability.runtime') } : {}),
    ...(optionalStringField(value.runtimeVersion, 'capability.runtimeVersion') ? { runtimeVersion: optionalStringField(value.runtimeVersion, 'capability.runtimeVersion') } : {}),
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

  const write = async (
    path: string,
    body: { requestKey: string },
    identity: { sideThreadId?: string; attemptId?: string } = {},
  ) => {
    try {
      return await transport(path, { method: 'POST', body: JSON.stringify(body) });
    } catch (error) {
      if (error instanceof SideThreadApiError && error.code !== 'SIDE_THREAD_NETWORK_ERROR') throw error;
      throw new SideThreadApiError(
        'SIDE_THREAD_AMBIGUOUS',
        'SideThread write acknowledgement was not received; reconcile with GET/list using the same requestKey',
        0,
        error instanceof SideThreadApiError ? error.operationId : undefined,
        error instanceof SideThreadApiError ? error.sideThreadId ?? identity.sideThreadId : identity.sideThreadId,
        error instanceof SideThreadApiError ? error.attemptId ?? identity.attemptId : identity.attemptId,
      );
    }
  };

  const decodeWriteRecord = (data: any, identity: { sideThreadId?: string } = {}): SideThreadRecord => {
    try {
      return decodeSideThreadRecord(data?.sideThread);
    } catch (error) {
      if (!(error instanceof SideThreadApiError) || error.code !== 'SIDE_THREAD_PROTOCOL_ERROR') throw error;
      throw new SideThreadApiError(
        'SIDE_THREAD_AMBIGUOUS',
        'Hub acknowledged the write but omitted the authoritative SideThread projection; reconcile with GET/list',
        0,
        undefined,
        identity.sideThreadId,
      );
    }
  };

  return {
    async capability(alias, context) {
      const networkId = cfg.networkId ?? await fetchNetworkId(cfg);
      const query = new URLSearchParams({
        alias,
        sourceThreadId: context.sourceThreadId,
        boundaryKind: context.boundary.kind,
        boundaryTurnId: context.boundary.turnId,
      });
      if (networkId) query.set('networkId', networkId);
      const data = await transport(`${SIDE_THREAD_ENDPOINTS.capability}?${query}`) as any;
      return decodeCapability(data.capability);
    },
    async list(alias, nodeId) {
      const networkId = cfg.networkId ?? await fetchNetworkId(cfg);
      const query = new URLSearchParams({ alias });
      if (networkId) query.set('networkId', networkId);
      if (nodeId) query.set('nodeId', nodeId);
      const data = await transport(`${SIDE_THREAD_ENDPOINTS.collection}?${query}`) as any;
      if (!Array.isArray(data.sideThreads)) protocolError('SideThread list response omitted sideThreads');
      // Keep purged tombstones through decoding so the model can remove a
      // previously-rendered card. Purged records intentionally have no question.
      return data.sideThreads.map(decodeSideThreadRecord);
    },
    async create(input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.collection, input) as any;
      return decodeWriteRecord(data);
    },
    async get(sideThreadId) {
      const data = await transport(SIDE_THREAD_ENDPOINTS.member(sideThreadId)) as any;
      return decodeSideThreadRecord(data.sideThread);
    },
    async cancel(sideThreadId, input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideThreadId, 'cancel'), input, { sideThreadId }) as any;
      return decodeWriteRecord(data, { sideThreadId });
    },
    async retry(sideThreadId, input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideThreadId, 'retry'), input, { sideThreadId }) as any;
      return decodeWriteRecord(data, { sideThreadId });
    },
    async archive(sideThreadId, input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideThreadId, 'archive'), input, { sideThreadId }) as any;
      return decodeWriteRecord(data, { sideThreadId });
    },
    async purge(sideThreadId, input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideThreadId, 'purge'), input, { sideThreadId }) as any;
      return decodeWriteRecord(data, { sideThreadId });
    },
    async bringBack(sideThreadId, input) {
      const data = await write(SIDE_THREAD_ENDPOINTS.action(sideThreadId, 'bring-back'), input, {
        sideThreadId,
        attemptId: input.attemptId,
      }) as any;
      try {
        if (!data.bringBack) protocolError('SideThread bring-back response is malformed');
        return {
          bringBackId: stringField(data.bringBack.bringBackId, 'bringBack.bringBackId'),
          destinationTurnId: stringField(data.bringBack.destinationTurnId, 'bringBack.destinationTurnId'),
        };
      } catch (error) {
        if (!(error instanceof SideThreadApiError) || error.code !== 'SIDE_THREAD_PROTOCOL_ERROR') throw error;
        throw new SideThreadApiError(
          'SIDE_THREAD_AMBIGUOUS',
          'Hub acknowledged bring-back without a complete receipt; reconcile with GET/list',
          0,
          undefined,
          sideThreadId,
          input.attemptId,
        );
      }
    },
  };
};
