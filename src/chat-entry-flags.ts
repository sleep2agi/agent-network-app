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
