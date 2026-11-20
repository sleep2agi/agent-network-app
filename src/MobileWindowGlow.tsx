// 手机整窗渐变（admin 2026-11-20：安卓/折叠屏要和桌面同一个暖桃/淡紫蓝风格）。
//
// 桌子用 CSS 两层 radial-gradient；原生没有，所以用预生成 PNG（颜色与 alpha 照 GLOW_*/ALPHA 烘焙）。
// 几何在 mobile-glow.ts（纯函数、有单测），这里只负责铺图 + 跟随窗口尺寸变化。
//
// 只铺在「整窗最外层」，和 WindowGlowRoot 的位置一致：拖动带/标题栏/内容共享同一层光。
import { useEffect, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Asset } from 'expo-asset';
import { colors, onThemeChange, themeMode } from './theme';
import { mobileGlowLayout, type GlowMode } from './mobile-glow';

// 贴图 URI：web 导出里 require() 的结果直接塞给 <Image> 出不来图（RNW 渲染 div 的
// background-image 是 none），而 RNW 上没有 Image.resolveAssetSource。用 expo-asset 取 uri，
// 两端口径统一（native 用 localUri）。
const uri = (m: number): string => {
  try {
    const a = Asset.fromModule(m);
    return a.localUri ?? a.uri;
  } catch { return ''; }
};
// v3（2026-11-20）：一张整窗图，两个角的光斑都烘焙在里面（桌面 CSS 同构图），stretch 到整窗。
const GLOW = {
  light: uri(require('../assets/glow-full-light.png')),
  dark: uri(require('../assets/glow-full-dark.png')),
} as const;

export default function MobileWindowGlow({ children }: { children: ReactNode }) {
  const win = useWindowDimensions();
  const [mode, setMode] = useState<GlowMode>(themeMode());
  useEffect(() => onThemeChange(() => setMode(themeMode())), []);
  const layout = mobileGlowLayout(win.width, win.height, mode);
  const image = GLOW[mode];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID="mobile-window-glow">
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Image source={{ uri: image }} resizeMode="stretch" style={[styles.layer, layout]} testID="mobile-glow-layer" />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
});
