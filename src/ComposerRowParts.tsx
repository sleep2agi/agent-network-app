// Mobile composer row pieces (WeChat layout, see composer-row-layout.ts):
//   · ComposerRightSlot — right of the input: ＋ always; a labelled 「发送」 slides in to the
//     right of ＋ once there is something to send (width + opacity, none under reduced motion).
//   · ComposerExpandButton — ⤢ at the top-left of the row once the input passes 3 lines.
//   · ComposerFullscreenEditor — the long-message editor ⤢ opens. Same draft; 发送 and a
//     collapse control; Android back / Esc close it through Modal onRequestClose.

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useModalSafePadding } from './safe-area-runtime';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { ds, uiScale } from './ui-scale';
import { composerControlSize, sendRevealAnimation, type ComposerRightSlot as Slot } from './composer-row-layout';

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

/**
 * Right of the input: ＋ always, then 「发送」 when there is something to send (slot === 'send').
 * 发送 is revealed by animating its wrapper's width from 0 to gap + pill width (and its opacity),
 * so the input narrows smoothly instead of jumping. The pill is absolutely positioned at the
 * wrapper's right edge, so its own width is measured independently of the animated wrapper.
 * The gap before 发送 is the row gap (ChatScreen styles.inputRow.gap = spacing.sm), so
 * field → ＋ and ＋ → 发送 are the same distance.
 */
export function ComposerRightSlot({ slot, sendDisabled, plusOpen, onSend, onPlus }: {
  slot: Slot;
  sendDisabled: boolean;
  plusOpen: boolean;
  onSend: () => void;
  onPlus: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const show = slot === 'send';
  const gap = spacing.sm;
  const [pillWidth, setPillWidth] = useState(ds(56));
  const reveal = useRef(new Animated.Value(show ? 1 : 0)).current;
  // Keep 发送 mounted while it animates out; unmount once hidden (no focusable 0-width button).
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) setMounted(true);
    const { duration } = sendRevealAnimation(reduceMotion);
    if (duration === 0) { reveal.setValue(show ? 1 : 0); if (!show) setMounted(false); return; }
    const anim = Animated.timing(reveal, { toValue: show ? 1 : 0, duration, useNativeDriver: false });
    anim.start(({ finished }) => { if (finished && !show) setMounted(false); });
    return () => anim.stop();
  }, [show, reduceMotion, reveal]);

  return (
    <View style={styles.rightSlot} testID="composer-right-slot">
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
      {mounted ? (
        <Animated.View
          testID="composer-send-reveal"
          style={[styles.sendReveal, { width: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, gap + pillWidth] }), opacity: reveal }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发送"
            accessibilityState={{ disabled: sendDisabled }}
            testID="composer-send"
            onLayout={e => { const w = Math.ceil(e.nativeEvent.layout.width); if (w > 0 && w !== pillWidth) setPillWidth(w); }}
            style={({ pressed }) => [styles.sendPill, styles.sendPillPinned, sendDisabled && styles.sendPillDisabled, pressed && { opacity: 0.7 }]}
            onPress={onSend}
            disabled={sendDisabled || !show}
          >
            <Text style={styles.sendPillText}>发送</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
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
  const safe = useModalSafePadding('fullScreen');
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent={false} animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.editorRoot, safe]} accessibilityViewIsModal testID="composer-fullscreen-editor">
        <View style={styles.editorBar} testID="screen-header">
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
    // Row control height (composer-row-layout.ts) — same as ＋, the toggle and the bar/input.
    height: composerControlSize(uiScale().densityFactor),
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  rightSlot: { flexDirection: 'row', alignItems: 'center' },
  // Wrapper whose width animates 0 → gap + pill; the pill sits pinned to its right edge.
  sendReveal: { height: composerControlSize(uiScale().densityFactor), overflow: 'hidden' },
  sendPillPinned: { position: 'absolute', right: 0, top: 0 },
  // Still the accent pill while a send is in flight — just dimmed, so it does not flash grey.
  sendPillDisabled: { opacity: 0.45 },
  sendPillText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  plusBtn: {
    width: composerControlSize(uiScale().densityFactor),
    height: composerControlSize(uiScale().densityFactor),
    borderRadius: composerControlSize(uiScale().densityFactor) / 2,
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
