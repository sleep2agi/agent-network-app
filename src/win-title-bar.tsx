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
// 只在 Tauri 桌面壳 + Windows 渲染;macOS/网页/移动端返回 null。
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { colors, onThemeChange, themeMode } from './theme';
import { WINDOWS_TITLE_BAR_HEIGHT, isWindowsTauriShell } from './window-shell';

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
    // 「向下还原」:两个错开的方框
    return (
      <View style={{ width: 10, height: 10 }}>
        <View style={{ position: 'absolute', left: 2, top: 0, width: 8, height: 8, borderWidth: 1, borderColor: c }} />
        <View style={{ position: 'absolute', left: 0, top: 2, width: 8, height: 8, borderWidth: 1, borderColor: c, backgroundColor: colors.railBg }} />
      </View>
    );
  }
  return <View style={{ width: 10, height: 10, borderWidth: 1, borderColor: c }} />;
}

export default function WinTitleBar() {
  // 0.2.83:同 MacTitleStrip——挂在 AppRoot 外面,主题翻了不会自动重画,自己订阅(见 window-background.ts)。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  const show = isWindowsTauriShell(Platform.OS);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!show) return;
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
  }, [show]);

  if (!show) return null;

  const button = (label: string, op: WindowOp, danger = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { void runWindowOp(op).catch(() => { /* 用户能再点一次 */ }); }}
      style={({ hovered, pressed }: any) => [
        {
          width: 46,
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
    <View
      accessibilityLabel="窗口标题栏"
      testID="win-title-bar"
      {...({ dataSet: { tauriDragRegion: '' } } as any)}
      style={{
        height: WINDOWS_TITLE_BAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.railBg,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <Text
        selectable={false}
        numberOfLines={1}
        {...({ dataSet: { tauriDragRegion: '' } } as any)}
        style={{ flex: 1, paddingLeft: 12, color: colors.textSecondary, fontSize: 12 }}
      >
        Agent Network
      </Text>
      {button('最小化', 'minimize')}
      {button(maximized ? '向下还原' : '最大化', 'toggleMaximize')}
      {button('关闭', 'close', true)}
    </View>
  );
}
