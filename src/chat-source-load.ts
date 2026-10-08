import { mergeMessagesNewestFirst } from './chat-actions';

export type ChatSource = 'tasks' | 'proactive';
type Row = { _localId?: string; _proactive?: boolean; created_at?: string };

/** Replace only the successful source; the other source and local echoes survive. */
export function mergeChatSource<T extends Row>(previous: T[], fresh: T[], source: ChatSource): T[] {
  const retained = previous.filter(row => !row._localId && (source === 'tasks' ? row._proactive : !row._proactive));
  return mergeMessagesNewestFirst(previous.filter(row => row._localId), [...fresh, ...retained]);
}

/** #781: each source paints when it arrives, not when the slower peer finishes.
 * Keep the poll in flight until both settle; failed reads never publish empty rows.
 */
export async function loadChatSources<T, P>(options: {
  tasks: () => Promise<T>; proactive: () => Promise<P>;
  isCurrent: () => boolean; onTasks: (value: T) => void; onProactive: (value: P) => void;
}): Promise<boolean[]> {
  const run = async <V>(read: () => Promise<V>, publish: (value: V) => void): Promise<boolean> => {
    try {
      const value = await read();
      if (options.isCurrent()) publish(value);
      return true;
    } catch { return false; }
  };
  return Promise.all([run(options.tasks, options.onTasks), run(options.proactive, options.onProactive)]);
}
