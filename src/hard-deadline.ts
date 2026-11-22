// 硬上限：把「永不 settle 的 promise」变成明确的失败，走调用方已有的退避/重试路径。
//
// 为什么还要这一层：api.ts 的 get() 已经有 12s 读超时，但那是**读路径**的保证。
// 只要有一天某个取数路径绕过 get()（新端点、不同 transport、被替换的 fetch 封装），
// 一个挂住的 promise 就会让 usePoll 的 single-flight 闩长期不复位 —— 界面上只表现为
// 「不刷新」，看不出「轮询死了」。
export const LOAD_HARD_DEADLINE_MS = 15_000; // 略高于读路径 12s：正常慢读先让 get() 自己报错

export function withHardDeadline<T>(promise: Promise<T>, label: string, ms: number = LOAD_HARD_DEADLINE_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => { if (timer) clearTimeout(timer); }) as Promise<T>;
}
