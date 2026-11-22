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
  paintDropped(seq: number, reason: 'token' | 'sequence' | 'unmounted'): void;
  paintApplied(seq: number, rows: number, mergedRows: number): void;
  loadSettled(seq: number, ms: number): void;
};

export function createChatLoadDiag(tag = 'chat-load'): ChatLoadDiag {
  const c = { started: 0, applied: 0, droppedToken: 0, droppedSeq: 0, droppedUnmounted: 0, settled: 0 };
  const stamp = () => `started=${c.started} applied=${c.applied} dropped(token=${c.droppedToken},seq=${c.droppedSeq},unmounted=${c.droppedUnmounted}) settled=${c.settled}`;
  return {
    loadStarted(seq, tokenCurrent, limit) {
      c.started += 1;
      console.log(`[${tag}] start seq=${seq} token=${tokenCurrent ? 'current' : 'stale'} limit=${limit} | ${stamp()}`);
    },
    paintDropped(seq, reason) {
      if (reason === 'token') c.droppedToken += 1;
      else if (reason === 'sequence') c.droppedSeq += 1;
      else c.droppedUnmounted += 1;
      console.warn(`[${tag}] paint dropped seq=${seq} reason=${reason} | ${stamp()}`);
    },
    paintApplied(seq, rows, mergedRows) {
      c.applied += 1;
      console.log(`[${tag}] paint applied seq=${seq} rows=${rows} merged=${mergedRows} | ${stamp()}`);
    },
    loadSettled(seq, ms) {
      c.settled += 1;
      console.log(`[${tag}] settle seq=${seq} ms=${ms} | ${stamp()}`);
    },
  };
}
