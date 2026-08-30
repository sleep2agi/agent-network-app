// Unread snapshot persistence (#161).
//
// Root cause: a disk/Tauri write that failed was caught and resolved as
// success. Memory had already ingested the snapshot, later polls saw no
// change, so nothing saved again. One transient invoke failure dropped
// unread across restart.
//
// Rules:
// 1. Write errors propagate. Do not masquerade as success.
// 2. Keep the latest failed snapshot as pending; later polls retry it even
//    when there is no new ingest.
// 3. Fire-and-forget callers must catch (retryUnreadPersistFromPoll).
// 4. Serial revision: an older failed write must not overwrite or re-dirty a
//    newer snapshot that already persisted.

export type UnreadPersistSnapshot = {
  revision: number
  payload: unknown
}

/** Pure settle for rule 4. Tested without overlapping timers. */
export function settleUnreadWrite(args: {
  lastSucceededRevision: number
  pending: UnreadPersistSnapshot | null
  finished: UnreadPersistSnapshot
  succeeded: boolean
}): { lastSucceededRevision: number; pending: UnreadPersistSnapshot | null } {
  const { finished, succeeded } = args
  let { lastSucceededRevision, pending } = args
  if (succeeded) {
    if (finished.revision >= lastSucceededRevision) {
      lastSucceededRevision = finished.revision
      if (!pending || pending.revision <= finished.revision) pending = null
    }
    return { lastSucceededRevision, pending }
  }
  // Failure of an older snapshot after a newer one already succeeded:
  // do not re-dirty, do not replace pending with the stale snapshot.
  if (finished.revision < lastSucceededRevision) {
    if (pending && pending.revision === finished.revision) pending = null
    return { lastSucceededRevision, pending }
  }
  if (!pending || pending.revision <= finished.revision) pending = finished
  return { lastSucceededRevision, pending }
}

export type UnreadPersistWriter = {
  persist(snapshot: UnreadPersistSnapshot): Promise<void>
  retryPending(): Promise<void>
  peekPending(): UnreadPersistSnapshot | null
  lastSucceededRevision(): number
}

export function createUnreadPersistWriter(opts: {
  write: (snapshot: UnreadPersistSnapshot) => Promise<void>
}): UnreadPersistWriter {
  let lastSucceededRevision = 0
  let pending: UnreadPersistSnapshot | null = null
  let gate: Promise<void> = Promise.resolve()

  const runWrite = async (snapshot: UnreadPersistSnapshot): Promise<void> => {
    if (snapshot.revision < lastSucceededRevision) {
      const settled = settleUnreadWrite({
        lastSucceededRevision,
        pending,
        finished: snapshot,
        succeeded: false,
      })
      lastSucceededRevision = settled.lastSucceededRevision
      pending = settled.pending
      return
    }
    try {
      await opts.write(snapshot)
      const settled = settleUnreadWrite({
        lastSucceededRevision,
        pending,
        finished: snapshot,
        succeeded: true,
      })
      lastSucceededRevision = settled.lastSucceededRevision
      pending = settled.pending
    } catch (error) {
      const settled = settleUnreadWrite({
        lastSucceededRevision,
        pending,
        finished: snapshot,
        succeeded: false,
      })
      lastSucceededRevision = settled.lastSucceededRevision
      pending = settled.pending
      throw error
    }
  }

  const persist = (snapshot: UnreadPersistSnapshot): Promise<void> => {
    pending = !pending || snapshot.revision >= pending.revision ? snapshot : pending
    const job = gate.then(() => runWrite(snapshot), () => runWrite(snapshot))
    gate = job.then(() => undefined, () => undefined)
    return job
  }

  return {
    persist,
    retryPending(): Promise<void> {
      if (!pending) return Promise.resolve()
      return persist(pending)
    },
    peekPending: () => pending,
    lastSucceededRevision: () => lastSucceededRevision,
  }
}

let runtimeWriter: UnreadPersistWriter | null = null
let runtimeWrite: ((snapshot: UnreadPersistSnapshot) => Promise<void>) | null = null

export function configureUnreadPersistWrite(
  write: (snapshot: UnreadPersistSnapshot) => Promise<void>,
): UnreadPersistWriter {
  runtimeWrite = write
  runtimeWriter = createUnreadPersistWriter({ write })
  return runtimeWriter
}

const getWriter = (): UnreadPersistWriter => {
  if (!runtimeWriter) {
    if (!runtimeWrite) {
      throw new Error('unread persist writer is not configured')
    }
    runtimeWriter = createUnreadPersistWriter({ write: runtimeWrite })
  }
  return runtimeWriter
}

/** Poll hook: retry pending even when ingest produced no new snapshot. */
async function ensureRuntimeWriter(): Promise<UnreadPersistWriter | null> {
  if (runtimeWriter) return runtimeWriter
  const { saveUnreadPersistSnapshot } = await import('./storage')
  return configureUnreadPersistWrite((snapshot) => saveUnreadPersistSnapshot(snapshot))
}

export function retryUnreadPersistFromPoll(): Promise<void> {
  return ensureRuntimeWriter()
    .then((writer) => writer ? writer.retryPending() : undefined)
    .catch((error) => {
      console.warn('[unread-persist] retry failed', error)
    })
}

export function persistUnreadSnapshot(snapshot: UnreadPersistSnapshot): Promise<void> {
  return getWriter().persist(snapshot)
}
