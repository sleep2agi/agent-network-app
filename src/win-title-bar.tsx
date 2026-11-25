// 0.2.81(Vincent 2026-09-20:「这个地方在 Windows 上也很难看」):
// Windows 此前还挂着系统原生标题栏——一条白带 + 小图标 + "Agent Network",跟下面自绘的界面
// 完全两个世界(macOS 在 0.2.70 就去掉了)。这里给 Windows 画一条同色系的标题栏:标题居左,
// 最小化/最大化-还原/关闭按 Windows 习惯放右上。
//
// 🔴 自绘标题栏最容易做丢的几件事,逐条对应到实现:
//   · 拖动窗口        → 整条 bar 标 data-tauri-drag-region(和 macOS 那条空带同一机制)
//   · 双击最大化/还原  → Tauri 的 drag region 自带双击切换最大化,不需要我们自己接
//   · 贴边分屏(Snap)  → Win11 的 Snap Layouts 悬停在「最大化按钮」上才出;非原生按钮拿不到
//                       那个系统提示(见 PR 说明),但拖到屏幕边缘的贴边仍由系统处理
//   · 边缘/角缩放      → decorations=false 时由 Tauri 自己画不可见的 resize 边框
//   · 最大化后仍可拖动 → drag region 在最大化状态下拖拽 = 还原并跟随,系统行为
//
// 只在 Tauri 桌面壳 + Windows + 主窗渲染;macOS/网页/移动端返回 null。设置窗、分离聊天窗、工作区窗、
// 看图窗保留原生标题栏(decorations: true),这里也返回 null —— 否则叠出两排 – □ ×(见 window-shell.ts)。
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, themeMode } from './theme';
import { WINDOWS_TITLE_BAR_HEIGHT, WINDOW_CONTROL_WIDTH, currentWindowLabel, isWindowsTauriShell, windowDrawsOwnTitleBar } from './window-shell';

export { WINDOWS_TITLE_BAR_HEIGHT, isWindowsTauriShell } from './window-shell';

type WindowOp = 'minimize' | 'toggleMaximize' | 'close';

/** 对当前窗口做一次窗口操作。拿不到 Tauri API(网页端/权限缺失)就安静地什么都不做。 */
export async function runWindowOp(op: WindowOp): Promise<void> {
  const mod = await import('@tauri-apps/api/window');
  const win = mod.getCurrentWindow();
  if (op === 'minimize') return win.minimize();
  if (op === 'close') return win.close();
  return win.toggleMaximize();
}

/**
 * 窗口控件图形。
 *
 * 🔴 用几何形状画,不用字体图标:Windows 的 `Segoe MDL2 Assets` 只有 Windows 上才有,
 *    一旦缺字体就是三个豆腐块(在 Linux 上截图时就是这样),而这三个按钮是窗口唯一的
 *    关闭入口——不能让它取决于某个字体在不在。
 */
function glyph(op: WindowOp, maximized: boolean) {
  const c = colors.textSecondary;
  if (op === 'minimize') return <View style={{ width: 10, height: 1, backgroundColor: c }} />;
  if (op === 'close') {
    return (
      <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 13, height: 1, backgroundColor: c, transform: [{ rotate: '45deg' }] }} />
        <View style={{ position: 'absolute', width: 13, height: 1, backgroundColor: c, transform: [{ rotate: '-45deg' }] }} />
      </View>
    );
  }
  if (maximized) {
    // 「向下还原」:两个错开的空心方框。只画后框露出前框之外的边，不再用实色背景遮罩前框内部，
    // 这样在透明暖黄渐变和按钮悬停底色上都不会露出实色小方块。
    return (
      <View style={{ width: 10, height: 10 }}>
        <View style={{ position: 'absolute', left: 2, top: 0, width: 8, height: 8, borderTopWidth: 1, borderRightWidth: 1, borderColor: c }} />
        <View style={{ position: 'absolute', left: 2, top: 0, width: 1, height: 2, backgroundColor: c }} />
        <View style={{ position: 'absolute', left: 8, top: 7, width: 2, height: 1, backgroundColor: c }} />
        <View style={{ position: 'absolute', left: 0, top: 2, width: 8, height: 8, borderWidth: 1, borderColor: c }} />
      </View>
    );
  }
  return <View style={{ width: 10, height: 10, borderWidth: 1, borderColor: c }} />;
}

/**
 * – □ × 三颗按钮(46×32,关闭悬停红底)。主窗的 WinTitleBar 和分离聊天窗的
 * PopoutWindowControls(页头兼标题栏,见 window-shell.ts)共用这一套,不各写一份。
 */
export function WindowControls({ restoreBg: _restoreBg }: { restoreBg?: string } = {}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let stop = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const mod = await import('@tauri-apps/api/window');
        const win = mod.getCurrentWindow();
        const sync = async () => {
          try {
            const next = await win.isMaximized();
            if (!stop) setMaximized(next);
          } catch { /* 权限缺失:按钮仍可点,只是图标不跟着变 */ }
        };
        await sync();
        unlisten = await win.onResized(() => { void sync(); });
        if (stop) unlisten?.();
      } catch { /* 网页端没有这个 API */ }
    })();
    return () => { stop = true; unlisten?.(); };
  }, []);

  const button = (label: string, op: WindowOp, danger = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`window-control-${op}`}
      onPress={() => { void runWindowOp(op).catch(() => { /* 用户能再点一次 */ }); }}
      style={({ hovered, pressed }: any) => [
        {
          width: WINDOW_CONTROL_WIDTH,
          height: WINDOWS_TITLE_BAR_HEIGHT,
          alignItems: 'center',
          justifyContent: 'center',
        },
        hovered && { backgroundColor: danger ? '#c42b1c' : colors.border },
        pressed && { backgroundColor: danger ? '#b2271a' : colors.card },
      ]}
    >
      {glyph(op, maximized)}
    </Pressable>
  );

  return (
    <>
      {button('最小化', 'minimize')}
      {button(maximized ? '向下还原' : '最大化', 'toggleMaximize')}
      {button('关闭', 'close', true)}
    </>
  );
}

export default function WinTitleBar() {
  // 0.2.83:同 MacTitleStrip——挂在 AppRoot 外面,主题翻了不会自动重画,自己订阅(见 window-background.ts)。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  const show = isWindowsTauriShell(Platform.OS) && windowDrawsOwnTitleBar();
  if (!show) return null;
  const title = currentWindowLabel() === 'settings' ? '设置 · ANet' : 'ANet';

  return (
    <View
      accessibilityLabel="窗口标题栏"
      testID="win-title-bar"
      {...({ dataSet: { tauriDragRegion: '' } } as any)}
      style={{
        height: WINDOWS_TITLE_BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        // 2026-11-24 admin Windows 截图「上面的颜色不对啊」：同 MacTitleStrip，透明让最外层
        // WindowGlowRoot 的暖黄整窗渐变从窗口最顶上透出来，不再压一条灰带和底边线。
        backgroundColor: 'transparent',
      }}
    >
      <Text
        selectable={false}
        numberOfLines={1}
        {...({ dataSet: { tauriDragRegion: '' } } as any)}
        style={{ flex: 1, paddingLeft: 12, color: colors.textSecondary, fontSize: 12 }}
      >
        {title}
      </Text>
      <WindowControls />
    </View>
  );
}
