import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { settingsText } from './i18n-settings';
// 设置 → 快捷键(桌面端)。分组列出:导航(可改)/ 会话(固定,别处写死的按键)/ 输入(发送键二选一 +
// 语音两条可改:按住说话 / 语音输入开关)。
// 可改的行:点一下 → 「按下新组合…」→ 按下即保存;Esc 取消;冲突 / 保留组合 / 没带 ⌘·Ctrl 就在行下
// 提示、继续等下一个组合。每行「恢复默认」+ 底部「全部恢复默认」。
// 模型在 shortcuts-model.ts,存储与「录入中」信号在 shortcuts-store.ts,执行在 App.tsx DesktopWorkspace。
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing, radius } from './theme';
import { ds } from './ui-scale';
import { SETTINGS_ROW_PAD_X } from './settings-kit';
import {
  FIXED_SHORTCUTS,
  SHORTCUTS,
  anyCustomized,
  comboChips,
  comboFromEvent,
  isCustomized,
  judgeCapture,
  newlineCombo,
  sendCombo,
  withBinding,
  type FixedShortcut,
  type ShortcutDef,
  type SendKey,
  type ShortcutGroupKey,
  type ShortcutId,
} from './shortcuts-model';
import { isMacKeyboard, saveShortcutPrefs, setShortcutCaptureActive, shortcutBindings, shortcutPrefs, subscribeShortcuts } from './shortcuts-store';

type SharedStyles = {
  row: object; rowCopy: object; rowLabel: object; rowHint: object;
  segmented: object; segment: object; segmentSelected: object; segmentText: object; segmentTextSelected: object;
  actionButton: object; actionButtonText: object; divider: object; disabled: object;
};

const GROUP_LABEL: Record<ShortcutGroupKey, string> = { nav: 'settings.copy.212', chat: 'settings.copy.213', input: 'settings.copy.214' };

