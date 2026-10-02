// 「阅读 / 编辑 / 左右」编辑器的共用零件:节点规则文件(#491 NodeRulesSection)和任务描述的全屏编辑器
// (TaskDescriptionEditor)用同一套 —— 模式切换、左右分隔条(拖动 / 双击 / 读屏按步调)、预览节流、焦点圈。
// 布局与比例的纯逻辑在 rules-split.ts;这里只是把它们画出来。
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, View } from 'react-native';
import { Text } from './ui-text';
import { colors, spacing, radius } from './theme';
import type { RulesViewMode } from './node-rules-view';
import { RULES_MODE_LABEL, SPLIT_DIVIDER_HIT, SPLIT_RATIO_DEFAULT, SPLIT_RATIO_STEP, clampSplitRatio, splitDividerHandlers } from './rules-split';
import { lockDocumentSelection } from './composer-resize';

const WEB = Platform.OS === 'web';

export function prefersReducedMotion(): boolean {
  const mm = (globalThis as any).matchMedia;
  try { return !!mm && mm('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// 键盘焦点要看得见:web 端 Pressable 的 focused 态画一圈强调色。
export const FocusRing = forwardRef<any, any>(function FocusRing({ style, children, ...rest }, ref) {
  return (
    <Pressable ref={ref} {...rest} style={(state: any) => [style, state.focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any : null, state.hovered ? { backgroundColor: colors.rowHover } : null]}>
      {children}
    </Pressable>
  );
});

/**
 * 编辑器顶栏(规则文件、任务描述、定时任务内容的全屏和内联工具条)里所有控件的统一高度:桌面 30,手指点的原生端 36。
 * 「阅读 / 编辑」切换、重新读取、保存、退出全屏都是这个高 —— 中线对齐(2026-10-02 #450 iPad 截图:退出全屏低一截、
 * 三个按钮三种样子)。几何守卫:src/editor-header.test.ts + tests/test-editor-header/drive.mjs。
 */
export const EDITOR_BTN_HEIGHT = WEB ? 30 : 36;

/**
 * 编辑器顶栏的按钮。plain = 描边;primary = 强调色底(保存)。height:跟同一行的切换控件一样高(手机整页用 Segmented 的 32)。
 * 禁用:主按钮换成浅灰底 + 灰字(一眼看得出不能点),不只是把强调色调淡 —— 调淡的强调色看起来像「正在加载」。
 */
export const EditorHeaderButton = forwardRef<any, { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; accessibilityLabel?: string; testID?: string; height?: number; fontSize?: number }>(
  function EditorHeaderButton({ label, onPress, disabled, primary, accessibilityLabel, testID, height = EDITOR_BTN_HEIGHT, fontSize = 12 }, ref) {
    const style = {
      height, paddingHorizontal: spacing.md, borderRadius: radius.control, justifyContent: 'center' as const, alignItems: 'center' as const, borderWidth: 1,
      ...(primary
        ? (disabled ? { backgroundColor: colors.subtleFill, borderColor: colors.subtleFill } : { backgroundColor: colors.accent, borderColor: colors.accent })
        : { borderColor: colors.border }),
    };
    const text = <Text style={{ fontSize, fontWeight: primary ? '600' : '400', color: disabled ? colors.textMuted : primary ? colors.onAccent : colors.textSecondary }} numberOfLines={1}>{label}</Text>;
    // 主按钮不用 FocusRing:它悬停时把底色换成行悬停色,强调色会被盖掉。
    return primary ? (
      <Pressable ref={ref} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }} aria-disabled={!!disabled}
        hitSlop={WEB ? undefined : 6} testID={testID}
        style={(state: any) => [style, state.focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any : null, state.pressed && !disabled ? { opacity: 0.85 } : null]}>
        {text}
      </Pressable>
    ) : (
      <FocusRing ref={ref} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }} aria-disabled={!!disabled}
        hitSlop={WEB ? undefined : 6} testID={testID} style={style}>
        {text}
      </FocusRing>
    );
  });

