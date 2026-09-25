// 0.2.92 托盘角标 vs 面板列表一致性。Vincent 2026-09-25:「这个地方明明标了 1,为什么下面没信息啊」。
// 两个真实成因,各钉一处:
//  1. 模型层:total 不截断而 items 截到 20 行 ⇒ 角标里有面板列不出的会话。不变式 total == sum(items)。
//  2. 推送层:先记 last 后推,推失败后同一模型不再重推 ⇒ Rust 侧停在旧值。只在成功后记;失败不毒死链条。
// (第三个成因在 Rust:macOS set_title(None) 不清旧标题 —— 钉在 tray.rs 的单测和下面的源码契约里。)
import { readFileSync } from 'node:fs';
import { createTrayPusher, trayModelConsistent, trayModelFrom, TRAY_MAX_ITEMS, type TrayModel } from './tray-menu-model';
import { trayPanelModelFrom } from './tray-panel-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

// —— 1. 任意状态下:角标总数 == 面板行之和,且每个被计入的会话都有一行 ——
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let bad = 0;
  for (let round = 0; round < 500; round++) {
    const n = Math.floor(rnd() * 45);
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const r = rnd();
      const alias = r < 0.05 ? '   ' : `node-${i}`;
      counts[alias] = r < 0.1 ? 0 : r < 0.15 ? -3 : r < 0.2 ? 2.7 : Math.floor(rnd() * 200) + 1;
    }
    const model = trayModelFrom(counts);
    const panel = trayPanelModelFrom(model.items);
    const counted = Object.entries(counts).filter(([a, c]) => a.trim() && Number.isFinite(c) && c >= 1).map(([a]) => a);
    const listed = new Set(panel.rows.map(r => r.alias));
    const ok = panel.total === model.total && trayModelConsistent(model) && counted.every(a => listed.has(a)) && panel.empty === (model.total === 0);
    if (!ok) bad++;
  }
  ck('500 个随机状态:角标总数 == 面板行之和,被计入的会话全部可列出', bad === 0);
}
{
  const many = trayModelFrom(Object.fromEntries(Array.from({ length: TRAY_MAX_ITEMS + 5 }, (_, i) => [`node-${i}`, 1])));
  ck(`超过 ${TRAY_MAX_ITEMS} 个会话有未读时,面板仍列出全部`, many.items.length === TRAY_MAX_ITEMS + 5 && trayPanelModelFrom(many.items).total === many.total);
  const zero = trayModelFrom({ a: 0, b: -1 });
  ck('0 未读:总数 0 且面板为空态', zero.total === 0 && trayPanelModelFrom(zero.items).empty);
}

// —— 2. 推送:只在成功后记;失败后同一模型会再推;失败不毒死后续;resync 强制重推 ——
{
  const calls: TrayModel[] = [];
  let failNext = 0;
  const pusher = createTrayPusher(async m => {
    calls.push(m);
    if (failNext > 0) { failNext--; throw new Error('tray not initialized'); }
  });
  const one = trayModelFrom({ a: 1 });
  const zero = trayModelFrom({});
  await pusher.push(one);
  await pusher.push(one);
  ck('成功推过的同一模型不重推', calls.length === 1);

  failNext = 1;
  let threw = false;
  try { await pusher.push(zero); } catch { threw = true; }
  ck('推送失败把错误交还给调用方', threw);
  ck('失败后「上次推送」仍是旧模型,不是这次失败的', pusher.lastPushed() === one);
  await pusher.push(zero);
  ck('失败过的同一模型会被再次推送(角标不会停在旧值)', calls.length === 3 && pusher.lastPushed() === zero);

  failNext = 1;
  const failing = pusher.push(one).catch(() => {});
  const after = pusher.push(trayModelFrom({ a: 2 }));
  await failing; await after;
  ck('一次失败不会让之后的推送全部失效', pusher.lastPushed()?.total === 2);

  const before = calls.length;
  await pusher.resync(pusher.lastPushed()!);
  ck('resync 对相同模型也强制重推', calls.length === before + 1);
}

// —— 3. 源码契约:Rust 侧 0 未读必须传 Some("") 清标题;主窗口聚焦时重推 ——
{
  const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');
  const rs = read('src-tauri/src/tray.rs');
  ck('set_title 走 title_arg(永远 Some)', rs.includes('tray.set_title(title_arg(total))') && rs.includes('Some(title_for(total))'));
  ck('不再把空标题换成 None(tray-icon macOS 收到 None 不清旧标题)', !rs.includes('if title.is_empty() { None }'));
  ck('Rust 存给面板的模型不截断', !/fn normalize_items[\s\S]*?items\.truncate\(MAX_ITEMS\)[\s\S]*?\n}/.test(rs.slice(rs.indexOf('pub fn normalize_items'), rs.indexOf('pub fn menu_rows'))));
  const dt = read('src/desktop-tray.ts');
  ck('主窗口聚焦 / 重新可见时强制重推', dt.includes("addEventListener?.('focus', resync)") && dt.includes("'visibilitychange'"));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
