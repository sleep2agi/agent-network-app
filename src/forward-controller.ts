export type ForwardState = 'pending' | 'ambiguous';
export interface ForwardOperation { key: string; conversationKey: string; target: string; sourceHash: string; requestId: string; state: ForwardState; }
let ops: Record<string, ForwardOperation> = {};
let persist: ((all: ForwardOperation[]) => void | Promise<void>) | null = null;
let revision = 0;
let persistedRevision = 0;
let writeChain: Promise<void> = Promise.resolve();
const flush = (allowAutoRetry = true) => {
  if (!persist) return;
  const snapshot = structuredClone(Object.values(ops));
  const writeRevision = ++revision;
  writeChain = writeChain.then(async () => {
    try { await persist?.(snapshot); persistedRevision = writeRevision; } catch {
      // Retry the latest state once without spinning forever. If that retry
      // also fails, dirty remains observable (persistedRevision < revision)
      // and the next controller event/lifecycle drain submits it again.
      if (allowAutoRetry && writeRevision === revision) flush(false);
    }
  });
};
export const drainForwardWrites = async () => {
  let observed: Promise<void>;
  do { observed = writeChain; await observed; } while (observed !== writeChain);
  if (persistedRevision < revision) {
    flush();
    do { observed = writeChain; await observed; } while (observed !== writeChain);
  }
};
export const forwardSourceHash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
};
export const forwardOperationKey = (conversationKey: string, target: string, text: string) =>
  `${conversationKey}::${encodeURIComponent(target)}::${forwardSourceHash(text)}`;
export const initForwardController = (saved: ForwardOperation[] | null, fn: (all: ForwardOperation[]) => void | Promise<void>) => {
  ops = {}; for (const op of saved ?? []) if (op?.key && (op.state === 'pending' || op.state === 'ambiguous')) ops[op.key] = op;
  persist = fn; revision = 0; persistedRevision = 0; writeChain = Promise.resolve();
};
export const beginForward = (conversationKey: string, target: string, text: string, createId: () => string) => {
  const key = forwardOperationKey(conversationKey, target, text);
  if (ops[key]) return { operation: ops[key], started: false };
  const operation: ForwardOperation = { key, conversationKey, target, sourceHash: forwardSourceHash(text), requestId: createId(), state: 'pending' };
  ops[key] = operation; flush(); return { operation, started: true };
};
export const markForwardAmbiguous = (key: string) => { if (ops[key]) { ops[key] = { ...ops[key], state: 'ambiguous' }; flush(); } };
export const confirmForward = (key: string) => { delete ops[key]; flush(); };
export const resetForwardWithoutResend = (key: string) => { delete ops[key]; flush(); };
export const findForward = (conversationKey: string, target: string, text: string) => ops[forwardOperationKey(conversationKey, target, text)] ?? null;
export const mayProjectForward = (operationConversation: string, visibleConversation: string, mounted: boolean) =>
  mounted && operationConversation === visibleConversation;

/** Production wiring: deliberately returns the storage Promise so the
 * controller write chain observes ordering and rejection. */
export const createForwardPersistence = (
  save: (all: ForwardOperation[], profileId?: string) => Promise<void>,
  profileId?: string,
) => (all: ForwardOperation[]) => save(all, profileId);
