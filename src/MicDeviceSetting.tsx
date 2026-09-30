// 设置 → 语音输入 → 麦克风(桌面端;Vincent 09-27「Mac 客户端要能检测并选择输入设备」)。
//
//   选择:「跟随系统默认」+ enumerateDevices() 的音频输入。设备名在授权前是空的 → 显示
//         「允许访问麦克风」,点了弹一次系统授权、立刻关流、重新枚举。
//   电平条:选择行下面一整行(🎤 + 6 高的条),AnalyserNode RMS;只在已授权、这一栏挂着且窗口可见时
//           开流;离开设置页 / 窗口隐藏就释放(macOS 菜单栏的橙色麦克风点随之消失)。没授权不画条。
//   插拔:devicechange 刷新列表;选中的那台没了 → 改回默认、存盘、行内提示。
//
// 只在 web 平台渲染(Tauri 壳 = react-native-web)。选择用 AppSelect(Owner 09-30 嫌 DOM <select> 的
// 系统灰色渐变「太丑」):宽的设置页 = 行 + 浮层;窄窗口的设置子页(phone)= 微信设置行 + 底部面板,
// 整栏画成一组卡片,说明放在卡片下的 footer。手机原生不出现这一栏(settings-model 的 platforms: ['desktop'])。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { Ionicons } from './icons';
import AppSelect from './AppSelect';
import { SettingsCardContent, SettingsGroup } from './settings-kit';
import { MIC_REMOVED_NOTICE, micListView, rmsLevel, type RawMediaDevice } from './mic-device-model';
import { listMediaDevices, loadMicDeviceId, onMediaDevicesChange, openMicStream, requestMicPermission, saveMicDeviceId, stopStream } from './mic-device';
import { buttonStyle, buttonTextStyle } from './elevation';

const METER_INTERVAL_MS = 80;

const pageVisible = (): boolean => {
  const d = (globalThis as { document?: Document }).document;
  return !d || d.visibilityState !== 'hidden';
};

/** 设置页可见期间的实时电平;deviceId 变了就换流。enabled=false 时不开流。 */
function useInputLevel(enabled: boolean, deviceId: string): number {
  const [level, setLevel] = useState(0);
  const [visible, setVisible] = useState(pageVisible());
  useEffect(() => {
    const d = (globalThis as { document?: Document }).document;
    if (!d) return;
    const on = () => setVisible(pageVisible());
    d.addEventListener('visibilitychange', on);
    return () => d.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    if (!enabled || !visible) { setLevel(0); return; }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        const opened = await openMicStream(deviceId);
        if (cancelled) { stopStream(opened.stream); return; }
        stream = opened.stream;
        const AC = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
        if (!AC) return;
        ctx = new AC() as AudioContext;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        // 经 0 增益接到 destination(不回放):图里没有终点时,有的引擎不驱动分析节点。Chromium 不接也行,
        // WKWebView 上是否需要没有在真机上单独验过 —— 接上没有代价,所以保守接上。
        const mute = ctx.createGain();
        mute.gain.value = 0;
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyser.connect(mute);
        mute.connect(ctx.destination);
        const buf = new Float32Array(analyser.fftSize);
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        timer = setInterval(() => { analyser.getFloatTimeDomainData(buf); setLevel(rmsLevel(buf)); }, METER_INTERVAL_MS);
      } catch { if (!cancelled) setLevel(0); }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stopStream(stream);
      void ctx?.close().catch(() => {});
      setLevel(0);
    };
  }, [enabled, visible, deviceId]);
  return level;
}

/** 一行说明:两处(宽页 / 窄页 footer)同一句,390 宽的 footer 里也放得下一行。 */
export const MIC_HINT = '语音输入和测试都用它;拔掉后自动改回系统默认。';

/** 电平条:🎤 + 一条 6 高的条。有声音时图标变强调色;宽度 80ms 过渡,和采样间隔一致。 */
function MicLevelBar({ level }: { level: number }) {
  const pct = Math.round(level * 100);
  return (
    <View style={styles.levelRow} testID="voice-mic-level">
      <Ionicons name="mic" size={16} color={pct > 2 ? colors.accent : colors.textMuted} />
      <View
        style={styles.meter}
        testID="voice-mic-meter"
        accessibilityRole="progressbar"
        accessibilityLabel="麦克风输入电平"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <View style={[styles.meterFill, { width: `${pct}%` }, Platform.OS === 'web' ? ({ transitionProperty: 'width', transitionDuration: `${METER_INTERVAL_MS}ms` } as object) : null]} />
      </View>
    </View>
  );
}

