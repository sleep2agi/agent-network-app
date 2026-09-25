// 节点列表的纯逻辑层(分组 / 过滤 / 排序)—— 无 RN 依赖,bun/node 可直跑。
// 从 App.tsx 的 AgentsScreen 抽出,配 agents-list.test.ts。
//
// 抽出的动机:这段逻辑决定 199 个节点在手机上以什么顺序、分到哪个组、
// 搜什么词能命中 —— 全是可以用纯数据钉住的行为,却混在一个 RN 组件的
// useMemo 里没法测。抽出来之后,排序改动才有可执行的断言。

import type { Session } from './api';

/** 组名 = 别名的团队前缀。逐字保留自 App.tsx 的原实现(#1094 分组)。 */
export function teamOf(alias: string): string {
  const a = (alias || '').trim();
  if (!a) return '其他';
  // explicit separator wins (e.g. "team/role" → "team")
  const seg = a.split(/[\s/_\-:|·]+/)[0];
  if (seg && seg !== a) return seg;
  // coarse team = leading 2 chars: the fleet's <team><role> aliases share a
  // 2-char team prefix (通信龙 / 通信N站马 / 通信测试牛 → 通信; 工程马 → 工程;
  // N站牛 → N站). Keeps groups few + findable rather than one-per-agent.
  return a.length <= 2 ? a : a.slice(0, 2);
}

export const isOffline = (s: Session) => s.status === 'offline';
export const isWorking = (s: Session) => s.status === 'working' || s.status === 'running';

export type AgentSection = {
  title: string;
  data: Session[];
  online: number;
  total: number;
};

/** 匹配器:默认按子串匹配;调用方可注入拼音匹配器替换它。 */
export type Matcher = (text: string, filter: string) => boolean;
export const substringMatch: Matcher = (text, filter) =>
  text.toLowerCase().includes(filter.toLowerCase());

/**
 * 组内排序键。
 *
 * 🔴 与 web `/nodes` 的关系:web 的比较器是
 *   `pin > online(SSE + 60s 迟滞) > lastActivityAt`
 * 三级的数据源在 web **全是浏览器本地状态**:
 *   - pin           = localStorage('anet_chat_pin_v1')
 *   - online        = SSE 实时态 + lastOnlineRef 的 60 秒迟滞 (R29)
 *   - lastActivityAt= useChatUnread(),**这台设备**最后看到消息的时间
 * App 一个都没有对应物,所以这里是**语义等价的移植,不是同一份数据**:
 *   - pinned        : 桌面端 localStorage('anet_chat_pin_v1')
 *   - online        : 用 status 判定,可由调用方注入 60s 迟滞(recentlyOnline)
 *   - recency       : 用**服务端** session.updated_at,语义 ≠ web 的本地活动时间
 * 不要在别处把这段写成"和 web 一致"——那会让人拿 web 的行为去推断 App 的。
 */
export type SortContext = {
  /** 桌面端注入持久化的置顶集合；移动端省略。 */
  pinned?: (alias: string) => boolean;
  /** R29 语义的迟滞:60s 内出现过在线即视为在线。默认只看当前 status。 */
  recentlyOnline?: (alias: string) => boolean;
};

const ts = (s: Session): number => {
  const t = Date.parse(s.updated_at ?? '');
  return Number.isFinite(t) ? t : 0;
};

/** 组内比较器:pinned > online > recency > 别名字母序。 */
export function compareInTeam(a: Session, b: Session, ctx: SortContext = {}): number {
  const pin = (s: Session) => (ctx.pinned?.(s.alias) ? 1 : 0);
  const on = (s: Session) =>
    ctx.recentlyOnline ? (ctx.recentlyOnline(s.alias) ? 1 : 0) : (isOffline(s) ? 0 : 1);
  return (
    pin(b) - pin(a) ||
    on(b) - on(a) ||
    ts(b) - ts(a) ||
    a.alias.localeCompare(b.alias)
  );
}

export const NEW_MESSAGES_TITLE = '新消息';
export const PINNED_TITLE = '置顶';

