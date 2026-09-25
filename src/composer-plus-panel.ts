// Chat composer 「＋」 panel — WeChat-style, one level (Vincent, 0.2.102, Android two-pane:
// 「就点击加号，要像微信一样，不要跳两层了，跳一层就行了」).
//
// Before: ＋ opened a full-screen-width bottom Modal (covering the agent list in
// two-pane) with two rows, BTW / 添加附件; 添加附件 then popped a native Alert
// 「发送附件」 with 图片 / 文件 / 取消 — two levels to get to a picker.
//
// Now (mobile, incl. Android two-pane): ＋ toggles an inline panel rendered directly
// under the input row, inside the chat pane. Every cell launches its picker/action
// directly. Desktop keeps its small popover but lists the same actions (one level).
//
// Pure (no react-native import) so the ck test can drive it.

export type PlusItemKey = 'album' | 'file' | 'btw' | 'camera';

export interface PlusItem {
  key: PlusItemKey;
  label: string;
  /** Ionicons glyph name, or null for the text badge (BTW). */
  icon: string | null;
  a11y: string;
}

export interface PlusItemEnv {
  os: string;
  desktop: boolean;
  attachEnabled: boolean;
}

/** Camera needs a native capture intent (expo-image-picker launchCameraAsync);
 *  web/Tauri has no camera flow worth offering. */
export function cameraAvailable(os: string): boolean {
  return os === 'android' || os === 'ios';
}

/** The panel's cells, in owner priority order: 相册, 文件, 旁路提问, 拍照. */
export function plusPanelItems(env: PlusItemEnv): PlusItem[] {
  const items: PlusItem[] = [];
  if (env.attachEnabled) {
    items.push({ key: 'album', label: '相册', icon: 'image-outline', a11y: '从相册选择图片' });
    items.push({ key: 'file', label: '文件', icon: 'document-outline', a11y: '选择文件' });
  }
  items.push({ key: 'btw', label: '旁路提问', icon: null, a11y: '新建 BTW 旁路线程' });
  if (env.attachEnabled && !env.desktop && cameraAvailable(env.os)) {
    items.push({ key: 'camera', label: '拍照', icon: 'camera-outline', a11y: '拍照' });
  }
  return items;
}

// ── state machine ──────────────────────────────────────────────────────────
export type PlusPanelEvent =
  | 'toggle'          // ＋ tapped
  | 'inputFocus'      // main TextInput focused
  | 'keyboardShown'   // soft keyboard appeared (any cause)
  | 'back'            // Android hardware back / gesture
  | 'itemPicked'      // a cell was tapped
  | 'conversationChanged';

export interface PlusPanelTransition {
  open: boolean;
  /** Opening the panel must take the keyboard down (they share the same slot). */
  dismissKeyboard: boolean;
  /** For 'back': true = consumed (do not leave the chat). */
  handled: boolean;
}

export function nextPlusPanel(open: boolean, event: PlusPanelEvent): PlusPanelTransition {
  switch (event) {
    case 'toggle':
      return { open: !open, dismissKeyboard: !open, handled: true };
    case 'back':
      return { open: false, dismissKeyboard: false, handled: open };
    case 'inputFocus':
    case 'keyboardShown':
    case 'itemPicked':
    case 'conversationChanged':
      return { open: false, dismissKeyboard: false, handled: open };
  }
}

/** Fixed panel height ≈ a soft keyboard (WeChat reuses the keyboard's slot).
 *  260dp by default; if we have seen the real keyboard height, reuse it (clamped);
 *  never more than 45% of the window so short landscape screens keep the chat. */
export const PLUS_PANEL_DEFAULT_HEIGHT = 260;
export function plusPanelHeight(windowHeight: number, lastKeyboardHeight?: number): number {
  const wanted = lastKeyboardHeight && lastKeyboardHeight > 0
    ? Math.min(340, Math.max(200, lastKeyboardHeight))
    : PLUS_PANEL_DEFAULT_HEIGHT;
  if (!(windowHeight > 0)) return wanted;
  return Math.max(120, Math.min(wanted, Math.floor(windowHeight * 0.45)));
}
