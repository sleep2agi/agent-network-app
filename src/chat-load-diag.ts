// 只加日志、不改行为：为「聊天面板不刷新」取证。
//
// 目的：一次复现就能分清三类成因（对应分析里的 ①②③）：
//   ① 取数回来了但 paint 被 isCurrent 丢掉（token / sequence 被换）
//   ② 取数回来了、paint 也执行了，但合并后渲染数组里没有这些行
//   ③ 轮询根本没跑（前台判定错 / 闩卡住）
//
// 做法：每次 load 打一行（起点 seq/token、结束是否 paint、丢弃原因、耗时），
// 累计计数打在同一行里，日志量 = 每轮轮询一行（5s），不刷屏。
export type ChatLoadDiag = {
  loadStarted(seq: number, tokenCurrent: boolean, limit: number): void;
  paintApplied(seq: number, rows: number, mergedRows: number): void;
  loadSettled(seq: number, ms: number, drop: 'none' | 'token' | 'sequence' | 'unmounted'): void;
};

export function createChatLoadDiag(tag = 'chat-load'): ChatLoadDiag {
  const c = { started: 0, applied: 0, droppedToken: 0, droppedSeq: 0, droppedUnmounted: 0, settled: 0 };
  const stamp = () => `started=${c.started} applied=${c.applied} dropped(token=${c.droppedToken},seq=${c.droppedSeq},unmounted=${c.droppedUnmounted}) settled=${c.settled}`;
  return {
    loadStarted(seq, tokenCurrent, limit) {
      c.started += 1;
      console.log(`[${tag}] start seq=${seq} token=${tokenCurrent ? 'current' : 'stale'} limit=${limit} | ${stamp()}`);
    },
    // 丢因在 settle 时判定（不在 paint 里判）：paint 的守卫必须保持
    // `if (!isCurrent()) return;` 这一行原样 —— conversation-store.test.ts 按它做源码断言。

    paintApplied(seq, rows, mergedRows) {
      c.applied += 1;
      // merged=-1 表示 updater 还没跑（并发渲染下可能晚于本次日志），不是「合并后为空」
      const merged = mergedRows < 0 ? 'pending' : String(mergedRows);
      console.log(`[${tag}] paint applied seq=${seq} rows=${rows} merged=${merged} | ${stamp()}`);
    },
    loadSettled(seq, ms, drop) {
      c.settled += 1;
      if (drop === 'token') c.droppedToken += 1;
      else if (drop === 'sequence') c.droppedSeq += 1;
      else if (drop === 'unmounted') c.droppedUnmounted += 1;
      const line = `[${tag}] settle seq=${seq} ms=${ms} drop=${drop} | ${stamp()}`;
      if (drop === 'none') console.log(line); else console.warn(line);
    },
  };
}
