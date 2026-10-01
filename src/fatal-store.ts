// 「上次异常退出」记录的读写。后端注入,逻辑在 bun 里能测;真实后端在 fatal-runtime.ts
// (原生 = documents/last-fatal.json 同步读写,web/桌面 = localStorage)。
// 🔴 写必须是同步的:全局处理器返回后 release 包立刻 abort,来不及等任何 Promise。
import { parseFatalReport, serializeFatal, type FatalReport } from './fatal-report';

export interface FatalBackend {
  read(): string | null;
  write(text: string): void;
  remove(): void;
}

export interface FatalStore {
  /** 盘上的那份(解析失败 = null)。 */
  read(): FatalReport | null;
  /** 覆盖写(最近一次为准)。吞掉所有错误,返回是否写成。 */
  save(report: FatalReport): boolean;
  /** 小提示出现过:留着给设置页复制,下次启动不再弹。 */
  markShown(): void;
  /** 发送 / 关闭 / 复制后删除。 */
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createFatalStore(backend: FatalBackend): FatalStore {
  const listeners = new Set<() => void>();
  const emit = () => { listeners.forEach(l => { try { l(); } catch { /* 监听者出错不影响别人 */ } }); };
  const read = (): FatalReport | null => {
    try { return parseFatalReport(backend.read()); } catch { return null; }
  };
  return {
    read,
    save(report) {
      try { backend.write(serializeFatal(report)); emit(); return true; } catch { return false; }
    },
    markShown() {
      const r = read();
      if (!r || r.shown) return;
      try { backend.write(serializeFatal({ ...r, shown: true })); emit(); } catch { /* 下次还弹一次,无害 */ }
    },
    clear() {
      try { backend.remove(); } catch { /* 已经不在 */ }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