export default function ShortcutsSettings({ s, showNav = true, showChat = true, showSend = true }: { s: SharedStyles; showNav?: boolean; showChat?: boolean; showSend?: boolean }) {
  useTranslation();
  const prefs = useSyncExternalStore(subscribeShortcuts, shortcutPrefs, shortcutPrefs);
  const bindings = useSyncExternalStore(subscribeShortcuts, shortcutBindings, shortcutBindings);
  const mac = isMacKeyboard();
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [warning, setWarning] = useState<{ id: ShortcutId; message: string } | null>(null);

  useEffect(() => {
    if (!capturing) return;
    setShortcutCaptureActive(true);
    const doc = (globalThis as any).document;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Esc') { setCapturing(null); setWarning(null); return; }
      const combo = comboFromEvent(e, mac);
      if (!combo || /^(?:Mod|Ctrl|Meta|Alt|Shift)(?:\+(?:Mod|Ctrl|Meta|Alt|Shift))*$/.test(combo)) return;
      const verdict = judgeCapture(capturing, combo, shortcutBindings(), mac);
      if (!verdict.ok) { setWarning({ id: capturing, message: verdict.message }); return; }
      saveShortcutPrefs(withBinding(shortcutPrefs(), capturing, verdict.combo));
      setWarning(null);
      setCapturing(null);
    };
    // 捕获阶段:先于 DesktopWorkspace 的全局监听和输入框自己的处理。
    doc?.addEventListener?.('keydown', onKey, true);
    return () => {
      doc?.removeEventListener?.('keydown', onKey, true);
      setShortcutCaptureActive(false);
    };
  }, [capturing, mac]);

  const toggleCapture = (id: ShortcutId) => {
    setWarning(null);
    setCapturing(cur => (cur === id ? null : id));
  };
  const resetOne = (id: ShortcutId) => {
    saveShortcutPrefs(withBinding(shortcutPrefs(), id, null));
    if (warning?.id === id) setWarning(null);
  };
  const setSendKey = (sendKey: SendKey) => saveShortcutPrefs({ ...shortcutPrefs(), sendKey });

  const rowProps = (d: ShortcutDef) => ({
    d, s, mac,
    combo: bindings[d.id],
    active: capturing === d.id,
    customized: isCustomized(prefs, d.id),
    warn: warning?.id === d.id ? warning.message : '',
    onToggle: () => toggleCapture(d.id),
    onReset: () => resetOne(d.id),
  });

  const groupTitle = (g: ShortcutGroupKey) => <Text style={styles.groupTitle} testID={`shortcut-group-${g}`}>{tr(GROUP_LABEL[g])}</Text>;

  return (
    <View testID="shortcuts-settings">
      {showNav ? (
        <>
          {groupTitle('nav')}
          {SHORTCUTS.filter(d => d.group === 'nav').map((d, i) => <BindableRow key={d.id} {...rowProps(d)} first={i === 0} />)}
        </>
      ) : null}

      {showChat ? (
        <>
          {groupTitle('chat')}
          {FIXED_SHORTCUTS.filter(f => f.group === 'chat').map((f, i) => <FixedRow key={f.key} f={f} first={i === 0} s={s} mac={mac} />)}
        </>
      ) : null}

      {showSend ? (
        <>
          {groupTitle('input')}
          <View style={[s.row, styles.row]} testID="shortcut-row-send">
            <View style={s.rowCopy}>
              <Text style={s.rowLabel} testID="shortcut-label-send">{tr('settings.copy.215')}</Text>
            </View>
            <View style={styles.right}>
            <View style={s.segmented} accessibilityRole="radiogroup" accessibilityLabel={tr('settings.copy.215')}>
              {(['enter', 'modEnter'] as const).map(k => {
                const selected = prefs.sendKey === k;
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    accessibilityLabel={comboChips(sendCombo(k), mac).join('+')}
                    onPress={() => { if (!selected) setSendKey(k); }}
                    style={({ pressed }) => [s.segment, selected && s.segmentSelected, pressed && !selected && { opacity: 0.6 }]}
                    testID={`shortcut-send-${k}`}
                  >
                    <Text style={[s.segmentText, selected && s.segmentTextSelected]} numberOfLines={1}>{comboChips(sendCombo(k), mac).join(mac ? '' : '+')}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.trail} />
            </View>
          </View>
          <View style={s.divider} />
          <View style={[s.row, styles.row]} testID="shortcut-row-newline">
            <View style={s.rowCopy}>
              <Text style={s.rowLabel} testID="shortcut-label-newline">{tr('settings.copy.216')}</Text>
            </View>
            <View style={styles.right}>
              <Chips combo={newlineCombo(prefs.sendKey)} mac={mac} testID="shortcut-chips-newline" />
              <View style={styles.trail}><Text style={styles.fixedTag}>{tr('settings.copy.217')}</Text></View>
            </View>
          </View>
          {SHORTCUTS.filter(d => d.group === 'input').map(d => <BindableRow key={d.id} {...rowProps(d)} first={false} />)}
          {FIXED_SHORTCUTS.filter(f => f.group === 'input').map(f => <FixedRow key={f.key} f={f} first={false} s={s} mac={mac} />)}
        </>
      ) : null}

      {showNav && showChat && showSend ? (
        <View style={styles.footer}>
          <Text style={[s.rowHint, styles.footerHint]}>{tr('settings.copy.218')}{mac ? '⌘' : 'Ctrl'}{tr('settings.copy.219')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('settings.copy.220')}
            disabled={!anyCustomized(prefs)}
            onPress={() => { setCapturing(null); setWarning(null); saveShortcutPrefs({ overrides: {}, sendKey: 'enter' }); }}
            style={({ pressed }) => [s.actionButton, !anyCustomized(prefs) && s.disabled, pressed && { opacity: 0.6 }]}
            testID="shortcuts-reset-all"
          >
            <Text style={s.actionButtonText}>{tr('settings.copy.220')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

type BindableRowProps = {
  d: ShortcutDef; first: boolean; s: SharedStyles; mac: boolean; combo: string;
  active: boolean; customized: boolean; warn: string;
  onToggle: () => void; onReset: () => void;
};

/** 可改的一行:点一下进入录入;改过的出现「恢复默认」。导航组和输入组的语音两条共用。 */
function BindableRow({ d, first, s, mac, combo, active, customized, warn, onToggle, onReset }: BindableRowProps) {
  useTranslation();
  return (
    <View>
      {first ? null : <View style={s.divider} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('settings.copy.269', { v0: settingsText(d.label) })}
        accessibilityState={{ selected: active }}
        onPress={onToggle}
        style={({ hovered, pressed }: any) => [s.row, styles.row, (hovered || pressed) && styles.rowHover, active && styles.rowCapturing]}
        testID={`shortcut-row-${d.id}`}
      >
        <View style={s.rowCopy}>
          <Text style={s.rowLabel} testID={`shortcut-label-${d.id}`}>{settingsText(d.label)}</Text>
          {warn ? <Text style={[s.rowHint, { color: colors.failed }]} testID={`shortcut-warning-${d.id}`}>{warn}</Text> : null}
        </View>
        <View style={styles.right}>
          {active
            ? <Text style={styles.capturing} testID={`shortcut-capturing-${d.id}`}>{tr('settings.copy.221')}</Text>
            : <Chips combo={combo} mac={mac} testID={`shortcut-chips-${d.id}`} />}
          <View style={styles.trail}>
          {customized && !active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('settings.copy.268', { v0: settingsText(d.label) })}
              onPress={e => { e.stopPropagation(); onReset(); }}
              hitSlop={6}
              style={({ hovered }: any) => [styles.resetButton, hovered && styles.resetButtonHover]}
              testID={`shortcut-reset-${d.id}`}
            >
              <Ionicons name="refresh" size={14} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function FixedRow({ f, first, s, mac }: { f: FixedShortcut; first: boolean; s: SharedStyles; mac: boolean }) {
  useTranslation();
  return (
    <View>
      {first ? null : <View style={s.divider} />}
      <View style={[s.row, styles.row]} testID={`shortcut-row-${f.key}`}>
        <View style={s.rowCopy}>
          <Text style={s.rowLabel} testID={`shortcut-label-${f.key}`}>{settingsText(f.label)}</Text>
        </View>
        <View style={styles.right}>
          <View style={styles.chipAlternatives} testID={`shortcut-chips-${f.key}`}>
            {f.combos.map((c, j) => (
              <View key={c} style={styles.chipAlternatives}>
                {j ? <Text style={styles.chipSeparator}>/</Text> : null}
                <Chips combo={c} mac={mac} />
              </View>
            ))}
          </View>
          <View style={styles.trail}><Text style={styles.fixedTag}>{tr('settings.copy.222')}</Text></View>
        </View>
      </View>
    </View>
  );
}

function Chips({ combo, mac, testID }: { combo: string; mac: boolean; testID?: string }) {
  useTranslation();
  return (
    <View style={styles.chips} testID={testID}>
      {comboChips(combo, mac).map((label, i) => (
        <View key={`${label}-${i}`} style={styles.chip}>
          <Text style={styles.chipText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  // 和设置积木的分组标题同一列(左边 16,13 号灰字;#427 v2)。
  groupTitle: { color: colors.textMuted, fontSize: 13, paddingHorizontal: SETTINGS_ROW_PAD_X, marginTop: spacing.lg, marginBottom: spacing.xs },
  // 行高固定:键帽、「按下新组合…」、分段控件三种右侧内容切换时整列不跳。
  row: { minHeight: ds(48), paddingVertical: spacing.sm, borderRadius: radius.item },
  rowHover: { backgroundColor: colors.rowHover },
  rowCapturing: { backgroundColor: colors.rowActive },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 0 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipAlternatives: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipSeparator: { color: colors.textMuted, fontSize: 12 },
  chip: { minWidth: ds(24), height: ds(24), paddingHorizontal: 6, borderRadius: radius.mark, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '500' },
  capturing: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  // 右侧末尾一格定宽:「恢复默认」按钮 / 「固定」标签 / 空,三种行的键帽右边缘对齐成一列。
  trail: { width: ds(52), alignItems: 'flex-end', justifyContent: 'center' },
  fixedTag: { color: colors.textMuted, fontSize: 11 },
  resetButton: { width: ds(24), height: ds(24), borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  resetButtonHover: { backgroundColor: colors.rowActive },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg, paddingHorizontal: spacing.md, marginTop: spacing.lg },
  footerHint: { flex: 1 },
});

// 与其它设置分区同一套主题写法:模块级 styles 随主题重建,App.tsx 的 key={theme} 让它重挂读新值。
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
