// 「去会话」落到那一条消息上(board #463,Vincent 截图:定时任务 → 执行记录 → 去会话 › 只打开了会话、停在最新)。
//
// 会话只先拉最新一页(ChatScreen PAGE = 20)。定时任务每小时跑一次,中间这个 agent 还收别的任务 —— 一小时前那次执行
// 早就不在第一页里了,旧代码「不在已加载的那页里就不定位」,于是什么都不做。
//
// 规则:要找的那条在已加载的消息里 ⇒ 滚过去、高亮;不在、且还有更早的 ⇒ 一次多拉 FOCUS_PAGE_STEP 条再看;
// 拉到 FOCUS_MAX_LIMIT 条还没有,或者已经到聊天记录起点 ⇒ 不再拉,给一句提示(停在最新,不乱跳)。
// 所有带「这条消息」的入口共用:定时任务执行记录的「去会话」、事件流(日志)里的一行、回复引用条。
// 守卫:src/message-focus.test.ts(判据)+ tests/test-goto-message/drive.mjs(真渲染:目标气泡在视口里、高亮)。

/** 找不到时每次多拉几条:比聊天里往上翻的一页(20)大,少几个来回。 */
export const FOCUS_PAGE_STEP = 100;
/**
 * 最多拉到这么多条还找不到就放弃。= hub GET /api/tasks 一次最多返回的条数(server.ts `Math.min(limit, 200)`):
 * 再大 hub 也只给 200 条,app 会把「不满 limit」当成到了聊天记录起点。更早的要走 hub 的 before / before_task_id
 * 游标(会话的分页还没接,见 PR 说明)。
 */
export const FOCUS_MAX_LIMIT = 200;

export type FocusStep =
  | { kind: 'locate'; index: number }
  | { kind: 'load'; limit: number }
  | { kind: 'wait' }
  | { kind: 'missing' };

/**
 * 下一步做什么。index = 目标在当前已加载消息里的下标(-1 = 没有);limit = 当前已请求的条数。
 * ready = 会话第一次拉取已经回来了(没回来时 messages 可能是空的 / 是缓存,不能据此判「找不到」)。
 */
export function nextFocusStep({ index, ready, hasOlder, loading, limit }: {
  index: number; ready: boolean; hasOlder: boolean; loading: boolean; limit: number;
}): FocusStep {
  if (index >= 0) return { kind: 'locate', index };
  if (!ready || loading) return { kind: 'wait' };
  if (hasOlder && limit < FOCUS_MAX_LIMIT) return { kind: 'load', limit: Math.min(limit + FOCUS_PAGE_STEP, FOCUS_MAX_LIMIT) };
  return { kind: 'missing' };
}