/**
 * 「新消息」组的输入(Vincent 2026-09-25「有消息的那些节点,你要置顶」)。
 *
 * 🔴 count 必须来自 agent-unread-counts.ts 的 agentUnreadCounts —— 托盘角标用的同一个函数。
 *    这里只收一个查询函数,不自己算未读,免得列表和托盘数出两组会话。
 */
export type UnreadContext = {
  /** 该会话的未读数;> 0 即进「新消息」组。 */
  count: (alias: string) => number;
  /** 该会话最近一条消息的时间(ms);读不到(0/缺省)时退回 session.updated_at。 */
  lastMessageAt?: (alias: string) => number;
};

/** 「新消息」组内:最近一条消息新的在前 → 别名字母序(稳定,不随轮询抖动)。 */
export function compareNewMessages(a: Session, b: Session, u: UnreadContext): number {
  const at = (s: Session) => u.lastMessageAt?.(s.alias) || ts(s);
  return at(b) - at(a) || a.alias.localeCompare(b.alias);
}

/**
 * 用户正在列表上移动指针/滚动时,「新消息」组的输入先按住上一份,停手后再换成最新的 ——
 * 否则行会在光标底下跳走(点到的不是想点的那个)。没被按住或还没有上一份时直接用最新的。
 */
export function holdWhileActive<T>(prev: T | null, live: T, active: boolean): T {
  return active && prev !== null ? prev : live;
}

/**
 * 分组 + 过滤 + 排序。组间顺序保持原有规则(有人在线的团队优先 → 在线人数
 * 多者优先 → 组名字母序),只有**组内**顺序改用 compareInTeam。
 */
export function buildSections(
  sessions: Session[],
  query: string,
  opts: { match?: Matcher; sort?: SortContext; unread?: UnreadContext } = {},
): AgentSection[] {
  const q = query.trim();
  const match = opts.match ?? substringMatch;
  const filtered = q ? sessions.filter(s => match(s.alias, q)) : sessions.slice();
  // 「新消息」组:有未读的会话整体上浮到最顶(在「置顶」之上),**搬走**而不是复制;
  // 读完(未读→0)下一次计算时自然回到原来的组。搜索时不浮动,保持搜索结果原有的顺序。
  const floating = !q && opts.unread ? filtered.filter(s => opts.unread!.count(s.alias) > 0) : [];
  if (floating.length) floating.sort((a, b) => compareNewMessages(a, b, opts.unread!));
  const floatSet = new Set(floating.map(s => s.alias));
  const rest = floatSet.size ? filtered.filter(s => !floatSet.has(s.alias)) : filtered;
  const pinned = opts.sort?.pinned
    ? rest.filter(s => opts.sort!.pinned!(s.alias)).sort((a, b) => compareInTeam(a, b, opts.sort))
    : [];
  const unpinned = pinned.length ? rest.filter(s => !opts.sort!.pinned!(s.alias)) : rest;

  const groups = new Map<string, Session[]>();
  for (const s of unpinned) {
    const key = teamOf(s.alias);
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const grouped = [...groups.entries()]
    .map(([title, items]) => {
      items.sort((a, b) => compareInTeam(a, b, opts.sort));
      const online = items.filter(s => !isOffline(s)).length;
      return { title, data: items, online, total: items.length };
    })
    .sort(
      (a, b) =>
        (b.online > 0 ? 1 : 0) - (a.online > 0 ? 1 : 0) ||
        b.online - a.online ||
        a.title.localeCompare(b.title),
    );
  const head: AgentSection[] = [];
  if (floating.length) head.push(sectionOf(NEW_MESSAGES_TITLE, floating));
  if (pinned.length) head.push(sectionOf(PINNED_TITLE, pinned));
  return head.length ? [...head, ...grouped] : grouped;
}

const sectionOf = (title: string, data: Session[]): AgentSection =>
  ({ title, data, online: data.filter(s => !isOffline(s)).length, total: data.length });

export const countShown = (sections: AgentSection[]): number =>
  sections.reduce((n, g) => n + g.data.length, 0);
