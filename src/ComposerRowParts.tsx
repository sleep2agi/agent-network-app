// Mobile composer row pieces (WeChat layout, see composer-row-layout.ts):
//   · ComposerRightSlot — the right-hand slot: ＋ when there is nothing to send, a labelled
//     「发送」 button once there is. The swap is a short crossfade + scale (none under
//     reduced motion).
//   · ComposerExpandButton — ⤢ at the top-left of the row once the input passes 3 lines.
//   · ComposerFullscreenEditor — the long-message editor ⤢ opens. Same draft; 发送 and a
//     collapse control; Android back / Esc close it through Modal onRequestClose.

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Platform, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { ds } from './ui-scale';
import { slotSwapAnimation, type ComposerRightSlot as Slot } from './composer-row-layout';
import { rulesFullscreenPadding } from './rules-fullscreen-layout';

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

export function ComposerRightSlot({ slot, sendDisabled, plusOpen, onSend, onPlus }: {
  slot: Slot;
  sendDisabled: boolean;
  plusOpen: boolean;
  onSend: () => void;
  onPlus: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const a = slotSwapAnimation(reduceMotion);
    opacity.setValue(a.fromOpacity);
    scale.setValue(a.fromScale);
    if (a.duration === 0) return;
    const useNativeDriver = Platform.OS !== 'web';
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: a.duration, useNativeDriver }),
      Animated.timing(scale, { toValue: 1, duration: a.duration, useNativeDriver }),
    ]).start();
  }, [slot, reduceMotion, opacity, scale]);

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }} testID="composer-right-slot">
      {slot === 'send' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送"
          accessibilityState={{ disabled: sendDisabled }}
          testID="composer-send"
          style={({ pressed }) => [styles.sendPill, sendDisabled && styles.sendPillDisabled, pressed && { opacity: 0.7 }]}
          onPress={onSend}
          disabled={sendDisabled}
        >
          <Text style={styles.sendPillText}>发送</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={plusOpen ? '收起更多发送方式' : '更多发送方式'}
          accessibilityState={{ expanded: plusOpen }}
          testID="composer-plus"
          style={({ pressed }) => [styles.plusBtn, plusOpen && styles.plusBtnActive, pressed && { opacity: 0.6 }]}
          onPress={onPlus}
          hitSlop={6}
        >
          <Text style={[styles.plusBtnText, plusOpen && styles.plusBtnTextActive]}>＋</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

export function ComposerExpandButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="全屏编辑"
      testID="composer-expand"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.expandBtn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="expand-outline" size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

export function ComposerFullscreenEditor({ visible, alias, draft, onChangeDraft, sendDisabled, onSend, onClose }: {
  visible: boolean;
  alias: string;
  draft: string;
  onChangeDraft: (text: string) => void;
  sendDisabled: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  const safe = rulesFullscreenPadding(Platform.OS, useSafeAreaInsets(), StatusBar.currentHeight);
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent={false} animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.editorRoot, safe]} accessibilityViewIsModal testID="composer-fullscreen-editor">
        <View style={styles.editorBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="收起全屏编辑"
            testID="composer-fullscreen-collapse"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.editorCollapse, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="contract-outline" size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.editorTitle} numberOfLines={1}>{alias}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            accessibilityState={{ disabled: sendDisabled }}
            testID="composer-fullscreen-send"
            style={({ pressed }) => [styles.sendPill, sendDisabled && styles.sendPillDisabled, pressed && { opacity: 0.7 }]}
            onPress={onSend}
            disabled={sendDisabled}
          >
            <Text style={styles.sendPillText}>发送</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.editorInput}
          value={draft}
          onChangeText={onChangeDraft}
          placeholder={`Message ${alias}…`}
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus
          textAlignVertical="top"
          testID="composer-fullscreen-input"
        />
      </View>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  sendPill: {
    minWidth: ds(56),
    height: ds(36),
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  // Still the accent pill while a send is in flight — just dimmed, so it does not flash grey.
  sendPillDisabled: { opacity: 0.45 },
  sendPillText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  plusBtn: {
    width: ds(36),
    height: ds(36),
    borderRadius: ds(36) / 2,
    borderColor: colors.text,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBtnText: { color: colors.text, fontSize: 20, lineHeight: 22 },
  plusBtnActive: { borderColor: colors.accent },
  plusBtnTextActive: { color: colors.accent },
  expandBtn: {
    width: ds(28),
    height: ds(28),
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorRoot: { flex: 1, backgroundColor: colors.bg },
  editorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  editorCollapse: { width: ds(36), height: ds(36), alignItems: 'center', justifyContent: 'center' },
  editorTitle: { flex: 1, color: colors.textSecondary, fontSize: 14 },
  editorInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
    padding: spacing.lg,
    textAlignVertical: 'top',
    outlineStyle: 'none',
  } as any,
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
