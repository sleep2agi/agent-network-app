// Does a screen's header carry the phone 「‹ 返回」 affordance?
//
// 0.2.124, 服务器 → 事件与日志 at 1200×800: the right pane showed 「‹ Server」 above 事件流 — a phone
// stack's back button inside the desktop workspace, where the rail and the server sidebar already
// select the page. The same phone header was in every screen the workspace reuses from the phone
// stack (节点详情 / 节点信息, 任务详情, 选服务器, 新建节点). The desktop workspace passes `desktop`
// to each of them and they ask this function; pane-header.test.ts scans App.tsx and the screens so
// a new one cannot come back with the phone header.
//
// Why only the Tauri desktop and not the Android two-pane: there the rail is the only navigation —
// pressing the destination you are already in is a no-op (nav-chrome.ts screenForNavPress), so a
// leaf such as the event stream has no other way back to 服务器.

/** The testID every phone back affordance in a screen header carries (pane-header.test.ts). */
export const PANE_BACK_TEST_ID = 'pane-back';

export const paneShowsBack = (desktop: boolean | undefined): boolean => !desktop;

/**
 * Screens the desktop workspace renders in its right pane that have a phone back header, keyed by
 * the component name used in App.tsx. The scan checks both sides: App.tsx passes `desktop` to each,
 * and each file gates its back affordance on `paneShowsBack`.
 */
export const PANE_SCREENS_WITH_BACK: Readonly<Record<string, string>> = {
  LogsScreen: 'src/LogsScreen.tsx',
  NodeDetailScreen: 'src/NodeDetailScreen.tsx',
  TaskDetailScreen: 'src/TaskDetailScreen.tsx',
  HostSupervisorPickerScreen: 'src/HostSupervisorPickerScreen.tsx',
  CreateNodeWizardScreen: 'src/CreateNodeWizardScreen.tsx',
};
