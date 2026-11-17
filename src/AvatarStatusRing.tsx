// 头像外圈状态动效，模型见 avatar-motion.ts。包在头像外面用：
//   <AvatarStatusRing status={s.status} size={34}><AliasAvatar … size={34} /></AvatarStatusRing>
// 圈画在头像外侧（绝对定位、不占布局），所以加不加圈，列表行和标题栏的尺寸都不变。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, View } from 'react-native';
import { avatarRadius, colors } from './theme';
import { AVATAR_PULSE_MS, AVATAR_RING_GAP, AVATAR_RING_STROKE, AVATAR_SPIN_MS, avatarMotion, avatarRingBox } from './avatar-motion';

const NATIVE_DRIVER = Platform.OS !== 'web';

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
    const loop = motion === 'working'
      ? Animated.loop(Animated.timing(spin, { toValue: 1, duration: AVATAR_SPIN_MS, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }))
      : Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: AVATAR_PULSE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(pulse, { toValue: 1, duration: AVATAR_PULSE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: NATIVE_DRIVER }),
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
