// 给一个 Promise 加硬截止时间:到点还没结果就改用 onTimeout() 的值,原 Promise 继续在后台跑、结果丢弃。
//
// 为什么需要(规则文件读取一直转圈,2026-09-25):api.ts 的 withTimeout 在**响应头**到达时就清掉了
// 计时器,之后的 `await res.text()` 没有任何上限 —— 响应体卡住(隧道/代理半开连接)时整条
// 「读取 → 轮询」链永远 await,界面停在「正在向节点读取…」,而 hub 上那条请求早就 done 了。
// AbortController 能不能打断 body 读取取决于底层 fetch(Tauri plugin-http 走 IPC 分块读),
// 所以这里不依赖 abort,直接 race 一个计时器。

export function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}
