// 0.2.76 系统栏托盘的菜单模型(纯函数,Rust 侧只负责画):
// 「N  <alias>」按未读数降序;总数是所有 agent 之和。
// 数的来源只有 unread-store 的每 agent 计数 —— 托盘和列表角标永远一致。
//
// 🔴 0.2.92:**不再截断 items**。以前截到 20 行而 total 不截,于是 >20 个会话有未读时,
//    角标数里包含了面板上根本列不出来、点不开的会话(「标了数、下面没东西」的一种形态)。
//    现在不变式是 `total === sum(items.count)`:凡是算进角标的,面板上都有一行能点开。
//    行数上限只留给 Rust 的**原生菜单**(Linux 只能用它;菜单塞不下时末尾给「还有 N 个」)。

/** 原生菜单(Linux)最多列多少行 —— 只约束菜单的画法,不约束模型。 */
export const TRAY_MAX_ITEMS = 20;

export type TrayItem = { alias: string; count: number };
export type TrayModel = { total: number; items: TrayItem[] };

export function trayModelFrom(counts: Readonly<Record<string, number>>): TrayModel {
  const items: TrayItem[] = [];
  let total = 0;
  for (const [alias, raw] of Object.entries(counts)) {
    const count = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    if (!alias.trim() || count === 0) continue;
    total += count;
    items.push({ alias, count });
  }
  items.sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias, 'zh-Hans-CN'));
  return { total, items };
}

/** 两次模型相同就不重画菜单(托盘重建在 macOS 上会闪一下)。 */
export function trayModelEqual(a: TrayModel | null, b: TrayModel): boolean {
  if (!a || a.total !== b.total || a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    if (a.items[i].alias !== b.items[i].alias || a.items[i].count !== b.items[i].count) return false;
  }
  return true;
}

/** 不变式:角标总数 == 可列出的行之和。任何时候为 false 都是「数和列表对不上」的缺陷。 */
export function trayModelConsistent(model: TrayModel): boolean {
  let sum = 0;
  for (const item of model.items) sum += item.count;
  return sum === model.total;
}

export type TrayInvoke = (model: TrayModel) => Promise<unknown>;

/**
 * 把模型推给 Rust(`tray_update`),相同模型不重推(托盘重建在 macOS 上会闪一下)。
 *
 * 🔴 0.2.92:「上次推过什么」只在推**成功**后才记。以前先记后推 —— 启动早期托盘还没建好、
 *    `tray_update` 报「tray not initialized」时,`last` 已经记成了这个模型,之后同样的模型
 *    再也不会推,角标就停在旧值上。`resync()` 用于窗口重新获得焦点时强制重推一次。
 */
export function createTrayPusher(invoke: TrayInvoke) {
  let last: TrayModel | null = null;
  let inflight: Promise<void> = Promise.resolve();
  const push = (model: TrayModel, force = false): Promise<void> => {
    // 上一次失败不能把链条毒死:先吞掉它的拒绝再排下一次,否则一次失败之后永远不再推。
    inflight = inflight.catch(() => {}).then(async () => {
      if (!force && trayModelEqual(last, model)) return;
      await invoke(model);
      last = model;
    });
    return inflight;
  };
  return {
    push: (model: TrayModel) => push(model),
    resync: (model: TrayModel) => push(model, true),
    /** 测试/诊断用:当前认为 Rust 侧显示的是哪一份。 */
    lastPushed: () => last,
  };
}