export default function MicDeviceSetting({ phone = false }: { phone?: boolean }) {
  const [devices, setDevices] = useState<RawMediaDevice[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  const refresh = useCallback(() => { void listMediaDevices().then(setDevices); }, []);
  useEffect(() => {
    setSaved(loadMicDeviceId());
    refresh();
    return onMediaDevicesChange(refresh);
  }, [refresh]);

  const view = useMemo(() => micListView(devices ?? [], saved), [devices, saved]);
  const ready = devices !== null && saved !== null;

  useEffect(() => {
    if (!ready || !view.selectedRemoved) return;
    setSaved('');
    saveMicDeviceId('');
    setNotice(MIC_REMOVED_NOTICE);
  }, [ready, view.selectedRemoved]);

  const granted = ready && !view.needsPermission;
  const level = useInputLevel(granted, view.selected);

  const onPick = (id: string) => { setSaved(id); setNotice(null); saveMicDeviceId(id); };
  const onAllow = async () => {
    setAsking(true);
    setPermError(null);
    try {
      await requestMicPermission();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setPermError(name === 'NotAllowedError' || name === 'SecurityError' ? '麦克风权限被拒绝:请在系统设置的隐私 → 麦克风里允许本应用' : name === 'NotFoundError' ? '没有找到麦克风' : '麦克风无法启动');
    } finally {
      setAsking(false);
      refresh();
    }
  };

  const options = view.options.map(o => ({ value: o.id, label: o.label }));
  const select = (
    <AppSelect
      testID="voice-mic-select"
      title="麦克风"
      icon="mic-outline"
      sheet={phone}
      value={view.selected}
      options={options}
      disabled={!ready}
      onChange={onPick}
    />
  );
  const perm = ready && view.needsPermission ? (
    <View style={styles.permRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="允许访问麦克风" disabled={asking} onPress={() => void onAllow()} style={({ pressed }) => [styles.secondary, asking && styles.disabled, pressed && { opacity: 0.7 }]} testID="voice-mic-allow">
        <Text style={styles.secondaryText}>{asking ? '等待授权…' : '允许访问麦克风'}</Text>
      </Pressable>
      <Text style={styles.hint}>授权后才能看到设备名称。</Text>
    </View>
  ) : null;
  const status = (
    <>
      {permError ? <Text style={[styles.hint, styles.error]} testID="voice-mic-error">{permError}</Text> : null}
      {notice ? <Text style={[styles.hint, styles.warn]} testID="voice-mic-notice">{notice}</Text> : null}
    </>
  );

  if (phone) {
    return (
      <SettingsGroup footer={MIC_HINT} testID="voice-mic">
        {select}
        {perm || granted || permError || notice ? (
          <SettingsCardContent testID="voice-mic-row">
            <View style={styles.cardStack}>
              {perm ?? (granted ? <MicLevelBar level={level} /> : null)}
              {status}
            </View>
          </SettingsCardContent>
        ) : null}
      </SettingsGroup>
    );
  }

  return (
    <View style={styles.block} testID="voice-mic">
      <Text style={styles.label}>麦克风</Text>
      <View testID="voice-mic-row">{select}</View>
      {perm ?? (granted ? <MicLevelBar level={level} /> : null)}
      {status}
      <Text style={styles.hint} numberOfLines={1} testID="voice-mic-hint">{MIC_HINT}</Text>
    </View>
  );
}

// 上下留白走 spacing token:本栏上下各 md(比其它栏的 sm 多一档 —— 选择行 + 电平条 + 说明三层,
// 挤在 sm 里说明会贴着下一栏的标题),栏内各层间距 sm。
const makeStyles = () => StyleSheet.create({
  block: { paddingVertical: spacing.md, gap: spacing.sm },
  label: { color: colors.text, fontSize: 14 },
  cardStack: { gap: spacing.sm },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
  meter: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  secondary: { ...buttonStyle('secondary') },
  secondaryText: { ...buttonTextStyle('secondary') },
  disabled: { opacity: 0.45 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.failed },
  warn: { color: colors.accent },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
