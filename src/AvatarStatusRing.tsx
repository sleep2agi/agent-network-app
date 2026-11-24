// 头像外圈状态动效，模型见 avatar-motion.ts。包在头像外面用：
//   <AvatarStatusRing status={s.status} size={34}><AliasAvatar … size={34} /></AvatarStatusRing>
// 圈画在头像外侧（绝对定位、不占布局），所以加不加圈，列表行和标题栏的尺寸都不变。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform, View } from 'react-native';
import { avatarRadius, colors } from './theme';
import { AVATAR_PULSE_MS, AVATAR_RING_GAP, AVATAR_RING_STROKE, AVATAR_SPIN_MS, avatarMotion, avatarRingBox } from './avatar-motion';

const NATIVE_DRIVER = Platform.OS !== 'web';
// 🔴 isInteraction: false —— 循环动画默认算「交互中」，永不结束 ⇒ InteractionManager 永远不空，
//    聊天列表的分批渲染和「加载更早消息」都会被卡住（test-chat-older-batches 桌面端红）。

// 🔴 手机上不用原生循环动画（ANet Android 0.2.617 真机报告 BUG-09）：
//    Animated.loop + 原生驱动会让整屏按屏幕刷新率（小米折叠屏 120Hz）持续重绘，
//    Agent 列表静置时 CPU 47–53%、80 秒画 9,503 帧，UIAutomator 也因此拿不到 idle。
//    改成全 App 共用一个低频节拍（约 10 次/秒）：所有圈一起跳一步，只在有圈要动且 App 在前台时运行。
//    转圈变成一格一格走，看得出「在干活」，但不再逼整屏 120Hz 重绘。桌面 / 网页仍用平滑动画。
export const AVATAR_TICK_MS = 100;
const tickListeners = new Set<(now: number) => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let appActive = true;
function syncTicker() {
  const shouldRun = appActive && tickListeners.size > 0;
  if (shouldRun && !tickTimer) {
    tickTimer = setInterval(() => { const now = Date.now(); tickListeners.forEach(fn => fn(now)); }, AVATAR_TICK_MS);
  } else if (!shouldRun && tickTimer) {
    clearInterval(tickTimer); tickTimer = null;
  }
}
if (NATIVE_DRIVER) {
  // 退到后台立刻停；回前台再接上。
  AppState.addEventListener('change', s => { appActive = s === 'active'; syncTicker(); });
}
function subscribeTick(fn: (now: number) => void): () => void {
  tickListeners.add(fn); syncTicker();
  return () => { tickListeners.delete(fn); syncTicker(); };
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

export default function AvatarStatusRing({ status, processing = false, size, children, testID }: {
  status?: string | null;
  processing?: boolean;
  /** The avatar's rendered size in px (already scaled). */
  size: number;
  children: ReactNode;
  testID?: string;
}) {
  const { motion, tone } = avatarMotion(status, processing);
  const reduce = useReduceMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    spin.stopAnimation(); pulse.stopAnimation();
    spin.setValue(0); pulse.setValue(1);
    if (reduce || motion === 'none') return;
    if (NATIVE_DRIVER) {
      // 手机：跟着共用节拍一步一步走（见文件顶部 BUG-09 说明）。
      return subscribeTick(now => {
        if (motion === 'working') spin.setValue((now % AVATAR_SPIN_MS) / AVATAR_SPIN_MS);
        else {
          const phase = (now % AVATAR_PULSE_MS) / AVATAR_PULSE_MS; // 0→1
          const tri = phase < 0.5 ? 1 - phase * 2 : (phase - 0.5) * 2; // 1→0→1
          pulse.setValue(0.25 + 0.75 * tri);
        }
      });
    }
    const loop = motion === 'working'
      ? Animated.loop(Animated.timing(spin, { toValue: 1, duration: AVATAR_SPIN_MS, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER, isInteraction: false }))
      : Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: AVATAR_PULSE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
        Animated.timing(pulse, { toValue: 1, duration: AVATAR_PULSE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER, isInteraction: false }),
      ]));
    loop.start();
    return () => loop.stop();
  }, [motion, reduce, spin, pulse]);

  if (motion === 'none' || !tone) return <>{children}</>;
  const box = avatarRingBox(size);
  const offset = -(AVATAR_RING_GAP + AVATAR_RING_STROKE);
  const color = colors[tone];
  const ring = {
    position: 'absolute' as const, left: offset, top: offset, width: box, height: box,
    borderRadius: avatarRadius(box), borderWidth: AVATAR_RING_STROKE,
  };
  // working：一段 3/4 弧（一边透明）在转；attention：整圈在呼吸。减少动态效果时两者都静止。
  const ringStyle = motion === 'working'
    ? [ring, { borderColor: color, borderTopColor: 'transparent' }, reduce ? null : { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]
    : [ring, { borderColor: color }, reduce ? null : { opacity: pulse }];
  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <Animated.View pointerEvents="none" style={ringStyle} testID={testID ? `${testID}-${motion}` : undefined} />
      {children}
    </View>
  );
}
