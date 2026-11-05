// Chat UI entry-point switches (Vincent, 0.2.105: 「这个闪电的标志就跟这个旁路 btw…
// 我好像很久从来一次都没用过…那我们就先删了吧」).
//
// Only the *buttons* are hidden. The features underneath stay intact:
//   - BTW side threads: `/btw <question>` typed in the composer still opens the
//     SideThreadDrawer (btw-command.ts → setBtwLaunch), so the drawer is not dead.
//   - ⚡ priority send: sendTask(…, priority) / outbox priority / retry keep working;
//     with the toggle hidden every composer send simply goes out as 'normal'.
//
// To bring an entry back, flip its constant to true — nothing else needs to change.
//
// Pure (no react-native import) so the ck tests can import it.

/** BTW entries: the chat-header 「BTW」 button, and the 「旁路提问」 cell in the
 *  mobile ＋ panel / desktop ＋ popover. */
export const SHOW_BTW_ENTRY = false;

/** ⚡ one-shot 「优先发送」 toggle (marks the next message priority=high): the round
 *  ⚡ button in the mobile composer row and the 「⚡ 优先」 chip in the desktop toolbar. */
export const SHOW_BOLT_ENTRY = false;

/** 聊天右侧工具条(admin 2026-10-30:「这里都先隐藏一下」)。
 *
 *  为什么关掉:0.364/0.365 那版把图标条放在**列流**里,输入框下面多出一条空白带
 *  (实测还压住了聊天内容,两个 drive 因此点不到元素)。定位已由 #1176 改成绝对定位,
 *  但"常驻 44px 会不会压气泡"还没在真实窗口确认过 —— 先把入口藏起来,布局回到原样。
 *  确认后把下面这行改成 true 即可,不用改别的。 */
export const SHOW_CHAT_TOOL_RAIL = false;
