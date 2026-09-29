// 预计完成:点开是月历(桌面 = 贴着字段的弹层,手机 = 底部面板),可选时刻(时:分:秒,24 小时制)或「全天」。
// 快捷项(今天 / 明天 / 下周一)保留,点了是全天。Hub 只认日期时(旧 Hub,没有 due_datetime 能力)不显示时刻。
// 桌面键盘:←→ 一天、↑↓ 一周、PageUp/Down 一个月、回车选中、Esc 关闭。
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { useModalSafePadding } from './safe-area-runtime';
import { colors, radius, spacing, themeMode, type as typeScale, weight } from './theme';
import { elevated } from './elevation';
import {
  calendarKey, dueFromLocal, dueShortcuts, dueToLocal, formatDueFull, localDateOf, monthGrid, shiftMonth,
} from './due-time';
import { fieldStyles } from './TaskCreateDialog';
import { a11yState, useTaskStyles } from './TaskBoardParts';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
export const DUE_PANEL_WIDTH = 308;

type Time = { hh: number; mm: number; ss: number };
const pad = (n: number) => String(n).padStart(2, '0');

export default function TaskDuePicker({ value, onChange, allowTime, pointer, sheet, idBase, error }: {
  value: string;
  onChange: (due: string) => void;
  /** Hub 能存时刻(capabilities 里有 due_datetime)。 */
  allowTime: boolean;
  /** 鼠标界面:弹层贴着字段 + 键盘操作;否则手机底部面板。 */
  pointer: boolean;
  sheet: boolean;
  idBase: string;
  error?: string;
}) {
  const s = useTaskStyles();
  const f = fieldStyles();
  const styles = makePickerStyles();
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const fieldRef = useRef<any>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const today = localDateOf(Date.now());
  const initial = dueToLocal(value);
  const [date, setDate] = useState<string>(initial?.date ?? today);
  const [allDay, setAllDay] = useState<boolean>(!initial?.time);
  const [time, setTime] = useState<Time>(initial?.time ?? { hh: 18, mm: 0, ss: 0 });
  const [timeText, setTimeText] = useState({ hh: pad(time.hh), mm: pad(time.mm), ss: pad(time.ss) });
  const [month, setMonth] = useState(() => { const [y, m] = (initial?.date ?? today).split('-').map(Number); return { y, m }; });

  const begin = () => {
    const l = dueToLocal(value);
    const d = l?.date ?? today;
    const t = l?.time ?? { hh: 18, mm: 0, ss: 0 };
    setDate(d);
    setAllDay(!l?.time);
    setTime(t);
    setTimeText({ hh: pad(t.hh), mm: pad(t.mm), ss: pad(t.ss) });
    const [y, m] = d.split('-').map(Number);
    setMonth({ y, m });
    const el = fieldRef.current;
    if (el?.measureInWindow) el.measureInWindow((x: number, y2: number, w: number, h: number) => { setAnchor({ x, y: y2, w, h }); setOpen(true); });
    else { setAnchor(null); setOpen(true); }
  };
  const pick = (d: string) => {
    setDate(d);
    const [y, m] = d.split('-').map(Number);
    if (y !== month.y || m !== month.m) setMonth({ y, m });
  };
  const commit = () => {
    onChange(allowTime && !allDay ? dueFromLocal(date, time) : date);
    setOpen(false);
  };

  // 桌面键盘
  const keyState = useRef({ date, open, commit, pick });
  keyState.current = { date, open, commit, pick };
  useEffect(() => {
    const doc = (globalThis as { document?: any }).document;
    if (!open || !pointer || !doc?.addEventListener) return;
    const onKey = (e: any) => {
      const tag = String(e.target?.tagName || '').toLowerCase();
      if (e.key === 'Escape') { e.preventDefault?.(); setOpen(false); return; }
      if (tag === 'input' || tag === 'textarea') return; // 在时分秒框里打字时不抢方向键 / 回车
      if (e.key === 'Enter') { e.preventDefault?.(); keyState.current.commit(); return; }
      const next = calendarKey(keyState.current.date, e.key);
      if (next) { e.preventDefault?.(); keyState.current.pick(next); }
    };
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  }, [open, pointer]);

  const setPart = (part: keyof Time, text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 2);
    setTimeText(t => ({ ...t, [part]: digits }));
    const n = Number(digits);
    const max = part === 'hh' ? 23 : 59;
    if (digits !== '' && n <= max) setTime(t => ({ ...t, [part]: n }));
  };
  const blurPart = (part: keyof Time) => setTimeText(t => ({ ...t, [part]: pad(time[part]) }));

  const label = value ? formatDueFull(value) : '';
  const grid = monthGrid(month.y, month.m);
  const cell = Math.floor((DUE_PANEL_WIDTH - spacing.lg * 2) / 7);

  const panelBody = (
    <View style={{ gap: spacing.md }} testID={`${idBase}-calendar`}>
      <View style={styles.monthRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="上个月" onPress={() => setMonth(shiftMonth(month.y, month.m, -1))} style={s.iconButton} testID={`${idBase}-prev`}>
          <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: typeScale.body, fontWeight: weight.strong }} testID={`${idBase}-month`}>{month.y}年{month.m}月</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="下个月" onPress={() => setMonth(shiftMonth(month.y, month.m, 1))} style={s.iconButton} testID={`${idBase}-next`}>
          <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.week}>
        {WEEK.map(w => <Text key={w} style={[styles.weekDay, { width: cell, color: colors.textMuted }]}>{w}</Text>)}
      </View>
      <View style={styles.grid} {...({ role: "grid" } as object)}>
        {grid.map(g => {
          const on = g.date === date;
          const isToday = g.date === today;
          return (
            <Pressable
              key={g.date}
              accessibilityRole="button"
              accessibilityLabel={`${g.date}${isToday ? ' 今天' : ''}`}
              {...a11yState({ selected: on })}
              onPress={() => pick(g.date)}
              style={state => [styles.day, { width: cell, height: cell - 4 },
                ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover },
                isToday && { borderWidth: 1, borderColor: colors.accent },
                on && { backgroundColor: colors.accent }]}
              testID={`${idBase}-day-${g.date}`}
            >
              <Text style={{ fontSize: typeScale.small + 1, color: on ? colors.onAccent : g.inMonth ? colors.text : colors.textMuted, fontWeight: on || isToday ? weight.strong : weight.regular }}>{Number(g.date.slice(8))}</Text>
            </Pressable>
          );
        })}
      </View>
      {allowTime ? (
        <View style={styles.timeRow} testID={`${idBase}-time`}>
          <Pressable accessibilityRole="checkbox" {...a11yState({ checked: allDay })} onPress={() => setAllDay(a => !a)} style={[f.row, { gap: 6 }]} testID={`${idBase}-allday`}>
            <Ionicons name={allDay ? 'checkbox' : 'square-outline'} size={16} color={allDay ? colors.accent : colors.textMuted} />
            <Text style={{ color: colors.text, fontSize: typeScale.small + 1 }}>全天</Text>
          </Pressable>
          <View style={[f.row, { gap: 4, opacity: allDay ? 0.35 : 1 }]} pointerEvents={allDay ? 'none' : 'auto'}>
            {(['hh', 'mm', 'ss'] as const).map((part, i) => (
              <View key={part} style={[f.row, { gap: 4 }]}>
                {i ? <Text style={{ color: colors.textMuted }}>:</Text> : null}
                <TextInput
                  value={timeText[part]}
                  onChangeText={t => setPart(part, t)}
                  onBlur={() => blurPart(part)}
                  keyboardType="number-pad"
                  maxLength={2}
                  editable={!allDay}
                  style={[styles.timeBox, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
                  accessibilityLabel={part === 'hh' ? '时' : part === 'mm' ? '分' : '秒'}
                  testID={`${idBase}-${part}`}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Pressable accessibilityRole="button" onPress={() => { onChange(''); setOpen(false); }} style={styles.footBtn} testID={`${idBase}-picker-clear`}>
          <Text style={s.link}>清除</Text>
        </Pressable>
        <View style={[f.row, { gap: spacing.sm }]}>
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={[s.primary, { backgroundColor: colors.subtleFill }]} testID={`${idBase}-cancel`}>
            <Text style={[s.primaryText, { color: colors.text }]}>取消</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={commit} style={s.primary} testID={`${idBase}-ok`}>
            <Text style={s.primaryText}>确定</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  // 桌面:贴着字段下沿;放不下就翻到上面;左边和字段左边对齐,右边夹进窗口。
  const panelH = allowTime ? 452 : 404;
  const left = anchor ? Math.max(8, Math.min(anchor.x, win.width - DUE_PANEL_WIDTH - 8)) : (win.width - DUE_PANEL_WIDTH) / 2;
  const below = anchor ? anchor.y + anchor.h + 6 : (win.height - panelH) / 2;
  const top = anchor && below + panelH > win.height - 8 ? Math.max(8, anchor.y - panelH - 6) : below;

  return (
    <View style={{ gap: spacing.sm }}>
      <View ref={fieldRef} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label ? `预计完成 ${label}，更改` : '选择预计完成日期'}
          onPress={begin}
          style={[f.input, f.row, error ? { borderColor: colors.failed } : null]}
          testID={idBase}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
          <Text style={{ flex: 1, color: label ? colors.text : colors.textMuted, fontSize: typeScale.body }} numberOfLines={1} testID={`${idBase}-value`}>{label || '选择日期(可空)'}</Text>
          {value ? (
            <Pressable accessibilityRole="button" accessibilityLabel="清除预计完成" onPress={() => onChange('')} hitSlop={8} testID={`${idBase}-x`}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {dueShortcuts(today).map(o => (
          <Pressable key={o.key} onPress={() => onChange(o.value)} style={[s.chip, { height: 28 }, value === o.value && s.chipOn]} testID={`${idBase}-${o.key}`} accessibilityRole="button">
            <Text style={[s.chipText, value === o.value && s.chipTextOn]}>{o.label}</Text>
          </Pressable>
        ))}
        {value ? (
          <Pressable onPress={() => onChange('')} style={[s.chip, { height: 28 }]} testID={`${idBase}-clear`} accessibilityRole="button">
            <Text style={s.chipText}>清除</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={s.err} accessibilityRole="alert">{error}</Text> : null}
      <Modal visible={open} transparent animationType={sheet ? 'slide' : 'fade'} onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: sheet ? 'rgba(0,0,0,0.4)' : 'transparent', justifyContent: sheet ? 'flex-end' : undefined }}>
          <Pressable accessibilityLabel="关闭日历" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} testID={`${idBase}-scrim`} />
          <View
            style={sheet
              ? { backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, padding: spacing.lg, paddingBottom: spacing.lg + safe.paddingBottom, alignItems: 'center', ...elevated('floating') }
              : { position: 'absolute', left, top, width: DUE_PANEL_WIDTH, padding: spacing.lg, borderRadius: radius.surface, backgroundColor: colors.card, borderWidth: themeMode() === 'dark' ? 1 : 0, borderColor: colors.border, ...elevated('floating') }}
            accessibilityViewIsModal
            testID={`${idBase}-panel`}
          >
            <View style={{ width: DUE_PANEL_WIDTH - spacing.lg * 2 }}>{panelBody}</View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makePickerStyles = () => StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  week: { flexDirection: 'row' },
  weekDay: { textAlign: 'center', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4 },
  day: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.item },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeBox: { width: 40, height: 32, borderWidth: 1, borderRadius: radius.item, textAlign: 'center', fontSize: 14, padding: 0 },
  footBtn: { height: 32, justifyContent: 'center' },
});

