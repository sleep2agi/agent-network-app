/**
 * #1563 —— 「客户端不显示新收到消息数」的缺陷定位到了客户端这一侧,
 * 而且是三种可能里的第 ① 种:**客户端从来没调过 `/api/messages?scope=user`**。
 *
 * 实测(2026-08-31,对两个仓的 origin/main):
 *   服务端 server.ts:2655-2676  写→推→读→计数→返回 五段齐全,
 *                               返回 `{ ok, messages, unread, pending_count }`,
 *                               注释明写「`unread` 给角标读」。
 *   客户端 全仓 `scope=user`     **0 处**;唯一调用是 api.ts 的
 *                               `/api/messages?limit=N` —— 那是 **alias 分支**,
 *                               读的是 `inbox` 表,而 agent 发给登录用户的
 *                               消息落在 `user_inbox`。
 *   客户端 `pending_count`       **0 处**;`unread` 的 9 处全是本地状态。
 *
 * ⇒ 服务端算好的数一路送到了 API,客户端一次都没去取。
 */

export type UserMessagesBody = {
  ok?: unknown;
  messages?: unknown;
  unread?: unknown;
  pending_count?: unknown;
};

/**
 * 从 `/api/messages?scope=user` 的响应里读服务端权威未读数。
 *
 * 🔴 读不到时返回 `null`(未知),**不返回 0**。
 *    返回 0 等于告诉调用方「没有未读」—— 那是兜底朝好的一侧:
 *    一个字段名改了、或者旧版 hub 不返回这个字段的情况,会被渲染成
 *    「一切已读」,而用户其实有未读。返回 null 让调用方**退回本地计数**,
 *    而不是把角标清掉。
 *
 * 两个名字是同一个数(服务端注释:「一处计算,不是两处实现」),
 * 优先 `unread`(角标专用名),再 `pending_count`(与 alias 分支同名)。
 */
export function readServerUnread(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as UserMessagesBody;
  for (const raw of [b.unread, b.pending_count]) {
    if (typeof raw !== 'number') continue;
    if (!Number.isFinite(raw) || raw < 0) continue;
    return Math.floor(raw);
  }
  return null;
}

/**
 * 角标该显示几:服务端权威数优先,拿不到就退回本地 ledger 的数。
 *
 * 🔴 本地数**不能**替代服务端数:重启、多端、SSE 重连之后本地会漂,
 *    而服务端那个是权威且自愈的。但反过来也不能在服务端数拿不到时清零 ——
 *    所以这里是「优先服务端,退回本地」,不是「二选一」。
 */
export function resolveUnread(serverUnread: number | null, localUnread: number): number {
  if (serverUnread !== null) return serverUnread;
  return Number.isFinite(localUnread) && localUnread > 0 ? Math.floor(localUnread) : 0;
}

/**
 * `/api/messages` 的 user 作用域路径。
 *
 * 🔴 两件事都不能少:
 *   - 缺 `scope=user` → 落回 **alias 分支**(读 `inbox` 表),取不到 agent 发给
 *     登录用户的消息;
 *   - `networkId` 有值时缺 `network_id` → 跨网络返回。服务端在
 *     `server.ts:1557` 用 `resolveRestNetworkScope(searchParams.get("network_id"), …)`
 *     统一处理,本仓 `api-network-scope.test.ts` 也把「每个读操作必须声明网络作用域」
 *     做成了门 —— 第一版我漏了它,被那道门抓住。
 *   - 反过来,`networkId` **没值时不能带** `network_id=` —— 那道门同样会红。
 */
export const userMessagesPath = (limit: number, networkId?: string | null): string => {
  const q = new URLSearchParams({ scope: 'user', limit: String(Math.max(1, Math.floor(limit))) });
  if (typeof networkId === 'string' && networkId.trim()) q.set('network_id', networkId.trim());
  return `/api/messages?${q}`;
};
