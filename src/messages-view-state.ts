// Messages 页视图状态选择(纯函数·可单测)。App战线① PR2(通信龙 08-13/18)。
//
// 🔴 三态必须分开,不能合成一种(通信龙 补充要求 2):
//   'loading' — 正在首载,还没有结果(什么都不声称)
//   'empty'   — 加载**成功**且真的没有消息(可以说「暂无消息」)
//   'failed'  — 本页自己的加载失败且手上没有数据(必须说「连不上」,给重试)
//   'list'    — 有数据就展示;若最近一次刷新失败,陈旧性由全局连接横幅(PR1)声明,
//               本页不再造第二份失败 UI(一处真相源)。
//
// lastLoadFailed 用的是**本页自己那次 fetch 的结局**(load() 的 catch 已经拿在手里),
// 不是全局 connectivity.offline——全局旗标聚合的是所有轮询读:别的端点抖一下就把
// 「真的没有消息」错标成「连不上」,或反过来。本页数据的失败标签只能来自本页的请求;
// 全局模块复用在「失败文案的上次成功时刻」上(见 MessagesScreen),不复用在判定上。
export type MessagesViewState = 'loading' | 'list' | 'empty' | 'failed';

export function messagesViewState(
  loaded: boolean,
  count: number,
  lastLoadFailed: boolean,
): MessagesViewState {
  if (!loaded) return 'loading';
  if (count > 0) return 'list';
  return lastLoadFailed ? 'failed' : 'empty';
}