/** labels:默认是规则文件的中文标签;新界面传 t() 翻译过的。 */
export function ModeToggle({ mode, tabs, onChange, labels = RULES_MODE_LABEL, testID }: {
  mode: RulesViewMode; tabs: readonly RulesViewMode[]; onChange: (m: RulesViewMode) => void; labels?: Record<RulesViewMode, string>; testID?: string;
}) {
  return (
    <View accessibilityRole="tablist" testID={testID} style={{ flexDirection: 'row', alignItems: 'stretch', height: EDITOR_BTN_HEIGHT, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 2, gap: 2 }}>
      {tabs.map((m) => (
        // aria-selected:react-native-web 不把 accessibilityState.selected 写进 DOM,读屏(和测试)看不出选中的是哪个。
        <FocusRing key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} aria-selected={mode === m} onPress={() => onChange(m)}
          hitSlop={WEB ? undefined : 4} testID={testID ? `${testID}-${m}` : undefined}
          style={{ justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.item, backgroundColor: mode === m ? colors.subtleFill : 'transparent' }}>
          <Text style={{ fontSize: 12, color: mode === m ? colors.text : colors.textMuted, fontWeight: mode === m ? '600' : '400' }}>{labels[m]}</Text>
        </FocusRing>
      ))}
    </View>
  );
}

// 左右之间的分隔条:1px 的线是左栏的右边框;这里是跨在线上的 SPLIT_DIVIDER_HIT 宽热区。
// 拖 = 实时改比例、松手定下;双击 = 回到 50/50(rules-split.ts splitDividerHandlers)。
export function SplitDivider({ left, width, ratio, onRatio, onCommit, label = '拖动调整左右比例，双击恢复各一半', valueText, testID = 'rules-split-divider' }: {
  left: number; width: number; ratio: number; onRatio: (r: number) => void; onCommit: (r: number) => void;
  /** 读屏标签 / 当前值说法:默认是规则文件的;新界面传 t() 翻译过的。 */
  label?: string; valueText?: (pct: number) => string; testID?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const ratioRef = useRef(ratio); ratioRef.current = ratio;
  const widthRef = useRef(width); widthRef.current = width;
  const onRatioRef = useRef(onRatio); onRatioRef.current = onRatio;
  const onCommitRef = useRef(onCommit); onCommitRef.current = onCommit;
  // 🔴 只建一次(空依赖):拖到一半重建 PanResponder,dx 会从 0 重算。
  const pan = useMemo(() => PanResponder.create(splitDividerHandlers({
    getRatio: () => ratioRef.current,
    getWidth: () => widthRef.current,
    setRatio: (r) => { setDragging(true); onRatioRef.current(r); },
    commit: (r) => { setDragging(false); onCommitRef.current(r); },
    reset: () => { setDragging(false); onCommitRef.current(SPLIT_RATIO_DEFAULT); },
    lockSelection: WEB ? () => lockDocumentSelection() : undefined,
  }) as any), []);
  const pct = Math.round(ratio * 100);
  return (
    <View
      testID={testID}
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 25, max: 75, now: pct, text: valueText ? valueText(pct) : `源码 ${pct}%` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        const a = e.nativeEvent.actionName;
        if (a === 'increment' || a === 'decrement') onCommit(clampSplitRatio(ratio + (a === 'increment' ? SPLIT_RATIO_STEP : -SPLIT_RATIO_STEP)));
      }}
      {...({ dataSet: { ratio: ratio.toFixed(4), dragging: dragging ? '1' : '0' } } as object)}
      style={[
        { position: 'absolute', top: 0, bottom: 0, left: left - SPLIT_DIVIDER_HIT / 2, width: SPLIT_DIVIDER_HIT, zIndex: 5, alignItems: 'center', justifyContent: 'center' },
        WEB ? ({ cursor: 'col-resize', touchAction: 'none', userSelect: 'none' } as object) : null,
      ]}
    >
      {dragging ? <View style={{ position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.accent }} /> : null}
      <View style={{ width: 4, height: 36, borderRadius: radius.pill, backgroundColor: dragging ? colors.accent : colors.textMuted, opacity: dragging ? 1 : 0.35 }} />
    </View>
  );
}

/** 停手 ms 毫秒后才跟上的值(左右模式的实时预览:边打字边重排整篇会卡键盘)。 */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (ms <= 0) { setV(value); return; }
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return ms <= 0 ? value : v;
}
