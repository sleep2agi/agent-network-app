import { dismissAllTargets, trayPanelModelFrom } from './tray-panel-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

{
  const m = trayPanelModelFrom([{ alias: 'node-a', count: 3 }, { alias: 'node-b', count: 1 }]);
  ck('行数与入参一致', m.rows.length === 2);
  ck('total = 各行之和', m.total === 4);
  ck('非空时 empty=false', m.empty === false);
  ck('badge 复用 formatUnreadBadge', m.rows[0].badge?.text === '3' && m.rows[0].badge?.a11yLabel === '3 条未读消息');
}

{
  // 🔴 不重新排序:顺序必须原样来自 trayModelFrom,否则托盘/面板/列表会排出不同顺序。
  const m = trayPanelModelFrom([{ alias: 'low', count: 1 }, { alias: 'high', count: 9 }]);
  ck('保持入参顺序,不自己排', m.rows[0].alias === 'low' && m.rows[1].alias === 'high');
}

{
  const m = trayPanelModelFrom([{ alias: 'over', count: 1200 }]);
  ck('超过 99 显示 99+', m.rows[0].badge?.text === '99+');
  ck('a11y 仍报真实数', m.rows[0].badge?.a11yLabel === '1200 条未读消息');
}

{
  const m = trayPanelModelFrom([
    { alias: 'ok', count: 2 },
    { alias: '   ', count: 5 },
    { alias: 'zero', count: 0 },
    { alias: 'neg', count: -3 },
    { alias: 'nan', count: Number.NaN },
  ]);
  ck('空白别名被丢掉', !m.rows.some(r => r.alias.trim() === ''));
  ck('count<=0 / NaN 被丢掉', m.rows.length === 1 && m.rows[0].alias === 'ok');
  ck('total 不被坏行污染', m.total === 2);
}

{
  ck('空列表 → empty=true', trayPanelModelFrom([]).empty === true);
  ck('null 入参不炸', trayPanelModelFrom(null).rows.length === 0);
  ck('全是坏行 → empty=true', trayPanelModelFrom([{ alias: '', count: 5 }]).empty === true);
}

{
  const m = trayPanelModelFrom([{ alias: 'a', count: 2 }, { alias: 'b', count: 1 }, { alias: 'a', count: 7 }]);
  const targets = dismissAllTargets(m);
  ck('忽略全部 = 面板显示的别名', targets.length === 2 && targets[0] === 'a' && targets[1] === 'b');
  ck('重复别名只出现一次', new Set(targets).size === targets.length);
}

{
  ck('空面板 → 忽略全部无目标', dismissAllTargets(trayPanelModelFrom([])).length === 0);
  ck('null 面板不炸', dismissAllTargets(null).length === 0);
}

{
  // 承重:面板只清它列出来的那些。截断在 trayModelFrom 侧发生,这里拿到什么就清什么,
  // 不得去读全量 —— 否则「忽略全部」会清掉用户没看见的会话。
  const shown = [{ alias: 'seen-1', count: 1 }, { alias: 'seen-2', count: 1 }];
  ck('目标集合恰等于显示集合', dismissAllTargets(trayPanelModelFrom(shown)).join(',') === 'seen-1,seen-2');
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
