import {
  formatUnreadBadge, initialUnreadState, reduceUnread, totalUnread, unreadOf,
  type UnreadEvent, type UnreadState,
} from './unread-ledger';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
};

const run = (evs: UnreadEvent[], from: UnreadState = initialUnreadState()) =>
  evs.reduce(reduceUnread, from);

// --- #161 已读规则里最容易悄悄写错的那条 -------------------------------------
{
  // 「仅选中列表行但消息尚未加载成功时不能误清零」
  const s = run([
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'conversation_opened', agent: 'a' },     // 只是选中,没渲染出来
  ]);
  check('🔴 打开会话但未渲染到最新 —— 未读**不清零**', unreadOf(s, 'a') === 2);

  const s2 = reduceUnread(s, { kind: 'rendered_to_latest', agent: 'a' });
  check('渲染到最新之后才清零', unreadOf(s2, 'a') === 0);
}

// --- 正在看的会话:新消息直接追加,不计未读 -----------------------------------
{
  const s = run([
    { kind: 'conversation_opened', agent: 'a' },
    { kind: 'rendered_to_latest', agent: 'a' },
    { kind: 'message_arrived', agent: 'a' },
  ]);
  check('前台 + 已渲染到最新时收到新消息 —— 视为已读', unreadOf(s, 'a') === 0);
}
{
  const s = run([
    { kind: 'conversation_opened', agent: 'a' },
    { kind: 'rendered_to_latest', agent: 'a' },
    { kind: 'foreground_changed', foreground: false },
    { kind: 'message_arrived', agent: 'a' },
  ]);
  check('🔴 窗口不在前台时,即使会话开着也要计未读', unreadOf(s, 'a') === 1);
}

// --- 切走之后重新累计 --------------------------------------------------------
{
  const s = run([
    { kind: 'conversation_opened', agent: 'a' },
    { kind: 'rendered_to_latest', agent: 'a' },
    { kind: 'conversation_left' },
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'message_arrived', agent: 'a' },
  ]);
  check('切换到其他 Agent 后,原会话新消息重新累计', unreadOf(s, 'a') === 2);
}

// --- 别清错人 ----------------------------------------------------------------
{
  const s = run([
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'message_arrived', agent: 'b' },
    { kind: 'conversation_opened', agent: 'b' },
    { kind: 'rendered_to_latest', agent: 'b' },
  ]);
  check('清零只作用于被打开的那个 Agent', unreadOf(s, 'a') === 1 && unreadOf(s, 'b') === 0);

  // 迟到的渲染回调(用户已经切走)不应该清掉当前打开会话的未读
  const late = run([
    { kind: 'conversation_opened', agent: 'a' },
    { kind: 'message_arrived', agent: 'b' },
    { kind: 'rendered_to_latest', agent: 'b' },    // b 并不是当前打开的
  ]);
  check('🔴 迟到/错配的 rendered_to_latest 不清零', unreadOf(late, 'b') === 1);
}

// --- 多 Agent 累计 -----------------------------------------------------------
{
  const s = run([
    { kind: 'message_arrived', agent: 'a' },
    { kind: 'message_arrived', agent: 'b' },
    { kind: 'message_arrived', agent: 'b' },
  ]);
  check('totalUnread 是各 Agent 之和', totalUnread(s) === 3);
  check('没见过的 Agent 未读为 0,不是 undefined', unreadOf(s, 'zzz') === 0);
}

// --- reducer 不可变 ----------------------------------------------------------
{
  const s0 = initialUnreadState();
  const s1 = reduceUnread(s0, { kind: 'message_arrived', agent: 'a' });
  check('reducer 不改旧状态', unreadOf(s0, 'a') === 0 && unreadOf(s1, 'a') === 1);
}

// --- 徽标文案:用边界值校准,不用生产值 ---------------------------------------
{
  check('0 返回 null(完全隐藏,不留空红点)', formatUnreadBadge(0) === null);
  check('负数/NaN 也返回 null', formatUnreadBadge(-1) === null && formatUnreadBadge(NaN) === null);
  check('1 显示 "1"', formatUnreadBadge(1)?.text === '1');
  check('99 仍显示准确数字', formatUnreadBadge(99)?.text === '99');
  check('100 显示 "99+"', formatUnreadBadge(100)?.text === '99+');
  check('🔴 可访问性文本存在且带数字(色彩不能是唯一提示)',
    formatUnreadBadge(3)?.a11yLabel === '3 条未读消息');
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
