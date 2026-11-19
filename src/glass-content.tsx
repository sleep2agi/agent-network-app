// admin 2026-11-19「任务这边也就是一块白」：整窗渐变只在聊天和列表里透出来，定时任务 / 任务 / 设置 / Hub / 日志 /
// 节点详情 / 组织这些页的根容器各自铺了一层 colors.bg，渐变被盖成一整块灰白。
//
// 不去十几个文件里一个个改根样式：RN-web 把每个样式值编成一个原子 class（同一个颜色同一个 class），
// 这里放一个隐藏探针读出「colors.bg 这个背景色」对应的 class，再加一条只在桌面内容区里生效的 CSS：
//   [data-glass-content] .<那个 class> { background-color: transparent }
// 卡片（colors.card）、输入框、弹层（Modal 走 portal，不在内容区里）都不受影响；主题一换重新探一次。
// 只在 web（桌面 Tauri / 网页）生效；手机原生不渲染探针。
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, themeMode } from './theme';

const STYLE_ID = 'anet-glass-content';

export { glassContentCss } from './glass-content-css';
import { glassContentCss } from './glass-content-css';

export default function GlassContent({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const probeRef = useRef<View>(null);
  const listProbeRef = useRef<View>(null);
  const mode = themeMode();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const probe = useMemo(() => StyleSheet.create({ bg: { backgroundColor: colors.bg } }).bg, [mode]);
  // 列表栏（定时任务左列等）用的是 colors.listBg，同样让出来。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const listProbe = useMemo(() => StyleSheet.create({ bg: { backgroundColor: colors.listBg } }).bg, [mode]);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = probeRef.current as unknown as HTMLElement | null;
    const listEl = listProbeRef.current as unknown as HTMLElement | null;
    const doc = (globalThis as { document?: Document }).document;
    if (!el || !doc || !el.classList) return;
    let tag = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!tag) { tag = doc.createElement('style'); tag.id = STYLE_ID; doc.head.appendChild(tag); }
    tag.textContent = glassContentCss([...Array.from(el.classList), ...(listEl?.classList ? Array.from(listEl.classList) : [])]);
  }, [probe, listProbe]);
  return (
    <View style={style} testID={testID} {...({ dataSet: { glassContent: '' } } as object)}>
      {Platform.OS === 'web' ? (
        <View style={HIDE} pointerEvents="none" aria-hidden>
          <View ref={probeRef} style={probe} />
          <View ref={listProbeRef} style={listProbe} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

// 不用模块级 StyleSheet.create：这里没有主题色，但 theme-restyle-coverage 按文件判断，写成普通对象最直接。
const HIDE: ViewStyle = { position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0 };
