// 0.2.82 源码契约:托盘面板必须画头像 + 「忽略全部」,而且面板窗口标签必须登记进
// capabilities —— 0.2.56 就是漏登记 workspace-* 导致新窗口所有 core 调用被拒
// (编译绿、测试绿,只有真开窗才露)。这条用文件内容钉,因为 GUI 在 CI 里开不出来。
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

// 🔴 Windows 检出是 CRLF;不归一化的话下面每条 includes 都会莫名其妙地红。
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

const panel = read('src/TrayPanel.tsx');
ck('面板画头像(复用 AliasAvatar,不另画一个圆)', panel.includes("import AliasAvatar from './AliasAvatar'") && panel.includes('<AliasAvatar'));
ck('面板有「忽略全部」', panel.includes('忽略全部') && panel.includes('testID="tray-dismiss-all"'));
ck('未读数走 formatUnreadBadge(经 model),不自己写 99+', !panel.includes("'99+'") && !panel.includes('"99+"'));
ck('行点击复用 tray_open_chat,不另起一条路', panel.includes("invoke('tray_open_chat'"));
ck('忽略全部只转发,不在面板里碰 hub', panel.includes("invoke('tray_dismiss_all'") && !panel.includes('/api/messages/ack'));
ck('面板不拿 token / 不读 hub 配置', !panel.includes('HubConfig') && !panel.includes('serverUrl'));
ck('Esc 关面板', panel.includes("=== 'Escape'"));
ck('空状态有文案,不是一片空白', panel.includes('没有未读消息') && panel.includes('testID="tray-panel-empty"'));

const caps = read('src-tauri/capabilities/default.json');
const capsJson = JSON.parse(caps) as { windows: string[]; permissions: unknown[] };
ck('面板窗口标签已登记(否则新窗口一个 core 权限都没有)', capsJson.windows.includes('tray-panel'));
const perms = capsJson.permissions.filter((x): x is string => typeof x === 'string');
ck('面板要用的窗口权限齐了', ['core:window:allow-set-position', 'core:window:allow-hide', 'core:window:allow-is-visible'].every(x => perms.includes(x)));

const tray = read('src-tauri/src/tray.rs');
ck('Linux 仍走原生菜单(那边 TrayIconEvent 根本不发)', tray.includes('show_menu_on_left_click(cfg!(target_os = "linux"))'));
ck('面板只在非 Linux 上接管左键', tray.includes('#[cfg(not(target_os = "linux"))]') && tray.includes('on_tray_icon_event'));
ck('位置由纯函数算(可单测)', tray.includes('pub fn panel_position('));
ck('失焦即收起', tray.includes('WindowEvent::Focused(false)'));
ck('托盘图标与未读标题沿用 0.2.79 那套', tray.includes('icon_as_template(true)') && tray.includes('fn title_for('));

const app = read('App.tsx');
ck('?tray=1 路由到面板', app.includes('readTrayPanelRoute()') && app.includes('<TrayPanel />'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
